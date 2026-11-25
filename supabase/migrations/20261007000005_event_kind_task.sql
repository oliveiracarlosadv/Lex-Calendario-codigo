-- Lex Calendário — novo tipo de compromisso: Tarefa
-- (em migration própria: um valor novo de enum não pode ser usado na mesma transação em que é criado)
alter type public.event_kind add value if not exists 'task' after 'deadline';
