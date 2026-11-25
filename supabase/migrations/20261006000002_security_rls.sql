-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Segurança: funções de autorização e Row Level Security
--
-- Matriz de papéis (resumo):
--   admin      → tudo, inclusive equipe, faturamento e integrações da organização
--   partner    → tudo do escritório, exceto gestão de faturamento
--   lawyer     → cria/edita clientes, processos e eventos; exclui o que criou
--   assistant  → cria/edita eventos, checklists e anexos; leitura de clientes/processos
--   secretary  → agenda (eventos/lembretes) e cadastro de clientes; sem exclusões
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.is_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid()
  )
$$;

create or replace function public.has_role(org uuid, roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.role = any (roles)
  )
$$;

create or replace function public.current_role_in(org uuid)
returns public.app_role language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m where m.organization_id = org and m.user_id = auth.uid()
$$;

-- Ativa RLS em todas as tabelas públicas
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','memberships','invitations','event_categories','clients','processes',
    'process_movements','events','event_checklist_items','event_reminders','event_attachments',
    'event_comments','activity_log','notifications','push_subscriptions','calendar_connections',
    'event_external_links','ai_suggestions','court_credentials','digital_certificates'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ─────────────────────────── Organizações ───────────────────────────
create policy "membros leem a organização" on public.organizations
  for select using (public.is_member(id));
create policy "admin/sócio atualizam a organização" on public.organizations
  for update using (public.has_role(id, '{admin,partner}'));

-- ───────────────────────────── Perfis ───────────────────────────────
create policy "usuário lê o próprio perfil e de colegas" on public.profiles
  for select using (
    id = auth.uid() or exists (
      select 1 from public.memberships a
      join public.memberships b on a.organization_id = b.organization_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
create policy "usuário atualiza o próprio perfil" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ──────────────────────────── Membros ───────────────────────────────
create policy "membros veem a equipe" on public.memberships
  for select using (public.is_member(organization_id));
create policy "admin gerencia equipe" on public.memberships
  for all using (public.has_role(organization_id, '{admin}'))
  with check (public.has_role(organization_id, '{admin}'));

create policy "admin/sócio gerenciam convites" on public.invitations
  for all using (public.has_role(organization_id, '{admin,partner}'))
  with check (public.has_role(organization_id, '{admin,partner}'));

-- ─────────────────────────── Categorias ─────────────────────────────
create policy "membros leem categorias" on public.event_categories
  for select using (public.is_member(organization_id));
create policy "admin/sócio/advogado gerenciam categorias" on public.event_categories
  for all using (public.has_role(organization_id, '{admin,partner,lawyer}'))
  with check (public.has_role(organization_id, '{admin,partner,lawyer}'));

-- ─────────────────────────── Clientes ───────────────────────────────
create policy "membros leem clientes" on public.clients
  for select using (public.is_member(organization_id));
create policy "cadastro de clientes" on public.clients
  for insert with check (public.has_role(organization_id, '{admin,partner,lawyer,secretary}'));
create policy "edição de clientes" on public.clients
  for update using (public.has_role(organization_id, '{admin,partner,lawyer,secretary}'));
create policy "exclusão de clientes" on public.clients
  for delete using (public.has_role(organization_id, '{admin,partner}'));

-- ─────────────────────────── Processos ──────────────────────────────
create policy "membros leem processos" on public.processes
  for select using (
    public.is_member(organization_id)
    and (not is_confidential or public.has_role(organization_id, '{admin,partner}') or responsible_id = auth.uid())
  );
create policy "cadastro de processos" on public.processes
  for insert with check (public.has_role(organization_id, '{admin,partner,lawyer}'));
create policy "edição de processos" on public.processes
  for update using (public.has_role(organization_id, '{admin,partner,lawyer,assistant}'));
create policy "exclusão de processos" on public.processes
  for delete using (
    public.has_role(organization_id, '{admin,partner}')
    or (public.has_role(organization_id, '{lawyer}') and created_by = auth.uid())
  );

create policy "membros leem movimentações" on public.process_movements
  for select using (public.is_member(organization_id));
create policy "registro de movimentações" on public.process_movements
  for insert with check (public.has_role(organization_id, '{admin,partner,lawyer,assistant}'));
create policy "exclusão de movimentações" on public.process_movements
  for delete using (public.has_role(organization_id, '{admin,partner,lawyer}'));

-- ──────────────────────────── Eventos ───────────────────────────────
create policy "membros leem eventos" on public.events
  for select using (
    public.is_member(organization_id)
    and (not is_private or created_by = auth.uid() or responsible_id = auth.uid())
  );
create policy "criação de eventos" on public.events
  for insert with check (public.is_member(organization_id));
create policy "edição de eventos" on public.events
  for update using (
    public.is_member(organization_id)
    and (not is_private or created_by = auth.uid() or responsible_id = auth.uid())
  );
create policy "exclusão de eventos" on public.events
  for delete using (
    public.has_role(organization_id, '{admin,partner}')
    or (public.has_role(organization_id, '{lawyer,assistant}') and (created_by = auth.uid() or responsible_id = auth.uid()))
  );

-- Recursos internos do evento: qualquer membro que enxerga o evento
do $$
declare t text;
begin
  foreach t in array array['event_checklist_items','event_attachments']
  loop
    execute format($f$
      create policy "membros acessam %1$s" on public.%1$I
        for select using (public.is_member(organization_id));
      create policy "membros criam %1$s" on public.%1$I
        for insert with check (public.is_member(organization_id));
      create policy "membros editam %1$s" on public.%1$I
        for update using (public.is_member(organization_id));
      create policy "membros removem %1$s" on public.%1$I
        for delete using (public.has_role(organization_id, '{admin,partner,lawyer,assistant}'));
    $f$, t);
  end loop;
end $$;

create policy "lembretes: dono lê" on public.event_reminders
  for select using (user_id = auth.uid() or public.has_role(organization_id, '{admin}'));
create policy "lembretes: dono gerencia" on public.event_reminders
  for all using (user_id = auth.uid() and public.is_member(organization_id))
  with check (user_id = auth.uid() and public.is_member(organization_id));

create policy "comentários: membros leem" on public.event_comments
  for select using (public.is_member(organization_id));
create policy "comentários: membros escrevem" on public.event_comments
  for insert with check (public.is_member(organization_id) and author_id = auth.uid());
create policy "comentários: autor edita" on public.event_comments
  for update using (author_id = auth.uid());
create policy "comentários: autor ou admin remove" on public.event_comments
  for delete using (author_id = auth.uid() or public.has_role(organization_id, '{admin,partner}'));

create policy "histórico: membros leem" on public.activity_log
  for select using (public.is_member(organization_id));

-- ─────────────────────────── Notificações ───────────────────────────
create policy "notificações do próprio usuário" on public.notifications
  for select using (user_id = auth.uid());
create policy "marcar notificações como lidas" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "remover notificações" on public.notifications
  for delete using (user_id = auth.uid());

create policy "push: próprio usuário" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────── Integrações ────────────────────────────
-- Tokens ficam acessíveis apenas ao service role. O cliente enxerga só metadados via view.
create policy "conexões: dono remove" on public.calendar_connections
  for delete using (user_id = auth.uid());

create view public.calendar_connections_public with (security_invoker = true) as
  select id, organization_id, user_id, provider, account_email, external_calendar_id,
         last_synced_at, last_error, is_active, created_at
  from public.calendar_connections;

create policy "conexões: dono lê metadados" on public.calendar_connections
  for select using (user_id = auth.uid());
-- Permissões em nível de coluna: o papel authenticated nunca lê os segredos criptografados.
revoke select, insert, update on public.calendar_connections from authenticated, anon;
grant select (id, organization_id, user_id, provider, account_email, external_calendar_id, token_expires_at,
              caldav_url, caldav_username, last_synced_at, last_error, is_active, created_at, updated_at)
  on public.calendar_connections to authenticated;

create policy "vínculos externos: membros leem" on public.event_external_links
  for select using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.organization_id)));

