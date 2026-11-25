package main

// Atualização do Lex Calendário (distribuição privada, sem consulta à internet).
//
//   - Instalador: reconhece a versão já instalada (arquivo .lex-instalado) e atualiza no
//     lugar, mantendo os dados; nunca troca uma versão mais nova por uma mais antiga.
//   - Atualização por arquivo: em Configurações → Aplicativo o usuário escolhe o pacote
//     baixado (.zip / .tar.gz); o app grava o caminho em dados/atualizar-arquivo, este
//     inicializador extrai o pacote e executa o instalador da nova versão, que encerra
//     esta instância e substitui os arquivos.
//
// Arquivos em dados/:
//   atualizar-arquivo  caminho do pacote enviado pelo usuário
//   atualizacao.json   situação da última atualização (lida pela tela de Configurações)
//   atualizado-de.txt  versão anterior, gravada pelo instalador após atualizar
//   desinstalar        pedido de desinstalação feito no app: "app" ou "tudo"

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type updateStatus struct {
	Current    string `json:"current"`
	Latest     string `json:"latest,omitempty"`
	State      string `json:"state"` // atualizado | disponivel | baixando | instalando | erro
	CheckedAt  string `json:"checkedAt,omitempty"`
	Error      string `json:"error,omitempty"`
	Notes      string `json:"notes,omitempty"`
	ReleaseURL string `json:"releaseUrl,omitempty"`
	Notified   string `json:"notified,omitempty"`
}

// compareVersions compara "1.10.0" e "1.9.2" numericamente (negativo, zero ou positivo).
func compareVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	for i := 0; i < 3; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(strings.SplitN(pa[i], "-", 2)[0])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(strings.SplitN(pb[i], "-", 2)[0])
		}
		if x != y {
			return x - y
		}
	}
	return 0
}

// installedLauncher localiza a cópia instalada e a versão gravada no marcador.
func installedLauncher() (ver, launcher string) {
	type cand struct{ marker, launcher string }
	var list []cand
	if runtime.GOOS == "darwin" {
		home, _ := os.UserHomeDir()
		for _, dir := range []string{"/Applications", filepath.Join(home, "Applications")} {
			app := filepath.Join(dir, appName+".app")
			list = append(list, cand{filepath.Join(app, "Contents", "Resources", markerFile), app})
		}
	} else if docs, err := documentsDir(); err == nil {
		dir := filepath.Join(docs, appName)
		exe := appName
		if runtime.GOOS == "windows" {
			exe += ".exe"
		}
		list = append(list, cand{filepath.Join(dir, markerFile), filepath.Join(dir, exe)})
	}
	for _, c := range list {
		if b, err := os.ReadFile(c.marker); err == nil && fileExists(c.launcher) {
			v := strings.TrimSpace(string(b))
			if v == "" {
				v = "0.0.0"
			}
			return v, c.launcher
		}
	}
	return "", ""
}

// launchInstalled abre a cópia instalada; em atualizações automáticas, em segundo plano.
func launchInstalled(installed string, background bool) error {
	if !background {
		return launchDetached(installed)
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-n", installed, "--args", "--segundo-plano").Start()
	}
	cmd := exec.Command(installed, "--segundo-plano")
	cmd.Dir = filepath.Dir(installed)
	hideWindow(cmd)
	return cmd.Start()
}

// ───────────────────────── Pedidos feitos pelo app ─────────────────────────

func readUpdateStatus(dataDir string) updateStatus {
	var s updateStatus
	if b, err := os.ReadFile(filepath.Join(dataDir, "atualizacao.json")); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func writeUpdateStatus(dataDir string, s updateStatus) {
	s.Current = version
	if b, err := json.MarshalIndent(s, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(dataDir, "atualizacao.json"), b, 0o644)
	}
}

