import { pullConnection, pushPendingEvents } from "@/application/sync/calendar-sync";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, isAuthorizedCron, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reconciliação periódica (cobre CalDAV, que não tem webhooks, e eventuais notificações perdidas). */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return fail("Não autorizado", 401);
  const admin = getSupabaseAdminClient();
  const { data: conns } = await admin
    .from("calendar_connections")
    .select("id, provider, last_synced_at")
    .eq("is_active", true)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(50);
  const results: Record<string, unknown> = {};
  for (const c of conns ?? []) {
    try {
      // Primeiro envia o que mudou no Lex (para a leitura não sobrescrever edições ainda não enviadas)
      const sent = await pushPendingEvents(c.id);
      results[c.id] = { ...sent, ...(await pullConnection(c.id)) };
    } catch (e) {
      results[c.id] = { error: (e as Error).message };
      await admin.from("calendar_connections").update({ last_error: (e as Error).message.slice(0, 500) }).eq("id", c.id);
    }
  }
  return json({ synced: conns?.length ?? 0, results });
}
