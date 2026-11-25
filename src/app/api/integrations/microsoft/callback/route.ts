import type { NextRequest } from "next/server";
import { relativeRedirect } from "@/lib/request-origin";
import { upsertOAuthConnection } from "@/application/sync/connections";
import { exchangeMicrosoftCode } from "@/infrastructure/integrations/microsoft/outlook-calendar";
import { consumeOAuthState } from "@/infrastructure/integrations/oauth-state";
import { getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

function emailFromIdToken(idToken?: string) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()) as { email?: string; preferred_username?: string };
    return payload.email ?? payload.preferred_username ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Fim do login: página que fecha a janela de login e avisa o calendário (ou oferece "Voltar ao calendário")
  const back = (status: string) => relativeRedirect(`/auth/conectado?provedor=microsoft&status=${status}`);
  if (url.searchParams.get("error")) {
    await consumeOAuthState("microsoft", null);
    return back(url.searchParams.get("error") === "access_denied" ? "cancelado" : "erro");
  }
  const ctx = await getUserContext();
  if (!ctx) return relativeRedirect("/inicio");
  const verifier = await consumeOAuthState("microsoft", url.searchParams.get("state"));
  if (!verifier || !url.searchParams.get("code")) return back("erro");
  try {
    const tokens = (await exchangeMicrosoftCode(url.searchParams.get("code")!, verifier)) as Awaited<ReturnType<typeof exchangeMicrosoftCode>> & { id_token?: string };
    await upsertOAuthConnection({ orgId: ctx.orgId, userId: ctx.user.id, provider: "microsoft", email: emailFromIdToken(tokens.id_token), tokens });
    return back("conectado");
  } catch (e) {
    console.error("[microsoft] callback", e);
    return back("erro");
  }
}
