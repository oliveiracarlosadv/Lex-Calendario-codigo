-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Comunicações com clientes (e-mails, ofícios, WhatsApp)
-- Modelos com variáveis, agendamento de envio, prazo e anexos; conta de e-mail (SMTP).
-- ════════════════════════════════════════════════════════════════════════════

create type public.communication_kind as enum ('email', 'oficio', 'whatsapp');
create type public.communication_status as enum ('draft', 'scheduled', 'sent', 'failed', 'cancelled');

create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind public.communication_kind not null default 'email',
  subject text not null default '',
  body text not null default '',
  is_default boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.communication_kind not null default 'email',
  status public.communication_status not null default 'draft',
  client_id uuid references public.clients (id) on delete set null,
  process_id uuid references public.processes (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,        -- tarefa de prazo criada no calendário
  template_id uuid references public.communication_templates (id) on delete set null,
  to_email text,
  to_phone text,
  recipient_name text,
  subject text not null default '',
  body text not null default '',
  deadline_at date,                     -- prazo informado ao destinatário
  send_at timestamptz,                  -- envio agendado
  sent_at timestamptz,
  notified_at timestamptz,              -- WhatsApp/ofício agendados: aviso "hora de enviar" já dado
  error text,
  attachments jsonb not null default '[]'::jsonb,  -- [{ name, path, size, mime }]
  generated_by_ai boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communications_org_idx on public.communications (organization_id, created_at desc);
create index communications_client_idx on public.communications (client_id, created_at desc);
create index communications_due_idx on public.communications (send_at) where status = 'scheduled';

-- Conta de e-mail para envio (SMTP). A senha fica criptografada e nunca é lida pelo navegador.
create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  host text not null,
  port integer not null default 465,
  secure boolean not null default true,
  username text not null,
  password_enc text,
  from_name text,
  from_email text not null,
  last_test_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

do $$
declare t text;
begin
  foreach t in array array['communication_templates','communications','mail_accounts']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

create trigger log_activity after insert or update or delete on public.communications
  for each row execute function public.log_activity();

-- ─────────────────────────────── RLS ───────────────────────────────
alter table public.communication_templates enable row level security;
alter table public.communications enable row level security;
alter table public.mail_accounts enable row level security;

create policy "modelos: membros leem" on public.communication_templates for select using (public.is_member(organization_id));
create policy "modelos: membros gerenciam" on public.communication_templates for all
  using (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'))
  with check (public.has_role(organization_id, '{admin,partner,lawyer,assistant,secretary}'));

create policy "comunicações: membros leem" on public.communications for select using (public.is_member(organization_id));
create policy "comunicações: membros criam" on public.communications for insert with check (public.is_member(organization_id));
create policy "comunicações: membros editam" on public.communications for update using (public.is_member(organization_id));
create policy "comunicações: autor ou admin remove" on public.communications for delete
  using (created_by = auth.uid() or public.has_role(organization_id, '{admin,partner}'));

create policy "conta de e-mail: dono" on public.mail_accounts for select using (user_id = auth.uid());
create policy "conta de e-mail: dono remove" on public.mail_accounts for delete using (user_id = auth.uid());
revoke select, insert, update on public.mail_accounts from authenticated, anon;
grant select (id, organization_id, user_id, host, port, secure, username, from_name, from_email, last_test_at, last_error, created_at, updated_at)
  on public.mail_accounts to authenticated;

-- ─────────────────────────── Modelos padrão ───────────────────────────
create or replace function public.seed_communication_templates(org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.communication_templates (organization_id, name, kind, subject, body, is_default) values
  (org, 'Comunicado de audiência', 'email', 'Audiência designada — processo {{processo}}',
'Prezado(a) {{cliente}},

Informamos que foi designada audiência no processo nº {{processo}}, em trâmite perante {{vara}} ({{tribunal}}).

Data e horário: {{data_evento}}
Local: {{local_evento}}

Pedimos que confirme sua presença até {{prazo}} e que compareça com 30 minutos de antecedência, portando documento de identificação com foto.

Permanecemos à disposição para quaisquer esclarecimentos.

Atenciosamente,
{{advogado}} — OAB {{oab}}
{{escritorio}}', true),
  (org, 'Solicitação de documentos', 'email', 'Documentos necessários — {{processo}}',
'Prezado(a) {{cliente}},

Para darmos andamento ao seu processo nº {{processo}}, solicitamos o envio dos seguintes documentos até {{prazo}}:

1.
2.
3.

Os documentos podem ser enviados em resposta a este e-mail (PDF ou foto legível).

Atenciosamente,
{{advogado}} — OAB {{oab}}
{{escritorio}}', true),
  (org, 'Informe de andamento processual', 'email', 'Andamento do processo {{processo}}',
'Prezado(a) {{cliente}},

Comunicamos a última movimentação do processo nº {{processo}} ({{tribunal}} — {{vara}}):

{{ultima_movimentacao}}

Próximos passos:

Qualquer dúvida, estamos à disposição.

Atenciosamente,
{{advogado}} — OAB {{oab}}
{{escritorio}}', true),
  (org, 'Lembrete de reunião', 'whatsapp', 'Lembrete de reunião',
'Olá, {{cliente}}! Lembramos da nossa reunião em {{data_evento}} ({{local_evento}}). Por favor, confirme sua presença. — {{escritorio}}', true),
  (org, 'Ofício', 'oficio', 'Ofício nº ___/{{ano}}',
'OFÍCIO Nº ___/{{ano}}

Belém (PA), {{hoje}}.

A(o) Ilustríssimo(a) Senhor(a)
[Destinatário]
[Cargo / Órgão]
[Endereço]

Assunto: [assunto]
Referência: processo nº {{processo}} — {{vara}} ({{tribunal}})

Senhor(a),

Na qualidade de advogado(a) de {{cliente}}, venho, respeitosamente, solicitar [descrever a solicitação], no prazo de {{prazo}}, nos termos da legislação aplicável.

Sem mais para o momento, renovo protestos de elevada estima e consideração.

Atenciosamente,

{{advogado}}
OAB {{oab}}
{{escritorio}}', true)
  on conflict (organization_id, name) do nothing
$$;

select public.seed_communication_templates(id) from public.organizations;

-- Novos escritórios recebem os modelos padrão
create or replace function public.on_organization_created_seed_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_communication_templates(new.id);
  return new;
end $$;

create trigger seed_communication_templates after insert on public.organizations
  for each row execute function public.on_organization_created_seed_templates();
