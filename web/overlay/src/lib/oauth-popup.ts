"use client";

import { startGoogleLogin } from "@/infrastructure/web/google";

/** Versão web: o login abre na própria tela, o que funciona também no app instalado no celular. */
export function openOAuthWindow(_provider: "google" | "microsoft", _opts: { gmail?: boolean } = {}) {
  startGoogleLogin();
}

export interface OAuthResultMessage {
  type: "lex-oauth";
  provider: string;
  status: "conectado" | "erro" | "cancelado";
}
