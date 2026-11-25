import { z } from "zod";
import { LicenseError, bearer, subscribe } from "@/application/licensing/server";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Servidor de assinaturas: cria a assinatura mensal no Asaas e devolve o link de pagamento. */
export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return fail("Sessão não informada.", 401);
  const parsed = z.object({ name: z.string().min(3).max(200), document: z.string().min(11).max(20) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Informe o nome completo e o CPF ou CNPJ.");
  try {
    return json(await subscribe(token, parsed.data));
  } catch (e) {
    return e instanceof LicenseError ? fail(e.message, e.status) : fail("Não foi possível gerar a cobrança.", 500);
  }
}
