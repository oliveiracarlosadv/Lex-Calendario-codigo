"use client";

import { useEffect, useState } from "react";

/**
 * App desktop:
 *  - avisa o inicializador, a cada minuto, que a janela continua aberta (assim o clique no
 *    ícone do Dock traz a janela existente em vez de abrir outra);
 *  - aba aberta pelo ícone (?janela=1) enquanto o Lex já está aberto em outra aba: fecha a si
 *    mesma, para não acumular abas.
 */
export function DesktopHeartbeat() {
  const [duplicate, setDuplicate] = useState(false);

  useEffect(() => {
    if (!["127.0.0.1", "localhost"].includes(window.location.hostname)) return;
    const ping = () => void fetch("/api/desktop/heartbeat", { method: "POST", keepalive: true }).catch(() => undefined);
    ping();
    const id = window.setInterval(ping, 60_000);

    // Aba única: as abas do Lex conversam entre si pelo BroadcastChannel
    if (!("BroadcastChannel" in window)) return () => window.clearInterval(id);
    const channel = new BroadcastChannel("lex-calendario-abas");
    const url = new URL(window.location.href);
    const openedByIcon = url.searchParams.get("janela") === "1";
    if (openedByIcon) {
      url.searchParams.delete("janela");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const bornAt = Date.now();
    let resolved = false;

    channel.onmessage = (e: MessageEvent<{ type: string; visible?: boolean }>) => {
      // Aba já existente: responde que está aberta
      if (e.data?.type === "quem-esta-aberto" && !(openedByIcon && Date.now() - bornAt < 1500)) {
        // Minimizada ou em segundo plano, esta aba não consegue se mostrar sozinha: avisa, e a nova fica
        channel.postMessage({ type: "estou-aberto", visible: document.visibilityState === "visible" });
        try {
          window.focus();
        } catch {
          // o navegador pode não permitir
        }
      }
      // Aba recém-aberta pelo ícone, mas o Lex já está aberto: fecha esta aba
      if (e.data?.type === "estou-aberto" && e.data.visible && openedByIcon && !resolved && Date.now() - bornAt < 1500) {
        resolved = true;
        window.close();
        // Se o navegador não deixar fechar, avisa
        window.setTimeout(() => setDuplicate(true), 400);
      }
    };
    if (openedByIcon) channel.postMessage({ type: "quem-esta-aberto" });

    return () => {
      window.clearInterval(id);
      channel.close();
    };
  }, []);

  if (!duplicate) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 text-center backdrop-blur">
      <div className="max-w-sm space-y-3">
        <p className="text-lg font-semibold">O Lex Calendário já está aberto em outra aba</p>
        <p className="text-sm text-muted-foreground">Use a aba que já estava aberta. Esta pode ser fechada.</p>
        <div className="flex justify-center gap-2">
          <button className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => window.close()}>
            Fechar esta aba
          </button>
          <button className="rounded-full border px-4 py-2 text-sm" onClick={() => setDuplicate(false)}>
            Continuar aqui
          </button>
        </div>
      </div>
    </div>
  );
}
