import { resolveMailSender } from "@/application/communications/deliver";
import { textToEmailHtml } from "@/domain/communications/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Envia um e-mail de teste para a própria conta, pelo meio de envio configurado (Gmail ou SMTP). */
export async function POST() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const sender = await resolveMailSender(getSupabaseAdminClient(), ctx.orgId, ctx.user.id);
  if (!sender) return fail("Conecte seu Gmail (ou configure outro provedor) antes de testar.", 400);
  const text = "Este é um e-mail de teste do Lex Calendário.\n\nSe você recebeu esta mensagem, as comunicações aos clientes já podem ser enviadas por esta conta.";
  try {
    await sender.send({ to: sender.address, subject: "Lex Calendário — teste de envio", text, html: textToEmailHtml(text) });
  } catch (err) {
    return fail(sender.explain(err), 422);
  }
  return json({ ok: true, via: sender.via, to: sender.address });
}