-- ──────────────────────────── IA / Monitoramento ────────────────────
create policy "sugestões: membros leem" on public.ai_suggestions
  for select using (public.is_member(organization_id));
create policy "sugestões: membros decidem" on public.ai_suggestions
  for update using (public.has_role(organization_id, '{admin,partner,lawyer,assistant}'));

create policy "credenciais de tribunal: dono" on public.court_credentials
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(organization_id));
revoke select, update on public.court_credentials from authenticated, anon;
grant select (id, organization_id, user_id, court_system, tribunal, username, created_at) on public.court_credentials to authenticated;

create policy "certificados: dono" on public.digital_certificates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(organization_id));
revoke select, update on public.digital_certificates from authenticated, anon;
grant select (id, organization_id, user_id, kind, subject_name, subject_document, issuer, serial_number,
              valid_from, valid_until, storage_path, is_default, created_at)
  on public.digital_certificates to authenticated;

-- ───────────────────────────── Storage ──────────────────────────────
-- Caminho dos arquivos: {organization_id}/{entity}/{entity_id}/{uuid}-{nome}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 52428800, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/rtf', 'text/plain', 'text/csv', 'text/calendar',
    'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/gif',
    'audio/mpeg', 'audio/mp4', 'video/mp4',
    'application/zip', 'application/x-zip-compressed',
    'message/rfc822', 'application/vnd.ms-outlook'
  ]),
  ('certificates', 'certificates', false, 1048576, array['application/x-pkcs12']),
  ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "anexos: membros leem" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "anexos: membros enviam" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "anexos: equipe jurídica remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and public.has_role(((storage.foldername(name))[1])::uuid, '{admin,partner,lawyer,assistant}'));

create policy "certificados: somente o dono" on storage.objects
  for all to authenticated
  using (bucket_id = 'certificates' and (storage.foldername(name))[2] = auth.uid()::text)
  with check (bucket_id = 'certificates' and (storage.foldername(name))[2] = auth.uid()::text);

create policy "avatares: leitura pública" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatares: dono envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatares: dono atualiza" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
