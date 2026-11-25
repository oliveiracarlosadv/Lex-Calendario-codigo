-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Cópias criadas por duas sincronizações simultâneas
-- Ao conectar o calendário, a primeira importação e a sincronização automática podiam
-- rodar ao mesmo tempo e cada uma criava o mesmo compromisso; só uma das cópias ficava
-- vinculada ao calendário externo. Remove a cópia sem vínculo (ela veio do mesmo evento
-- externo, então não tem dado próprio do Lex).
-- ════════════════════════════════════════════════════════════════════════════

update public.events e
set deleted_at = now()
where e.deleted_at is null
  and e.source not in ('lex', 'ai')
  and e.client_id is null
  and e.process_id is null
  and not exists (select 1 from public.event_external_links l where l.event_id = e.id)
  and exists (
    select 1
    from public.events k
    join public.event_external_links kl on kl.event_id = k.id
    where k.id <> e.id
      and k.organization_id = e.organization_id
      and k.deleted_at is null
      and k.source = e.source
      and k.title = e.title
      and k.starts_at = e.starts_at
      and k.ends_at = e.ends_at
  );
