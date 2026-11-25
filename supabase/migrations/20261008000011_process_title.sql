-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Nome do processo e número opcional
-- O advogado identifica o processo por um nome ("Cobrança — contra Banco X") e pelo
-- número CNJ quando houver (processos ainda não ajuizados ficam sem número).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.processes add column title text;
alter table public.processes alter column number drop not null;

-- Busca textual inclui o nome
drop index if exists public.processes_search_idx;
alter table public.processes drop column search;
alter table public.processes add column search tsvector generated always as (
  setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(number, '')), 'A') ||
  setweight(to_tsvector('simple', regexp_replace(coalesce(number, ''), '\D', '', 'g')), 'A') ||
  setweight(to_tsvector('portuguese', coalesce(procedural_class, '')), 'B') ||
  setweight(to_tsvector('portuguese', coalesce(subject, '')), 'B') ||
  setweight(to_tsvector('portuguese', coalesce(opposing_party, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(tribunal, '')), 'C') ||
  setweight(to_tsvector('portuguese', coalesce(court_division, '')), 'C') ||
  setweight(to_tsvector('portuguese', coalesce(notes, '')), 'D')
) stored;
create index processes_search_idx on public.processes using gin (search);

-- Processo precisa de nome ou número
alter table public.processes add constraint processes_title_or_number
  check (coalesce(nullif(btrim(title), ''), nullif(btrim(number), '')) is not null);

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
    select 'process', p.id, coalesce(nullif(concat_ws(' — ', p.title, p.number), ''), 'Processo'),
           concat_ws(' · ', p.procedural_class, p.tribunal, p.court_division),
           coalesce(p.next_hearing_at, p.next_deadline_at),
           (ts_rank(p.search, query.tsq) + case when length(query.digits) >= 4 and regexp_replace(p.number, '\D', '', 'g') like '%' || query.digits || '%' then 1 else 0 end)::real
    from public.processes p, query
    where p.organization_id = org
      and (p.search @@ query.tsq
           or (length(query.digits) >= 4 and regexp_replace(p.number, '\D', '', 'g') like '%' || query.digits || '%')
           or public.normalize_text(p.opposing_party) like query.pattern
           or public.normalize_text(p.title) like query.pattern)
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
