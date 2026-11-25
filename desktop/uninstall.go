package main

// Desinstalação e limpeza do Lex Calendário.
//
//   - "Desinstalar Lex Calendário" (arquivo que vem no pacote) ou o botão em
//     Configurações → Aplicativo: remove o aplicativo, os atalhos, o início automático e,
//     se o usuário escolher, todos os dados (enviados para a Lixeira, recuperáveis).
//   - "Limpar todas as informações": apaga os dados do app (para a Lixeira) e reinicia do zero.

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// moveToTrash envia o arquivo/pasta para a Lixeira do sistema (ou apaga, se não houver Lixeira).
func moveToTrash(path string) {
	if !fileExists(path) {
		return
	}
	if trashPlatform(path) && !fileExists(path) {
		return
	}
	_ = os.RemoveAll(path)
}

// wipeData envia para a Lixeira tudo o que o usuário cadastrou e configurou (banco, preferências),
// mantendo apenas os arquivos de controle desta execução. O app recomeça do zero.
func wipeData(dataDir string) {
	keep := map[string]bool{"token": true, "heartbeat": true, "servidor.pid": true, "lex.log": true, ".chave": true, ".segredo": true}
	stamp := time.Now().Format("2006-01-02 15.04")
	holder := filepath.Join(filepath.Dir(dataDir), fmt.Sprintf("Lex Calendário — dados apagados %s", stamp))
	_ = os.MkdirAll(holder, 0o755)
	entries, _ := os.ReadDir(dataDir)
	for _, e := range entries {
		if keep[e.Name()] {
			continue
		}
		_ = os.Rename(filepath.Join(dataDir, e.Name()), filepath.Join(holder, e.Name()))
	}
	moveToTrash(holder)
	log.Printf("dados apagados (enviados para a Lixeira): %s", holder)
}

// runUninstall remove o Lex do computador. mode: "app" (mantém dados) ou "tudo".
func runUninstall(mode string, interactive bool) {
	if interactive || (mode != "app" && mode != "tudo") {
		mode = askUninstallPlatform()
		if mode == "" {
			return
		}
	}
	// Encerra o app em execução (servidor e inicializadores)
	stopRunningInstance(dataDirGuess())
	_ = freePort()
	for _, pid := range otherLaunchers() {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
		}
	}
	removeInstallation(mode == "tudo")
	if mode == "tudo" {
		notify(appName, "Lex Calendário desinstalado. Os dados foram enviados para a Lixeira.")
	} else {
		notify(appName, "Lex Calendário desinstalado. Seus dados e backups continuam guardados.")
	}
}

// dataDirGuess localiza a pasta de dados da instalação (para pedir o encerramento do servidor).
func dataDirGuess() string {
	if runtime.GOOS == "darwin" {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", appName, "dados")
	}
	if docs, err := documentsDir(); err == nil {
		return filepath.Join(docs, appName, "dados")
	}
	return ""
}
