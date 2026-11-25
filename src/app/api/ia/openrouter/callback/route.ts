import { NextResponse } from "next/server";
import { aiProvider } from "@/domain/ai/providers";
import { decryptSecret, encryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

/** Retorno do OpenRouter: troca o código pela chave da conta do usuário e ativa o OpenRouter como IA do escritório. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/$/, "");
  const back = (status: string) => NextResponse.redirect(`${appUrl}/configuracoes/ia?status=${status}`);
  const code = url.searchParams.get("code");
  let state: { v: string; o: string; u: string; m?: string; e: number } | null = null;
  try {
    state = JSON.parse(decryptSecret(url.searchParams.get("state")) ?? "null");
  } catch {
    state = null;
  }
  if (!code || !state || state.e < Date.now()) return back("ia-erro");

  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: state.v, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { key?: string } | null) : null;
  if (!data?.key) return back("ia-erro");

  const admin = getSupabaseAdminClient();
  const { data: member } = await admin.from("memberships").select("role").eq("organization_id", state.o).eq("user_id", state.u).maybeSingle();
  if (!member) return back("ia-erro");
  const { data: existing } = await admin.from("ai_settings").select("provider, model").eq("organization_id", state.o).maybeSingle();
  const model = state.m || (existing?.provider === "openrouter" && existing.model ? (existing.model as string) : aiProvider("openrouter").defaultModel);
  const { error } = await admin.from("ai_settings").upsert(
    {
      organization_id: state.o,
      provider: "openrouter",
      model,
      base_url: null,
      api_key_enc: encryptSecret(data.key),
      last_test_at: null,
      last_error: null,
      updated_by: state.u,
    },
    { onConflict: "organization_id" },
  );
  return back(error ? "ia-erro" : "ia-conectada");
}
