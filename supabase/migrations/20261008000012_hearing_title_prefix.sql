-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Audiências salvas com "AUDIÊNCIA:" no início do nome
-- Vale para compromissos criados no Lex (manual, IA, intimações). Ao mudar o tipo
-- para outro, o prefixo é retirado. Eventos vindos do Google mantêm o nome original.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.apply_hearing_prefix()
returns trigger language plpgsql as $$
declare
  prefix_re constant text := '^\s*audi[eê]ncia\s*:\s*';
begin
  if new.source not in ('lex', 'ai') then
    return new;
  end if;
  if new.kind = 'hearing' then
    if new.title !~* prefix_re then
      new.title := 'AUDIÊNCIA: ' || btrim(new.title);
    else
      new.title := regexp_replace(new.title, prefix_re, 'AUDIÊNCIA: ', 'i');
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'hearing' and new.title ~* prefix_re then
    new.title := regexp_replace(new.title, prefix_re, '', 'i');
  end if;
  return new;
end $$;

create trigger apply_hearing_prefix before insert or update of title, kind on public.events
  for each row execute function public.apply_hearing_prefix();

-- Audiências já cadastradas no Lex
update public.events
   set title = 'AUDIÊNCIA: ' || btrim(title)
 where kind = 'hearing' and source in ('lex', 'ai') and deleted_at is null and title !~* '^\s*audi[eê]ncia\s*:';
