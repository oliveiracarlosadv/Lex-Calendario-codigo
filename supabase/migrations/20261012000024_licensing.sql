-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Assinantes
-- Tabelas do servidor de assinaturas (a instalação na nuvem do titular do Lex): contas dos
-- assinantes, códigos de entrada por e-mail e sessões dos aplicativos. Nas instalações
-- no computador elas ficam vazias. Só o servidor (service role) lê e grava.
-- ════════════════════════════════════════════════════════════════════════════

create table public.license_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  document text,
  status text not null default 'trial' check (status in ('trial', 'active', 'overdue', 'canceled')),
  trial_ends_at timestamptz not null,
  paid_until timestamptz,
  asaas_customer_id text,
  asaas_subscription_id text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.license_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now()
);

create table public.license_sessions (
  token_hash text primary key,
  account_id uuid not null references public.license_accounts (id) on delete cascade,
  device text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index license_sessions_account_idx on public.license_sessions (account_id);

create trigger set_updated_at before update on public.license_accounts
  for each row execute function public.set_updated_at();

alter table public.license_accounts enable row level security;
alter table public.license_codes enable row level security;
alter table public.license_sessions enable row level security;
revoke all on public.license_accounts, public.license_codes, public.license_sessions from anon, authenticated;
