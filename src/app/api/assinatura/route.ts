import { z } from "zod";
import { LicenseClientError, licenseRequired, localLicense, requestLoginCode, signInLocal, signOutLocal, subscribeLocal } from "@/application/licensing/client";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Aplicativo instalado: situação da assinatura deste computador. */
export async function GET(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  return json(await localLicense(new URL(request.url).searchParams.get("atualizar") === "1"));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("codigo"), email: z.string().email().max(200) }),
  z.object({ action: z.literal("entrar"), email: z.string().email().max(200), code: z.string().min(6).max(12) }),
  z.object({ action: z.literal("assinar"), name: z.string().min(3).max(200), document: z.string().min(11).max(20) }),
  z.object({ action: z.literal("sair") }),
]);

export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!licenseRequired()) return fail("Esta instalação não usa assinatura.", 400);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Confira os dados informados.");
  const b = parsed.data;
  try {
    if (b.action === "codigo") await requestLoginCode(b.email);
    else if (b.action === "entrar") await signInLocal(b.email, b.code);
    else if (b.action === "sair") await signOutLocal();
    else return json({ ...(await subscribeLocal(b.name, b.document)), license: await localLicense() });
    return json({ license: await localLicense() });
  } catch (e) {
    return e instanceof LicenseClientError ? fail(e.message, e.status || 503) : fail("Não foi possível concluir.", 500);
  }
}
