-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Avisos aos convidados só em mudanças importantes; convidados
-- podem alterar data/hora e comentar pelo Google Agenda
-- ════════════════════════════════════════════════════════════════════════════

-- Impressão digital do que importa ao convidado (data, hora, local, link, convidados) no último envio
alter table public.event_external_links add column notify_hash text;

-- Convidados podem alterar o evento no Google Agenda (padrão: sim)
alter table public.events add column guests_can_modify boolean not null default true;

-- Observações deixadas pelos convidados ao responder o convite, já importadas como comentário
alter table public.event_comments add column external_ref text;
create unique index event_comments_external_ref_idx on public.event_comments (event_id, external_ref) where external_ref is not null;
