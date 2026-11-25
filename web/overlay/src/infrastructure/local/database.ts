import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { MIGRATIONS } from "./migrations.generated";

/**
 * Versão web: o mesmo PostgreSQL do app de computador (PGlite), guardado no navegador
 * (IndexedDB), com as mesmas migrations. Os dados ficam só neste aparelho.
 */
const DATE_OID = 1082;

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
create table if not exists public.lex_web_files (bucket text not null, path text not null, bytes bytea not null, primary key (bucket, path));
`;

const adaptMigration = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !/^\s*alter publication supabase_realtime/i.test(line))
    .join("\n");

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

let instance: Promise<PGlite> | null = null;

/** Este aparelho guarda a agenda (true) ou está usando uma cópia só na memória (false). */
export let persistent = true;

/**
 * Só uma janela do Lex usa o banco guardado por vez. No iPhone, a janela do login do Google
 * às vezes fica aberta por cima e segura o banco: em vez de esperar para sempre em
 * "Preparando sua agenda", esta janela abre em 3 segundos com uma cópia na memória,
 * que o Google Agenda preenche na hora.
 */
function holdDatabaseLock(): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    void locks
      .request("lex-calendario-banco", { mode: "exclusive" }, () => {
        clearTimeout(timer);
        resolve(true);
        return new Promise<void>(() => undefined); // guarda até a janela fechar
      })
      .catch(() => resolve(false));
  });
}

async function openDb(dataDir: string) {
  const db = await PGlite.create(dataDir, {
    relaxedDurability: true,
    extensions: { pgcrypto, pg_trgm, unaccent },
    // Colunas "date" voltam como texto AAAA-MM-DD, igual ao Supabase
    parsers: { [DATE_OID]: (value: string) => value },
  });
  await migrate(db);
  return db;
}

export function getLocalDb(): Promise<PGlite> {
  instance ??= (async () => {
    persistent = await holdDatabaseLock();
    if (persistent) {
      try {
        return await openDb("idb://lex-calendario");
      } catch (error) {
        console.error("[lex-web] banco guardado indisponível; usando cópia na memória", error);
        persistent = false;
      }
    }
    // Sem o banco guardado, o calendário abre assim mesmo: a agenda vem do Google
    sessionStorage.setItem("lex-banco-memoria", "1");
    return openDb("memory://");
  })().catch((error) => {
    instance = null;
    throw error;
  });
  return instance;
}