func updateLoop(dataDir string, o *owner) {
	fileRequest := filepath.Join(dataDir, "atualizar-arquivo")
	uninstallRequest := filepath.Join(dataDir, "desinstalar")
	for range time.Tick(3 * time.Second) {
		if b, err := os.ReadFile(uninstallRequest); err == nil {
			_ = os.Remove(uninstallRequest)
			mode := strings.TrimSpace(string(b))
			log.Printf("desinstalação pedida pelo app (%s)", mode)
			if o != nil {
				o.close() // libera a porta de controle
			}
			runUninstall(mode, false)
			os.Exit(0)
		}
		b, err := os.ReadFile(fileRequest)
		if err != nil {
			continue
		}
		_ = os.Remove(fileRequest)
		archive := strings.TrimSpace(string(b))
		if err := applyPackageFile(dataDir, archive); err != nil {
			log.Printf("atualização por arquivo: %v", err)
			writeUpdateStatus(dataDir, updateStatus{State: "erro", Error: err.Error(), CheckedAt: time.Now().Format(time.RFC3339)})
		}
	}
}

// packagedVersion pergunta ao inicializador do pacote a versão dele (lex --versao).
func packagedVersion(launcher string) string {
	out, err := exec.Command(launcher, "--versao").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// applyPackageFile instala o pacote escolhido pelo usuário (atualização sem internet).
func applyPackageFile(dataDir, archive string) error {
	if !fileExists(archive) {
		return errors.New("arquivo do pacote não encontrado")
	}
	if ext := strings.ToLower(filepath.Ext(archive)); ext == ".exe" || ext == ".pkg" || ext == ".deb" {
		return applyInstallerFile(dataDir, archive, ext)
	}
	defer os.Remove(archive)
	writeUpdateStatus(dataDir, updateStatus{State: "instalando", CheckedAt: time.Now().Format(time.RFC3339), Notes: "Abrindo o pacote…"})
	work, err := os.MkdirTemp("", "lex-atualizacao-*")
	if err != nil {
		return err
	}
	extracted := filepath.Join(work, "pacote")
	if err := extractArchive(archive, extracted); err != nil {
		return fmt.Errorf("não foi possível abrir o pacote (%v). Use o arquivo .zip (ou .tar.gz no Linux) baixado para este sistema", err)
	}
	launcher, err := findPackagedLauncher(extracted)
	if err != nil {
		return fmt.Errorf("este pacote não é do Lex Calendário para este sistema (%s/%s)", runtime.GOOS, runtime.GOARCH)
	}
	newVersion := packagedVersion(launcher)
	if newVersion != "" && version != "dev" && compareVersions(newVersion, version) < 0 {
		return fmt.Errorf("o pacote é da versão %s, mais antiga que a instalada (%s)", newVersion, version)
	}
	// Antes de trocar de versão: cópia completa dos dados em Documentos/Lex Calendário/backups
	writeUpdateStatus(dataDir, updateStatus{State: "instalando", Latest: newVersion, CheckedAt: time.Now().Format(time.RFC3339), Notes: "Fazendo o backup dos seus dados…"})
	if _, err := backupBeforeUpdate(newVersion); err != nil {
		return fmt.Errorf("a atualização foi cancelada porque o backup automático falhou (%v). Nada foi alterado", err)
	}
	writeUpdateStatus(dataDir, updateStatus{State: "instalando", Latest: newVersion, CheckedAt: time.Now().Format(time.RFC3339), Notes: "Backup salvo. Instalando…"})
	notify(appName, fmt.Sprintf("Backup salvo. Atualizando para a versão %s…", newVersion))
	cmd := exec.Command(launcher)
	cmd.Dir = filepath.Dir(launcher)
	cmd.Env = append(os.Environ(), "LEX_UPDATE=1", "LEX_UPDATE_PARENT="+strconv.Itoa(os.Getpid()), "LEX_SKIP_INSTALL=", "LEX_BACKGROUND=")
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("não foi possível iniciar o instalador: %w", err)
	}
	return nil
}

