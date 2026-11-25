import { GMAIL_SEND_SCOPE } from "@/infrastructure/integrations/google/google-calendar";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Deixa de enviar pelo Gmail (a agenda do Google continua conectada). */
export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const admin = getSupabaseAdminClient();
  const { data: conns } = await admin.from("calendar_connections").select("id, scopes").eq("user_id", ctx.user.id).eq("provider", "google");
  for (const c of conns ?? []) {
    const scopes = String(c.scopes ?? "")
      .split(/\s+/)
      .filter((s) => s && s !== GMAIL_SEND_SCOPE)
      .join(" ");
    await admin.from("calendar_connections").update({ scopes }).eq("id", c.id);
  }
  return json({ ok: true });
}
