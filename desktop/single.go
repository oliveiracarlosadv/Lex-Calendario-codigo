package main

// Instância única do Lex Calendário.
//
// O inicializador que sobe o servidor ("dono") escuta numa porta de controle local
// (127.0.0.1:47831). Cliques seguintes no ícone não tentam adivinhar se o servidor
// está vivo — o servidor Node pode ficar alguns segundos sem responder enquanto o banco
// embutido trabalha — apenas pedem ao dono que mostre a janela e saem.
// Assim nunca há dois servidores, o servidor não é derrubado por demora e cliques
// repetidos não abrem várias janelas.

import (
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const controlPort = port + 1

var controlClient = &http.Client{Timeout: 3 * time.Second}

func controlURL(path string) string { return fmt.Sprintf("http://127.0.0.1:%d/%s", controlPort, path) }

// askOwner envia um pedido ao inicializador dono. Devolve a resposta ou "" se não houver dono.
func askOwner(path string) string {
	req, _ := http.NewRequest(http.MethodPost, controlURL(path), nil)
	req.Header.Set("X-Lex-Version", version)
	res, err := controlClient.Do(req)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 256))
	return strings.TrimSpace(string(body))
}

// ownerVersion devolve a versão do inicializador dono, ou "".
func ownerVersion() string {
	res, err := controlClient.Get(controlURL("versao"))
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64))
	if !strings.HasPrefix(string(body), "lex ") {
		return ""
	}
	return strings.TrimPrefix(strings.TrimSpace(string(body)), "lex ")
}

// stopOwner pede ao dono (outra versão ou instalação antiga) que encerre tudo e espera a porta liberar.
func stopOwner() bool {
	if askOwner("sair") == "" {
		return false
	}
	for i := 0; i < 50; i++ {
		if ownerVersion() == "" {
			time.Sleep(300 * time.Millisecond)
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

// owner coordena a abertura de janelas e o encerramento enquanto este inicializador é o dono.
type owner struct {
	listener  net.Listener
	mu        sync.Mutex
	ready     bool
	wanted    bool // pedido de janela recebido antes de o servidor ficar pronto
	lastOpen  time.Time
	open      func()
	quit      chan struct{}
	quitOnce  sync.Once
}

// becomeOwner tenta assumir a porta de controle (só um processo consegue).
func becomeOwner() (*owner, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", controlPort))
	if err != nil {
		return nil, err
	}
	o := &owner{listener: ln, quit: make(chan struct{})}
	mux := http.NewServeMux()
	mux.HandleFunc("/versao", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprintf(w, "lex %s", version) })
	mux.HandleFunc("/abrir", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "método", http.StatusMethodNotAllowed)
			return
		}
		if v := r.Header.Get("X-Lex-Version"); v != "" && v != version && compareVersions(v, version) > 0 {
			// Versão mais nova foi aberta (atualização manual): ela assume no lugar desta.
			fmt.Fprint(w, "outra-versao")
			return
		}
		o.requestWindow()
		fmt.Fprint(w, "ok")
	})
	mux.HandleFunc("/sair", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "método", http.StatusMethodNotAllowed)
			return
		}
		fmt.Fprint(w, "ok")
		o.stop()
	})
	// Somente processos locais com o cabeçalho do Lex conseguem pedir; o navegador não envia esse cabeçalho.
	guard := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/versao" && r.Header.Get("X-Lex-Version") == "" {
			http.Error(w, "proibido", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
	go func() { _ = http.Serve(ln, guard) }()
	return o, nil
}

func (o *owner) stop() {
	o.quitOnce.Do(func() { close(o.quit) })
}

// requestWindow abre a janela agora (servidor pronto) ou assim que ficar pronto.
// Cliques repetidos em menos de 3 segundos abrem uma janela só.
func (o *owner) requestWindow() {
	o.mu.Lock()
	if !o.ready || o.open == nil {
		o.wanted = true
		o.mu.Unlock()
		return
	}
	if time.Since(o.lastOpen) < 3*time.Second {
		o.mu.Unlock()
		return
	}
	o.lastOpen = time.Now()
	open := o.open
	o.mu.Unlock()
	go open()
}

// markReady é chamado quando o servidor responde; abre a janela pendente, se houver.
func (o *owner) markReady(open func(), openNow bool) {
	o.mu.Lock()
	o.ready = true
	o.open = open
	pending := o.wanted || openNow
	o.wanted = false
	o.mu.Unlock()
	if pending {
		o.requestWindow()
	}
}

func (o *owner) markStarting() {
	o.mu.Lock()
	o.ready = false
	o.mu.Unlock()
}

func (o *owner) close() { _ = o.listener.Close() }

// handOffOrOwn decide o papel deste processo. Devolve o dono (este processo assume)
// ou nil quando outro inicializador já cuidou do pedido.
func handOffOrOwn(background bool) (*owner, error) {
	for attempt := 0; attempt < 3; attempt++ {
		if o, err := becomeOwner(); err == nil {
			return o, nil
		}
		// Já existe um dono.
		reply := "ok"
		if !background {
			reply = askOwner("abrir")
		} else if v := ownerVersion(); v != "" && compareVersions(version, v) > 0 {
			reply = "outra-versao"
		}
		switch reply {
		case "ok":
			return nil, nil
		case "outra-versao":
			log.Printf("inicializador da versão %s em execução; substituindo pela %s", ownerVersion(), version)
			stopOwner()
		default:
			// Porta ocupada por algo que não responde: espera um pouco e tenta de novo.
			time.Sleep(time.Second)
		}
	}
	return becomeOwner()
}
