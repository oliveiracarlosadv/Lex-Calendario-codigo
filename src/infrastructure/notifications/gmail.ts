import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";
import { refreshGoogle } from "@/infrastructure/integrations/google/google-calendar";
import { getAccessToken } from "@/infrastructure/integrations/token-store";
import type { ConnectionRow } from "@/infrastructure/integrations/types";
import type { OutgoingMail } from "./smtp";

/**
 * Envio pelo Gmail do advogado (API do Gmail, permissão "gmail.send"): a mensagem sai
 * da conta Google conectada e fica em "Enviados", sem senha de app nem servidor SMTP.
 */
export async function sendGmail(conn: ConnectionRow, fromName: string | null, mail: OutgoingMail): Promise<{ id: string; threadId: string | null }> {
  const from = conn.account_email ? (fromName ? `"${fromName.replace(/"/g, "")}" <${conn.account_email}>` : conn.account_email) : undefined;
  const raw = await new MailComposer({
    from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  })
    .compile()
    .build();
  const token = await getAccessToken(conn, refreshGoogle);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: raw.toString("base64url") }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string; status?: string } };
  if (!res.ok) throw new GmailError(res.status, data.error?.message ?? "");
  return { id: data.id ?? "", threadId: data.threadId ?? null };
}

export class GmailError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(explainGmail(status, detail));
  }
}

function explainGmail(status: number, detail: string): string {
  if (/has not been used|is disabled|accessNotConfigured/i.test(detail))
    return "A API do Gmail ainda não está ativada no projeto do Google Cloud do app. Ative em console.cloud.google.com/apis/library/gmail.googleapis.com e tente de novo.";
  if (status === 401 || status === 403 || /insufficient/i.test(detail))
    return "O Lex não tem permissão para enviar pelo seu Gmail. Clique em “Conectar meu Gmail” e autorize o envio.";
  if (status === 400 && /invalid to|recipient/i.test(detail)) return "Endereço de destino inválido.";
  if (status === 429) return "Limite de envios do Gmail atingido. Tente mais tarde.";
  return `Gmail ${status}: ${detail || "falha no envio"}`;
}
