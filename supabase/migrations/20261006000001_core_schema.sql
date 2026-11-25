-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Esquema principal (multi-tenant)
-- Cada registro de negócio pertence a uma organização (escritório).
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "unaccent" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- ─────────────────────────────── Tipos ───────────────────────────────

create type public.app_role as enum ('admin', 'partner', 'lawyer', 'assistant', 'secretary');

create type public.event_kind as enum (
  'hearing',      -- Audiência
  'deadline',     -- Prazo
  'meeting',      -- Reunião
  'diligence',    -- Diligência
  'consultation', -- Consulta
  'service',      -- Atendimento
  'reminder',     -- Lembrete
  'custom'        -- Evento personalizado
);

create type public.event_priority as enum ('low', 'medium', 'high', 'critical');
create type public.event_status as enum ('scheduled', 'in_progress', 'done', 'cancelled', 'postponed');
create type public.client_kind as enum ('individual', 'company');
create type public.process_status as enum ('active', 'suspended', 'archived', 'closed', 'appeal');
create type public.court_system as enum ('pje', 'esaj', 'projudi', 'eproc', 'tucujuris', 'other');
create type public.calendar_provider as enum ('google', 'microsoft', 'caldav');
create type public.notification_channel as enum ('in_app', 'push', 'email');
create type public.suggestion_kind as enum ('hearing', 'deadline', 'reminder');
create type public.suggestion_status as enum ('pending', 'accepted', 'dismissed');

-- ─────────────────────────── Utilitários ────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Normaliza texto para busca (sem acentos, minúsculas)
create or replace function public.normalize_text(value text)
returns text language sql immutable parallel safe as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, '')))
$$;

-- ─────────────────────────── Organizações ───────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique,
  document text,                         -- CNPJ do escritório
  oab_registration text,                 -- Registro da sociedade na OAB
  plan text not null default 'trial' check (plan in ('trial', 'solo', 'team', 'enterprise')),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  phone text,
  oab_number text,
  oab_state char(2),
  timezone text not null default 'America/Sao_Paulo',
  current_organization_id uuid references public.organizations (id) on delete set null,
  preferences jsonb not null default '{"defaultView":"timeGridWeek","weekStartsOn":0,"defaultReminders":[1440,60]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null default 'lawyer',
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.app_role not null default 'lawyer',
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid not null references auth.users (id),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

-- ──────────────────────── Categorias de eventos ──────────────────────

create table public.event_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.event_kind not null,
  name text not null,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_visible boolean not null default true,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create index event_categories_org_idx on public.event_categories (organization_id);

-- ───────────────────────────── Clientes ──────────────────────────────

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.client_kind not null default 'individual',
  name text not null check (char_length(name) between 2 and 200),
  trade_name text,
  document text,                        -- CPF ou CNPJ (somente dígitos)
  rg text,
  birth_date date,
  email text,
  phone text,
  secondary_phone text,
  address_zip text,
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  address_city text,
  address_state char(2),
  notes text,
  tags text[] not null default '{}',
  responsible_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(trade_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(document, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(email, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(notes, '')), 'C')
  ) stored,
  unique (organization_id, document)
);
create index clients_org_idx on public.clients (organization_id);
create index clients_search_idx on public.clients using gin (search);
create index clients_name_trgm_idx on public.clients using gin (name extensions.gin_trgm_ops);

-- ───────────────────────────── Processos ─────────────────────────────

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null,                 -- Número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
  procedural_class text,                -- Classe processual
  subject text,                         -- Assunto
  tribunal text,                        -- Ex.: TJPA, TRT8, TRF1
  court_division text,                  -- Vara / Órgão julgador
  court_system public.court_system not null default 'pje',
  instance smallint not null default 1 check (instance between 1 and 4),
  client_id uuid references public.clients (id) on delete set null,
  client_role text,                     -- Autor, Réu, Reclamante, ...
  opposing_party text,
  responsible_id uuid references auth.users (id) on delete set null,
  status public.process_status not null default 'active',
  claim_value numeric(14, 2),
  distributed_at date,
  last_movement_at timestamptz,
  last_movement_summary text,
  next_hearing_at timestamptz,
  next_deadline_at timestamptz,
  is_monitored boolean not null default true,
  monitoring_checked_at timestamptz,
  is_confidential boolean not null default false,  -- Segredo de justiça
  tags text[] not null default '{}',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(number, '')), 'A') ||
    setweight(to_tsvector('simple', regexp_replace(coalesce(number, ''), '\D', '', 'g')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(procedural_class, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(subject, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(opposing_party, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(tribunal, '')), 'C') ||
    setweight(to_tsvector('portuguese', coalesce(court_division, '')), 'C') ||
    setweight(to_tsvector('portuguese', coalesce(notes, '')), 'D')
  ) stored,
  unique (organization_id, number)
);
create index processes_org_idx on public.processes (organization_id);
create index processes_client_idx on public.processes (client_id);
create index processes_search_idx on public.processes using gin (search);
create index processes_monitored_idx on public.processes (is_monitored, monitoring_checked_at) where is_monitored;

create table public.process_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  occurred_at timestamptz not null,
  code integer,                         -- Código TPU/CNJ quando disponível
  title text not null,
  description text,
  source text not null default 'manual', -- manual | datajud | pje | esaj | projudi | eproc
  external_id text,
  raw jsonb,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (process_id, source, external_id)
);
create index process_movements_process_idx on public.process_movements (process_id, occurred_at desc);
create index process_movements_pending_idx on public.process_movements (analyzed_at) where analyzed_at is null;

