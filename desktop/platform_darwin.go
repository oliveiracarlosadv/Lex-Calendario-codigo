//go:build darwin

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// No macOS o executável fica em Lex Calendário.app/Contents/MacOS.
func bundlePath(exe string) string {
	return filepath.Clean(filepath.Join(filepath.Dir(exe), "..", ".."))
}

func payloadDir(exe string) string {
	return filepath.Join(filepath.Dir(exe), "..", "Resources", "payload")
}

// installRoot é a pasta de dados do app: ~/Library/Application Support/Lex Calendário
// (local padrão de apps do macOS, fora de Documentos). Na primeira execução, migra os
// dados que ficavam em Documentos/Lex Calendário/dados (versões até 1.7).
func installRoot(exe string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Dir(bundlePath(exe))
	}
	root := filepath.Join(home, "Library", "Application Support", appName)
	_ = os.MkdirAll(root, 0o755)
	newData := filepath.Join(root, "dados")
	if !fileExists(newData) {
		if docs, err := documentsDir(); err == nil {
			old := filepath.Join(docs, appName, "dados")
			if fileExists(old) {
				if err := os.Rename(old, newData); err != nil {
					log.Printf("aviso: dados não migrados de %s: %v", old, err)
				}
			}
		}
	}
	return root
}

// backupsDir: cópias de segurança visíveis ao usuário em Documentos/Lex Calendário/backups.
func backupsDir(root string) string {
	if docs, err := documentsDir(); err == nil {
		return filepath.Join(docs, appName, "backups")
	}
	return filepath.Join(root, "backups")
}

// applicationsDir: /Applications (como os apps do sistema); sem permissão, ~/Applications.
func applicationsDir() string {
	if probe, err := os.CreateTemp("/Applications", ".lex-probe-*"); err == nil {
		probe.Close()
		_ = os.Remove(probe.Name())
		return "/Applications"
	}
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, "Applications")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func isInstalledCopy(exe string) bool {
	return fileExists(filepath.Join(filepath.Dir(exe), "..", "Resources", markerFile))
}

func documentsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Documents"), nil
}

func nodeBinary(payload string) string {
	arch := "x64"
	if runtime.GOARCH == "arm64" {
		arch = "arm64"
	}
	if p := filepath.Join(payload, "runtime-"+arch, "bin", "node"); fileExists(p) {
		return p
	}
	return filepath.Join(payload, "runtime", "bin", "node")
}

// copyApplication instala o app em Aplicativos (Launchpad, Spotlight, Finder) e remove a
// cópia antiga que ficava em Documentos/Lex Calendário (versões até 1.5).
func copyApplication(exe, target string) (string, error) {
	src := bundlePath(exe)
	dst := filepath.Join(applicationsDir(), appName+".app")
	_ = os.RemoveAll(dst)
	if out, err := exec.Command("ditto", src, dst).CombinedOutput(); err != nil {
		return "", fmt.Errorf("ditto: %v: %s", err, out)
	}
	_ = exec.Command("xattr", "-dr", "com.apple.quarantine", dst).Run()
	if err := os.WriteFile(filepath.Join(dst, "Contents", "Resources", markerFile), []byte(version), 0o644); err != nil {
		return "", err
	}
	legacy := filepath.Join(target, appName+".app")
	if !strings.EqualFold(legacy, dst) && !strings.HasPrefix(strings.ToLower(src), strings.ToLower(legacy)) {
		_ = os.RemoveAll(legacy)
	}
	// Atualiza o ícone em cache (Finder/Dock) e registra no Launch Services (Launchpad e Spotlight)
	_ = exec.Command("touch", dst).Run()
	// Registra no Launch Services (aparece no Launchpad e no Spotlight imediatamente)
	_ = exec.Command("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", dst).Run()
	return dst, nil
}

