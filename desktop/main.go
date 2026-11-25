// Lex Calendário — instalador e inicializador para desktop.
//
// Primeiro duplo clique (cópia baixada): copia o aplicativo para
// Documentos/Lex Calendário, cria os atalhos do sistema, registra o início
// automático com o sistema e abre o app.
// Cliques seguintes (cópia instalada): inicia o servidor local (Node.js
// embarcado + build Next.js "standalone") em 127.0.0.1 e abre uma janela
// dedicada do navegador. O servidor continua em segundo plano para enviar
// os lembretes como notificações nativas do sistema; "Sair do Lex Calendário"
// no menu do app encerra tudo.
package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	appName     = "Lex Calendário"
	appID       = "lex-calendario"
	port        = 47830
	markerFile  = ".lex-instalado"
	startTimeout = 90 * time.Second
)

// definidas no build: -ldflags "-X main.version=1.2.3 -X main.googleClientID=..."
var (
	version            = "dev"
	googleClientID     = ""
	googleClientSecret = ""
	microsoftClientID  = ""
)

// installOnly: chamado pelos instaladores com assistente (Windows, macOS): instala sem abrir o
// app — quem abre é o botão "Concluir" do assistente. Em atualizações (LEX_UPDATE=1) reabre como antes.
var installOnly bool

// systemPackageDir: pasta do pacote .deb no Linux. O atalho do menu aponta para ela; o
// inicializador de lá instala ou atualiza a cópia em Documentos e abre o app.
const systemPackageDir = "/opt/lex-calendario"

func main() {
	exe, err := os.Executable()
	if err != nil {
		fatal(err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	for _, a := range os.Args[1:] {
		switch a {
		case "--versao":
			fmt.Println(version)
			return
		case "--desinstalar":
			runUninstall("", true)
			return
		case "--instalar":
			installOnly = os.Getenv("LEX_UPDATE") != "1"
		}
	}

	if runtime.GOOS == "linux" && strings.HasPrefix(exe, systemPackageDir+"/") && os.Getenv("LEX_UPDATE") != "1" {
		// Pacote do sistema (.deb): se a cópia em Documentos já está nesta versão (ou mais nova), só abre
		if prev, launcher := installedLauncher(); prev != "" && version != "dev" && compareVersions(prev, version) >= 0 {
			bg := false
			for _, a := range os.Args[1:] {
				bg = bg || a == "--segundo-plano"
			}
			if err := launchInstalled(launcher, bg); err != nil {
				fatal(err)
			}
			return
		}
	}

	if !isInstalledCopy(exe) && os.Getenv("LEX_SKIP_INSTALL") == "" {
		if err := runInstaller(exe); err != nil {
			fatal(fmt.Errorf("não foi possível instalar o %s: %w", appName, err))
		}
		return
	}

	background := os.Getenv("LEX_BACKGROUND") == "1"
	for _, a := range os.Args[1:] {
		if a == "--segundo-plano" {
			background = true
		}
	}
	if err := runApp(exe, background); err != nil {
		fatal(err)
	}
}

// ───────────────────────────── Instalação ─────────────────────────────

func runInstaller(exe string) error {
	docs, err := documentsDir()
	if err != nil {
		return err
	}
	target := filepath.Join(docs, appName)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	updating := os.Getenv("LEX_UPDATE") == "1"

	// Já existe uma instalação? Atualiza no lugar — mas nunca troca uma versão mais nova
	// por esta (ex.: o usuário abriu um pacote antigo que ficou em Downloads).
	previous, previousLauncher := installedLauncher()
	if previous != "" && version != "dev" && compareVersions(previous, version) > 0 {
		log.Printf("versão instalada %s é mais nova que %s; abrindo a instalada", previous, version)
		if installOnly {
			return nil
		}
		notify(appName, fmt.Sprintf("A versão %s já está instalada. Abrindo o aplicativo…", previous))
		return launchDetached(previousLauncher)
	}
	if previous != "" && previous != version {
		notify(appName, fmt.Sprintf("Atualizando da versão %s para %s…", previous, version))
	}
	// Atualização: encerra a versão em execução antes de sobrescrever arquivos
	// (à força, se o pedido de encerramento não funcionar — ex.: pasta de dados recriada).
	stopRunningInstance(filepath.Join(target, "dados"))
	if runtime.GOOS == "darwin" {
		if home, err := os.UserHomeDir(); err == nil {
			stopRunningInstance(filepath.Join(home, "Library", "Application Support", appName, "dados"))
		}
	}
	if err := freePort(); err != nil {
		log.Printf("aviso: %v", err)
	}
	// Atualização automática: o inicializador antigo que baixou este pacote também sai.
	if pid, err := strconv.Atoi(os.Getenv("LEX_UPDATE_PARENT")); err == nil && pid > 0 && pid != os.Getpid() {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
		}
	}
	// Inicializadores de versões anteriores que ficaram em segundo plano
	for _, pid := range otherLaunchers() {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
		}
	}

	installed, err := copyApplication(exe, target)
	if err != nil {
		return err
	}
	dataDir := filepath.Join(installRoot(installed+"/Contents/MacOS/x"), "dados")
	if runtime.GOOS != "darwin" {
		dataDir = filepath.Join(target, "dados")
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	writeDefaultConfig(dataDir)

	if err := createShortcuts(target, installed); err != nil {
		log.Printf("aviso: atalhos não foram criados por completo: %v", err)
	}
	switch {
	case installOnly:
		if previous != "" && previous != version {
			_ = os.WriteFile(filepath.Join(dataDir, "atualizado-de.txt"), []byte(previous), 0o644)
		}
	case previous == "":
		notify(appName, "Instalação concluída. Abrindo o aplicativo…")
	case previous != version:
		_ = os.WriteFile(filepath.Join(dataDir, "atualizado-de.txt"), []byte(previous), 0o644)
		notify(appName, fmt.Sprintf("Atualizado para a versão %s. Seus dados foram mantidos.", version))
	default:
		notify(appName, "Aplicativo reinstalado. Abrindo…")
	}
	_ = os.Remove(filepath.Join(dataDir, "atualizar-agora"))
	writeUpdateStatus(dataDir, updateStatus{State: "atualizado", Latest: version, CheckedAt: time.Now().Format(time.RFC3339)})
	if installOnly {
		return nil
	}
	return launchInstalled(installed, updating)
}

// copyTree copia recursivamente src para dst, preservando permissões.
func copyTree(src, dst string, skip func(rel string) bool) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel != "." && skip != nil && skip(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		out := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(out, info.Mode().Perm()|0o700)
		case info.Mode()&os.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			_ = os.Remove(out)
			return os.Symlink(link, out)
		default:
			return copyFile(path, out, info.Mode().Perm())
		}
	})
}

