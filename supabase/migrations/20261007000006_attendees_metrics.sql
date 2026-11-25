-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Convidados nos compromissos e indicadores do painel
-- ════════════════════════════════════════════════════════════════════════════

-- Convidados: [{ "email": "...", "name": "...", "status": "needsAction|accepted|declined|tentative" }]
alter table public.events add column attendees jsonb not null default '[]'::jsonb;

-- Indicadores: eventos importados de outras agendas (Google, Outlook, iCloud, ICS) não têm
-- controle de conclusão no Lex — não entram em "pendentes" nem em "atrasados".
create or replace function public.dashboard_metrics(org uuid, tz text default 'America/Sao_Paulo')
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select date_trunc('day', now() at time zone tz) at time zone tz as day_start,
           (date_trunc('day', now() at time zone tz) + interval '1 day') at time zone tz as day_end,
           date_trunc('month', now() at time zone tz) at time zone tz as month_start
  ),
  ev as (
    select e.* from public.events e where e.organization_id = org and e.deleted_at is null
  ),
  own as (
    select * from ev where source in ('lex', 'ai')
  )
  select jsonb_build_object(
    'hearingsToday', (select count(*) from ev, bounds where kind = 'hearing' and starts_at >= day_start and starts_at < day_end and status <> 'cancelled'),
    'deadlinesNext7', (select count(*) from ev where kind = 'deadline' and ends_at >= now() and starts_at <= now() + interval '7 days' and status not in ('done','cancelled')),
    'upcoming', (select count(*) from ev where starts_at > now() and status in ('scheduled','in_progress')),
    'pending', (select count(*) from own where status in ('scheduled','in_progress') and starts_at <= now() + interval '7 days' and ends_at >= now()),
    'overdue', (select count(*) from own where ends_at < now() and status in ('scheduled','in_progress') and kind in ('deadline','task','diligence','reminder')),
    'critical', (select count(*) from ev where priority = 'critical' and status not in ('done','cancelled') and ends_at >= now()),
    'completedThisMonth', (select count(*) from ev, bounds where status = 'done' and updated_at >= month_start),
    'createdThisMonth', (select count(*) from own, bounds where created_at >= month_start),
    'deadlinesMetOnTime', (select count(*) from ev, bounds where kind = 'deadline' and status = 'done' and updated_at <= ends_at and starts_at >= month_start),
    'deadlinesTotalMonth', (select count(*) from ev, bounds where kind = 'deadline' and starts_at >= month_start and starts_at < now()),
    'activeProcesses', (select count(*) from public.processes where organization_id = org and status = 'active'),
    'clients', (select count(*) from public.clients where organization_id = org and archived_at is null),
    'pendingSuggestions', (select count(*) from public.ai_suggestions where organization_id = org and status = 'pending'),
    'unreadIntimations', (select count(*) from public.intimations where organization_id = org and read_at is null),
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
        from own where starts_at >= now() - interval '8 weeks' and starts_at < now()
        group by 1
      ) w
    )
  )
$$;

-- ───────────── Categoria "Tarefa" (escritórios existentes e novos) ─────────────
insert into public.event_categories (organization_id, kind, name, color, position)
select o.id, 'task', 'Tarefa', '#5856D6', 8 from public.organizations o
on conflict (organization_id, name) do nothing;

create or replace function public.seed_default_categories(org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.event_categories (organization_id, kind, name, color, position) values
    (org, 'hearing',      'Audiência',           '#D93F3F', 0),
    (org, 'deadline',     'Prazo',               '#E8833A', 1),
    (org, 'task',         'Tarefa',              '#5856D6', 2),
    (org, 'meeting',      'Reunião',             '#3478F6', 3),
    (org, 'diligence',    'Diligência',          '#8E5BD9', 4),
    (org, 'consultation', 'Consulta',            '#2BA59A', 5),
    (org, 'service',      'Atendimento',         '#556B2F', 6),
    (org, 'reminder',     'Lembrete',            '#E5B800', 7),
    (org, 'custom',       'Evento personalizado','#8E8E93', 8)
  on conflict (organization_id, name) do nothing
$$;
