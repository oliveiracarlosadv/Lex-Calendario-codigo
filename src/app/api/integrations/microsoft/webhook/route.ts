import { pullConnection } from "@/application/sync/calendar-sync";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { safeEqual, webhookToken } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Notificações de alteração do Microsoft Graph (subscriptions). */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) return new Response(validationToken, { headers: { "Content-Type": "text/plain" } });

  const body = (await request.json().catch(() => ({ value: [] }))) as { value?: { subscriptionId: string; clientState?: string }[] };
  const admin = getSupabaseAdminClient();
  const ids = new Set<string>();
  for (const n of body.value ?? []) {
    const { data: conn } = await admin.from("calendar_connections").select("id").eq("webhook_channel_id", n.subscriptionId).maybeSingle();
    if (conn && safeEqual(n.clientState ?? "", webhookToken(conn.id))) ids.add(conn.id);
  }
  await Promise.all([...ids].map((id) => pullConnection(id).catch((e) => console.error("[microsoft] webhook pull", e))));
  return new Response(null, { status: 202 });
}
