-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Eventos compartilhados entre instalações do Lex (via Google Agenda),
-- respostas de e-mail como comentários e função (profissão) no perfil
-- ════════════════════════════════════════════════════════════════════════════

-- Perfil: função/profissão da pessoa (advogado, engenheiro, médico…)
alter table public.profiles
  add column profession text,
  add column document text;   -- CPF (para buscar intimações pelo nome/CPF de quem não é advogado)

-- Comentários vindos de outra pessoa (convidado, outra instalação do Lex, resposta por e-mail)
alter table public.event_comments
  add column author_name text,
  add column author_email text;

-- Evento em que este usuário é CONVIDADO (o organizador é outra conta):
--   shared_origin   e-mail do organizador
--   shared_readonly o organizador não permite alterações (o convidado ainda pode comentar)
alter table public.events
  add column shared_origin text,
  add column shared_readonly boolean not null default false;

-- Conversas de e-mail dos comentários (para transformar as respostas em comentários)
create table public.comment_mail_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  connection_id uuid references public.calendar_connections (id) on delete cascade,
  thread_id text not null,
  created_at timestamptz not null default now(),
  unique (connection_id, thread_id)
);
create index comment_mail_threads_event_idx on public.comment_mail_threads (event_id);
alter table public.comment_mail_threads enable row level security;
create policy "conversas de comentários: membros leem" on public.comment_mail_threads for select using (public.is_member(organization_id));

-- Reenvia (em silêncio) os compromissos com convidados, para que passem a levar os dados
-- compartilhados do Lex e a permissão de alteração pelos convidados
update public.events
   set updated_at = now()
 where source in ('lex', 'ai') and deleted_at is null and ends_at > now() - interval '7 days'
   and attendees is not null and attendees <> '[]'::jsonb;
