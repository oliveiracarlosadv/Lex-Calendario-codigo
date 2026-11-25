import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { can } from "@/domain/identity/permissions";
import { encryptSecret } from "@/infrastructure/crypto/secrets";
import { fail, getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Entrar com o OpenRouter (sem copiar chave): leva o usuário ao OpenRouter, que devolve um código
 * para o Lex trocar por uma chave da conta dele (OAuth PKCE). Pelo OpenRouter a mesma conta usa
 * ChatGPT, Claude, Gemini e modelos gratuitos.
 */
export async function GET(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!can(ctx.role, "organization:update")) return fail("Apenas administradores e sócios alteram o agente de IA.", 403);
  const model = (new URL(request.url).searchParams.get("modelo") ?? "").slice(0, 120);
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  // O estado volta intacto do OpenRouter; vai cifrado porque o retorno chega sem a sessão do navegador
  const state = encryptSecret(JSON.stringify({ v: verifier, o: ctx.orgId, u: ctx.user.id, m: model, e: Date.now() + 15 * 60_000 }));
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  // No aplicativo instalado o OpenRouter só aceita retorno para "localhost"
  const callbackBase = process.env.LEX_DESKTOP === "1" ? appUrl.replace("127.0.0.1", "localhost") : appUrl;
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", `${callbackBase}/api/ia/openrouter/callback`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", "Lex Calendário");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
