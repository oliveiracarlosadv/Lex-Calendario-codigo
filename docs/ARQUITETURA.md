# Arquitetura do Lex Calendário

## Camadas (Clean Architecture + DDD)

| Camada | Pasta | Responsabilidade | Depende de |
|---|---|---|---|
| **Domínio** | `src/domain` | Regras puras: eventos, prazos (CPC), numeração CNJ, CPF/CNPJ, permissões, analisador por regras e **portas** (`MovementAnalyzer`, `TribunalConnector`) | nada |
| **Aplicação** | `src/application` | Casos de uso: sincronizar agendas, monitorar processos, disparar lembretes | domínio + portas |
| **Infraestrutura** | `src/infrastructure` | Adaptadores: Supabase, Google, Microsoft Graph, CalDAV, ICS, Web Push, e-mail, IA (Ollama/compatível/Claude), tribunais (TJPA, PJe MNI, DataJud), criptografia, certificados | domínio |
| **Apresentação** | `src/app`, `src/components`, `src/hooks`, `src/stores` | Rotas Next.js, UI (shadcn/ui + FullCalendar + TipTap), TanStack Query, Zustand | todas |

Princípios aplicados:
- **SRP / ISP**: cada adaptador implementa uma porta pequena (`CalendarProviderAdapter`: `push`, `remove`, `pull`).
- **OCP**: novos tribunais e provedores de IA entram como novas classes registradas em `registry.ts`, sem alterar casos de uso.
- **DIP**: casos de uso dependem de interfaces do domínio; implementações são escolhidas por configuração (`AI_PROVIDER`, conectores).

## Multi-tenant e segurança

- Toda tabela de negócio tem `organization_id`; **RLS** em todas as tabelas, com funções `is_member()` e `has_role()`.
- Segredos (tokens OAuth, senha CalDAV, credenciais de tribunais, senha do certificado) são cifrados com **AES-256-GCM** (`ENCRYPTION_KEY`) e as colunas não são legíveis pelo papel `authenticated` (grants por coluna).
- Rotas de servidor que usam o *service role* sempre conferem antes o acesso do usuário via RLS.
- Webhooks validados por HMAC (`webhookToken`), cron por `CRON_SECRET`, OAuth com `state` em cookie httpOnly.
- MFA (TOTP) com exigência de AAL2 no middleware.

## Fluxos principais

### Criar/editar compromisso
1. UI → Supabase (RLS) insere/atualiza `events` e `event_reminders`.
2. Triggers: histórico (`activity_log`), reagendamento de lembretes, próxima audiência/prazo do processo.
3. UI chama `POST /api/events/:id/sync` → `pushEvent` envia aos calendários externos do responsável/criador.
4. Supabase Realtime atualiza as outras telas abertas.

### Sincronização de entrada
- **Google**: `events.watch` → `/api/integrations/google/webhook` → `pullConnection` (syncToken incremental; 410 refaz completa).
- **Microsoft**: assinatura Graph → `/api/integrations/microsoft/webhook` → `calendarView/delta`.
- **CalDAV**: `/api/cron/sync` a cada 10 min (janela de 90 dias para trás e 2 anos à frente).
- Eco do próprio envio é ignorado por `etag`; eventos nascidos no Lex são reconhecidos por `extendedProperties`/`transactionId`/UID.

### Monitoramento processual e IA
1. `/api/cron/monitoring` (3/3 h) → `checkProcess` → conectores em ordem (TJPA WS → PJe MNI → DataJud).
2. Movimentações novas são gravadas (`process_movements`, idempotente por `source + external_id`).
3. `CompositeMovementAnalyzer`: regras primeiro; modelo de linguagem (padrão **Ollama**, open source) para textos ambíguos; prazos do modelo são **recalculados** pelo domínio.
4. Sugestões em `ai_suggestions`; ao aceitar, `accept_ai_suggestion()` cria o evento com lembretes padrão.

### Lembretes
`/api/cron/reminders` (5/5 min) → reivindica cada lembrete (`sent_at`) de forma atômica → notificação na plataforma, push (VAPID) e e-mail (Resend).

## Aplicativo desktop

`desktop/` contém o inicializador em Go: no primeiro duplo clique instala em `Documentos/Lex Calendário` e cria atalhos; depois executa o build *standalone* do Next.js com um Node.js embarcado em `127.0.0.1:47830` e abre uma janela dedicada (modo app do Chrome/Edge). Encerra após 10 min sem janela aberta (heartbeat). Pacotes gerados por `.github/workflows/release.yml`.
