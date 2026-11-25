import { NextResponse } from "next/server";
import { microsoftAuthUrl } from "@/infrastructure/integrations/microsoft/outlook-calendar";
import { createOAuthState } from "@/infrastructure/integrations/oauth-state";
import { fail, getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!process.env.MICROSOFT_CLIENT_ID) return fail("Integração com Microsoft não configurada (MICROSOFT_CLIENT_ID).", 501);
  const { state, challenge } = await createOAuthState("microsoft", new URL(request.url).searchParams.get("janela") === "1");
  return NextResponse.redirect(microsoftAuthUrl(state, challenge));
}
