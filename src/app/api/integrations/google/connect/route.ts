import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/infrastructure/integrations/google/google-calendar";
import { createOAuthState } from "@/infrastructure/integrations/oauth-state";
import { fail, getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!process.env.GOOGLE_CLIENT_ID) return fail("Integração com Google não configurada (GOOGLE_CLIENT_ID).", 501);
  const params = new URL(request.url).searchParams;
  const { state, challenge } = await createOAuthState("google", params.get("janela") === "1");
  // ?gmail=1: também pede permissão para enviar e-mails (comunicações aos clientes)
  return NextResponse.redirect(googleAuthUrl(state, challenge, { gmail: params.get("gmail") === "1" }));
}