-- ────────────────────────────── Eventos ──────────────────────────────

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  kind public.event_kind not null default 'custom',
  category_id uuid references public.event_categories (id) on delete set null,
  description jsonb,                    -- Documento do editor rico (TipTap/ProseMirror JSON)
  description_text text,                -- Texto plano para busca
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  recurrence_rule text,                 -- RRULE (RFC 5545)
  location text,
  meeting_url text,
  client_id uuid references public.clients (id) on delete set null,
  process_id uuid references public.processes (id) on delete set null,
  tribunal text,
  court_division text,
  responsible_id uuid references auth.users (id) on delete set null,
  priority public.event_priority not null default 'medium',
  status public.event_status not null default 'scheduled',
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  is_private boolean not null default false,
  source text not null default 'lex',   -- lex | google | microsoft | caldav | ics | ai
  created_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,               -- Exclusão lógica (lixeira)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(location, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(tribunal, '') || ' ' || coalesce(court_division, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(description_text, '')), 'C')
  ) stored,
  check (ends_at >= starts_at)
);
create index events_org_range_idx on public.events (organization_id, starts_at, ends_at) where deleted_at is null;
create index events_process_idx on public.events (process_id);
create index events_client_idx on public.events (client_id);
create index events_responsible_idx on public.events (responsible_id, starts_at);
create index events_search_idx on public.events using gin (search);

create table public.event_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  is_done boolean not null default false,
  position integer not null default 0,
  due_at timestamptz,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_checklist_event_idx on public.event_checklist_items (event_id, position);

create table public.event_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  offset_minutes integer not null check (offset_minutes in (30, 60, 120, 1440, 4320, 10080, 21600, 43200) or offset_minutes between 0 and 525600),
  channels public.notification_channel[] not null default '{in_app,push,email}',
  remind_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, user_id, offset_minutes)
);
create index event_reminders_due_idx on public.event_reminders (remind_at) where sent_at is null;

create table public.event_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  process_id uuid references public.processes (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(event_id, process_id, client_id) >= 1)
);
create index event_attachments_event_idx on public.event_attachments (event_id);

create table public.event_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index event_comments_event_idx on public.event_comments (event_id, created_at);

-- ─────────────────────── Histórico / Auditoria ───────────────────────

create table public.activity_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null,            -- event | client | process | checklist | attachment | comment
  entity_id uuid not null,
  parent_type text,
  parent_id uuid,
  action text not null,                 -- created | updated | deleted | completed | ...
  actor_id uuid references auth.users (id) on delete set null,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id, created_at desc);
create index activity_log_parent_idx on public.activity_log (parent_type, parent_id, created_at desc);
create index activity_log_org_idx on public.activity_log (organization_id, created_at desc);

-- ───────────────────────────── Notificações ──────────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text,
  link text,
  kind text not null default 'reminder',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ──────────────────────── Integrações de calendário ──────────────────

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.calendar_provider not null,
  account_email text,
  external_calendar_id text not null default 'primary',
  -- Credenciais criptografadas (AES-256-GCM na aplicação). Nunca expostas ao cliente.
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  caldav_url text,
  caldav_username text,
  caldav_password_enc text,
  -- Estado de sincronização incremental
  sync_token text,
  webhook_channel_id text,
  webhook_resource_id text,
  webhook_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_calendar_id)
);

create table public.event_external_links (
  event_id uuid not null references public.events (id) on delete cascade,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  external_id text not null,
  etag text,
  last_synced_at timestamptz not null default now(),
  primary key (event_id, connection_id),
  unique (connection_id, external_id)
);

-- ─────────────────── IA jurídica / Monitoramento ─────────────────────

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  movement_id uuid references public.process_movements (id) on delete cascade,
  kind public.suggestion_kind not null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  rationale text,
  confidence numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  analyzer text not null default 'rules', -- rules | llm
  payload jsonb not null default '{}'::jsonb,
  status public.suggestion_status not null default 'pending',
  event_id uuid references public.events (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_suggestions_pending_idx on public.ai_suggestions (organization_id, status, created_at desc);

create table public.court_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  court_system public.court_system not null,
  tribunal text not null,
  username text,
  secret_enc text,
  created_at timestamptz not null default now(),
  unique (user_id, court_system, tribunal)
);

-- Certificado digital A1 (ICP-Brasil) — estrutura preparada para integração futura.
create table public.digital_certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'A1' check (kind in ('A1', 'A3')),
  subject_name text,
  subject_document text,
  issuer text,
  serial_number text,
  valid_from timestamptz,
  valid_until timestamptz,
  storage_path text,                    -- PFX criptografado no bucket privado "certificates"
  passphrase_enc text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Triggers de updated_at ────────────────────

do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','event_categories','clients','processes','events','event_checklist_items','calendar_connections']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
