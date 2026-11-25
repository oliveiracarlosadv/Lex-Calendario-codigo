-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — União de duplicados mais tolerante
-- Ao restaurar um backup depois de conectar o Google, a cópia do backup e a trazida do
-- Google podiam ficar com término diferente (ex.: dia inteiro terminando 23:59 ou 00:00,
-- ou horário alterado no Google depois do backup) e não eram unidas. Agora a cópia antiga
-- sem vínculo de um evento do calendário externo é unida mesmo com término diferente.
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
             e.starts_at
    having count(*) > 1
  loop
    keeper := g.ids[1];
    foreach loser in array g.ids[2:array_length(g.ids, 1)]
    loop
      -- Término diferente: só une a cópia antiga de um evento do calendário externo (sem vínculo),
      -- por exemplo a que veio de um backup quando o mesmo evento já foi trazido do Google.
      if exists (
        select 1 from public.events l, public.events k
        where l.id = loser and k.id = keeper
          and l.ends_at is distinct from k.ends_at
          and (
            l.source in ('lex', 'ai')
            or exists (select 1 from public.event_external_links x where x.event_id = loser)
          )
      ) then
        continue;
      end if;
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

-- Une agora as cópias que ficaram duplicadas nas instalações existentes
select public.merge_duplicate_events(null);
