"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/hooks/use-records";
import { publicEnv } from "@/lib/env";
import { openOAuthWindow } from "@/lib/oauth-popup";

/** Erros que só se resolvem entrando de novo com a conta Google. */
const EXPIRED = /expired or revoked|invalid_grant|invalid authentication|sem refresh token|reconecte|expirou/i;

/** Na versão web, a renovação automática do acesso foi recusada e precisa de um toque. */
function webNeedsLogin() {
  try {
    const token = JSON.parse(localStorage.getItem("lex-google-token") ?? "null") as { exp?: number } | null;
    return !!localStorage.getItem("lex-google-erro") && !(token?.exp && token.exp - Date.now() > 120_000);
  } catch {
    return false;
  }
}

/**
 * Aviso no alto do calendário quando a agenda não está chegando ao Google:
 * conexão expirada (computador e celular) ou, no celular, ainda sem conta conectada.
 */
export function GoogleSignInBanner() {
  const { data: connections, isLoading } = useConnections();
  const [webLogin, setWebLogin] = useState(false);
  useEffect(() => {
    if (!publicEnv.webMode) return;
    const check = () => setWebLogin(webNeedsLogin());
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);
  if (isLoading) return null;

  const active = (connections ?? []).filter((c) => c.is_active);
  const expired = active.find((c) => EXPIRED.test(`${c.last_error ?? ""} ${c.last_push_error ?? ""}`));

  if (expired || (active.length && webLogin))
    return (
      <div className="flex flex-wrap items-center gap-3 border-b bg-amber-500/15 px-4 py-3 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1">
          <b className="font-medium">A conexão com o Google expirou.</b>{" "}
          {publicEnv.webMode ? "A agenda deste aparelho pode estar desatualizada." : "Os compromissos novos não estão indo para o Google Agenda."} Entre de novo com a conta
          {expired?.account_email ? ` ${expired.account_email}` : " Google"} para voltar a sincronizar.
        </p>
        <Button size="sm" onClick={() => openOAuthWindow("google")}>
          <RefreshCw /> Reconectar
        </Button>
      </div>
    );

  if (!publicEnv.webMode || active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-primary/10 px-4 py-3 text-sm">
      <p className="min-w-0 flex-1">
        <b className="font-medium">Veja sua agenda do Google aqui.</b> Entre com a sua conta Google para ver os compromissos do Lex Calendário no celular.
      </p>
      {publicEnv.googleWebClientId ? (
        <Button size="sm" onClick={() => openOAuthWindow("google")}>
          <LogIn /> Entrar com Google
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Login com Google ainda não configurado.</span>
      )}
    </div>
  );
}