func copyFile(src, dst string, perm fs.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm|0o200)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}

func writeDefaultConfig(dataDir string) {
	path := filepath.Join(dataDir, "config.env")
	if _, err := os.Stat(path); err == nil {
		return
	}
	content := `# Lex Calendário — configuração local (opcional)
# As chaves públicas do servidor (Supabase) já vêm no aplicativo.
# Preencha abaixo apenas se quiser usar recursos de servidor nesta máquina.
#
# SUPABASE_SERVICE_ROLE_KEY=
# ENCRYPTION_KEY=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# MICROSOFT_CLIENT_ID=
# MICROSOFT_CLIENT_SECRET=
# ANTHROPIC_API_KEY=
# DATAJUD_API_KEY=
`
	_ = os.WriteFile(path, []byte(content), 0o600)
}

// ───────────────────────────── Execução ─────────────────────────────

func runApp(exe string, background bool) error {
	root := installRoot(exe)
	dataDir := filepath.Join(root, "dados")
	_ = os.MkdirAll(dataDir, 0o755)

	logFile, err := os.OpenFile(filepath.Join(dataDir, "lex.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err == nil {
		log.SetOutput(logFile)
		defer logFile.Close()
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)

	// Já existe um Lex aberto? Só pede a janela a ele (nunca derruba o servidor em uso).
	o, err := handOffOrOwn(background)
	if err != nil {
		return fmt.Errorf("outra cópia do %s está travada (%v). Reinicie o computador e tente de novo", appName, err)
	}
	if o == nil {
		log.Printf("já em execução: janela pedida ao inicializador principal (segundo plano: %v)", background)
		return nil
	}
	defer o.close()
	_ = os.Remove(filepath.Join(dataDir, "iniciando")) // trava das versões até 1.8

	// Este processo é o dono: um servidor do Lex que ainda esteja na porta é órfão
	// (ex.: versão anterior encerrada à força) e é substituído.
	if runningVersion(url) != "" {
		log.Print("servidor órfão na porta; substituindo")
		stopServer(dataDir)
	}
	if err := freePort(); err != nil {
		return err
	}

	payload := payloadDir(exe)
	node := nodeBinary(payload)
	server := filepath.Join(payload, "app", "server.js")
	for _, p := range []string{node, server} {
		if _, err := os.Stat(p); err != nil {
			return fmt.Errorf("arquivo do aplicativo ausente (%s). Baixe o pacote novamente", p)
		}
	}

	token := randomToken()
	_ = os.WriteFile(filepath.Join(dataDir, "token"), []byte(token), 0o600)
	heartbeat := filepath.Join(dataDir, "heartbeat")
	_ = os.WriteFile(heartbeat, []byte(fmt.Sprint(time.Now().Unix())), 0o600)

	cronSecret := randomToken()
	env := append(os.Environ(),
		fmt.Sprintf("PORT=%d", port),
		"HOSTNAME=127.0.0.1",
		"NODE_ENV=production",
		"NEXT_TELEMETRY_DISABLED=1",
		"LEX_DESKTOP=1",
		"LEX_DESKTOP_VERSION="+version,
		"LEX_DESKTOP_TOKEN="+token,
		"LEX_HEARTBEAT_FILE="+heartbeat,
		// Modo local: banco embutido e sessões assinadas com segredo desta instalação
		"LEX_LOCAL=1",
		"LEX_DATA_DIR="+dataDir,
		"LEX_LOCAL_SECRET="+persistentSecret(filepath.Join(dataDir, ".segredo"), func() string { return randomToken() + randomToken() }),
		"ENCRYPTION_KEY="+persistentSecret(filepath.Join(dataDir, ".chave"), func() string {
			b := make([]byte, 32)
			_, _ = rand.Read(b)
			return base64.StdEncoding.EncodeToString(b)
		}),
		"SUPABASE_SERVICE_ROLE_KEY="+randomToken(),
		"CRON_SECRET="+cronSecret,
	)
	for k, v := range map[string]string{"GOOGLE_CLIENT_ID": googleClientID, "GOOGLE_CLIENT_SECRET": googleClientSecret, "MICROSOFT_CLIENT_ID": microsoftClientID} {
		if v != "" {
			env = append(env, k+"="+v)
		}
	}
	env = append(env, readEnvFile(filepath.Join(dataDir, "config.env"))...)

	openWindow := func() {
		// A janela do Lex já está aberta (a página avisa a cada minuto)? Traz para a frente
		// em vez de abrir outra a cada clique no ícone do Dock.
		if info, err := os.Stat(heartbeat); err == nil && time.Since(info.ModTime()) < 75*time.Second && focusExistingWindow(fmt.Sprintf(":%d/", port)) {
			return
		}
		// "?janela=1": a página sabe que foi aberta pelo ícone e se fecha se o Lex já estiver aberto em outra aba
		if err := openApp(url+"calendario?janela=1", dataDir); err != nil {
			log.Printf("aviso: %v", err)
		}
	}
	if !background {
		o.requestWindow() // abre assim que o servidor responder
	}

	jobsStarted := false
	failures := 0
	for {
		o.markStarting()
		cmd := exec.Command(node, server)
		cmd.Dir = filepath.Join(payload, "app")
		cmd.Env = env
		if logFile != nil {
			cmd.Stdout = logFile
			cmd.Stderr = logFile
		}
		hideWindow(cmd)
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("não foi possível iniciar o servidor local: %w", err)
		}
		exited := make(chan error, 1)
		go func() { exited <- cmd.Wait() }()
		_ = os.WriteFile(filepath.Join(dataDir, "servidor.pid"), []byte(strconv.Itoa(cmd.Process.Pid)), 0o600)

		if !waitReady(url, startTimeout, exited) {
			_ = cmd.Process.Kill()
			failures++
			if failures >= 3 {
				return errors.New("o servidor local não respondeu. Consulte dados/lex.log")
			}
			log.Print("servidor não respondeu; tentando de novo")
			continue
		}
		// Prepara o banco local (na 1ª execução cria as tabelas) antes de abrir a janela
		warmClient := &http.Client{Timeout: 3 * time.Minute}
		if res, err := warmClient.Get(url + "local/health"); err == nil {
			res.Body.Close()
		} else {
			log.Printf("aviso: banco local ainda preparando: %v", err)
		}
		if !jobsStarted {
			jobsStarted = true
			requestNotificationPermission()
			go scheduleJobs(url, cronSecret)
			backupURL, backupSecret, backupFolder = url, cronSecret, backupsDir(root)
			go autoBackup(url, cronSecret, backupsDir(root))
			go updateLoop(dataDir, o)
		}
		log.Printf("%s %s em %s (segundo plano: %v)", appName, version, url, background)
		o.markReady(openWindow, false)

		stopWatch := make(chan struct{})
		go watchServer(url, cmd, stopWatch)

		select {
		case err := <-exited:
			close(stopWatch)
			log.Printf("servidor encerrado: %v", err)
			select {
			case <-o.quit:
				return nil
			default:
			}
			// "Limpar todas as informações" (Configurações → Aplicativo): o servidor saiu para liberar o banco
			if reset := filepath.Join(dataDir, "limpar-tudo"); fileExists(reset) {
				_ = os.Remove(reset)
				wipeData(dataDir)
				notify(appName, "Todas as informações foram apagadas (estão na Lixeira). O Lex recomeça do zero.")
				o.requestWindow()
				continue
			}
			if err == nil {
				return nil // "Sair do Lex Calendário" no menu do app
			}
			failures++
			if failures > 5 {
				return fmt.Errorf("o servidor local parou várias vezes (%v). Consulte dados/lex.log", err)
			}
			log.Print("servidor parou inesperadamente; reiniciando")
			time.Sleep(2 * time.Second)
		case <-o.quit:
			close(stopWatch)
			log.Print("encerramento pedido por outra cópia do Lex (atualização)")
			stopServer(dataDir)
			_ = cmd.Process.Kill()
			<-exited
			return nil
		}
	}
}

