-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Parceiro como responsável por tarefas e compromissos
-- ════════════════════════════════════════════════════════════════════════════
alter table public.events add column partner_id uuid references public.partners (id) on delete set null;
create index events_partner_idx on public.events (partner_id) where partner_id is not null;
