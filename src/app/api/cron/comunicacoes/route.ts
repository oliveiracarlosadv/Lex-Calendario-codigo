import { dispatchDueCommunications } from "@/application/communications/deliver";
import { importMailReplies } from "@/application/communications/replies";
import { fail, isAuthorizedCron, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Envia os e-mails agendados, avisa a hora de enviar WhatsApp e ofícios e traz as respostas por e-mail como comentários. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return fail("Não autorizado", 401);
  const replies = await importMailReplies().catch(() => ({ imported: 0 }));
  return json({ ...(await dispatchDueCommunications()), replies: replies.imported });
}
