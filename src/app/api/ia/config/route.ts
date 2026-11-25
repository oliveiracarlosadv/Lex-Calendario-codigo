import { z } from "zod";
import { AI_PROVIDERS, aiProvider } from "@/domain/ai/providers";
import { can } from "@/domain/identity/permissions";
import { AiUnavailableError, buildAi, chat, isAllowedBaseUrl, listModels, pickModels } from "@/infrastructure/ai/config";
import { decryptSecret, encryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Agente de inteligência artificial do escritório. A chave nunca volta ao navegador. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { data } = await getSupabaseAdminClient()
    .from("ai_settings")
    .select("provider, model, base_url, api_key_enc, last_test_at, last_error")
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  return json({
    provider: aiProvider(data?.provider as string | undefined).id,
    model: (data?.model as string | null) ?? null,
    baseUrl: (data?.base_url as string | null) ?? null,
    hasKey: !!data?.api_key_enc,
    lastTestAt: (data?.last_test_at as string | null) ?? null,
    lastError: (data?.last_error as string | null) ?? null,
    saved: !!data,
    desktop: process.env.LEX_DESKTOP === "1",
  });
}

const Body = z.object({
  provider: z.enum(AI_PROVIDERS.map((p) => p.id) as [string, ...string[]]),
  model: z.string().max(120).nullish(),
  baseUrl: z.string().max(300).nullish(),
  apiKey: z.string().max(600).nullish(),
});

/** Salva a escolha e faz um teste rápido com a IA. */
export async function PUT(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!can(ctx.role, "organization:update")) return fail("Apenas administradores e sócios alteram o agente de IA.", 403);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Confira os dados informados.");
  const b = parsed.data;
  const provider = aiProvider(b.provider);
  const admin = getSupabaseAdminClient();
  const { data: existing } = await admin.from("ai_settings").select("provider, api_key_enc").eq("organization_id", ctx.orgId).maybeSingle();

  const usesKey = provider.protocol === "openai" || provider.protocol === "anthropic";
  let apiKey: string | null = null;
  if (usesKey) {
    apiKey = b.apiKey?.trim() || null;
    if (!apiKey && existing?.provider === provider.id) apiKey = decryptSecret(existing.api_key_enc as string | null);
    if (!apiKey && provider.id !== "custom") return fail(`Informe ${provider.keyLabel ? "o token" : "a chave"} de acesso.`);
  }
  const baseUrl = provider.id === "custom" ? (b.baseUrl ?? "").trim().replace(/\/$/, "") : null;
  if (provider.id === "custom" && !isAllowedBaseUrl(baseUrl ?? "")) return fail("Informe o endereço do serviço (começando com https://).");
  // Sem modelo informado, o Lex escolhe um entre os disponíveis na conta
  let model: string | null = usesKey ? b.model?.trim() || provider.defaultModel || "" : null;

  let lastError: string | null = null;
  let adjusted = false;
  if (usesKey) {
    const test = async (m: string) => {
      const answer = await chat(buildAi({ provider: provider.id, model: m, base_url: baseUrl }, apiKey), {
        system: "Você é um assistente. Responda em português.",
        user: "Responda apenas com a palavra: pronto",
        timeoutMs: 45_000,
      });
      if (!answer.trim()) throw new AiUnavailableError("A IA respondeu vazio.", 404);
    };
    const asked = model ?? "";
    try {
      if (!asked) throw new AiUnavailableError("Sem modelo informado.", 404);
      await test(asked);
    } catch (e) {
      lastError = e instanceof AiUnavailableError ? e.message : "Não foi possível falar com a IA.";
      const status = e instanceof AiUnavailableError ? e.status : undefined;
      // Modelo inexistente ou aposentado: o Lex consulta os modelos da conta e escolhe um que funcione
      if (status === 404 || status === 400 || status === 422) {
        const available = await listModels(buildAi({ provider: provider.id, model: asked, base_url: baseUrl }, apiKey));
        for (const candidate of pickModels(provider.id, available).filter((m) => m !== asked)) {
          try {
            await test(candidate);
            model = candidate;
            adjusted = true;
            lastError = null;
            break;
          } catch (again) {
            if (again instanceof AiUnavailableError && (again.status === 401 || again.status === 403 || again.status === 429)) {
              lastError = again.message;
              break;
            }
          }
        }
      }
    }
  }

  const { error } = await admin.from("ai_settings").upsert(
    {
      organization_id: ctx.orgId,
      provider: provider.id,
      model,
      base_url: baseUrl,
      api_key_enc: apiKey ? encryptSecret(apiKey) : null,
      last_test_at: usesKey ? new Date().toISOString() : null,
      last_error: lastError,
      updated_by: ctx.user.id,
    },
    { onConflict: "organization_id" },
  );
  if (error) return fail(error.message, 500);
  return lastError ? fail(`Escolha salva, mas o teste falhou: ${lastError}`, 422) : json({ ok: true, tested: usesKey, model, adjusted });
}
