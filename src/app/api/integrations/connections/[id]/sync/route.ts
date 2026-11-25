import { pullConnection, pushPendingEvents } from "@/application/sync/calendar-sync";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { data: conn } = await getSupabaseAdminClient().from("calendar_connections").select("id").eq("id", id).eq("user_id", ctx.user.id).maybeSingle();
  if (!conn) return fail("Conexão não encontrada", 404);
  try {
    const sent = await pushPendingEvents(id, 200);
    return json({ ...sent, ...(await pullConnection(id)) });
  } catch (e) {
    await getSupabaseAdminClient().from("calendar_connections").update({ last_error: (e as Error).message.slice(0, 500) }).eq("id", id);
    return fail((e as Error).message, 502);
  }
}
