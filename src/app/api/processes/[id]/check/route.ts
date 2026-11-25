import { checkProcess } from "@/application/monitoring/process-monitor";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { data } = await ctx.supabase.from("processes").select("id").eq("id", id).maybeSingle();
  if (!data) return fail("Processo não encontrado", 404);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Monitoramento indisponível: SUPABASE_SERVICE_ROLE_KEY não configurada.", 501);
  return json(await checkProcess(id));
}
