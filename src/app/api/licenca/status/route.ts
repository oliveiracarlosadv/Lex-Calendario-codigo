import { LicenseError, bearer, signOut, statusFor } from "@/application/licensing/server";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Servidor de assinaturas: situação da assinatura da sessão informada. */
export async function GET(request: Request) {
  const token = bearer(request);
  if (!token) return fail("Sessão não informada.", 401);
  try {
    return json(await statusFor(token));
  } catch (e) {
    return e instanceof LicenseError ? fail(e.message, e.status) : fail("Não foi possível consultar a assinatura.", 500);
  }
}

/** Encerra a sessão (sair). */
export async function DELETE(request: Request) {
  const token = bearer(request);
  if (token) await signOut(token).catch(() => undefined);
  return json({ ok: true });
}
