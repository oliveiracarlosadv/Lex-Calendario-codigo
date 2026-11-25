"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OAuthResultMessage } from "@/lib/oauth-popup";

/** Recebe o resultado da janela de login do Google e atualiza o calendário. */
export function OAuthListener() {
  const qc = useQueryClient();
  useEffect(() => {
    const onMessage = (e: MessageEvent<OAuthResultMessage>) => {
      if (e.origin !== window.location.origin || e.data?.type !== "lex-oauth") return;
      if (e.data.status === "conectado") {
        toast.success("Conta Google conectada", { description: "A agenda está sendo sincronizada." });
        for (const key of ["connections", "events", "integration-providers", "mail-account"]) void qc.invalidateQueries({ queryKey: [key] });
      } else if (e.data.status === "erro") {
        toast.error("Não foi possível conectar a conta Google", { description: "Confira se o seu e-mail está liberado como usuário de teste." });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);
  return null;
}
