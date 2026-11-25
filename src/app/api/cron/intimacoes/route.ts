import { syncAllIntimations } from "@/application/monitoring/intimations";
import { fail, isAuthorizedCron, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Busca intimações (DJEN pela OAB e avisos do PJe). A resposta lista notificações para o app desktop. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return fail("Não autorizado", 401);
  const r = await syncAllIntimations();
  // As notificações das intimações são entregues pelo ciclo de lembretes (tabela notifications)
  return json({ inserted: r.inserted, errors: r.errors });
}
