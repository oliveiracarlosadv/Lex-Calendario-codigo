-- Lex Calendário — notificações do sistema operacional (aplicativo desktop)
-- Toda notificação da plataforma (lembretes, intimações, testes) também é mostrada
-- como notificação nativa do sistema; esta coluna marca as já entregues.
alter table public.notifications add column system_sent_at timestamptz;
create index notifications_system_pending_idx on public.notifications (created_at) where system_sent_at is null;
-- As notificações antigas não devem disparar de uma vez após a atualização
update public.notifications set system_sent_at = now() where system_sent_at is null;
