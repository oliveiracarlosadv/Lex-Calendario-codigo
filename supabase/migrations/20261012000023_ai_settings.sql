-- ════════════════════════════════════════════════════════════════════════════
-- Lex Calendário — Agente de inteligência artificial
-- Cada escritório escolhe a IA que o Lex usa: a gratuita no computador (Ollama), serviços
-- com plano gratuito (Groq, Gemini, OpenRouter) ou a própria conta de ChatGPT, Claude ou
-- Copilot. A chave fica criptografada e nunca é lida pelo navegador.
-- ════════════════════════════════════════════════════════════════════════════

create table public.ai_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'ollama',
  model text,
  base_url text,
  api_key_enc text,
  last_test_at timestamptz,
  last_error text,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.ai_settings
  for each row execute function public.set_updated_at();

alter table public.ai_settings enable row level security;
create policy "agente de IA: membros leem" on public.ai_settings for select using (public.is_member(organization_id));
revoke select, insert, update on public.ai_settings from authenticated, anon;
grant select (organization_id, provider, model, base_url, last_test_at, last_error, updated_at)
  on public.ai_settings to authenticated;
