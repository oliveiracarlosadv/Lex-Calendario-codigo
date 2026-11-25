import { sendCommunicationEmail } from "@/application/communications/deliver";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Envia agora um e-mail ao cliente pela conta de e-mail configurada. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { id } = await params;
  // Confere o acesso pelas regras do usuário (RLS) antes de enviar com a conta do servidor
  const { data } = await ctx.supabase.from("communications").select("id").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle();
  if (!data) return fail("Comunicação não encontrada", 404);
  const result = await sendCommunicationEmail(id, ctx.user.id);
  return result.ok ? json({ ok: true }) : fail(result.error, 422);
}
