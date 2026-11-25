"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/layout/logo";
import type { OAuthResultMessage } from "@/lib/oauth-popup";

export function OAuthDone({ status, provider }: { status: string; provider: string }) {
  const ok = status === "conectado";
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      setIsPopup(true);
      const message: OAuthResultMessage = { type: "lex-oauth", provider, status: ok ? "conectado" : status === "cancelado" ? "cancelado" : "erro" };
      window.opener.postMessage(message, window.location.origin);
      const t = setTimeout(() => window.close(), ok ? 1200 : 3500);
      return () => clearTimeout(t);
    }
  }, [ok, provider, status]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark className="size-12 rounded-xl" />
      {ok ? <CheckCircle2 className="size-8 text-emerald-600" /> : <XCircle className="size-8 text-destructive" />}
      <h1 className="text-xl font-semibold tracking-tight">
        {ok ? "Conta Google conectada" : status === "cancelado" ? "Login cancelado" : "Não foi possível conectar"}
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {ok
          ? "Sua agenda será sincronizada a cada 30 segundos."
          : status === "cancelado"
            ? "Nenhuma alteração foi feita."
            : "Confira se o seu e-mail está liberado como usuário de teste do app no Google e tente novamente."}
      </p>
      {isPopup ? (
        <Button variant="outline" onClick={() => window.close()}>Fechar esta janela</Button>
      ) : (
        <div className="flex gap-2">
          <Button asChild><Link href="/calendario">Voltar ao calendário</Link></Button>
          <Button variant="outline" asChild><Link href="/configuracoes/integracoes">Ver integrações</Link></Button>
        </div>
      )}
    </div>
  );
}
