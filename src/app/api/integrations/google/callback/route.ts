import type { NextRequest } from "next/server";
import { relativeRedirect } from "@/lib/request-origin";
import { upsertOAuthConnection } from "@/application/sync/connections";
import { exchangeGoogleCode, googleUserEmail } from "@/infrastructure/integrations/google/google-calendar";
import { consumeOAuthState } from "@/infrastructure/integrations/oauth-state";
import { getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Fim do login: página que fecha a janela de login e avisa o calendário (ou oferece "Voltar ao calendário")
  const back = (status: string) => relativeRedirect(`/auth/conectado?provedor=google&status=${status}`);
  if (url.searchParams.get("error")) {
    await consumeOAuthState("google", null);
    return back(url.searchParams.get("error") === "access_denied" ? "cancelado" : "erro");
  }
  const ctx = await getUserContext();
  if (!ctx) return relativeRedirect("/inicio");
  const verifier = await consumeOAuthState("google", url.searchParams.get("state"));
  if (!verifier || !url.searchParams.get("code")) return back("erro");
  try {
    const tokens = await exchangeGoogleCode(url.searchParams.get("code")!, verifier);
    const email = await googleUserEmail(tokens.access_token);
    await upsertOAuthConnection({ orgId: ctx.orgId, userId: ctx.user.id, provider: "google", email, tokens });
    return back("conectado");
  } catch (e) {
    console.error("[google] callback", e);
    return back("erro");
  }
}
