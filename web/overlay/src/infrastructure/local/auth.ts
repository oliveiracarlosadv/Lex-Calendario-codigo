import type { PGlite as PGliteWorker } from "@electric-sql/pglite";
import { signJwt, verifyJwt } from "./jwt";

/** Subconjunto do Supabase Auth para a versão web: um único usuário, sem conta, neste aparelho. */
interface UserRow {
  id: string;
  email: string | null;
  raw_user_meta_data: Record<string, unknown>;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
}

const SESSION_SECONDS = 60 * 60 * 24 * 365;

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const toUserJson = (u: UserRow) => ({
  id: u.id,
  aud: "authenticated",
  role: "authenticated",
  email: u.email ?? "",
  phone: "",
  app_metadata: { provider: "anonymous", providers: ["anonymous"] },
  user_metadata: u.raw_user_meta_data ?? {},
  identities: [],
  factors: [],
  is_anonymous: u.is_anonymous,
  created_at: new Date(u.created_at).toISOString(),
  updated_at: new Date(u.updated_at).toISOString(),
});

function sessionFor(u: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_SECONDS;
  return {
    access_token: signJwt({ sub: u.id, role: "authenticated", aud: "authenticated", is_anonymous: true, aal: "aal1", session_id: crypto.randomUUID(), exp }),
    token_type: "bearer",
    expires_in: SESSION_SECONDS,
    expires_at: exp,
    refresh_token: signJwt({ sub: u.id, role: "authenticated", kind: "refresh", exp: now + SESSION_SECONDS * 10 }),
    user: toUserJson(u),
  };
}

async function primaryUser(db: PGliteWorker) {
  const { rows } = await db.query<UserRow>("select * from auth.users order by created_at asc limit 1");
  return rows[0] ?? null;
}

export async function userFromToken(db: PGliteWorker, token: string | null) {
  const claims = verifyJwt(token);
  if (!claims?.sub || claims.role !== "authenticated" || claims.kind === "refresh") return null;
  const { rows } = await db.query<UserRow>("select * from auth.users where id = $1", [claims.sub]);
  return rows[0] ?? null;
}

export async function handleAuth(db: PGliteWorker, route: string, request: Request, token: string | null) {
  const url = new URL(request.url);
  const body = (request.method === "GET" ? {} : await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (route === "signup" && request.method === "POST") {
    const existing = await primaryUser(db);
    if (existing) return sessionFor(existing);
    const meta = { full_name: "Você", organization_name: "Meu escritório", ...((body.data as object) ?? {}) };
    const { rows } = await db.query<UserRow>("insert into auth.users (raw_user_meta_data, is_anonymous) values ($1::jsonb, true) returning *", [JSON.stringify(meta)]);
    return sessionFor(rows[0]);
  }
  if (route === "token" && url.searchParams.get("grant_type") === "refresh_token") {
    const claims = verifyJwt(String(body.refresh_token ?? ""));
    const user = claims?.kind === "refresh" ? await primaryUser(db) : null;
    if (!user) throw new AuthError(400, "invalid_grant", "Invalid Refresh Token");
    return sessionFor(user);
  }
  if (route === "user") {
    const user = await userFromToken(db, token);
    if (!user) throw new AuthError(401, "bad_jwt", "invalid JWT");
    if (request.method === "GET") return toUserJson(user);
    if (request.method === "PUT") {
      const meta = { ...user.raw_user_meta_data, ...((body.data as object) ?? {}) };
      const { rows } = await db.query<UserRow>("update auth.users set raw_user_meta_data = $2::jsonb, updated_at = now() where id = $1 returning *", [user.id, JSON.stringify(meta)]);
      return toUserJson(rows[0]);
    }
  }
  if (route === "logout") return null;
  throw new AuthError(404, "not_available", "Recurso indisponível na versão web");
}
