import { isLicenseAdmin, listSubscribers, price, trialDays } from "@/application/licensing/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Lista de assinantes — só para os e-mails em LICENSE_ADMIN_EMAILS, no servidor de assinaturas. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (process.env.LEX_DESKTOP === "1" || !isLicenseAdmin(ctx.user.email)) return fail("Acesso restrito ao titular do Lex Calendário.", 403);
  return json({ subscribers: await listSubscribers(), price: price(), trialDays: trialDays() });
}
