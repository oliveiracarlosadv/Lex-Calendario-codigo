import { z } from "zod";
import { templateVariables } from "@/application/communications/context";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({
  clientId: z.string().uuid().nullish(),
  processId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  deadline: z.string().nullish(),
});

/** Valores das variáveis dos modelos para o cliente/processo/compromisso escolhidos. */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Dados inválidos");
  return json(await templateVariables(ctx.supabase, ctx.orgId, ctx.user.id, parsed.data));
}
