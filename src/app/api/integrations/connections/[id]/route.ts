import { stopGoogleChannel } from "@/infrastructure/integrations/google/google-calendar";
import type { ConnectionRow } from "@/infrastructure/integrations/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const admin = getSupabaseAdminClient();
  const { data: conn } = await admin.from("calendar_connections").select("*").eq("id", id).eq("user_id", ctx.user.id).maybeSingle();
  if (!conn) return fail("Conexão não encontrada", 404);
  if (conn.provider === "google") await stopGoogleChannel(conn as ConnectionRow);
  await admin.from("calendar_connections").delete().eq("id", id);
  return json({ ok: true });
}
