import { currentGoogleToken } from "@/infrastructure/web/google";
import type { ConnectionRow } from "./types";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** Versão web: o acesso vem direto do login do Google e fica só neste aparelho. */
export async function getAccessToken(_conn: ConnectionRow, _refresh: unknown): Promise<string> {
  const token = currentGoogleToken();
  if (!token) throw new Error("O acesso ao Google expirou. Toque em Sincronizar para renovar.");
  return token;
}

export async function postForm<T>(): Promise<T> {
  throw new Error("Indisponível na versão web");
}
