-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Regras de negócio no banco: onboarding, lembretes,
-- histórico, agregados de processos e busca global.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────── Categorias padrão do escritório ─────────────────────
create or replace function public.seed_default_categories(org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.event_categories (organization_id, kind, name, color, position) values
    (org, 'hearing',      'Audiência',          '#D93F3F', 0),
    (org, 'deadline',     'Prazo',              '#E8833A', 1),
    (org, 'meeting',      'Reunião',            '#3478F6', 2),
    (org, 'diligence',    'Diligência',         '#8E5BD9', 3),
    (org, 'consultation', 'Consulta',           '#2BA59A', 4),
    (org, 'service',      'Atendimento',        '#556B2F', 5),
    (org, 'reminder',     'Lembrete',           '#E5B800', 6),
    (org, 'custom',       'Evento personalizado','#8E8E93', 7)
  on conflict (organization_id, name) do nothing
$$;

-- ───────────────────── Onboarding: novo usuário ─────────────────────
-- Cria perfil; se houver convite pendente, entra na organização convidante;
-- caso contrário, cria um escritório próprio com o usuário como administrador.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  org_id uuid;
  invite record;
  display_name text := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1)
  );
begin
  select * into invite from public.invitations
   where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
   order by created_at desc limit 1;

  if invite.id is not null then
    org_id := invite.organization_id;
    insert into public.memberships (organization_id, user_id, role, invited_by)
    values (org_id, new.id, invite.role, invite.invited_by);
    update public.invitations set accepted_at = now() where id = invite.id;
  else
    insert into public.organizations (name, slug)
    values (
      coalesce(new.raw_user_meta_data ->> 'organization_name', 'Escritório de ' || display_name),
      lower(regexp_replace(public.normalize_text(display_name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 6)
    )
    returning id into org_id;
    insert into public.memberships (organization_id, user_id, role) values (org_id, new.id, 'admin');
    perform public.seed_default_categories(org_id);
  end if;

  insert into public.profiles (id, full_name, email, avatar_url, current_organization_id)
  values (new.id, display_name, new.email, new.raw_user_meta_data ->> 'avatar_url', org_id);

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Preenche organization_id dos filhos a partir do evento ─────────────
create or replace function public.inherit_event_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_id is not null then
    select organization_id into new.organization_id from public.events where id = new.event_id;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['event_checklist_items','event_reminders','event_comments']
  loop
    execute format('create trigger inherit_org before insert on public.%I for each row execute function public.inherit_event_org()', t);
  end loop;
end $$;

create trigger inherit_org before insert on public.event_attachments
  for each row when (new.event_id is not null) execute function public.inherit_event_org();

-- ───────────────────────── Lembretes ─────────────────────────
create or replace function public.compute_reminder_time()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select e.starts_at - make_interval(mins => new.offset_minutes)
    into new.remind_at
    from public.events e where e.id = new.event_id;
  return new;
end $$;

create trigger compute_reminder_time
  before insert or update of offset_minutes on public.event_reminders
  for each row execute function public.compute_reminder_time();

-- Ao remarcar o evento, reagenda lembretes não enviados (e reabre os futuros)
create or replace function public.reschedule_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at is distinct from old.starts_at then
    update public.event_reminders
       set remind_at = new.starts_at - make_interval(mins => offset_minutes),
           sent_at = case when new.starts_at - make_interval(mins => offset_minutes) > now() then null else sent_at end
     where event_id = new.id;
  end if;
  return new;
end $$;

create trigger reschedule_reminders
  after update of starts_at on public.events
  for each row execute function public.reschedule_reminders();

-- ───────────────────── Agregados do processo ─────────────────────
-- Mantém "próxima audiência" e "próximo prazo" atualizados a partir da agenda.
create or replace function public.refresh_process_schedule(pid uuid)
returns void language sql security definer set search_path = '' as $$
  update public.processes p set
    next_hearing_at = (
      select min(e.starts_at) from public.events e
      where e.process_id = pid and e.kind = 'hearing' and e.deleted_at is null
        and e.status not in ('cancelled', 'done') and e.starts_at >= now()
    ),
    next_deadline_at = (
      select min(e.starts_at) from public.events e
      where e.process_id = pid and e.kind = 'deadline' and e.deleted_at is null
        and e.status not in ('cancelled', 'done') and e.starts_at >= now() - interval '1 day'
    )
  where p.id = pid
$$;

create or replace function public.on_event_change_refresh_process()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.process_id is not null then
    perform public.refresh_process_schedule(new.process_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.process_id is not null
     and (tg_op = 'DELETE' or old.process_id is distinct from new.process_id) then
    perform public.refresh_process_schedule(old.process_id);
  end if;
  return null;
end $$;

create trigger refresh_process_schedule
  after insert or update or delete on public.events
  for each row execute function public.on_event_change_refresh_process();

create or replace function public.on_movement_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.processes
     set last_movement_at = new.occurred_at,
         last_movement_summary = new.title
   where id = new.process_id
     and (last_movement_at is null or last_movement_at <= new.occurred_at);
  return new;
end $$;

create trigger on_movement_insert
  after insert on public.process_movements
  for each row execute function public.on_movement_insert();

-- ───────────────────────── Histórico de atividades ─────────────────────────
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb;
  old_rec jsonb;
  diff jsonb := '{}'::jsonb;
  k text;
  act text;
  p_type text;
  p_id uuid;
  ignored text[] := array['updated_at', 'search', 'description'];
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Exclusão em cascata da organização: não há onde registrar
  if not exists (select 1 from public.organizations o where o.id = (rec ->> 'organization_id')::uuid) then
    return null;
  end if;
  act := lower(tg_op) || 'd';
  if tg_op = 'UPDATE' then
    old_rec := to_jsonb(old);
    for k in select jsonb_object_keys(rec) loop
      if not (k = any (ignored)) and rec -> k is distinct from old_rec -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_rec -> k, 'to', rec -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      if rec -> 'description' is distinct from old_rec -> 'description' then
        diff := jsonb_build_object('description', jsonb_build_object('changed', true));
      else
        return null;
      end if;
    end if;
    if tg_table_name = 'event_checklist_items' and diff ? 'is_done' then
      act := case when (rec ->> 'is_done')::boolean then 'completed' else 'reopened' end;
    end if;
    if tg_table_name = 'events' and diff ? 'deleted_at' then
      act := case when rec ->> 'deleted_at' is null then 'restored' else 'trashed' end;
    end if;
  elsif tg_op = 'INSERT' then
    diff := null;
  end if;

  if tg_table_name in ('event_checklist_items', 'event_attachments', 'event_comments') and rec ? 'event_id' and rec ->> 'event_id' is not null then
    p_type := 'event'; p_id := (rec ->> 'event_id')::uuid;
  elsif tg_table_name = 'processes' and rec ->> 'client_id' is not null then
    p_type := 'client'; p_id := (rec ->> 'client_id')::uuid;
  elsif tg_table_name = 'events' and rec ->> 'process_id' is not null then
    p_type := 'process'; p_id := (rec ->> 'process_id')::uuid;
  end if;

  insert into public.activity_log (organization_id, entity_type, entity_id, parent_type, parent_id, action, actor_id, changes)
  values (
    (rec ->> 'organization_id')::uuid,
    case tg_table_name
      when 'events' then 'event' when 'clients' then 'client' when 'processes' then 'process'
      when 'event_checklist_items' then 'checklist' when 'event_attachments' then 'attachment'
      when 'event_comments' then 'comment' else tg_table_name end,
    (rec ->> 'id')::uuid, p_type, p_id, act, auth.uid(), diff
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['events','clients','processes','event_checklist_items','event_attachments','event_comments']
  loop
    execute format('create trigger log_activity after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- ─────────────────────────── Busca global ───────────────────────────
create or replace function public.global_search(org uuid, q text, max_results int default 8)
returns table (
  entity_type text,
  id uuid,
  title text,
  subtitle text,
  starts_at timestamptz,
  rank real
) language sql stable security invoker set search_path = public, extensions as $$
  with query as (
    select websearch_to_tsquery('portuguese', q) as tsq,
           '%' || public.normalize_text(q) || '%' as pattern,
           regexp_replace(q, '\D', '', 'g') as digits
  )
  (
    select 'client'::text, c.id, c.name,
           concat_ws(' · ', nullif(c.document, ''), c.email, c.phone),
           null::timestamptz,
           (ts_rank(c.search, query.tsq) + similarity(c.name, q))::real
    from public.clients c, query
    where c.organization_id = org and c.archived_at is null
      and (c.search @@ query.tsq or public.normalize_text(c.name) like query.pattern
           or (length(query.digits) >= 4 and c.document like '%' || query.digits || '%'))
    order by 6 desc limit max_results
  )
  union all
  (
    select 'process', p.id, p.number,
           concat_ws(' · ', p.procedural_class, p.tribunal, p.court_division),
           coalesce(p.next_hearing_at, p.next_deadline_at),
           (ts_rank(p.search, query.tsq) + case when length(query.digits) >= 4 and regexp_replace(p.number, '\D', '', 'g') like '%' || query.digits || '%' then 1 else 0 end)::real
    from public.processes p, query
    where p.organization_id = org
      and (p.search @@ query.tsq
           or (length(query.digits) >= 4 and regexp_replace(p.number, '\D', '', 'g') like '%' || query.digits || '%')
           or public.normalize_text(p.opposing_party) like query.pattern)
    order by 6 desc limit max_results
  )
  union all
  (
    select 'event', e.id, e.title,
           concat_ws(' · ', e.location, e.tribunal),
           e.starts_at,
           ts_rank(e.search, query.tsq)::real
    from public.events e, query
    where e.organization_id = org and e.deleted_at is null
      and (e.search @@ query.tsq or public.normalize_text(e.title) like query.pattern)
    order by 6 desc, e.starts_at desc limit max_results
  )
  union all
  (
    select 'note', e.id, e.title,
           left(e.description_text, 140),
           e.starts_at,
           ts_rank(to_tsvector('portuguese', coalesce(e.description_text, '')), query.tsq)::real
    from public.events e, query
    where e.organization_id = org and e.deleted_at is null and e.description_text is not null
      and to_tsvector('portuguese', e.description_text) @@ query.tsq
    order by 6 desc limit greatest(3, max_results / 2)
  )
$$;

-- ───────────────────────── Indicadores do painel ─────────────────────────
create or replace function public.dashboard_metrics(org uuid, tz text default 'America/Sao_Paulo')
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select date_trunc('day', now() at time zone tz) at time zone tz as day_start,
           (date_trunc('day', now() at time zone tz) + interval '1 day') at time zone tz as day_end,
           date_trunc('month', now() at time zone tz) at time zone tz as month_start
  ),
  ev as (
    select e.* from public.events e where e.organization_id = org and e.deleted_at is null
  )
  select jsonb_build_object(
    'hearingsToday', (select count(*) from ev, bounds where kind = 'hearing' and starts_at >= day_start and starts_at < day_end and status <> 'cancelled'),
    'deadlinesNext7', (select count(*) from ev where kind = 'deadline' and starts_at between now() and now() + interval '7 days' and status not in ('done','cancelled')),
    'upcoming', (select count(*) from ev where starts_at > now() and status = 'scheduled'),
    'pending', (select count(*) from ev where status in ('scheduled','in_progress') and starts_at <= now() + interval '7 days'),
    'overdue', (select count(*) from ev where ends_at < now() and status in ('scheduled','in_progress') and kind in ('deadline','diligence','reminder','custom')),
    'critical', (select count(*) from ev where priority = 'critical' and status not in ('done','cancelled') and starts_at >= now() - interval '1 day'),
    'completedThisMonth', (select count(*) from ev, bounds where status = 'done' and updated_at >= month_start),
    'createdThisMonth', (select count(*) from ev, bounds where created_at >= month_start),
    'deadlinesMetOnTime', (select count(*) from ev, bounds where kind = 'deadline' and status = 'done' and updated_at <= ends_at and starts_at >= month_start),
    'deadlinesTotalMonth', (select count(*) from ev, bounds where kind = 'deadline' and starts_at >= month_start and starts_at < now()),
    'activeProcesses', (select count(*) from public.processes where organization_id = org and status = 'active'),
    'clients', (select count(*) from public.clients where organization_id = org and archived_at is null),
    'pendingSuggestions', (select count(*) from public.ai_suggestions where organization_id = org and status = 'pending'),
    'checklistProgress', (
      select coalesce(round(100.0 * count(*) filter (where i.is_done) / nullif(count(*), 0)), 0)
      from public.event_checklist_items i join ev on ev.id = i.event_id
      where ev.starts_at >= now() - interval '30 days'
    ),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'done', w.done, 'total', w.total) order by w.week), '[]'::jsonb)
      from (
        select date_trunc('week', starts_at at time zone tz)::date as week,
               count(*) filter (where status = 'done') as done,
               count(*) as total
        from ev where starts_at >= now() - interval '8 weeks' and starts_at < now()
        group by 1
      ) w
    )
  )