// createShortcuts adiciona o app ao Dock (se ainda não estiver lá) e o início automático.
func createShortcuts(target, installed string) error {
	if err := registerAutostart(installed); err != nil {
		log.Printf("aviso: início automático não registrado: %v", err)
	}
	// Ícone do Dock: se já existe (versões antigas, em Documentos), aponta para o app em Aplicativos
	if exported, err := exec.Command("defaults", "export", "com.apple.dock", "-").Output(); err == nil {
		re := regexp.MustCompile(`<string>[^<]*L[Ee]x(?: |%20)Calend[^<]*\.app/?</string>`)
		if re.Match(exported) {
			updated := re.ReplaceAll(exported, []byte("<string>"+xmlText(installed)+"</string>"))
			cmd := exec.Command("defaults", "import", "com.apple.dock", "-")
			cmd.Stdin = strings.NewReader(string(updated))
			if out, err := cmd.CombinedOutput(); err != nil {
				return fmt.Errorf("dock: %v: %s", err, out)
			}
			return exec.Command("killall", "Dock").Run()
		}
	}
	tile := fmt.Sprintf(`<dict><key>tile-data</key><dict><key>file-data</key><dict>`+
		`<key>_CFURLString</key><string>%s</string><key>_CFURLStringType</key><integer>0</integer>`+
		`</dict></dict></dict>`, xmlText(installed))
	if out, err := exec.Command("defaults", "write", "com.apple.dock", "persistent-apps", "-array-add", tile).CombinedOutput(); err != nil {
		return fmt.Errorf("dock: %v: %s", err, out)
	}
	return exec.Command("killall", "Dock").Run()
}

func xmlText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func launchDetached(installed string) error {
	return exec.Command("open", "-n", installed).Start()
}

func browserCandidates() []string {
	return []string{
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/Applications/Arc.app/Contents/MacOS/Arc",
	}
}

func openDefaultBrowser(url string) error { return exec.Command("open", url).Start() }

func hideWindow(*exec.Cmd) {}

// notifierPath: notificador nativo (Swift) dentro do próprio app.
func notifierPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	p := filepath.Join(filepath.Dir(exe), "LexNotifier")
	if fileExists(p) {
		return p
	}
	return ""
}

// notify mostra a notificação como "Lex Calendário" na Central de Notificações.
// Sem o notificador nativo, recorre ao AppleScript (atribuído ao Editor de Scripts).
func notify(title, message string) {
	if n := notifierPath(); n != "" {
		if err := exec.Command(n, title, message).Run(); err == nil {
			return
		}
	}
	script := fmt.Sprintf("display notification %q with title %q sound name \"Glass\"", message, title)
	_ = exec.Command("osascript", "-e", script).Run()
}

// requestNotificationPermission pede a permissão de notificações ao abrir o app.
func requestNotificationPermission() {
	if n := notifierPath(); n != "" {
		_ = exec.Command(n, "--autorizar").Start()
	}
}

