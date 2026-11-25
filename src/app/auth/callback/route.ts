import type { NextRequest } from "next/server";
import { relativeRedirect } from "@/lib/request-origin";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";

/** Retorno do OAuth (Google, Microsoft, Apple), confirmação de e-mail e recuperação de senha. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/calendario";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/calendario";

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const target = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? `/auth/mfa?next=${encodeURIComponent(next)}` : next;
      return relativeRedirect(target);
    }
  }
  return relativeRedirect("/entrar?erro=callback");
}
