//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func payloadDir(exe string) string   { return filepath.Join(filepath.Dir(exe), "payload") }
func installRoot(exe string) string  { return filepath.Dir(exe) }
func isInstalledCopy(exe string) bool { return fileExists(filepath.Join(filepath.Dir(exe), markerFile)) }
func nodeBinary(payload string) string {
	return filepath.Join(payload, "runtime", "bin", "node")
}

// xdgDir consulta xdg-user-dir (respeita nomes localizados, ex.: "Documentos").
func xdgDir(kind string, fallbacks ...string) (string, error) {
	if out, err := exec.Command("xdg-user-dir", kind).Output(); err == nil {
		if p := strings.TrimSpace(string(out)); p != "" {
			home, _ := os.UserHomeDir()
			if p != home {
				return p, nil
			}
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	for _, f := range fallbacks {
		if p := filepath.Join(home, f); fileExists(p) {
			return p, nil
		}
	}
	return filepath.Join(home, fallbacks[0]), nil
}

func documentsDir() (string, error) { return xdgDir("DOCUMENTS", "Documentos", "Documents") }

func copyApplication(exe, target string) (string, error) {
	src := filepath.Dir(exe)
	skip := func(rel string) bool {
		return strings.Split(rel, string(filepath.Separator))[0] == "dados"
	}
	if err := copyTree(src, target, skip); err != nil {
		return "", err
	}
	installed := filepath.Join(target, filepath.Base(exe))
	_ = os.Chmod(installed, 0o755)
	if err := os.WriteFile(filepath.Join(target, markerFile), []byte(version), 0o644); err != nil {
		return "", err
	}
	return installed, nil
}

// createShortcuts cria o atalho na Área de Trabalho e no menu de aplicativos.
func createShortcuts(target, installed string) error {
	// Instalado pelo pacote .deb: os atalhos chamam o inicializador do sistema, que atualiza esta
	// cópia quando um pacote mais novo for instalado e depois abre o app.
	execPath := installed
	if sys := filepath.Join(systemPackageDir, appName); fileExists(sys) {
		execPath = sys
	}
	entry := fmt.Sprintf(`[Desktop Entry]
Type=Application
Version=1.0
Name=%s
Comment=Agenda jurídica inteligente para advogados
Exec="%s"
Path=%s
Icon=%s
Terminal=false
Categories=Office;Calendar;
StartupWMClass=lex-calendario
`, appName, execPath, target, filepath.Join(target, "lex-calendario.png"))
	if execPath != installed {
		// Se o pacote .deb for removido, o atalho some sozinho do menu
		entry += fmt.Sprintf("TryExec=%s\n", execPath)
	}

	desktop, err := xdgDir("DESKTOP", "Área de Trabalho", "Área de trabalho", "Desktop")
	if err != nil {
		return err
	}
	_ = os.MkdirAll(desktop, 0o755)
	onDesktop := filepath.Join(desktop, "lex-calendario.desktop")
	if err := os.WriteFile(onDesktop, []byte(entry), 0o755); err != nil {
		return err
	}
	// GNOME exige marcar o atalho como confiável para permitir execução
	_ = exec.Command("gio", "set", onDesktop, "metadata::trusted", "true").Run()

	home, _ := os.UserHomeDir()
	apps := filepath.Join(home, ".local", "share", "applications")
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		apps = filepath.Join(xdg, "applications")
	}
	_ = os.MkdirAll(apps, 0o755)
	_ = os.WriteFile(filepath.Join(apps, "lex-calendario.desktop"), []byte(entry), 0o755)
	_ = exec.Command("update-desktop-database", apps).Run()

	// Inicia em segundo plano ao entrar na sessão (lembretes)
	autostartDir := filepath.Join(home, ".config", "autostart")
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		autostartDir = filepath.Join(xdg, "autostart")
	}
	_ = os.MkdirAll(autostartDir, 0o755)
	autostart := strings.Replace(entry, fmt.Sprintf("Exec=\"%s\"", execPath), fmt.Sprintf("Exec=\"%s\" --segundo-plano", execPath), 1) +
		"X-GNOME-Autostart-enabled=true\nNoDisplay=true\n"
	_ = os.WriteFile(filepath.Join(autostartDir, "lex-calendario.desktop"), []byte(autostart), 0o644)
	return nil
}

func launchDetached(installed string) error {
	cmd := exec.Command(installed)
	cmd.Dir = filepath.Dir(installed)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start()
}

func browserCandidates() []string {
	return []string{"google-chrome", "google-chrome-stable", "microsoft-edge", "brave-browser", "chromium", "chromium-browser"}
}

