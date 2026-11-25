import { handleAsaasEvent, isAsaasWebhook } from "@/application/licensing/server";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Aviso (webhook) do Asaas: pagamentos e assinaturas. Autenticado pelo token configurado no Asaas. */
export async function POST(request: Request) {
  if (!isAsaasWebhook(request)) return fail("Não autorizado", 401);
  const body = (await request.json().catch(() => null)) as Parameters<typeof handleAsaasEvent>[0] | null;
  if (body) await handleAsaasEvent(body).catch((e) => console.error("[asaas] webhook", e));
  return json({ received: true });
}
