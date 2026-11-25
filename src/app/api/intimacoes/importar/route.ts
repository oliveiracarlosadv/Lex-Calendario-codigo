import { importDjenItems } from "@/application/monitoring/intimations";
import type { DjenItem } from "@/infrastructure/tribunals/djen-connector";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Importa para a Central de Intimações as publicações escolhidas na busca (cadastra processo, movimentação e sugestões). */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const body = (await request.json().catch(() => null)) as { items?: DjenItem[] } | null;
  const items = (body?.items ?? []).filter((i) => i && typeof i.id === "number" && typeof i.numero_processo === "string").slice(0, 100);
  if (!items.length) return fail("Selecione ao menos uma publicação.");
  return json(await importDjenItems(ctx.orgId, ctx.user.id, items));
}
