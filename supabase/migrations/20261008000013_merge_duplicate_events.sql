-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — União de compromissos duplicados
-- Restaurar um backup numa instalação nova trazia os compromissos sem o vínculo com o
-- Google; a sincronização seguinte importava tudo de novo. Esta rotina une as cópias
-- (mesmo nome, início e fim), mantendo a que tem mais informação do Lex e o vínculo
-- com o Google, e leva para ela checklist, comentários e anexos das outras.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.merge_duplicate_events(org uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  g record;
  keeper uuid;
  loser uuid;
  merged integer := 0;
begin
  for g in
    select array_agg(e.id order by (
             (e.client_id is not null)::int * 4
           + (e.process_id is not null)::int * 4
           + (select count(*) from public.event_checklist_items c where c.event_id = e.id)::int
           + 2 * (select count(*) from public.event_comments c where c.event_id = e.id)::int
           + 2 * (select count(*) from public.event_attachments c where c.event_id = e.id)::int
           + 3 * (e.source in ('lex', 'ai'))::int
           + 2 * (exists (select 1 from public.event_external_links l where l.event_id = e.id))::int
         ) desc, e.created_at) as ids
    from public.events e
    where e.deleted_at is null
      and (org is null or e.organization_id = org)
    group by e.organization_id,
             regexp_replace(lower(btrim(e.title)), '^\s*(✔️|✔|✅)\s*', ''),
             e.starts_at, e.ends_at
    having count(*) > 1
  loop
    keeper := g.ids[1];
    foreach loser in array g.ids[2:array_length(g.ids, 1)]
    loop
      -- Cópia ligada a outro evento do Google na mesma conta: o Google também tem a cópia.
      -- Só é apagada (no Lex e, pela sincronização, no Google) se tiver o mesmo nome, horário e local
      -- e nenhum dado do Lex (cliente, processo, checklist, comentários, anexos).
      if exists (
        select 1 from public.event_external_links a
        join public.event_external_links b on b.connection_id = a.connection_id
        where a.event_id = loser and b.event_id = keeper
      ) then
        if exists (
          select 1 from public.events l, public.events k
          where l.id = loser and k.id = keeper
            and l.client_id is null and l.process_id is null and l.collaborator_id is null
            and l.location is not distinct from k.location
            and not exists (select 1 from public.event_checklist_items c where c.event_id = loser)
            and not exists (select 1 from public.event_comments c where c.event_id = loser)
            and not exists (select 1 from public.event_attachments c where c.event_id = loser)
        ) then
          update public.events set deleted_at = now() where id = loser;
          merged := merged + 1;
        end if;
        continue;
      end if;
      update public.event_external_links set event_id = keeper where event_id = loser;

      update public.events k set
        client_id = coalesce(k.client_id, l.client_id),
        process_id = coalesce(k.process_id, l.process_id),
        tribunal = coalesce(k.tribunal, l.tribunal),
        court_division = coalesce(k.court_division, l.court_division),
        description_text = coalesce(k.description_text, l.description_text),
        description = coalesce(k.description, l.description),
        collaborator_id = coalesce(k.collaborator_id, l.collaborator_id),
        related_event_id = coalesce(k.related_event_id, nullif(l.related_event_id, k.id))
      from public.events l
      where k.id = keeper and l.id = loser;

      if not exists (select 1 from public.event_checklist_items where event_id = keeper) then
        update public.event_checklist_items set event_id = keeper where event_id = loser;
      end if;
      update public.event_comments set event_id = keeper where event_id = loser;
      update public.event_attachments set event_id = keeper where event_id = loser;
      update public.events set related_event_id = keeper where related_event_id = loser;
      update public.communications set event_id = keeper where event_id = loser;

      update public.events set deleted_at = now() where id = loser;
      merged := merged + 1;
    end loop;
  end loop;
  return merged;
end $$;
revoke execute on function public.merge_duplicate_events(uuid) from public, anon, authenticated;

-- Sugestões da IA repetidas (mesma publicação recebida por mais de uma intimação)
create or replace function public.skip_duplicate_suggestion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.ai_suggestions s
    where s.organization_id = new.organization_id
      and s.process_id = new.process_id
      and s.kind = new.kind
      and s.title = new.title
      and s.starts_at is not distinct from new.starts_at
      and s.status <> 'dismissed'
  ) then
    return null; -- já existe: não cria outra
  end if;
  return new;
end $$;

create trigger skip_duplicate_suggestion before insert on public.ai_suggestions
  for each row execute function public.skip_duplicate_suggestion();

delete from public.ai_suggestions s
using public.ai_suggestions o
where s.status = 'pending'
  and o.organization_id = s.organization_id and o.process_id = s.process_id and o.kind = s.kind
  and o.title = s.title and o.starts_at is not distinct from s.starts_at
  and o.status <> 'dismissed'
  and (o.created_at, o.id) < (s.created_at, s.id);

select public.merge_duplicate_events(null);
