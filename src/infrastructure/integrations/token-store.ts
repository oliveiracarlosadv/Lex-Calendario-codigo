import "server-only";
import { decryptSecret, encryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import type { ConnectionRow } from "./types";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Garante um access token válido, renovando com o refresh token quando faltar
 * menos de 2 minutos para expirar. Persiste os tokens criptografados.
 */
export async function getAccessToken(
  conn: ConnectionRow,
  refresh: (refreshToken: string) => Promise<TokenResponse>,
): Promise<string> {
  const current = decryptSecret(conn.access_token_enc);
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (current && expiresAt - Date.now() > 120_000) return current;

  const refreshToken = decryptSecret(conn.refresh_token_enc);
  if (!refreshToken) throw new Error("Conexão sem refresh token — reconecte a conta.");
  let tokens: TokenResponse;
  try {
    tokens = await refresh(refreshToken);
  } catch (e) {
    const message = (e as Error).message;
    // O Google cancelou a conexão (ex.: app em modo de teste, senha trocada, acesso removido)
    if (/expired or revoked|invalid_grant/i.test(message)) throw new Error("A conexão com o Google expirou (Token has been expired or revoked). Reconecte a conta Google.");
    throw e;
  }
  await saveTokens(conn.id, tokens);
  conn.access_token_enc = encryptSecret(tokens.access_token);
  conn.token_expires_at = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  return tokens.access_token;
}

export async function saveTokens(connectionId: string, tokens: TokenResponse) {
  const admin = getSupabaseAdminClient();
  const update: Record<string, string> = {
    access_token_enc: encryptSecret(tokens.access_token),
    token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
  };
  if (tokens.refresh_token) update.refresh_token_enc = encryptSecret(tokens.refresh_token);
  const { error } = await admin.from("calendar_connections").update(update).eq("id", connectionId);
  if (error) throw error;
}

export async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const json = (await res.json()) as T & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(json.error_description ?? json.error ?? `HTTP ${res.status}`);
  return json;
}