// registerAutostart cria um LaunchAgent que inicia o Lex em segundo plano ao entrar no Mac.
func registerAutostart(installed string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, "Library", "LaunchAgents")
	_ = os.MkdirAll(dir, 0o755)
	binary := filepath.Join(installed, "Contents", "MacOS", "LexCalendario")
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>br.adv.caao.lexcalendario</string>
  <key>ProgramArguments</key><array><string>%s</string><string>--segundo-plano</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`, xmlText(binary))
	return os.WriteFile(filepath.Join(dir, "br.adv.caao.lexcalendario.plist"), []byte(plist), 0o644)
}

// portOwners lista os PIDs que escutam na porta (lsof; no Linux, ss como alternativa).
func portOwners(p int) []int {
	var pids []int
	if out, err := exec.Command("lsof", "-nP", "-t", fmt.Sprintf("-iTCP:%d", p), "-sTCP:LISTEN").Output(); err == nil {
		for _, f := range strings.Fields(string(out)) {
			if n, err := strconv.Atoi(f); err == nil {
				pids = append(pids, n)
			}
		}
	}
	if len(pids) == 0 {
		if out, err := exec.Command("ss", "-ltnpH", fmt.Sprintf("sport = :%d", p)).Output(); err == nil {
			for _, part := range strings.Split(string(out), "pid=")[1:] {
				end := strings.IndexAny(part, ",)")
				if end > 0 {
					if n, err := strconv.Atoi(part[:end]); err == nil {
						pids = append(pids, n)
					}
				}
			}
		}
	}
	return pids
}

func processCommand(pid int) string {
	out, err := exec.Command("ps", "-o", "command=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

const launcherPattern = "Contents/MacOS/LexCalendario"

// otherLaunchers lista outros processos do inicializador do Lex (versões anteriores em segundo plano).
func otherLaunchers() []int {
	self := os.Getpid()
	out, err := exec.Command("pgrep", "-f", launcherPattern).Output()
	if err != nil {
		return nil
	}
	var pids []int
	for _, f := range strings.Fields(string(out)) {
		if n, err := strconv.Atoi(f); err == nil && n != self && n != os.Getppid() {
			pids = append(pids, n)
		}
	}
	return pids
}

var macBrowsers = map[string]string{
	"chrome":  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"edge":    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"brave":   "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
	"safari":  "/Applications/Safari.app",
	"firefox": "/Applications/Firefox.app",
}

func namedBrowser(id string) string {
	if p := macBrowsers[id]; p != "" && fileExists(p) {
		return p
	}
	return ""
}

func openInNamedBrowser(id, url string) error {
	// Firefox: o Lex abre numa janela própria (assim o clique no Dock consegue trazê-la para a frente)
	if id == "firefox" {
		for _, bin := range []string{"/Applications/Firefox.app/Contents/MacOS/firefox", "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"} {
			if fileExists(bin) {
				if err := exec.Command(bin, "-new-window", url).Start(); err == nil {
					return nil
				}
			}
		}
	}
	app := map[string]string{"safari": "Safari", "firefox": "Firefox"}[id]
	if app == "" {
		return fmt.Errorf("navegador desconhecido")
	}
	return exec.Command("open", "-a", app, url).Start()
}

// openChromiumApp abre o Lex como janela de aplicativo do Chrome/Edge/Brave pelo Launch
// Services ("open"), como um clique no Dock: se o navegador já estiver aberto, a janela abre
// nele; se não, ele inicia normalmente. Executar o binário direto criava janelas em branco
// e um segundo Chrome preso ao processo do Lex.
func openChromiumApp(id, url string) error {
	bin := namedBrowser(id)
	if bin == "" {
		return fmt.Errorf("navegador %s não encontrado", id)
	}
	app := filepath.Clean(filepath.Join(filepath.Dir(bin), "..", ".."))
	return exec.Command("open", "-n", "-a", app, "--args", "--app="+url, "--window-size=1360,880").Run()
}

// ───────────────────────────── Desinstalação ─────────────────────────────

func trashPlatform(path string) bool {
	home, _ := os.UserHomeDir()
	dest := filepath.Join(home, ".Trash", filepath.Base(path))
	if fileExists(dest) {
		dest = fmt.Sprintf("%s %s", dest, time.Now().Format("2006-01-02 15.04.05"))
	}
	return os.Rename(path, dest) == nil
}

func askUninstallPlatform() string {
	script := `display dialog "Desinstalar o Lex Calendário?" & return & return & "• Só o aplicativo: remove o app, o ícone do Dock e o início automático. Seus dados e backups ficam guardados." & return & "• Tudo: também envia para a Lixeira todos os dados, configurações e backups do Lex." buttons {"Cancelar", "Só o aplicativo", "Tudo"} default button "Só o aplicativo" cancel button "Cancelar" with title "Lex Calendário" with icon caution`
	out, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		return ""
	}
	switch {
	case strings.Contains(string(out), "Tudo"):
		return "tudo"
	case strings.Contains(string(out), "aplicativo"):
		return "app"
	}
	return ""
}

// removeInstallation remove o app (Aplicativos), o ícone do Dock, o início automático e,
// com all=true, envia os dados e backups para a Lixeira.
func removeInstallation(all bool) {
	home, _ := os.UserHomeDir()
	agent := filepath.Join(home, "Library", "LaunchAgents", "br.adv.caao.lexcalendario.plist")
	_ = exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d", os.Getuid()), agent).Run()
	_ = os.Remove(agent)
	removeDockTile()
	for _, dir := range []string{"/Applications", filepath.Join(home, "Applications")} {
		app := filepath.Join(dir, appName+".app")
		if fileExists(app) {
			if err := os.RemoveAll(app); err != nil {
				moveToTrash(app)
			}
		}
	}
	if docs, err := documentsDir(); err == nil {
		legacy := filepath.Join(docs, appName, appName+".app")
		_ = os.RemoveAll(legacy)
		if all {
			moveToTrash(filepath.Join(docs, appName))
		}
	}
	if all {
		moveToTrash(filepath.Join(home, "Library", "Application Support", appName))
	}
}

// removeDockTile tira o Lex do Dock (preferências do Dock exportadas, editadas e reimportadas).
func removeDockTile() {
	tmp, err := os.CreateTemp("", "lex-dock-*.plist")
	if err != nil {
		return
	}
	tmp.Close()
	defer os.Remove(tmp.Name())
	if exec.Command("defaults", "export", "com.apple.dock", tmp.Name()).Run() != nil {
		return
	}
	buddy := "/usr/libexec/PlistBuddy"
	changed := false
	for i := 60; i >= 0; i-- {
		out, err := exec.Command(buddy, "-c", fmt.Sprintf("Print :persistent-apps:%d:tile-data:file-data:_CFURLString", i), tmp.Name()).Output()
		if err != nil {
			continue
		}
		u := strings.ReplaceAll(string(out), "%20", " ")
		if strings.Contains(u, "Lex Calend") || strings.Contains(u, "LEx Calend") {
			if exec.Command(buddy, "-c", fmt.Sprintf("Delete :persistent-apps:%d", i), tmp.Name()).Run() == nil {
				changed = true
			}
		}
	}
	if changed && exec.Command("defaults", "import", "com.apple.dock", tmp.Name()).Run() == nil {
		_ = exec.Command("killall", "Dock").Run()
	}
}

// focusExistingWindow traz para a frente a aba/janela do Lex já aberta no Chrome, Edge,
// Brave ou Safari (sem abrir o navegador se ele estiver fechado). Devolve false se não achar.
func focusExistingWindow(needle string) bool {
	chromium := map[string]string{"Google Chrome": "Google Chrome", "Microsoft Edge": "Microsoft Edge", "Brave Browser": "Brave Browser", "Chromium": "Chromium"}
	for process, app := range chromium {
		if exec.Command("pgrep", "-x", process).Run() != nil {
			continue
		}
		script := fmt.Sprintf(`tell application %q
	repeat with w in windows
		set i to 0
		repeat with t in tabs of w
			set i to i + 1
			if URL of t contains %q then
				if minimized of w then set minimized of w to false
				set active tab index of w to i
				set index of w to 1
				activate
				return "ok"
			end if
		end repeat
	end repeat
	return "no"
