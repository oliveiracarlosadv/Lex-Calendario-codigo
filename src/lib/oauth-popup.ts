"use client";

/**
 * Abre o login do provedor (Google) numa janela separada, por cima do calendário.
 * Na janela do app (modo aplicativo) não há botão "voltar" do navegador: fechar a janela
 * de login devolve o usuário ao calendário, que nunca sai da tela.
 */
export function openOAuthWindow(provider: "google" | "microsoft", opts: { gmail?: boolean } = {}) {
  const extra = opts.gmail ? "&gmail=1" : "";
  const width = 520;
  const height = 700;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(
    `/api/integrations/${provider}/connect?janela=1${extra}`,
    "lex-oauth",
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!popup) window.location.href = `/api/integrations/${provider}/connect?x=1${extra}`; // bloqueador de janelas: segue na mesma tela
  else popup.focus();
}

export interface OAuthResultMessage {
  type: "lex-oauth";
  provider: string;
  status: "conectado" | "erro" | "cancelado";
}
