-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Responsáveis sem conta no app (estagiários, colegas, secretárias,
-- correspondentes, convidados por e-mail) que podem receber tarefas.
-- ════════════════════════════════════════════════════════════════════════════

create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  email text,
  phone text,
  role text,                       -- função: advogado(a), estagiário(a), secretária, correspondente...
  oab text,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collaborators_org_idx on public.collaborators (organization_id, name);
create unique index collaborators_org_email_idx on public.collaborators (organization_id, lower(email)) where email is not null;

create trigger set_updated_at before update on public.collaborators for each row execute function public.set_updated_at();

alter table public.events add column collaborator_id uuid references public.collaborators (id) on delete set null;
create index events_collaborator_idx on public.events (collaborator_id) where collaborator_id is not null;

alter table public.collaborators enable row level security;
create policy "responsáveis: membros leem" on public.collaborators for select using (public.is_member(organization_id));
create policy "responsáveis: equipe gerencia" on public.collaborators for all
  using (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'))
  with check (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'));

-- ─────────────── Tarefa relacionada e data de conclusão ───────────────
-- Uma nova tarefa pode apontar para outra já concluída; a descrição enviada ao Google
-- informa o que foi executado e quando.
alter table public.events
  add column related_event_id uuid references public.events (id) on delete set null,
  add column completed_at timestamptz;
create index events_related_idx on public.events (related_event_id) where related_event_id is not null;

update public.events set completed_at = updated_at where status = 'done' and completed_at is null;

create or replace function public.set_event_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger set_event_completed_at before insert or update of status on public.events
  for each row execute function public.set_event_completed_at();
