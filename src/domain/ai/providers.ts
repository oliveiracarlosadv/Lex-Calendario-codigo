/** Catálogo das IAs que o Lex sabe usar (tela Configurações → Agente de inteligência artificial). */
export type AiProviderId = "ollama" | "groq" | "gemini" | "openrouter" | "openai" | "anthropic" | "copilot" | "custom" | "rules";

/** Como o Lex conversa com o serviço. */
export type AiProtocol = "ollama" | "openai" | "anthropic" | "none";

export interface AiProvider {
  id: AiProviderId;
  label: string;
  group: "gratuita" | "conta" | "outras";
  protocol: AiProtocol;
  summary: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: string[];
  /** Onde o usuário cria a chave de acesso. */
  keyUrl?: string;
  keyLabel?: string;
  keyHelp?: string;
  /** Entrar com a conta do serviço, sem copiar chave (hoje só o OpenRouter oferece isso a outros aplicativos). */
  login?: boolean;
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "ollama",
    label: "IA do Lex no computador (recomendada)",
    group: "gratuita",
    protocol: "ollama",
    summary: "Gratuita e de código aberto (Ollama). Roda neste computador, funciona sem internet e não envia seus textos para fora.",
  },
  {
    id: "groq",
    label: "Groq",
    group: "gratuita",
    protocol: "openai",
    summary: "Plano gratuito, muito rápido, com modelos abertos (Llama). Precisa de internet.",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    keyUrl: "https://console.groq.com/keys",
    keyHelp: "Crie uma conta gratuita na Groq e gere uma chave (API Key).",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    group: "gratuita",
    protocol: "openai",
    summary: "Plano gratuito do Google AI Studio, com limite diário de uso. Precisa de internet.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    keyUrl: "https://aistudio.google.com/apikey",
    keyHelp: "Entre com a sua conta Google no AI Studio e clique em “Criar chave de API”.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "gratuita",
    protocol: "openai",
    summary: "Entre com a sua conta, sem copiar chave. Uma só conta dá acesso a ChatGPT, Claude, Gemini e a modelos gratuitos (os terminados em “:free”).",
    login: true,
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    models: ["meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "google/gemini-2.5-flash"],
    keyUrl: "https://openrouter.ai/keys",
    keyHelp: "Crie uma conta no OpenRouter e gere uma chave.",
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    group: "conta",
    protocol: "openai",
    summary: "Use a sua conta da OpenAI. A cobrança é feita pela OpenAI, conforme o uso.",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
    keyUrl: "https://platform.openai.com/api-keys",
    keyHelp: "A assinatura do ChatGPT (Plus) não inclui a chave: ela é criada na plataforma de desenvolvedores da OpenAI, com crédito próprio.",
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    group: "conta",
    protocol: "anthropic",
    summary: "Use a sua conta da Anthropic. A cobrança é feita pela Anthropic, conforme o uso.",
    defaultModel: "claude-haiku-5-5",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHelp: "A assinatura do Claude (Pro/Max) não inclui a chave: ela é criada no console de desenvolvedores da Anthropic, com crédito próprio.",
  },
  {
    id: "copilot",
    label: "Copilot (GitHub Models)",
    group: "conta",
    protocol: "openai",
    summary: "Use a sua conta do GitHub/Copilot pelos modelos do GitHub. Há uma cota gratuita.",
    baseUrl: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini", "openai/gpt-4o"],
    keyUrl: "https://github.com/settings/personal-access-tokens",
    keyLabel: "Token do GitHub",
    keyHelp: "Crie um token pessoal no GitHub com a permissão “Models” (somente leitura). O Copilot do Microsoft 365 não oferece chave para outros aplicativos.",
  },
  {
    id: "custom",
    label: "Outra IA (compatível com OpenAI)",
    group: "outras",
    protocol: "openai",
    summary: "Qualquer serviço ou programa com endereço compatível com a OpenAI: LM Studio, Azure OpenAI, Together, Mistral e outros.",
    keyHelp: "Informe o endereço do serviço, o nome do modelo e a chave (se houver).",
  },
  {
    id: "rules",
    label: "Sem IA",
    group: "outras",
    protocol: "none",
    summary: "O Lex usa apenas as regras fixas para sugerir prazos; o botão de escrever textos fica desligado.",
  },
];

export const aiProvider = (id: string | null | undefined) => AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
