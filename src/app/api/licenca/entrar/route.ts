import { z } from "zod";
import { LicenseError, signIn } from "@/application/licensing/server";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Servidor de assinaturas: confere o código e abre a sessão do aplicativo. */
export async function POST(request: Request) {
  const parsed = z
    .object({ email: z.string().email().max(200), code: z.string().min(6).max(12), device: z.string().max(120).nullish() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Informe o e-mail e o código de 6 números.");
  try {
    return json(await signIn(parsed.data.email, parsed.data.code, parsed.data.device ?? null));
  } catch (e) {
    return e instanceof LicenseError ? fail(e.message, e.status) : fail("Não foi possível entrar.", 500);
  }
}
