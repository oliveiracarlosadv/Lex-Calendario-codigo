import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** JWT HS256 mínimo para as sessões do modo local (compatível com supabase-js). */
const secret = () => process.env.LEX_LOCAL_SECRET ?? (globalThis.__lexDevSecret ??= randomBytes(32).toString("hex"));

declare global {
  var __lexDevSecret: string | undefined;
}

const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");

export interface LocalClaims {
  sub?: string;
  role: "authenticated" | "service_role" | "anon" | "storage";
  email?: string | null;
  is_anonymous?: boolean;
  path?: string;
  exp: number;
  iat?: number;
  [k: string]: unknown;
}

export function signJwt(claims: LocalClaims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iat: Math.floor(Date.now() / 1000), ...claims });
  const sig = createHmac("sha256", secret()).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string | null | undefined): LocalClaims | null {
  if (!token) return null;
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as LocalClaims;
    if (claims.exp && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export function bearer(request: Request) {
  const h = request.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}
