import "server-only";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { MIGRATIONS } from "./migrations.generated";

const DATE_OID = 1082;

/**
 * Modo local (aplicativo desktop / uso offline): PostgreSQL completo embutido via PGlite,
 * com as MESMAS migrations do Supabase. Os dados ficam em LEX_DATA_DIR/banco.
 * Esquemas "auth" e "storage" recebem versões mínimas compatíveis.
 */
const BOOTSTRAP_SQL = `
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 1)]
$$;

create table if not exists public.lex_local_migrations (name text primary key, applied_at timestamptz not null default now());
`;

/** Ajusta as migrations do Supabase para o banco embutido. */
export function adaptMigration(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !/^\s*alter publication supabase_realtime/i.test(line))
    .join("\n");
}

async function migrate(db: PGlite) {
  await db.exec(BOOTSTRAP_SQL);
  const { rows } = await db.query<{ name: string }>("select name from public.lex_local_migrations");
  const applied = new Set(rows.map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await db.exec(adaptMigration(m.sql));
    await db.query("insert into public.lex_local_migrations (name) values ($1)", [m.name]);
  }
  await db.exec("set timezone to 'America/Sao_Paulo'");
}

export function localDataDir() {
  return process.env.LEX_DATA_DIR ?? path.join(process.cwd(), ".lex-local");
}

let instance: Promise<PGlite> | null = null;

/** Instância única do banco local (dataDir undefined = memória, usado em testes). */
export function getLocalDb(dataDir: string | null = path.join(localDataDir(), "banco")): Promise<PGlite> {
  // A pasta do banco sumiu com o app aberto (ex.: pasta apagada/reinstalada): recria do zero
  if (instance && dataDir && !existsSync(path.join(dataDir, "PG_VERSION"))) {
    const stale = instance;
    instance = null;
    void stale.then((db) => db.close()).catch(() => undefined);
  }
  instance ??= (async () => {
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    const db = await PGlite.create(dataDir ?? undefined, {
      extensions: { pgcrypto, pg_trgm, unaccent },
      // Colunas "date" voltam como texto AAAA-MM-DD, igual ao Supabase (sem isso viravam
      // "AAAA-MM-DDT00:00:00.000Z" e quebravam a formatação de prazos e intimações).
      parsers: { [DATE_OID]: (value: string) => value },
    });
    await migrate(db);
    return db;
  })().catch((error) => {
    instance = null;
    throw error;
  });
  return instance;
}

export function resetLocalDbForTests() {
  instance = null;
}

/**
 * Descarta a instância atual (ex.: a pasta de dados foi apagada com o app aberto).
 * A próxima requisição recria o banco na pasta de dados atual.
 */
export async function resetLocalDb() {
  const current = instance;
  instance = null;
  try {
    await (await current)?.close();
  } catch {
    // a instância já estava inutilizável
  }
}

/** Erros que indicam que os arquivos do banco sumiram do disco. */
export const isMissingFilesError = (e: unknown) =>
  /could not open file|No such file or directory|ENOENT/i.test(String((e as Error)?.message ?? e));

export const isLocalMode = () => process.env.LEX_LOCAL === "1";
