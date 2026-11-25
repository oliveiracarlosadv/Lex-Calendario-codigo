import { pushEvent } from "@/application/sync/calendar-sync";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Envia o evento às agendas externas conectadas (após criar/editar/excluir). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  // Confere acesso pelo RLS antes de usar o cliente administrativo
  const { data } = await ctx.supabase.from("events").select("id").eq("id", id).maybeSingle();
  if (!data) return fail("Evento não encontrado", 404);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ pushed: 0, skipped: "sem integrações no servidor" });
  return json(await pushEvent(id));
}