end tell`, app, needle)
		if out, err := exec.Command("osascript", "-e", script).Output(); err == nil && strings.TrimSpace(string(out)) == "ok" {
			return true
		}
	}
	// Firefox não expõe abas ao AppleScript: traz para a frente a janela cujo título é do Lex
	// (requer a permissão de Acessibilidade, pedida pelo macOS na primeira vez)
	if exec.Command("pgrep", "-x", "firefox").Run() == nil {
		script := `tell application "System Events"
	tell process "firefox"
		repeat with w in windows
			if name of w contains "Lex Calendário" then
				if value of attribute "AXMinimized" of w then set value of attribute "AXMinimized" of w to false
				perform action "AXRaise" of w
				set frontmost to true
				return "ok"
			end if
		end repeat
	end tell
end tell
return "no"`
		if out, err := exec.Command("osascript", "-e", script).Output(); err == nil && strings.TrimSpace(string(out)) == "ok" {
			return true
		}
	}
	if exec.Command("pgrep", "-x", "Safari").Run() == nil {
		script := fmt.Sprintf(`tell application "Safari"
	repeat with w in windows
		repeat with t in tabs of w
			if URL of t contains %q then
				if miniaturized of w then set miniaturized of w to false
				set current tab of w to t
				set index of w to 1
				activate
				return "ok"
			end if
		end repeat
	end repeat
	return "no"
