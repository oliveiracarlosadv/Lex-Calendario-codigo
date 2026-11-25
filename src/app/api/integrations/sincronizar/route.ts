import { pullConnection, pushPendingEvents } from "@/application/sync/calendar-sync";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Botão "Sincronizar": envia ao Google o que mudou no Lex e traz as novidades do Google,
 * em todas as agendas conectadas do usuário.
 */
export async function POST() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const admin = getSupabaseAdminClient();
  const { data: conns } = await admin
    .from("calendar_connections")
    .select("id, provider, account_email")
    .eq("user_id", ctx.user.id)
    .eq("organization_id", ctx.orgId)
    .eq("is_active", true);
  if (!conns?.length) return json({ connections: 0, sent: 0, received: 0, deleted: 0, errors: [] });

  let sent = 0;
  let received = 0;
  let deleted = 0;
  const errors: string[] = [];
  for (const c of conns) {
    try {
      sent += (await pushPendingEvents(c.id as string, 300)).pushed;
      const pulled = await pullConnection(c.id as string);
      received += pulled.created + pulled.updated;
      deleted += pulled.deleted;
    } catch (e) {
      const message = (e as Error).message.slice(0, 300);
      errors.push(`${c.account_email ?? c.provider}: ${message}`);
      await admin.from("calendar_connections").update({ last_error: message }).eq("id", c.id);
    }
  }
  const { data: pushErrors } = await admin
    .from("calendar_connections")
    .select("last_push_error")
    .in("id", conns.map((c) => c.id as string))
    .not("last_push_error", "is", null);
  for (const p of pushErrors ?? []) errors.push(p.last_push_error as string);
  return json({ connections: conns.length, sent, received, deleted, errors });
}
