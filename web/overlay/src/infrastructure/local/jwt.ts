/** Sessão da versão web: os dados nunca saem do aparelho, então o token só identifica o usuário local. */
export interface LocalClaims {
  sub?: string;
  role: string;
  exp: number;
  [k: string]: unknown;
}

const enc = (v: object) => btoa(unescape(encodeURIComponent(JSON.stringify(v)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const signJwt = (claims: LocalClaims) => `${enc({ alg: "none", typ: "JWT" })}.${enc({ iat: Math.floor(Date.now() / 1000), ...claims })}.bG9jYWw`;

export function verifyJwt(token: string | null | undefined): LocalClaims | null {
  try {
    const body = token?.split(".")[1];
    if (!body) return null;
    const claims = JSON.parse(decodeURIComponent(escape(atob(body.replace(/-/g, "+").replace(/_/g, "/"))))) as LocalClaims;
    return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
  } catch {
    return null;
  }
}

export function bearer(request: Request) {
  const h = request.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}
