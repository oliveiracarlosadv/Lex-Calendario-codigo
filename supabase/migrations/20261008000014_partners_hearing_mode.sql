-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Cadastro de parceiros e modalidade da audiência
-- ════════════════════════════════════════════════════════════════════════════

-- Parceiros: escritórios e advogados correspondentes, peritos, contadores,
-- indicadores de clientes etc. Podem ser vinculados a processos, com a divisão de honorários.
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'individual' check (kind in ('individual', 'company')),
  category text not null default 'correspondente',
  name text not null check (char_length(name) between 2 and 200),
  trade_name text,
  document text,
  oab text,
  email text,
  phone text,
  secondary_phone text,
  website text,
  address_city text,
  address_state text,
  specialties text,                    -- áreas de atuação
  fee_percent numeric(5, 2) check (fee_percent between 0 and 100),  -- divisão de honorários padrão
  bank_info text,                      -- dados para repasse (PIX, banco)
  notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partners_org_idx on public.partners (organization_id, name);
create trigger set_updated_at before update on public.partners for each row execute function public.set_updated_at();

alter table public.partners enable row level security;
create policy "parceiros: membros leem" on public.partners for select using (public.is_member(organization_id));
create policy "parceiros: equipe gerencia" on public.partners for all
  using (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'))
  with check (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'));

alter table public.processes
  add column partner_id uuid references public.partners (id) on delete set null,
  add column partner_fee_percent numeric(5, 2) check (partner_fee_percent between 0 and 100);
create index processes_partner_idx on public.processes (partner_id) where partner_id is not null;

-- Audiência on-line ou presencial
alter table public.events add column hearing_mode text check (hearing_mode in ('online', 'presencial'));
