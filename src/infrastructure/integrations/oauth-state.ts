import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "lex_oauth_state";

/** Cria state + PKCE (code_verifier guardado em cookie httpOnly). */
export async function createOAuthState(provider: string, _popup = false) {
  const state = `${provider}.${randomBytes(18).toString("base64url")}`;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  (await cookies()).set(COOKIE, `${state}|${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && !process.env.LEX_LOCAL,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return { state, challenge };
}

/** Valida o state e devolve o code_verifier (ou null se inválido). */
export async function consumeOAuthState(provider: string, received: string | null) {
  const store = await cookies();
  const [expected, verifier] = (store.get(COOKIE)?.value ?? "").split("|");
  store.delete(COOKIE);
  return !!received && !!expected && received === expected && expected.startsWith(`${provider}.`) ? verifier || null : null;
}
