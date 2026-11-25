# Integrações — passo a passo

> Em todas as URLs abaixo, troque `https://SEU_DOMINIO` pelo endereço do app (ou `http://localhost:3000` em desenvolvimento).

## Aplicativo desktop

O desktop roda em **modo local** (sem conta, offline). Para habilitar "Entrar com Google/Microsoft" em todos os instaladores, faça uma vez:

1. **Google Cloud Console** → APIs e serviços → ative a *Google Calendar API* → Credenciais → *Criar ID do cliente OAuth* → tipo **App para computador**. Em *Tela de consentimento*, adicione o escopo `calendar.events`.
2. **Microsoft Entra ID** → Registros de aplicativo → Novo registro (contas de qualquer organização + pessoais) → *Autenticação* → plataforma **Aplicativos móveis e da área de trabalho** com o URI `http://127.0.0.1:47830/api/integrations/microsoft/callback` → *Permitir fluxos de clientes públicos* = Sim → Permissões delegadas `Calendars.ReadWrite`, `User.Read`, `offline_access`.
3. No GitHub: *Settings → Secrets and variables → Actions* → **Variables** `GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID` e **Secret** `GOOGLE_CLIENT_SECRET`.
4. Publique nova versão: `git tag vX.Y.Z && git push --tags`.

Apple não oferece OAuth para calendários; a integração usa o CalDAV do iCloud com senha de app e funciona sem cadastro prévio.

## Login na versão web (Supabase Auth)

A versão web também abre direto no calendário (sessão anônima — habilite *Anonymous sign-ins* em Authentication → Providers). O login com conta é opcional.

| Provedor | Onde configurar | URL de retorno |
|---|---|---|
| Google | Google Cloud Console → APIs e serviços → Credenciais → ID do cliente OAuth (Web) | `https://<projeto>.supabase.co/auth/v1/callback` |
| Microsoft | Microsoft Entra ID → Registros de aplicativo (contas de qualquer organização + pessoais) | `https://<projeto>.supabase.co/auth/v1/callback` |
| Apple | Apple Developer → Identifiers (Services ID) + Key "Sign in with Apple" | `https://<projeto>.supabase.co/auth/v1/callback` |

Depois, no Supabase: *Authentication → Providers*, habilite cada um e cadastre `https://SEU_DOMINIO/auth/callback` em *URL Configuration → Redirect URLs*.

## Google Calendar (sincronização bidirecional)

1. No mesmo projeto do Google Cloud, ative a **Google Calendar API**.
2. Adicione a URL de redirecionamento `https://SEU_DOMINIO/api/integrations/google/callback`.
3. Escopo usado: `https://www.googleapis.com/auth/calendar.events` (tela de consentimento em "Produção" exige verificação do Google).
4. Variáveis: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
5. Notificações em tempo real exigem HTTPS público; em localhost o cron `/api/cron/sync` faz a reconciliação.

## Outlook / Microsoft 365

1. No registro do aplicativo, adicione a plataforma Web com `https://SEU_DOMINIO/api/integrations/microsoft/callback`.
2. Permissões delegadas do Microsoft Graph: `offline_access`, `openid`, `email`, `User.Read`, `Calendars.ReadWrite`.
3. Crie um segredo do cliente. Variáveis: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (`common`).
4. As assinaturas (webhooks) duram ~3 dias e são renovadas pelo cron `/api/cron/renew-webhooks`.

## Apple Calendar (iCloud) via CalDAV

1. Em <https://appleid.apple.com> → *Iniciar sessão e segurança* → *Senhas de apps*, gere uma senha.
2. No Lex: *Configurações → Integrações → Apple Calendar*, informe o Apple ID e a senha de app (servidor `https://caldav.icloud.com`).
3. Funciona com qualquer servidor CalDAV (Nextcloud, Fastmail, Zimbra…).

## ICS

- Exportar tudo: `GET /api/ics/export` · um compromisso: `GET /api/ics/export?event=<id>` (inclui alarmes).
- Importar: *Configurações → Integrações → Importar .ics* (até 10 MB).

## Notificações

- **Push**: `npm run vapid:generate` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- **E-mail**: conta no [Resend](https://resend.com) com domínio verificado → `RESEND_API_KEY`, `EMAIL_FROM`.

## Tribunais

| Conector | Configuração |
|---|---|
| **TJPA — WebService** | Nenhuma. Endpoint público `https://consultas.tjpa.jus.br/WSConsultaProcessualTJ/ConsultaProcessualService` (operações `dadosProcessoCNJ` e `dadosProcessoListaDocumento`). |
| **PJe — MNI 2.2.2** | Cada advogado cadastra CPF e senha do PJe em *Configurações → Tribunais*. Endpoints em `src/infrastructure/tribunals/pje-mni-connector.ts` (identificadores conforme o guia de implantação do PJe 2.1, ex.: `pje-tjpa-1g`). |
| **DataJud (CNJ)** | Chave pública em <https://datajud-wiki.cnj.jus.br/api-publica/acesso> → `DATAJUD_API_KEY`. |
| **e-SAJ, Projudi, eproc** | Implementar `TribunalConnector` e registrar em `src/infrastructure/tribunals/registry.ts`. |
| **Certificado A1** | Porta `CertificateProvider` (`src/infrastructure/certificates`), bucket privado `certificates` e tabela `digital_certificates`. |

## IA jurídica (open source e gratuita)

```bash
# instalar o Ollama: https://ollama.com/download
ollama pull qwen2.5:7b
```

| Variável | Padrão | Observação |
|---|---|---|
| `AI_PROVIDER` | `ollama` | `ollama`, `openai-compatible`, `anthropic` ou `rules` |
| `AI_MODEL` | `qwen2.5:7b` | Alternativas: `llama3.1:8b`, `gemma2:9b`, `mistral-nemo` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Em produção, aponte para um servidor com Ollama |
| `AI_BASE_URL` / `AI_API_KEY` | — | Para vLLM, LM Studio, Groq, OpenRouter (modelos abertos) |

Sem modelo disponível, o analisador por regras continua funcionando.
