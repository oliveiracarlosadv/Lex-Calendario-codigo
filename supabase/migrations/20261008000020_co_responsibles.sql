-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Mais de um responsável por tarefa/compromisso
-- Lista de responsáveis adicionais: [{ "type": "member"|"collaborator"|"partner", "id": "<uuid>" }]
-- ════════════════════════════════════════════════════════════════════════════
alter table public.events add column co_responsibles jsonb not null default '[]'::jsonb;

-- ════════════════════════════════════════════════════════════════════════════
-- Tipo de contrato do cliente: por trabalho (por causa/serviço) ou fixo (mensal)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.clients
  add column contract_type text check (contract_type in ('trabalho', 'fixo')),
  add column contract_value numeric(14, 2),
  add column contract_notes text;
