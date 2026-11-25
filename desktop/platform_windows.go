//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const createNoWindow = 0x08000000

func payloadDir(exe string) string   { return filepath.Join(filepath.Dir(exe), "payload") }
func installRoot(exe string) string  { return filepath.Dir(exe) }
func isInstalledCopy(exe string) bool { return fileExists(filepath.Join(filepath.Dir(exe), markerFile)) }
func nodeBinary(payload string) string {
	return filepath.Join(payload, "runtime", "node.exe")
}

func powershell(script string) (string, error) {
	// Saída em UTF-8: sem isso o PowerShell responde na página de código do console (cp850) e
	// caminhos com acento (ex.: usuário "João") chegam embaralhados — o Lex instalava no lugar errado.
	script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" + script
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// documentsDir respeita o redirecionamento da pasta Documentos (ex.: OneDrive).
func documentsDir() (string, error) {
	if out, err := powershell("[Environment]::GetFolderPath('MyDocuments')"); err == nil && out != "" {
		return out, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Documents"), nil
}

func copyApplication(exe, target string) (string, error) {
	src := filepath.Dir(exe)
	skip := func(rel string) bool {
		top := strings.Split(rel, string(filepath.Separator))[0]
		return top == "dados"
	}
	if err := copyTree(src, target, skip); err != nil {
		return "", err
	}
	installed := filepath.Join(target, filepath.Base(exe))
	if err := os.WriteFile(filepath.Join(target, markerFile), []byte(version), 0o644); err != nil {
		return "", err
	}
	return installed, nil
}

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// createShortcuts cria atalhos na Área de Trabalho, no Menu Iniciar e fixa na barra de tarefas.
func createShortcuts(target, installed string) error {
	icon := filepath.Join(target, "lex-calendario.ico")
	if !fileExists(icon) {
		icon = installed
	}
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Continue'
$exe = %s; $icon = %s; $dir = %s; $name = %s
$ws = New-Object -ComObject WScript.Shell
function New-Lnk($path, $arguments = '') {
  $s = $ws.CreateShortcut($path)
  $s.TargetPath = $exe
  $s.Arguments = $arguments
  $s.WorkingDirectory = $dir
  $s.IconLocation = "$icon,0"
  $s.Description = 'Lex Calendário — agenda jurídica inteligente'
  $s.Save()
}
$desktop = [Environment]::GetFolderPath('Desktop')
New-Lnk (Join-Path $desktop "$name.lnk")
$programs = [Environment]::GetFolderPath('Programs')
New-Lnk (Join-Path $programs "$name.lnk")
# Inicia em segundo plano com o Windows (lembretes)
$startup = [Environment]::GetFolderPath('Startup')
New-Lnk (Join-Path $startup "$name.lnk") '--segundo-plano'

# Barra de tarefas: tenta fixar o atalho (o Windows 10/11 restringe isso a ações do próprio usuário;
# as duas tentativas abaixo funcionam em parte das versões)
$pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
try {
  $shell = New-Object -ComObject Shell.Application
  $item = $shell.Namespace($programs).ParseName("$name.lnk")
  $verb = $item.Verbs() | Where-Object { $_.Name.Replace('&','') -match 'barra de tarefas|taskbar' } | Select-Object -First 1
  if ($verb) { $verb.DoIt() }
} catch {}
if (-not (Test-Path (Join-Path $pinned "$name.lnk"))) {
  try {
    $k = 'HKCU:\Software\Classes\*\shell\{:}'
    New-Item -Path $k -Force | Out-Null
    Set-ItemProperty -LiteralPath $k -Name 'ExplorerCommandHandler' -Value '{90AA3A4E-1CBA-4233-B8BB-535773D48449}'
    $item = (New-Object -ComObject Shell.Application).Namespace($programs).ParseName("$name.lnk")
    $item.InvokeVerb('{:}')
    Start-Sleep -Milliseconds 800
    Remove-Item -LiteralPath $k -Recurse -Force
  } catch {}
}
if (-not (Test-Path (Join-Path $pinned "$name.lnk"))) { Write-Output 'NAO_FIXADO' }
`, psQuote(installed), psQuote(icon), psQuote(target), psQuote(appName))
	out, err := powershell(script)
	registerUninstall(installed, target)
	if strings.Contains(out, "NAO_FIXADO") {
		// O Windows não deixou fixar automaticamente: orienta o usuário (um clique)
		go func() {
			time.Sleep(20 * time.Second)
			notify(appName, "Para fixar na barra de tarefas: clique com o botão direito no ícone do Lex Calendário na barra e escolha “Fixar na barra de tarefas”.")
		}()
	}
	if err != nil {
		return fmt.Errorf("%v: %s", err, out)
	}
	return nil
}

func launchDetached(installed string) error {
	cmd := exec.Command(installed)
	cmd.Dir = filepath.Dir(installed)
	return cmd.Start()
}

func browserCandidates() []string {
	var list []string
	for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
		if base == "" {
			continue
		}
		list = append(list,
			filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(base, `Google\Chrome\Application\chrome.exe`),
			filepath.Join(base, `BraveSoftware\Brave-Browser\Application\brave.exe`),
		)
	}
	return list
}

func openDefaultBrowser(url string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	hideWindow(cmd)
	return cmd.Start()
}

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// notify mostra uma notificação nativa do Windows (toast da Central de Ações).
func notify(title, message string) {
	script := fmt.Sprintf(`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$x.Item(0).AppendChild($t.CreateTextNode(%s)) | Out-Null
$x.Item(1).AppendChild($t.CreateTextNode(%s)) | Out-Null
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($t))
`, psQuote(title), psQuote(message))
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script)
	hideWindow(cmd)
	_ = cmd.Start()
}

func portOwners(p int) []int {
	out, err := powershell(fmt.Sprintf("Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess", p))
	if err != nil {
		return nil
	}
	var pids []int
	for _, f := range strings.Fields(out) {
		if n, err := strconv.Atoi(f); err == nil && n > 0 {
			pids = append(pids, n)
		}
	}
	return pids
}

func processCommand(pid int) string {
	out, _ := powershell(fmt.Sprintf("(Get-CimInstance Win32_Process -Filter 'ProcessId=%d').CommandLine", pid))
	return out
}

// otherLaunchers lista outros processos do inicializador do Lex (versões anteriores em segundo plano).
func otherLaunchers() []int {
	out, err := powershell(`Get-Process | Where-Object { $_.Path -like '*\Lex Calend*\*.exe' -and $_.ProcessName -notmatch 'node' } | Select-Object -ExpandProperty Id`)
	if err != nil {
		return nil
	}
	var pids []int
	for _, f := range strings.Fields(out) {
		if n, err := strconv.Atoi(f); err == nil && n != os.Getpid() {
			pids = append(pids, n)
		}
	}
	return pids
}

func requestNotificationPermission() {}

func backupsDir(root string) string { return filepath.Join(root, "backups") }

func windowsBrowserPaths(id string) []string {
	rel := map[string]string{
		"chrome":  `Google\Chrome\Application\chrome.exe`,
		"edge":    `Microsoft\Edge\Application\msedge.exe`,
		"brave":   `BraveSoftware\Brave-Browser\Application\brave.exe`,
		"firefox": `Mozilla Firefox\firefox.exe`,
	}[id]
	if rel == "" {
		return nil
	}
	var list []string
	for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
		if base != "" {
			list = append(list, filepath.Join(base, rel))
		}
	}
	return list
}

func namedBrowser(id string) string {
	for _, p := range windowsBrowserPaths(id) {
		if fileExists(p) {
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
	script := fmt.Sprintf(`Add-Type -AssemblyName Microsoft.VisualBasic
$p = %s
if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }`, psQuote(path))
	_, err := powershell(script)
	return err == nil
}

func askUninstallPlatform() string {
	out, _ := powershell("Add-Type -AssemblyName System.Windows.Forms\n" +
		"$r = [System.Windows.Forms.MessageBox]::Show(\"Desinstalar o Lex Calendário?`n`nSim: remove o aplicativo E envia para a Lixeira todos os dados, configurações e backups.`nNão: remove só o aplicativo (os dados ficam guardados).`nCancelar: não faz nada.\", 'Lex Calendário', 'YesNoCancel', 'Warning')\n" +
		"Write-Output $r")
	switch strings.TrimSpace(out) {
	case "Yes":
		return "tudo"
	case "No":
		return "app"
	}
	return ""
}

// removeInstallation remove atalhos, início automático, registro em "Aplicativos instalados"
// e a pasta do app. O executável em uso é apagado logo após este processo terminar.
func removeInstallation(all bool) {
	docs, err := documentsDir()
	if err != nil {
		return
	}
	target := filepath.Join(docs, appName)
	script := fmt.Sprintf(`$ErrorActionPreference = 'SilentlyContinue'
$name = %s
foreach ($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'), (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))) {
  Remove-Item -LiteralPath (Join-Path $f "$name.lnk") -Force
}
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LexCalendario' -Recurse -Force`, psQuote(appName))
	_, _ = powershell(script)
	if all {
		moveToTrash(filepath.Join(target, "dados"))
		moveToTrash(filepath.Join(target, "backups"))
	}
	// Apaga a pasta do app depois que este processo sair (o .exe em uso não pode ser apagado agora)
	keep := ""
	if !all {
		keep = "dados|backups"
	}
	cleanup := fmt.Sprintf(`Start-Sleep -Seconds 3
$dir = %s
Get-ChildItem -LiteralPath $dir -Force | Where-Object { %s } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue }`,
		psQuote(target), map[bool]string{true: "$true", false: "$_.Name -notmatch '^(" + keep + ")$'"}[keep == ""])
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", cleanup)
	hideWindow(cmd)
	_ = cmd.Start()
}