func extractArchive(archive, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	switch {
	case runtime.GOOS == "darwin":
		// ditto preserva links simbólicos, permissões e a assinatura do pacote .app
		if out, err := exec.Command("ditto", "-x", "-k", archive, dst).CombinedOutput(); err != nil {
			return fmt.Errorf("%v: %s", err, out)
		}
		return nil
	case strings.HasSuffix(archive, ".tar.gz"):
		if out, err := exec.Command("tar", "-xzf", archive, "-C", dst).CombinedOutput(); err != nil {
			return fmt.Errorf("%v: %s", err, out)
		}
		return nil
	}
	r, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer r.Close()
	root := filepath.Clean(dst) + string(os.PathSeparator)
	for _, f := range r.File {
		target := filepath.Join(dst, f.Name)
		if !strings.HasPrefix(target, root) {
			return errors.New("pacote com caminho inválido")
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(target, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		src, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode()|0o600)
		if err != nil {
			src.Close()
			return err
		}
		_, err = io.Copy(out, src)
		src.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// findPackagedLauncher acha o executável do inicializador dentro do pacote extraído
// (a pasta "payload" fica ao lado dele; no macOS, em Contents/Resources).
func findPackagedLauncher(dir string) (string, error) {
	found := ""
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || found != "" || !d.IsDir() || d.Name() != "payload" {
			return nil
		}
		parent := filepath.Dir(path)
		if runtime.GOOS == "darwin" {
			if p := filepath.Join(parent, "..", "MacOS", "LexCalendario"); fileExists(p) {
				found = filepath.Clean(p)
			}
			return filepath.SkipDir
		}
		entries, _ := os.ReadDir(parent)
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || !strings.HasPrefix(name, "Lex Calend") {
				continue
			}
			if (runtime.GOOS == "windows" && strings.HasSuffix(name, ".exe")) || (runtime.GOOS != "windows" && filepath.Ext(name) == "") {
				found = filepath.Join(parent, name)
			}
		}
		return filepath.SkipDir
	})
	if found == "" {
		return "", errors.New("inicializador não encontrado no pacote baixado")
	}
	_ = os.Chmod(found, 0o755)
	return found, nil
}

// applyInstallerFile atualiza a partir do instalador com assistente (.exe, .pkg ou .deb):
// faz o backup e executa o instalador. No Windows ele roda sozinho (sem perguntas) e o app
// reabre; no macOS e no Linux abre o assistente do sistema, que pede a senha do computador.
func applyInstallerFile(dataDir, installer, ext string) error {
	want := map[string]string{"windows": ".exe", "darwin": ".pkg", "linux": ".deb"}[runtime.GOOS]
	if ext != want {
		return fmt.Errorf("este instalador não é para este sistema; use o arquivo %s", want)
	}
	writeUpdateStatus(dataDir, updateStatus{State: "instalando", CheckedAt: time.Now().Format(time.RFC3339), Notes: "Fazendo o backup dos seus dados…"})
	if _, err := backupBeforeUpdate("instalador"); err != nil {
		_ = os.Remove(installer)
		return fmt.Errorf("a atualização foi cancelada porque o backup automático falhou (%v). Nada foi alterado", err)
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command(installer, "/S")
		cmd.Env = append(os.Environ(), "LEX_UPDATE=1", "LEX_UPDATE_PARENT="+strconv.Itoa(os.Getpid()), "LEX_SKIP_INSTALL=", "LEX_BACKGROUND=")
		hideWindow(cmd)
	case "darwin":
		cmd = exec.Command("open", "-W", installer)
	default:
		// Instala o .deb (pede a senha) e roda o inicializador do sistema, que atualiza esta cópia
		script := fmt.Sprintf("pkexec dpkg -i %s && LEX_UPDATE=1 LEX_UPDATE_PARENT=%d %s", shellQuote(installer), os.Getpid(), shellQuote(filepath.Join(systemPackageDir, appName)))
		cmd = exec.Command("sh", "-c", script)
	}
	writeUpdateStatus(dataDir, updateStatus{State: "instalando", CheckedAt: time.Now().Format(time.RFC3339), Notes: "Backup salvo. Siga o instalador que abriu, se ele pedir algo."})
	notify(appName, "Backup salvo. Instalando a nova versão…")
	if err := cmd.Start(); err != nil {
		_ = os.Remove(installer)
		return fmt.Errorf("não foi possível abrir o instalador: %w", err)
	}
	go func() {
		err := cmd.Wait()
		_ = os.Remove(installer)
		// Se a instalação terminou, esta versão já foi encerrada pelo instalador novo.
		// Continuar rodando aqui significa que o assistente foi fechado antes do fim.
		if err != nil || runtime.GOOS != "windows" {
			writeUpdateStatus(dataDir, updateStatus{State: "erro", Error: "A instalação foi cancelada ou não terminou. Nada foi alterado.", CheckedAt: time.Now().Format(time.RFC3339)})
		}
	}()
	return nil
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }
