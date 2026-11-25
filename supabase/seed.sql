-- ════════════════════════════════════════════════════════════════════════════
-- Dados de demonstração — SOMENTE para ambiente local (supabase db reset).
-- Usuário: demo@lexcalendario.local  ·  Senha: LexDemo#2026
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  uid uuid := '00000000-0000-4000-a000-000000000001';
  org uuid;
  c1 uuid; c2 uuid; c3 uuid;
  p1 uuid; p2 uuid; p3 uuid;
  e1 uuid; e2 uuid;
  cat record;
  base date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    'demo@lexcalendario.local', extensions.crypt('LexDemo#2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Dra. Helena Duarte","organization_name":"Duarte & Associados Advocacia"}',
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', 'demo@lexcalendario.local'), 'email', now(), now(), now());

  select current_organization_id into org from public.profiles where id = uid;
  update public.profiles set oab_number = '12345', oab_state = 'PA' where id = uid;

  insert into public.clients (organization_id, kind, name, document, email, phone, address_street, address_number, address_district, address_city, address_state, address_zip, created_by)
  values (org, 'individual', 'Marcos Vinícius Albuquerque', '52998224725', 'marcos.albuquerque@email.com', '(91) 98765-4321', 'Av. Nazaré', '1200', 'Nazaré', 'Belém', 'PA', '66035-170', uid)
  returning id into c1;
  insert into public.clients (organization_id, kind, name, trade_name, document, email, phone, address_city, address_state, created_by)
  values (org, 'company', 'Amazônia Logística Ltda.', 'AmazLog', '11222333000181', 'juridico@amazlog.com.br', '(91) 3222-1100', 'Ananindeua', 'PA', uid)
  returning id into c2;
  insert into public.clients (organization_id, kind, name, document, email, phone, address_city, address_state, created_by)
  values (org, 'individual', 'Juliana Ferreira Costa', '11144477735', 'juliana.costa@email.com', '(91) 99111-2233', 'Belém', 'PA', uid)
  returning id into c3;

  insert into public.processes (organization_id, number, procedural_class, subject, tribunal, court_division, court_system, client_id, client_role, opposing_party, responsible_id, status, claim_value, distributed_at, created_by)
  values (org, '0801234-16.2025.8.14.0301', 'Procedimento Comum Cível', 'Indenização por Dano Moral', 'TJPA', '5ª Vara Cível e Empresarial de Belém', 'pje', c1, 'Autor', 'Banco Exemplo S.A.', uid, 'active', 45000, base - 120, uid)
  returning id into p1;
  insert into public.processes (organization_id, number, procedural_class, subject, tribunal, court_division, court_system, client_id, client_role, opposing_party, responsible_id, status, claim_value, distributed_at, created_by)
  values (org, '0000456-14.2025.5.08.0005', 'Ação Trabalhista - Rito Ordinário', 'Horas Extras', 'TRT8', '5ª Vara do Trabalho de Belém', 'pje', c2, 'Reclamada', 'Carlos Henrique Souza', uid, 'active', 120000, base - 60, uid)
  returning id into p2;
  insert into public.processes (organization_id, number, procedural_class, subject, tribunal, court_division, court_system, client_id, client_role, opposing_party, responsible_id, status, distributed_at, created_by)
  values (org, '1002345-51.2024.4.01.3900', 'Procedimento do Juizado Especial Cível', 'Benefício Previdenciário', 'TRF1', '8ª Vara Federal de Juizado Especial Cível da SJPA', 'pje', c3, 'Autora', 'Instituto Nacional do Seguro Social - INSS', uid, 'appeal', base - 300, uid)
  returning id into p3;

  insert into public.process_movements (organization_id, process_id, occurred_at, title, description, source, external_id) values
    (org, p1, now() - interval '2 days', 'Audiência de conciliação designada', 'Designada audiência de conciliação para o dia ' || to_char(base + 12, 'DD/MM/YYYY') || ' às 10h00, a ser realizada por videoconferência.', 'manual', 'seed-1'),
    (org, p2, now() - interval '1 day', 'Intimação', 'Intime-se a reclamada para, no prazo de 8 (oito) dias, manifestar-se sobre o laudo pericial.', 'manual', 'seed-2'),
    (org, p3, now() - interval '5 days', 'Remetidos os autos para Turma Recursal', null, 'manual', 'seed-3');

  for cat in select id, kind from public.event_categories where organization_id = org loop
    if cat.kind = 'hearing' then
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, location, client_id, process_id, tribunal, court_division, responsible_id, priority, created_by, description_text)
      values (org, 'Audiência de conciliação — Albuquerque x Banco Exemplo', 'hearing', cat.id,
              (base + 12 + time '10:00') at time zone 'America/Sao_Paulo', (base + 12 + time '11:00') at time zone 'America/Sao_Paulo',
              'Videoconferência (Microsoft Teams)', c1, p1, 'TJPA', '5ª Vara Cível e Empresarial de Belém', uid, 'high', uid,
              'Levar proposta de acordo aprovada pelo cliente. Teto: R$ 30.000,00.')
      returning id into e1;
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, location, client_id, process_id, tribunal, court_division, responsible_id, priority, created_by)
      values (org, 'Audiência de instrução — AmazLog', 'hearing', cat.id,
              (base + time '14:30') at time zone 'America/Sao_Paulo', (base + time '16:00') at time zone 'America/Sao_Paulo',
              'Fórum Trabalhista de Belém — Sala 3', c2, p2, 'TRT8', '5ª Vara do Trabalho de Belém', uid, 'critical', uid);
    elsif cat.kind = 'deadline' then
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, all_day, client_id, process_id, tribunal, responsible_id, priority, created_by)
      values (org, 'Prazo: manifestação sobre laudo pericial', 'deadline', cat.id,
              (base + 8) at time zone 'America/Sao_Paulo', (base + 9) at time zone 'America/Sao_Paulo', true, c2, p2, 'TRT8', uid, 'critical', uid)
      returning id into e2;
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, all_day, client_id, process_id, responsible_id, priority, created_by)
      values (org, 'Prazo: contrarrazões ao recurso inominado', 'deadline', cat.id,
              (base - 1) at time zone 'America/Sao_Paulo', base at time zone 'America/Sao_Paulo', true, c3, p3, uid, 'high', uid);
    elsif cat.kind = 'meeting' then
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, location, responsible_id, created_by)
      values (org, 'Reunião semanal de pauta', 'meeting', cat.id,
              (base + 1 + time '09:00') at time zone 'America/Sao_Paulo', (base + 1 + time '10:00') at time zone 'America/Sao_Paulo', 'Sala de reuniões', uid, uid);
    elsif cat.kind = 'consultation' then
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, client_id, location, responsible_id, created_by)
      values (org, 'Consulta inicial — Juliana Costa', 'consultation', cat.id,
              (base + 2 + time '15:00') at time zone 'America/Sao_Paulo', (base + 2 + time '16:00') at time zone 'America/Sao_Paulo', c3, 'Escritório', uid, uid);
    elsif cat.kind = 'diligence' then
      insert into public.events (organization_id, title, kind, category_id, starts_at, ends_at, location, process_id, responsible_id, created_by)
      values (org, 'Protocolo físico de documentos no Fórum', 'diligence', cat.id,
              (base + 3 + time '11:00') at time zone 'America/Sao_Paulo', (base + 3 + time '12:00') at time zone 'America/Sao_Paulo', 'Fórum Cível de Belém', p1, uid, uid);
    end if;
  end loop;

  insert into public.event_checklist_items (organization_id, event_id, title, is_done, position) values
    (org, e1, 'Confirmar presença do cliente', true, 0),
    (org, e1, 'Enviar link da videoconferência ao cliente', false, 1),
    (org, e1, 'Preparar minuta do acordo', false, 2),
    (org, e2, 'Analisar laudo pericial', true, 0),
    (org, e2, 'Consultar assistente técnico', false, 1),
    (org, e2, 'Protocolar manifestação', false, 2);

  insert into public.event_reminders (organization_id, event_id, user_id, offset_minutes) values
    (org, e1, uid, 1440), (org, e1, uid, 60), (org, e2, uid, 4320), (org, e2, uid, 1440);
end $$;
