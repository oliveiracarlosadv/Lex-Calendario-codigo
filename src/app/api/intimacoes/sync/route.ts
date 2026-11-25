import { syncAllIntimations } from "@/application/monitoring/intimations";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Buscar agora": consulta as intimações das OABs e credenciais do PJe do usuário. */
export async function POST() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Monitoramento indisponível neste servidor.", 501);
  const r = await syncAllIntimations({ userId: ctx.user.id });
  return json({ inserted: r.inserted, errors: r.errors });
}
