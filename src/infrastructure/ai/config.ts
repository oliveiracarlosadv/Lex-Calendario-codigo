import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiProvider, type AiProtocol, type AiProviderId } from "@/domain/ai/providers";
import { decryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { optionalServerEnv } from "@/lib/env";
import { OLLAMA_URL, installedPath, localModel, startServer } from "./ollama-local";

/** IA em uso por um escritório, já com endereço, modelo e chave resolvidos. */
export interface ResolvedAi {
  provider: AiProviderId;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export class AiUnavailableError extends Error {
  /** Código HTTP devolvido pelo serviço de IA, quando houve resposta. */
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Configuração antiga, por variáveis de ambiente (instalações em servidor). */
function fromEnv(): ResolvedAi {
  const provider = (optionalServerEnv("AI_PROVIDER") ?? "ollama").toLowerCase();
  if (provider === "anthropic") {
    return { provider: "anthropic", protocol: "anthropic", baseUrl: "", model: optionalServerEnv("AI_MODEL") ?? "claude-opus-5-5", apiKey: optionalServerEnv("ANTHROPIC_API_KEY") ?? null };
  }
  if (provider === "openai-compatible") {
    return {
      provider: "custom",
      protocol: "openai",
      baseUrl: (optionalServerEnv("AI_BASE_URL") ?? "http://127.0.0.1:8000/v1").replace(/\/$/, ""),
      model: optionalServerEnv("AI_MODEL") ?? "llama-3.3-70b-versatile",
      apiKey: optionalServerEnv("AI_API_KEY") ?? null,
    };
  }
  if (provider === "ollama") return { provider: "ollama", protocol: "ollama", baseUrl: OLLAMA_URL, model: localModel(), apiKey: null };
  return { provider: "rules", protocol: "none", baseUrl: "", model: "", apiKey: null };
}

export function buildAi(row: { provider: string; model?: string | null; base_url?: string | null }, apiKey: string | null): ResolvedAi {
  const p = aiProvider(row.provider);
  if (p.protocol === "ollama") return { provider: "ollama", protocol: "ollama", baseUrl: OLLAMA_URL, model: localModel(), apiKey: null };
  return {
    provider: p.id,
    protocol: p.protocol,
    baseUrl: (p.baseUrl ?? row.base_url ?? "").trim().replace(/\/$/, ""),
    model: (row.model ?? "").trim() || p.defaultModel || "",
    apiKey,
  };
}

/** IA escolhida em Configurações → Agente de inteligência artificial (ou o padrão da instalação). */
export async function resolveAi(orgId: string | null | undefined): Promise<ResolvedAi> {
  if (!orgId) return fromEnv();
  const { data } = await getSupabaseAdminClient().from("ai_settings").select("provider, model, base_url, api_key_enc").eq("organization_id", orgId).maybeSingle();
  if (!data) return fromEnv();
  let apiKey: string | null = null;
  try {
    apiKey = decryptSecret(data.api_key_enc as string | null);
  } catch {
    apiKey = null;
  }
  return buildAi(data as { provider: string; model: string | null; base_url: string | null }, apiKey);
}

/** Fora do aplicativo instalado, o endereço informado pelo usuário precisa ser público e seguro. */
export function isAllowedBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (process.env.LEX_DESKTOP === "1") return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:") return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.includes(":")) return false;
  return !/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

export interface ChatOptions {
  system: string;
  user: string;
  temperature?: number;
  /** JSON Schema da resposta (usado pelo Ollama; os demais recebem o pedido de JSON no texto). */
  jsonSchema?: unknown;
  timeoutMs?: number;
}

const explain = (status: number, name: string, model: string) =>
  status === 401 || status === 403
    ? `${name} recusou a chave de acesso. Confira a chave em Configurações → Agente de inteligência artificial.`
    : status === 404
      ? `${name} não encontrou o modelo “${model}”. Confira o nome do modelo.`
      : status === 429
        ? `${name} atingiu o limite de uso ou está sem crédito na sua conta. Tente mais tarde ou escolha outra IA.`
        : `${name} respondeu com erro ${status}.`;

/** Uma pergunta, uma resposta em texto — igual para qualquer IA configurada. */
export async function chat(ai: ResolvedAi, o: ChatOptions): Promise<string> {
  const name = aiProvider(ai.provider).label;
  const timeout = o.timeoutMs ?? 120_000;

  if (ai.protocol === "none") throw new AiUnavailableError("A IA está desligada. Escolha uma em Configurações → Agente de inteligência artificial.");

  if (ai.protocol === "anthropic") {
    if (!ai.apiKey) throw new AiUnavailableError("Informe a chave do Claude em Configurações → Agente de inteligência artificial.");
    try {
      const response = await new Anthropic({ apiKey: ai.apiKey, timeout }).messages.create({
        model: ai.model,
        max_tokens: 4000,
        system: o.system,
        messages: [{ role: "user", content: o.user }],
      });
      return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    } catch (e) {
      const status = (e as { status?: number }).status;
      throw new AiUnavailableError(status ? explain(status, name, ai.model) : `${name} não respondeu. Verifique a internet.`, status);
    }
  }

  if (ai.protocol === "openai") {
    if (!ai.baseUrl || !isAllowedBaseUrl(ai.baseUrl)) throw new AiUnavailableError("Informe um endereço válido para a IA em Configurações → Agente de inteligência artificial.");
    if (!ai.model) throw new AiUnavailableError("Informe o nome do modelo em Configurações → Agente de inteligência artificial.");
    const messages = [
      { role: "system", content: o.system },
      { role: "user", content: o.user },
    ];
    const send = (body: Record<string, unknown>) =>
      fetch(`${ai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      }).catch(() => null);
    let res = await send({
      model: ai.model,
      messages,
      ...(o.temperature != null ? { temperature: o.temperature } : {}),
      ...(o.jsonSchema ? { response_format: { type: "json_object" } } : {}),
    });
    // Alguns modelos não aceitam temperatura ou formato de resposta: tenta de novo só com o essencial
    if (res && (res.status === 400 || res.status === 422)) res = await send({ model: ai.model, messages });
    if (!res) throw new AiUnavailableError(`${name} não respondeu. Verifique a internet e o endereço do serviço.`);
    if (!res.ok) throw new AiUnavailableError(explain(res.status, name, ai.model), res.status);
    const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  }

  // Ollama no computador. Instalado mas desligado (ex.: logo após ligar o computador): liga antes de usar
  if (installedPath()) await startServer().catch(() => undefined);
  const res = await fetch(`${ai.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ai.model,
      stream: false,
      ...(o.jsonSchema ? { format: o.jsonSchema } : {}),
      options: { temperature: o.temperature ?? 0 },
      messages: [
        { role: "system", content: o.system },
        { role: "user", content: o.user },
      ],
    }),
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
  if (!res) {
    throw new AiUnavailableError("A IA gratuita (Ollama) não está instalada neste computador. Use o botão “Instalar IA gratuita” para instalar com um clique.");
  }
  if (res.status === 404) throw new AiUnavailableError(`O modelo de IA (${ai.model}) ainda não foi baixado. Use o botão “Instalar IA gratuita” para baixar.`);
  if (!res.ok) throw new AiUnavailableError(`Ollama respondeu ${res.status}.`);
  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? "";
}

/** Remove a moldura ```json que alguns modelos colocam em volta da resposta. */
export const stripFences = (content: string) => content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();

// ───────────────────────────── Modelos disponíveis na conta ─────────────────────────────

/** Pergunta ao serviço quais modelos a chave informada pode usar (os nomes mudam com o tempo). */
export async function listModels(ai: ResolvedAi): Promise<string[]> {
  try {
    if (ai.protocol === "anthropic" && ai.apiKey) {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      return (((await res.json()) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
    }
    if (ai.protocol === "openai" && ai.baseUrl && isAllowedBaseUrl(ai.baseUrl)) {
      const res = await fetch(`${ai.baseUrl}/models`, {
        headers: ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: { id: string }[] } | { id: string }[];
      const list = Array.isArray(json) ? json : (json.data ?? []);
      return list.map((m) => String(m.id ?? "").replace(/^models\//, "")).filter(Boolean);
    }
  } catch {
    // sem lista: fica o modelo informado
  }
  return [];
}

const NOT_CHAT = /(whisper|tts|speech|audio|embed|guard|moderation|rerank|image|imagen|veo|vision-preview|realtime|transcribe|dall-e|sora|search|aqa|learnlm|robotics|computer-use|live|native)/i;

/** Ordem de preferência por serviço: modelos de conversa rápidos e baratos primeiro. */
const PREFERRED: Partial<Record<AiProviderId, RegExp[]>> = {
  groq: [/llama-3\.3-70b/i, /llama.*70b/i, /gpt-oss-120b/i, /llama-4|llama.*maverick|llama.*scout/i, /qwen/i, /llama/i, /gpt-oss/i],
  gemini: [/^gemini-[\d.]+-flash$/i, /^gemini-.*flash(?!-lite)/i, /^gemini-.*flash/i, /^gemini-.*pro/i],
  openai: [/^gpt-[\d.]+o?-mini$/i, /^gpt-.*mini/i, /^gpt-.*nano/i, /^gpt-[\d.]+o?$/i, /^gpt-/i],
  anthropic: [/haiku/i, /sonnet/i, /opus/i],
  openrouter: [/llama-3\.3-70b-instruct:free/i, /:free$/i],
  copilot: [/gpt-.*mini/i, /gpt-/i],
};

/** Candidatos a testar, do mais indicado ao menos, entre os modelos que a conta enxerga. */
export function pickModels(provider: AiProviderId, ids: string[], max = 4): string[] {
  const usable = ids.filter((id) => !NOT_CHAT.test(id));
  // nomes com data ou versão maior primeiro (em geral, os mais novos)
  const sorted = [...usable].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const out: string[] = [];
  for (const re of PREFERRED[provider] ?? []) for (const id of sorted) if (re.test(id) && !out.includes(id)) out.push(id);
  for (const id of sorted) if (!out.includes(id)) out.push(id);
  return out.slice(0, max);
}

/**
 * Como chat(), mas se o modelo salvo deixou de existir no serviço, escolhe outro disponível
 * na conta, guarda a nova escolha do escritório e segue — sem o usuário precisar reconfigurar.
 */
export async function chatWithFallback(orgId: string, ai: ResolvedAi, o: ChatOptions): Promise<{ text: string; model: string }> {
  try {
    return { text: await chat(ai, o), model: ai.model };
  } catch (e) {
    if (!(e instanceof AiUnavailableError) || e.status !== 404 || ai.protocol === "ollama") throw e;
    for (const candidate of pickModels(ai.provider, await listModels(ai)).filter((m) => m !== ai.model)) {
      try {
        const text = await chat({ ...ai, model: candidate }, o);
        await getSupabaseAdminClient().from("ai_settings").update({ model: candidate, last_error: null }).eq("organization_id", orgId);
        return { text, model: candidate };
      } catch (again) {
        if (!(again instanceof AiUnavailableError) || again.status !== 404) throw again;
      }
    }
    throw e;
  }
}
