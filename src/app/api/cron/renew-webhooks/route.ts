import { registerWebhook } from "@/application/sync/connections";
import type { ConnectionRow } from "@/infrastructure/integrations/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, isAuthorizedCron, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Renova canais do Google (7 dias) e assinaturas do Graph (~3 dias) antes de expirarem. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return fail("Não autorizado", 401);
  const admin = getSupabaseAdminClient();
  const limit = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const { data } = await admin
    .from("calendar_connections")
    .select("*")
    .eq("is_active", true)
    .in("provider", ["google", "microsoft"])
    .or(`webhook_expires_at.is.null,webhook_expires_at.lt.${limit}`);
  let renewed = 0;
  for (const c of (data ?? []) as ConnectionRow[]) {
    await registerWebhook(c).then(() => renewed++).catch((e) => console.warn("[webhooks]", c.id, (e as Error).message));
  }
  return json({ renewed });
}
