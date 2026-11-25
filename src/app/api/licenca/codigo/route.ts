import { z } from "zod";
import { LicenseError, requestCode } from "@/application/licensing/server";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Servidor de assinaturas: envia o código de entrada para o e-mail. */
export async function POST(request: Request) {
  const parsed = z.object({ email: z.string().email().max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Informe um e-mail válido.");
  try {
    await requestCode(parsed.data.email);
    return json({ ok: true });
  } catch (e) {
    return e instanceof LicenseError ? fail(e.message, e.status) : fail("Não foi possível enviar o código.", 500);
  }
}
