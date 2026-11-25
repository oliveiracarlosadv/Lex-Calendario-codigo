-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Envio de e-mails pelo Gmail (permissão gmail.send da conta Google)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.calendar_connections add column scopes text;
grant select (scopes) on public.calendar_connections to authenticated;

create or replace view public.calendar_connections_public with (security_invoker = true) as
  select id, organization_id, user_id, provider, account_email, external_calendar_id,
         last_synced_at, last_error, is_active, created_at, last_push_error, last_push_error_at, scopes
  from public.calendar_connections;