// registerUninstall registra o Lex em Configurações → Aplicativos (Desinstalar).
func registerUninstall(installed, target string) {
	script := fmt.Sprintf(`$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LexCalendario'
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name DisplayName -Value 'Lex Calendário'
Set-ItemProperty -Path $k -Name DisplayVersion -Value %s
Set-ItemProperty -Path $k -Name Publisher -Value 'Carlos Alexandre Albuquerque Oliveira'
Set-ItemProperty -Path $k -Name DisplayIcon -Value %s
Set-ItemProperty -Path $k -Name InstallLocation -Value %s
Set-ItemProperty -Path $k -Name UninstallString -Value ('"' + %s + '" --desinstalar')
Set-ItemProperty -Path $k -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $k -Name NoRepair -Value 1 -Type DWord`, psQuote(version), psQuote(installed), psQuote(target), psQuote(installed))
	_, _ = powershell(script)
}

// focusExistingWindow: nesta plataforma o navegador escolhido decide; abre a janela normalmente.
func focusExistingWindow(string) bool { return false }

// openAppModeWindow: nesta plataforma a janela própria é aberta diretamente pelo executável do navegador.
func openAppModeWindow(string, string, bool) (bool, error) { return false, nil }

// defaultBrowserChoice: no Windows o padrão é a janela própria (Edge/Chrome em modo aplicativo),
// que aparece na barra de tarefas com o ícone do Lex — e não como mais uma aba do navegador.
func defaultBrowserChoice() string { return "app" }