// watchServer reinicia o servidor se ele ficar travado (sem responder) por 3 minutos seguidos.
// Demoras curtas são normais: o banco embutido roda na mesma linha de execução do servidor.
func watchServer(url string, cmd *exec.Cmd, stop <-chan struct{}) {
	var since time.Time
	tick := time.NewTicker(20 * time.Second)
	defer tick.Stop()
	client := &http.Client{Timeout: 15 * time.Second}
	for {
		select {
		case <-stop:
			return
		case <-tick.C:
		}
		res, err := client.Get(url + "api/health")
		if err == nil {
			res.Body.Close()
			since = time.Time{}
			continue
		}
		if since.IsZero() {
			since = time.Now()
			continue
		}
		if time.Since(since) > 3*time.Minute {
			log.Print("servidor travado há 3 minutos; reiniciando")
			_ = cmd.Process.Kill()
			return
		}
	}
}

func waitReady(url string, timeout time.Duration, exited <-chan error) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			return false
		default:
		}
		if runningVersion(url) != "" {
			return true
		}
		time.Sleep(400 * time.Millisecond)
	}
	return false
}

// Não segue redirecionamentos: só uma resposta 200 do /api/health conta como "pronto".
var httpClient = &http.Client{
	Timeout:       2 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// runningVersion devolve a versão do Lex Calendário que responde na porta, ou "".
func runningVersion(url string) string {
	res, err := httpClient.Get(url + "api/health")
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ""
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
	text := string(body)
	if !strings.Contains(text, appID) {
		return ""
	}
	// formato: {"app":"lex-calendario","version":"x.y.z",...}
	if i := strings.Index(text, `"version":"`); i >= 0 {
		rest := text[i+11:]
		if j := strings.Index(rest, `"`); j >= 0 {
			return rest[:j]
		}
	}
	return "?"
}

// stopRunningInstance encerra o Lex em execução: pede ao inicializador dono (1.9+) e,
// para versões anteriores, ao servidor diretamente.
func stopRunningInstance(dataDir string) {
	if ownerVersion() != "" && stopOwner() {
		return
	}
	stopServer(dataDir)
}

func stopServer(dataDir string) {
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	if runningVersion(url) == "" {
		return
	}
	token, _ := os.ReadFile(filepath.Join(dataDir, "token"))
	req, err := http.NewRequest(http.MethodPost, url+"api/desktop/quit", nil)
	if err != nil {
		return
	}
	req.Header.Set("X-Lex-Desktop-Token", strings.TrimSpace(string(token)))
	if res, err := httpClient.Do(req); err == nil {
		res.Body.Close()
	}
	for i := 0; i < 30 && runningVersion(url) != ""; i++ {
		time.Sleep(300 * time.Millisecond)
	}
	time.Sleep(500 * time.Millisecond)
}

// openApp abre uma janela dedicada (modo aplicativo do Chrome/Edge/Brave/Chromium);
// sem navegador compatível, usa o navegador padrão.
// openApp abre o Lex no navegador escolhido em Configurações → Aplicativo (arquivo dados/navegador.txt):
//
//	padrao  — navegador padrão do sistema (padrão)
//	chrome / edge / brave — janela de aplicativo no SEU perfil do navegador (favoritos e logins preservados)
//	safari / firefox — abre no navegador indicado
//	app     — janela própria com perfil separado (comportamento das versões até 1.7)
func openApp(url, dataDir string) error {
	choice := defaultBrowserChoice()
	if b, err := os.ReadFile(filepath.Join(dataDir, "navegador.txt")); err == nil && strings.TrimSpace(string(b)) != "" {
		choice = strings.TrimSpace(string(b))
	}
	switch choice {
	case "padrao":
		return openDefaultBrowser(url)
	case "chrome", "edge", "brave":
		// Sem --user-data-dir: usa o perfil do próprio usuário (se o navegador já estiver aberto, abre nele)
		if err := openChromiumApp(choice, url); err == nil {
			return nil
		}
		return openDefaultBrowser(url)
	case "safari", "firefox":
		if err := openInNamedBrowser(choice, url); err == nil {
			return nil
		}
		return openDefaultBrowser(url)
	}
	return openAppWindow(url, dataDir)
}

// openAppWindow: janela de aplicativo com perfil separado (dados/navegador).
func openAppWindow(url, dataDir string) error {
	profile := filepath.Join(dataDir, "navegador")
	alive := false
	if info, err := os.Stat(filepath.Join(dataDir, "heartbeat")); err == nil && time.Since(info.ModTime()) < 75*time.Second {
		alive = true
	}
	// Plataforma com tratamento próprio (macOS): reaproveita a janela aberta ou limpa uma presa
	if handled, err := openAppModeWindow(url, profile, alive); handled {
		return err
	}
	defer afterAppWindowOpened()
	for _, browser := range browserCandidates() {
		if _, err := os.Stat(browser); err != nil {
			if _, lookErr := exec.LookPath(browser); lookErr != nil {
				continue
			}
		}
		cmd := exec.Command(browser,
			"--app="+url,
			"--user-data-dir="+profile,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1360,880",
		)
		if err := cmd.Start(); err == nil {
			go func() { _ = cmd.Wait() }()
			return nil
		}
	}
	return openDefaultBrowser(url)
}

// autoBackup salva uma cópia por dia em Documentos/Lex Calendário/backups (mantém as 10 mais recentes).
func autoBackup(url, secret, dir string) {
	time.Sleep(3 * time.Minute)
	client := &http.Client{Timeout: 10 * time.Minute}
	for {
		today := time.Now().Format("2006-01-02")
		target := filepath.Join(dir, "lex-calendario-backup-"+today+".json")
		if !fileExists(target) {
			if err := os.MkdirAll(dir, 0o755); err == nil {
				req, _ := http.NewRequest(http.MethodGet, url+"api/backup/export?arquivos=1", nil)
				req.Header.Set("Authorization", "Bearer "+secret)
				if res, err := client.Do(req); err == nil {
					if res.StatusCode == http.StatusOK {
						tmp := target + ".tmp"
						if f, err := os.Create(tmp); err == nil {
							_, copyErr := io.Copy(f, res.Body)
							f.Close()
							if copyErr == nil {
								_ = os.Rename(tmp, target)
								log.Printf("backup automático salvo: %s", target)
							} else {
								_ = os.Remove(tmp)
							}
						}
					}
					res.Body.Close()
				}
				pruneBackups(dir, 10)
			}
		}
		time.Sleep(1 * time.Hour)
	}
}

// Usados pelo backup feito antes de cada atualização.
var backupURL, backupSecret, backupFolder string

// backupBeforeUpdate salva uma cópia completa dos dados antes de instalar outra versão.
// Se a cópia falhar, a atualização não é feita.
func backupBeforeUpdate(newVersion string) (string, error) {
	if backupURL == "" || backupFolder == "" {
		return "", errors.New("o aplicativo ainda está iniciando; tente de novo em um minuto")
	}
	if err := os.MkdirAll(backupFolder, 0o755); err != nil {
		return "", err
	}
	label := strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || r == '.' {
			return r
		}
		return -1
	}, newVersion)
	if label == "" {
		label = "nova"
	}
	target := filepath.Join(backupFolder, "lex-calendario-backup-"+time.Now().Format("2006-01-02-1504")+"-antes-da-versao-"+label+".json")
	req, _ := http.NewRequest(http.MethodGet, backupURL+"api/backup/export?arquivos=1", nil)
	req.Header.Set("Authorization", "Bearer "+backupSecret)
	res, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return "", nil // instalação nova, ainda sem dados para copiar
	}
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("o Lex respondeu %d ao gerar o backup", res.StatusCode)
	}
	tmp := target + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	n, copyErr := io.Copy(f, res.Body)
	f.Close()
	if copyErr != nil || n == 0 {
		_ = os.Remove(tmp)
		if copyErr == nil {
			copyErr = errors.New("backup vazio")
		}
		return "", copyErr
	}
	if err := os.Rename(tmp, target); err != nil {
		return "", err
	}
	log.Printf("backup antes da atualização salvo: %s", target)
	pruneBackups(backupFolder, 15)
	return target, nil
}

func pruneBackups(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "lex-calendario-backup-") && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > keep {
		_ = os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

// persistentSecret lê um segredo salvo em dados/ ou cria um novo na primeira execução.
func persistentSecret(path string, generate func() string) string {
	if b, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		return strings.TrimSpace(string(b))
	}
	v := generate()
	_ = os.WriteFile(path, []byte(v), 0o600)
	return v
}

// scheduleJobs executa as rotinas periódicas que, na nuvem, seriam cron jobs.
func scheduleJobs(url, secret string) {
	jobs := []struct {
		path  string
		every time.Duration
		next  time.Time
	}{
		{"api/cron/reminders", 30 * time.Second, time.Now().Add(15 * time.Second)},
		{"api/cron/sync", 30 * time.Second, time.Now().Add(30 * time.Second)},
		{"api/cron/intimacoes", 2 * time.Hour, time.Now().Add(90 * time.Second)},
		{"api/cron/monitoring", 3 * time.Hour, time.Now().Add(5 * time.Minute)},
		{"api/cron/comunicacoes", time.Minute, time.Now().Add(45 * time.Second)},
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	for range time.Tick(5 * time.Second) {
		for i := range jobs {
			if time.Now().Before(jobs[i].next) {
				continue
			}
			jobs[i].next = time.Now().Add(jobs[i].every)
			req, err := http.NewRequest(http.MethodGet, url+jobs[i].path, nil)
			if err != nil {
				continue
			}
			req.Header.Set("Authorization", "Bearer "+secret)
			res, err := client.Do(req)
			if err != nil {
				continue
			}
			var payload struct {
				Notifications []struct {
					Title string `json:"title"`
					Body  string `json:"body"`
				} `json:"notifications"`
			}
			_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&payload)
			res.Body.Close()
			// Lembretes vencidos viram notificações nativas do sistema
			for _, n := range payload.Notifications {
				notify(n.Title, n.Body)
			}
		}
	}
}