func openDefaultBrowser(url string) error { return exec.Command("xdg-open", url).Start() }

func hideWindow(*exec.Cmd) {}

func notify(title, message string) {
	if _, err := exec.LookPath("notify-send"); err == nil {
		_ = exec.Command("notify-send", "-a", appName, "-u", "critical", "-i", "x-office-calendar", title, message).Run()
		return
	}
	if _, err := exec.LookPath("zenity"); err == nil {
		_ = exec.Command("zenity", "--info", "--title", title, "--text", message).Start()
	}
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

const launcherPattern = "Lex Calendário/Lex Calendário$"

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

func requestNotificationPermission() {}

func backupsDir(root string) string { return filepath.Join(root, "backups") }

func namedBrowser(id string) string {
	names := map[string][]string{
		"chrome":  {"google-chrome", "google-chrome-stable"},
		"edge":    {"microsoft-edge", "microsoft-edge-stable"},
		"brave":   {"brave-browser"},
		"firefox": {"firefox"},
	}[id]
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

func openInNamedBrowser(id, url string) error {
	if bin := namedBrowser(id); bin != "" {
		return exec.Command(bin, url).Start()
	}
	return fmt.Errorf("navegador não encontrado")
}

// openChromiumApp abre o Lex como janela de aplicativo do Chrome/Edge/Brave no perfil do usuário.
func openChromiumApp(id, url string) error {
	bin := namedBrowser(id)
	if bin == "" {
		return fmt.Errorf("navegador %s não encontrado", id)
	}
	cmd := exec.Command(bin, "--app="+url, "--window-size=1360,880")
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// ───────────────────────────── Desinstalação ─────────────────────────────

func trashPlatform(path string) bool {
	return exec.Command("gio", "trash", path).Run() == nil
}

func askUninstallPlatform() string {
	if _, err := exec.LookPath("zenity"); err == nil {
		out, err := exec.Command("zenity", "--list", "--radiolist", "--title", appName, "--text", "Desinstalar o Lex Calendário?",
			"--column", "", "--column", "Opção", "TRUE", "Só o aplicativo (mantém os dados)", "FALSE", "Tudo (aplicativo, dados e backups)").Output()
		if err != nil {
			return ""
		}
		if strings.HasPrefix(strings.TrimSpace(string(out)), "Tudo") {
			return "tudo"
		}
		return "app"
	}
	fmt.Print("Desinstalar o Lex Calendário? [a] só o aplicativo · [t] tudo, inclusive dados · [c] cancelar: ")
	var answer string
	_, _ = fmt.Scanln(&answer)
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "t":
		return "tudo"
	case "a":
		return "app"
	}
	return ""
}

func removeInstallation(all bool) {
	home, _ := os.UserHomeDir()
	if desktop, err := xdgDir("DESKTOP", "Área de Trabalho", "Área de trabalho", "Desktop"); err == nil {
		_ = os.Remove(filepath.Join(desktop, "lex-calendario.desktop"))
	}
	apps := filepath.Join(home, ".local", "share", "applications")
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
		apps = filepath.Join(xdg, "applications")
	}
	_ = os.Remove(filepath.Join(apps, "lex-calendario.desktop"))
	autostart := filepath.Join(home, ".config", "autostart")
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		autostart = filepath.Join(xdg, "autostart")
	}
	_ = os.Remove(filepath.Join(autostart, "lex-calendario.desktop"))
	// Pacote do sistema (.deb): pede a senha para removê-lo também (sem ele o menu reinstalaria o app)
	if fileExists(systemPackageDir) {
		if _, err := exec.LookPath("pkexec"); err == nil {
			_ = exec.Command("pkexec", "dpkg", "-r", "lex-calendario").Run()
		}
	}
	docs, err := documentsDir()
	if err != nil {
		return
	}
	target := filepath.Join(docs, appName)
	if all {
		moveToTrash(target)
		return
	}
	entries, _ := os.ReadDir(target)
	for _, e := range entries {
		if e.Name() == "dados" || e.Name() == "backups" {
			continue
		}
		_ = os.RemoveAll(filepath.Join(target, e.Name()))
	}
}

// focusExistingWindow: nesta plataforma o navegador escolhido decide; abre a janela normalmente.
func focusExistingWindow(string) bool { return false }

// openAppModeWindow: nesta plataforma a janela própria é aberta diretamente pelo executável do navegador.
func openAppModeWindow(string, string, bool) (bool, error) { return false, nil }

// defaultBrowserChoice: sem escolha salva, abre no navegador padrão do sistema.
func defaultBrowserChoice() string { return "padrao" }

// afterAppWindowOpened: nada a fazer nesta plataforma.
func afterAppWindowOpened() {}