var (
	user32             = syscall.NewLazyDLL("user32.dll")
	procEnumWindows    = user32.NewProc("EnumWindows")
	procGetWindowTextW = user32.NewProc("GetWindowTextW")
	procGetClassNameW  = user32.NewProc("GetClassNameW")
	procSendMessageW   = user32.NewProc("SendMessageW")
	procLoadImageW     = user32.NewProc("LoadImageW")
	brandOnce          sync.Once
	lexIconBig         uintptr
	lexIconSmall       uintptr
	brandCallback      uintptr
)

// afterAppWindowOpened troca o ícone da janela própria (que o navegador marca com o ícone dele)
// pelo ícone do Lex Calendário, na janela e na barra de tarefas. O inicializador fica em
// segundo plano e mantém o ícone enquanto o app estiver aberto.
func afterAppWindowOpened() {
	brandOnce.Do(func() {
		exe, err := os.Executable()
		if err != nil {
			return
		}
		icon := filepath.Join(filepath.Dir(exe), "lex-calendario.ico")
		if !fileExists(icon) {
			return
		}
		path, err := syscall.UTF16PtrFromString(icon)
		if err != nil {
			return
		}
		const imageIcon, loadFromFile = 1, 0x10
		lexIconBig, _, _ = procLoadImageW.Call(0, uintptr(unsafe.Pointer(path)), imageIcon, 48, 48, loadFromFile)
		lexIconSmall, _, _ = procLoadImageW.Call(0, uintptr(unsafe.Pointer(path)), imageIcon, 16, 16, loadFromFile)
		if lexIconBig == 0 {
			return
		}
		brandCallback = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
			title := make([]uint16, 300)
			procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&title[0])), uintptr(len(title)))
			if !strings.Contains(syscall.UTF16ToString(title), "Lex Calend") {
				return 1
			}
			class := make([]uint16, 64)
			procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&class[0])), uintptr(len(class)))
			if !strings.HasPrefix(syscall.UTF16ToString(class), "Chrome_WidgetWin") {
				return 1
			}
			const wmSetIcon, iconSmall, iconBig = 0x0080, 0, 1
			procSendMessageW.Call(hwnd, wmSetIcon, iconBig, lexIconBig)
			if lexIconSmall != 0 {
				procSendMessageW.Call(hwnd, wmSetIcon, iconSmall, lexIconSmall)
			}
			return 1
		})
		go func() {
			for i := 0; ; i++ {
				procEnumWindows.Call(brandCallback, 0)
				if i < 20 {
					time.Sleep(2 * time.Second) // logo após abrir, o navegador ainda troca o ícone
				} else {
					time.Sleep(15 * time.Second)
				}
			}
		}()
	})
}
