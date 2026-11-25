import { pullConnection } from "@/application/sync/calendar-sync";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { safeEqual, webhookToken } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Notificações push do Google Calendar (events.watch). */
export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const token = request.headers.get("x-goog-channel-token") ?? "";
  const state = request.headers.get("x-goog-resource-state");
  if (!channelId) return new Response(null, { status: 400 });

  const admin = getSupabaseAdminClient();
  const { data: conn } = await admin.from("calendar_connections").select("id").eq("webhook_channel_id", channelId).maybeSingle();
  if (!conn || !safeEqual(token, webhookToken(conn.id))) return new Response(null, { status: 404 });
  if (state !== "sync") await pullConnection(conn.id).catch((e) => console.error("[google] webhook pull", e));
  return new Response(null, { status: 200 });
}
