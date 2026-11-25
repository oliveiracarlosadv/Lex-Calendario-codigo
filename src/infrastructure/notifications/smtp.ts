import "server-only";
import nodemailer from "nodemailer";

/** Envio de e-mail pela conta do próprio advogado (SMTP: Gmail, Outlook, iCloud, provedor do escritório). */
export interface SmtpAccount {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string | null;
  fromEmail: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

function transport(acc: SmtpAccount) {
  return nodemailer.createTransport({
    host: acc.host,
    port: acc.port,
    secure: acc.secure, // 465 = TLS direto; 587 = STARTTLS
    auth: { user: acc.username, pass: acc.password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

const from = (acc: SmtpAccount) => (acc.fromName ? `"${acc.fromName.replace(/"/g, "")}" <${acc.fromEmail}>` : acc.fromEmail);

export async function verifySmtp(acc: SmtpAccount): Promise<void> {
  await transport(acc).verify();
}

export async function sendSmtp(acc: SmtpAccount, mail: OutgoingMail): Promise<string> {
  const info = await transport(acc).sendMail({
    from: from(acc),
    to: mail.to,
    replyTo: acc.fromEmail,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });
  return info.messageId;
}

/** Mensagem de erro compreensível para os problemas mais comuns de SMTP. */
export function explainSmtpError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  if (e.code === "EAUTH" || e.responseCode === 535 || e.responseCode === 534)
    return "Usuário ou senha recusados. No Gmail, iCloud e Outlook use uma “senha de app” (não a senha normal da conta).";
  if (e.code === "ECONNECTION" || e.code === "ETIMEDOUT" || e.code === "ESOCKET")
    return "Não foi possível conectar ao servidor de e-mail. Confira o servidor e a porta (465 com SSL ou 587 sem SSL).";
  if (e.code === "EENVELOPE") return "Endereço de destino inválido.";
  return e.message ?? "Falha no envio.";
}
