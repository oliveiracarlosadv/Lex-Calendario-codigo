-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Contatos do cliente para comunicação (pessoas terceiras)
-- ════════════════════════════════════════════════════════════════════════════
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  relationship text,                 -- cônjuge, filho(a), secretária, contador, representante legal…
  email text,
  phone text,
  notes text,
  receives_communications boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_contacts_client_idx on public.client_contacts (client_id, name);
create trigger set_updated_at before update on public.client_contacts for each row execute function public.set_updated_at();

alter table public.client_contacts enable row level security;
create policy "contatos: membros leem" on public.client_contacts for select using (public.is_member(organization_id));
create policy "contatos: equipe gerencia" on public.client_contacts for all
  using (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'))
  with check (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'));

-- Comunicação enviada a um contato do cliente
alter table public.communications add column contact_id uuid references public.client_contacts (id) on delete set null;
