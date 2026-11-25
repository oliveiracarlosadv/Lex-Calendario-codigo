-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Monitoramento de intimações
--   • pela OAB, no Diário de Justiça Eletrônico Nacional (DJEN/CNJ — Res. 455/2022)
--   • pelos avisos pendentes do PJe (MNI), com CPF e senha do advogado
-- ════════════════════════════════════════════════════════════════════════════

create table public.oab_monitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  oab_number text not null check (oab_number ~ '^[0-9]{1,7}[A-Za-z]?$'),
  oab_state char(2) not null,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (organization_id, oab_number, oab_state)
);
create index oab_monitors_active_idx on public.oab_monitors (is_active, last_checked_at);

create table public.intimations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  process_id uuid references public.processes (id) on delete set null,
  monitor_id uuid references public.oab_monitors (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,   -- advogado destinatário
  source text not null default 'djen' check (source in ('djen', 'pje')),
  external_id text not null,
  process_number text not null,
  tribunal text,
  organ text,                         -- órgão julgador / vara
  class_name text,
  communication_type text,            -- Intimação, Citação, Edital...
  document_type text,                 -- Decisão, Despacho, Sentença...
  available_at date,                  -- disponibilização no diário
  published_at date,                  -- publicação: 1º dia útil seguinte (Lei 11.419/2006, art. 4º, §3º)
  tacit_awareness_at date,            -- PJe: ciência tácita (art. 5º, §3º)
  text text,
  link text,
  parties jsonb not null default '[]'::jsonb,
  lawyers jsonb not null default '[]'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index intimations_org_idx on public.intimations (organization_id, available_at desc);
create index intimations_unread_idx on public.intimations (organization_id, read_at) where read_at is null;
create index intimations_process_idx on public.intimations (process_id);

alter table public.court_credentials
  add column last_checked_at timestamptz,
  add column last_error text;
grant select (last_checked_at, last_error) on public.court_credentials to authenticated;

-- ─────────────────────────────── RLS ───────────────────────────────
alter table public.oab_monitors enable row level security;
alter table public.intimations enable row level security;

create policy "monitores de OAB: membros leem" on public.oab_monitors
  for select using (public.is_member(organization_id));
create policy "monitores de OAB: advogado cadastra a própria" on public.oab_monitors
  for insert with check (public.is_member(organization_id) and user_id = auth.uid());
create policy "monitores de OAB: dono ou admin altera" on public.oab_monitors
  for update using (user_id = auth.uid() or public.has_role(organization_id, '{admin,partner}'));
create policy "monitores de OAB: dono ou admin remove" on public.oab_monitors
  for delete using (user_id = auth.uid() or public.has_role(organization_id, '{admin,partner}'));

create policy "intimações: membros leem" on public.intimations
  for select using (public.is_member(organization_id));
create policy "intimações: membros marcam como lidas" on public.intimations
  for update using (public.is_member(organization_id));

alter publication supabase_realtime add table public.intimations;
