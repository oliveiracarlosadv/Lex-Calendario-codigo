-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Anotações nos processos (datadas, com autor)
-- ════════════════════════════════════════════════════════════════════════════
create table public.process_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index process_notes_process_idx on public.process_notes (process_id, created_at);
create trigger set_updated_at before update on public.process_notes for each row execute function public.set_updated_at();

alter table public.process_notes enable row level security;
create policy "anotações: membros leem" on public.process_notes for select using (public.is_member(organization_id));
create policy "anotações: membros escrevem" on public.process_notes for insert with check (public.is_member(organization_id));
create policy "anotações: autor ou admin edita" on public.process_notes for update
  using (author_id = auth.uid() or public.has_role(organization_id, '{admin,partner}'));
create policy "anotações: autor ou admin remove" on public.process_notes for delete
  using (author_id = auth.uid() or public.has_role(organization_id, '{admin,partner}'));