// portInUse indica se algo já escuta na porta do aplicativo.
func portInUse() bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// looksLikeOurServer reconhece o servidor Next.js do Lex pelo comando do processo.
func looksLikeOurServer(command string) bool {
	c := strings.ToLower(command)
	return strings.Contains(c, "next-server") || strings.Contains(c, "lex calend") ||
		(strings.Contains(c, "node") && strings.Contains(c, "server.js"))
}

// freePort encerra servidores do próprio Lex que ficaram presos na porta.
// Se a porta pertence a outro programa, devolve um erro explicativo.
func freePort() error {
	if !portInUse() {
		return nil
	}
	killed := false
	for _, pid := range portOwners(port) {
		if pid == os.Getpid() {
			continue
		}
		command := processCommand(pid)
		if !looksLikeOurServer(command) {
			log.Printf("porta %d ocupada por outro programa (pid %d: %s)", port, pid, command)
			continue
		}
		if p, err := os.FindProcess(pid); err == nil {
			log.Printf("encerrando servidor antigo do Lex (pid %d)", pid)
			_ = p.Kill()
			killed = true
		}
	}
	for i := 0; i < 25 && portInUse(); i++ {
		time.Sleep(200 * time.Millisecond)
	}
	if portInUse() {
		if killed {
			return errors.New("não foi possível liberar a porta do aplicativo. Reinicie o computador e tente novamente")
		}
		return fmt.Errorf("a porta %d está ocupada por outro programa. Feche-o e abra o Lex Calendário novamente", port)
	}
	return nil
}

func readEnvFile(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var env []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		env = append(env, strings.TrimSpace(k)+"="+strings.Trim(strings.TrimSpace(v), `"'`))
	}
	return env
}

func randomToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func fatal(err error) {
	log.Print(err)
	notify(appName, err.Error())
	os.Exit(1)
}