end tell`, needle)
		if out, err := exec.Command("osascript", "-e", script).Output(); err == nil && strings.TrimSpace(string(out)) == "ok" {
			return true
		}
	}
	return false
}

// appModeProcesses lista os processos principais do navegador abertos com o perfil próprio do Lex.
func appModeProcesses(profile string) []int {
	out, err := exec.Command("ps", "-axo", "pid=,command=").Output()
	if err != nil {
		return nil
	}
	var pids []int
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "--user-data-dir="+profile) || strings.Contains(line, "--type=") {
			continue
		}
		if f := strings.Fields(line); len(f) > 0 {
			if n, err := strconv.Atoi(f[0]); err == nil {
				pids = append(pids, n)
			}
		}
	}
	return pids
}

// openAppModeWindow abre a janela própria do Lex (perfil separado) pelo Launch Services.
//   - Janela já aberta e respondendo: traz para a frente (não abre outra).
//   - Janela presa (sem sinal da página): encerra, remove o bloqueio do perfil e abre de novo.
// Dois navegadores no mesmo perfil travavam a janela nova ("não deixa selecionar nada").
func openAppModeWindow(url, profile string, alive bool) (bool, error) {
	pids := appModeProcesses(profile)
	if len(pids) == 1 && alive { // mais de um processo no mesmo perfil = travado
		// Restaura a janela se estiver minimizada (Acessibilidade) e traz para a frente.
		script := fmt.Sprintf(`tell application "System Events"
	set p to first process whose unix id is %d
	set restored to true
	repeat with w in windows of p
		try
			if value of attribute "AXMinimized" of w then set value of attribute "AXMinimized" of w to false
		on error
			set restored to false
		end try
	end repeat
	set frontmost of p to true
	if (count of windows of p) is 0 then return "sem-janela"
	if restored then return "ok"
	return "sem-permissao"
end tell`, pids[0])
		out, err := exec.Command("osascript", "-e", script).Output()
		if err == nil && strings.TrimSpace(string(out)) == "ok" {
			return true, nil
		}
		// Sem permissão para restaurar (ou sem janela): abre uma janela nova no mesmo navegador.
		// A página antiga, minimizada, cede o lugar; nada fica travado porque o processo é o mesmo.
		log.Printf("janela própria não pôde ser restaurada (%s); abrindo outra", strings.TrimSpace(string(out)))
		return true, launchAppModeWindow(url, profile)
	}
	if len(pids) > 0 {
		log.Printf("janela própria presa (%v); reiniciando", pids)
		for _, pid := range pids {
			if p, err := os.FindProcess(pid); err == nil {
				_ = p.Kill()
			}
		}
		time.Sleep(800 * time.Millisecond)
	}
	for _, lock := range []string{"SingletonLock", "SingletonSocket", "SingletonCookie"} {
		_ = os.Remove(filepath.Join(profile, lock))
	}
	if err := launchAppModeWindow(url, profile); err != nil {
		return false, nil
	}
	return true, nil
}

// launchAppModeWindow abre a janela própria pelo Launch Services (se o navegador deste perfil já
// estiver aberto, ele mesmo abre a janela nova).
func launchAppModeWindow(url, profile string) error {
	for _, app := range []string{"/Applications/Google Chrome.app", "/Applications/Microsoft Edge.app", "/Applications/Brave Browser.app", "/Applications/Chromium.app"} {
		if !fileExists(app) {
			continue
		}
		if err := exec.Command("open", "-n", "-a", app, "--args",
			"--user-data-dir="+profile, "--app="+url, "--no-first-run", "--no-default-browser-check", "--window-size=1360,880").Run(); err == nil {
			return nil
		}
	}
	return fmt.Errorf("nenhum navegador compatível encontrado")
}

// defaultBrowserChoice: sem escolha salva, abre no navegador padrão do sistema.
func defaultBrowserChoice() string { return "padrao" }

// afterAppWindowOpened: nada a fazer nesta plataforma.
func afterAppWindowOpened() {}
