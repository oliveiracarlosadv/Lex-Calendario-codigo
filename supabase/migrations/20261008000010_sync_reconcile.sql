-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Sincronização confiável com Google Agenda
-- Alterações feitas no Lex que não chegaram ao Google (janela fechada, servidor
-- reiniciando, falha da API) são reenviadas pela sincronização periódica.
-- ════════════════════════════════════════════════════════════════════════════

-- Erros de envio ficam separados dos de leitura (a leitura bem-sucedida não os apaga)
alter table public.calendar_connections
  add column last_push_error text,
  add column last_push_error_at timestamptz;
grant select (last_push_error, last_push_error_at) on public.calendar_connections to authenticated;

-- Checklist, comentários e anexos fazem parte da descrição no Google: alterá-los marca o compromisso como alterado
create or replace function public.touch_parent_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := coalesce(case when tg_op = 'DELETE' then old.event_id else new.event_id end, null);
begin
  if eid is not null then
    update public.events set updated_at = now() where id = eid and updated_at < now();
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['event_checklist_items', 'event_comments', 'event_attachments']
  loop
    execute format('drop trigger if exists touch_parent_event on public.%I', t);
    execute format('create trigger touch_parent_event after insert or update or delete on public.%I for each row execute function public.touch_parent_event()', t);
  end loop;
end $$;

-- Compromissos com alterações ainda não enviadas a uma conexão.
-- Eventos vindos do Google só são reenviados quando um usuário os alterou no Lex
-- (evita reescrever a agenda inteira depois de uma importação de backup).
create or replace function public.sync_pending_events(conn uuid, max_rows integer default 25)
returns table (event_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id
  from public.calendar_connections c
  join public.events e on e.organization_id = c.organization_id
  left join public.event_external_links l on l.event_id = e.id and l.connection_id = c.id
  where c.id = conn
    and c.is_active
    and (e.responsible_id = c.user_id or e.created_by = c.user_id)
    and e.ends_at > now() - interval '90 days'
    and (
      (l.event_id is null and e.deleted_at is null and e.source in ('lex', 'ai'))
      or (l.event_id is not null and e.deleted_at is not null)
      or (
        l.event_id is not null and e.deleted_at is null
        and e.updated_at > l.last_synced_at + interval '2 seconds'
        and (
          e.source in ('lex', 'ai')
          or exists (
            select 1 from public.activity_log a
            where (a.entity_id = e.id or a.parent_id = e.id)
              and a.actor_id is not null
              and a.created_at > l.last_synced_at
          )
        )
      )
    )
  order by e.updated_at desc
  limit max_rows
$$;
revoke execute on function public.sync_pending_events(uuid, integer) from public, anon, authenticated;

create or replace view public.calendar_connections_public with (security_invoker = true) as
  select id, organization_id, user_id, provider, account_email, external_calendar_id,
         last_synced_at, last_error, is_active, created_at, last_push_error, last_push_error_at
  from public.calendar_connections;