$$;

-- ─────────────────── Aceitar sugestão da IA (cria evento) ───────────────────
create or replace function public.accept_ai_suggestion(suggestion_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  s public.ai_suggestions;
  p public.processes;
  new_event uuid;
  cat uuid;
begin
  select * into s from public.ai_suggestions where id = suggestion_id and status = 'pending' for update;
  if s.id is null then
    raise exception 'Sugestão não encontrada ou já decidida';
  end if;
  select * into p from public.processes where id = s.process_id;
  select id into cat from public.event_categories
   where organization_id = s.organization_id and kind = s.kind::text::public.event_kind
   order by position limit 1;

  insert into public.events (
    organization_id, title, kind, category_id, starts_at, ends_at, all_day,
    process_id, client_id, tribunal, court_division, responsible_id, priority, source, created_by, description_text
  ) values (
    s.organization_id, s.title, s.kind::text::public.event_kind, cat,
    coalesce(s.starts_at, now() + interval '1 day'),
    coalesce(s.ends_at, coalesce(s.starts_at, now() + interval '1 day') + case when s.kind = 'hearing' then interval '1 hour' else interval '0' end),
    s.kind = 'deadline',
    p.id, p.client_id, p.tribunal, p.court_division, coalesce(p.responsible_id, auth.uid()),
    case when s.kind in ('hearing', 'deadline') then 'high'::public.event_priority else 'medium'::public.event_priority end,
    'ai', auth.uid(), s.rationale
  ) returning id into new_event;

  insert into public.event_reminders (event_id, user_id, offset_minutes)
  select new_event, coalesce(p.responsible_id, auth.uid()), unnest(
    case when s.kind = 'deadline' then array[1440, 4320, 10080] else array[60, 1440] end
  )
  on conflict do nothing;

  update public.ai_suggestions
     set status = 'accepted', event_id = new_event, decided_by = auth.uid(), decided_at = now()
   where id = s.id;
  return new_event;
end $$;

-- ─────────────────────────── Realtime ───────────────────────────
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.ai_suggestions;
alter publication supabase_realtime add table public.event_comments;
alter publication supabase_realtime add table public.event_checklist_items;
