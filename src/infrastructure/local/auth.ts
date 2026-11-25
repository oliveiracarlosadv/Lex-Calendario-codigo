import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { signJwt, verifyJwt } from "./jwt";

/**
 * Subconjunto do GoTrue (Supabase Auth) para o modo local.
 * O usuário entra automaticamente ("sem conta"): os dados ficam neste computador.
 * Login com Google/Microsoft/Apple serve apenas para sincronizar calendários (integrações).
 */

interface UserRow {
  id: string;
  email: string | null;
  encrypted_password: string | null;
  raw_user_meta_data: Record<string, unknown>;
  raw_app_meta_data: Record<string, unknown>;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
}

const SESSION_SECONDS = 60 * 60 * 24 * 30;

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password: string, stored: string | null) {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  const computed = scryptSync(password, Buffer.from(salt, "hex"), 32);
  const expected = Buffer.from(hash, "hex");
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function toUserJson(u: UserRow) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email ?? "",
    phone: "",
    app_metadata: { provider: u.is_anonymous ? "anonymous" : "email", providers: [u.is_anonymous ? "anonymous" : "email"] },
    user_metadata: u.raw_user_meta_data ?? {},
    identities: [],
    factors: [],
    is_anonymous: u.is_anonymous,
    created_at: new Date(u.created_at).toISOString(),
    updated_at: new Date(u.updated_at).toISOString(),
  };
}

export function sessionFor(u: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_SECONDS;
  const access_token = signJwt({
    sub: u.id,
    role: "authenticated",
    aud: "authenticated",
    email: u.email,
    is_anonymous: u.is_anonymous,
    aal: "aal1",
    amr: [{ method: u.is_anonymous ? "anonymous" : "password", timestamp: now }],
    session_id: randomBytes(8).toString("hex"),
    exp,
  });
  const refresh_token = signJwt({ sub: u.id, role: "authenticated", kind: "refresh", exp: now + SESSION_SECONDS * 12 });
  return { access_token, token_type: "bearer", expires_in: SESSION_SECONDS, expires_at: exp, refresh_token, user: toUserJson(u) };
}

async function userById(db: PGlite, id: string) {
  const { rows } = await db.query<UserRow>("select * from auth.users where id = $1", [id]);
  return rows[0] ?? null;
}

/** Usuário dono dos dados deste computador (o primeiro criado). */
async function primaryUser(db: PGlite) {
  const { rows } = await db.query<UserRow>("select * from auth.users order by created_at asc limit 1");
  return rows[0] ?? null;
}

async function createUser(db: PGlite, data: { email?: string | null; password?: string | null; meta?: Record<string, unknown>; anonymous: boolean }) {
  const meta = { full_name: "Você", organization_name: "Meu escritório", ...(data.meta ?? {}) };
  const { rows } = await db.query<UserRow>(
    `insert into auth.users (email, encrypted_password, raw_user_meta_data, is_anonymous)
     values ($1, $2, $3::jsonb, $4) returning *`,
    [data.email ?? null, data.password ? hashPassword(data.password) : null, JSON.stringify(meta), data.anonymous],
  );
  return rows[0];
}

export async function userFromToken(db: PGlite, token: string | null) {
  const claims = verifyJwt(token);
  if (!claims?.sub || claims.role !== "authenticated" || claims.kind === "refresh") return null;
  return userById(db, claims.sub);
}

export async function handleAuth(db: PGlite, route: string, request: Request, token: string | null) {
  const url = new URL(request.url);
  const body = (request.method === "GET" ? {} : await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (route === "signup" && request.method === "POST") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
    const password = typeof body.password === "string" ? body.password : null;
    const meta = (body.data as Record<string, unknown>) ?? {};
    if (!email) {
      // "Entrar sem conta": sempre o mesmo usuário local (os dados são deste computador)
      const existing = await primaryUser(db);
      return sessionFor(existing ?? (await createUser(db, { meta, anonymous: true })));
    }
    if (!password || password.length < 6) throw new AuthError(422, "weak_password", "Senha muito curta");
    const { rows } = await db.query("select 1 from auth.users where email = $1", [email]);
    if (rows.length) throw new AuthError(422, "user_already_exists", "User already registered");
    return sessionFor(await createUser(db, { email, password, meta, anonymous: false }));
  }

  if (route === "token" && request.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const { rows } = await db.query<UserRow>("select * from auth.users where email = $1", [String(body.email ?? "").toLowerCase()]);
      const user = rows[0];
      if (!user || !checkPassword(String(body.password ?? ""), user.encrypted_password))
        throw new AuthError(400, "invalid_credentials", "Invalid login credentials");
      return sessionFor(user);
    }
    if (grant === "refresh_token") {
      const claims = verifyJwt(String(body.refresh_token ?? ""));
      const user = claims?.kind === "refresh" && claims.sub ? await userById(db, claims.sub) : null;
      if (!user) throw new AuthError(400, "invalid_grant", "Invalid Refresh Token");
      return sessionFor(user);
    }
    throw new AuthError(400, "unsupported_grant_type", "Tipo de acesso indisponível no modo local");
  }

  if (route === "user") {
    const user = await userFromToken(db, token);
    if (!user) throw new AuthError(401, "bad_jwt", "invalid JWT");
    if (request.method === "GET") return toUserJson(user);
    if (request.method === "PUT") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : user.email;
      const password = typeof body.password === "string" && body.password ? hashPassword(body.password) : user.encrypted_password;
      const meta = { ...user.raw_user_meta_data, ...((body.data as Record<string, unknown>) ?? {}) };
      const { rows } = await db.query<UserRow>(
        `update auth.users set email = $2::text, encrypted_password = $3::text, raw_user_meta_data = $4::jsonb,
                is_anonymous = (is_anonymous and $2::text is null), updated_at = now()
          where id = $1 returning *`,
        [user.id, email, password, JSON.stringify(meta)],
      );
      await db.query("update public.profiles set email = coalesce($2::text, email), full_name = coalesce($3::text, full_name) where id = $1", [
        user.id,
        email,
        (meta.full_name as string) ?? null,
      ]);
      return toUserJson(rows[0]);
    }
  }

  if (route === "logout") return null;

  throw new AuthError(404, "not_available", "Recurso de autenticação indisponível no modo local");
}
