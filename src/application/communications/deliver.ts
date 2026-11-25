import "server-only";
import { COMMUNICATION_KIND_LABELS, textToEmailHtml, type CommunicationAttachment, type CommunicationKind } from "@/domain/communications/types";
import { decryptSecret } from "@/infrastructure/crypto/secrets";
import { explainSmtpError, sendSmtp, type OutgoingMail, type SmtpAccount } from "@/infrastructure/notifications/smtp";
import { sendGmail } from "@/infrastructure/notifications/gmail";
import { GMAIL_SEND_SCOPE } from "@/infrastructure/integrations/google/google-calendar";
import type { ConnectionRow } from "@/infrastructure/integrations/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";

type Admin = ReturnType<typeof getSupabaseAdminClient>;

const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024; // limite usual dos provedores de e-mail (~25 MB com codificação)

export async function loadMailAccount(admin: Admin, orgId: string, userId: string | null): Promise<SmtpAccount | null> {
  const { data } = await admin
    .from("mail_accounts")
    .select("host, port, secure, username, password_enc, from_name, from_email, user_id")
    .eq("organization_id", orgId)
    .order("created_at");
  const rows = (data ?? []) as { host: string; port: number; secure: boolean; username: string; password_enc: string | null; from_name: string | null; from_email: string; user_id: string }[];
  const row = rows.find((r) => r.user_id === userId) ?? rows[0];
  if (!row?.password_enc) return null;
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    password: decryptSecret(row.password_enc) ?? "",
    fromName: row.from_name,
    fromEmail: row.from_email,
  };
}

export interface MailSender {
  via: "gmail" | "smtp";
  address: string;
  /** conexão Google usada (Gmail) */
  connectionId?: string;
  send: (mail: OutgoingMail) => Promise<unknown>;
  explain: (err: unknown) => string;
}

/**
 * Como os e-mails saem: pelo Gmail conectado (permissão de envio concedida no login do
 * Google) ou, se não houver, pela conta SMTP configurada. Prefere a conta do próprio usuário.
 */
export async function resolveMailSender(admin: Admin, orgId: string, userId: string | null): Promise<MailSender | null> {
  const { data: conns } = await admin
    .from("calendar_connections")
    .select("*")
    .eq("organization_id", orgId)
    .eq("provider", "google")
    .eq("is_active", true)
    .like("scopes", `%${GMAIL_SEND_SCOPE}%`);
  const list = (conns ?? []) as ConnectionRow[];
  const gmail = list.find((c) => c.user_id === userId) ?? list[0];
  if (gmail?.account_email) {
    const { data: profile } = await admin.from("profiles").select("full_name").eq("id", gmail.user_id).maybeSingle();
    return {
      via: "gmail",
      address: gmail.account_email,
      connectionId: gmail.id,
      send: (mail) => sendGmail(gmail, (profile?.full_name as string | null) ?? null, mail),
      explain: (err) => (err instanceof Error ? err.message : "Falha no envio pelo Gmail."),
    };
  }
  const smtp = await loadMailAccount(admin, orgId, userId);
  if (!smtp) return null;
  return { via: "smtp", address: smtp.fromEmail, send: (mail) => sendSmtp(smtp, mail), explain: explainSmtpError };
}

async function loadAttachments(admin: Admin, list: CommunicationAttachment[]) {
  const files: { filename: string; content: Buffer; contentType?: string }[] = [];
  let total = 0;
  for (const a of list) {
    const { data: signed } = await admin.storage.from("attachments").createSignedUrl(a.path, 120);
    const res = signed?.signedUrl ? await fetch(signed.signedUrl).catch(() => null) : null;
    if (!res?.ok) throw new Error(`Anexo indisponível: ${a.name}`);
    const content = Buffer.from(await res.arrayBuffer());
    total += content.byteLength;
    if (total > MAX_ATTACHMENTS_BYTES) throw new Error("Os anexos passam de 20 MB, limite dos provedores de e-mail.");
    files.push({ filename: a.name, content, contentType: a.mime || undefined });
  }
  return files;
}

async function notifyUser(admin: Admin, orgId: string, userId: string | null, title: string, body: string, id: string) {
  if (!userId) return;
  await admin.from("notifications").insert({ organization_id: orgId, user_id: userId, title, body, link: `/comunicacoes?abrir=${id}`, kind: "communication" });
}

interface CommunicationRow {
  id: string;
  organization_id: string;
  kind: CommunicationKind;
  status: string;
  to_email: string | null;
  recipient_name: string | null;
  subject: string;
  body: string;
  attachments: CommunicationAttachment[] | null;
  created_by: string | null;
}

/** Envia um e-mail agora pela conta SMTP configurada. Marca como enviado ou com falha. */
/**
 * Assinatura do e-mail: quem está cadastrado no perfil do Lex (nome, função e OAB), o escritório e o telefone.
 * Se o texto já termina com o nome do remetente, acrescenta só o que falta.
 */
export async function withSignature(admin: Admin, body: string, orgId: string, userId: string | null): Promise<string> {
  if (!userId) return body;
  const { data: p } = await admin.from("profiles").select("full_name, profession, oab_number, oab_state, phone, email").eq("id", userId).maybeSingle();
  const { data: org } = await admin.from("organizations").select("name, settings").eq("id", orgId).maybeSingle();
  const name = ((p?.full_name as string | null) ?? "").trim();
  if (!name) return body;
  const settings = (org?.settings ?? {}) as { address?: string | null; phone?: string | null };
  const oab = p?.oab_number ? `OAB/${(p.oab_state as string | null) ?? ""} ${p.oab_number as string}`.replace("OAB/ ", "OAB ") : "";
  const email = (p?.email as string | null) ?? "";
  const lines = [
    [(p?.profession as string | null) ?? "", oab].filter(Boolean).join(" · "),
    (org?.name as string | null) ?? "",
    [(p?.phone as string | null) || settings.phone || "", email.endsWith("@lex.local") ? "" : email].filter(Boolean).join(" · "),
    settings.address ?? "",
  ]
    .map((l) => l.trim())
    .filter(Boolean);
  const text = body.replace(/\s+$/, "");
  const tail = text.slice(-400).toLowerCase();
  // Não repete o que o texto já traz no fecho
  const missing = lines.filter((l) => !tail.includes(l.toLowerCase()));
  if (tail.includes(name.toLowerCase())) return missing.length ? `${text}\n${missing.join("\n")}` : text;
  return `${text}\n\n--\n${[name, ...missing].join("\n")}`;
}

export async function sendCommunicationEmail(id: string, actingUserId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = getSupabaseAdminClient();
  const { data } = await admin.from("communications").select("*").eq("id", id).maybeSingle();
  const c = data as CommunicationRow | null;
  if (!c) return { ok: false, error: "Comunicação não encontrada." };
  if (c.kind !== "email") return { ok: false, error: "Somente e-mails são enviados automaticamente." };
  if (c.status === "sent") return { ok: true };
  if (!c.to_email) return { ok: false, error: "Informe o e-mail do destinatário." };

  const sender = await resolveMailSender(admin, c.organization_id, actingUserId ?? c.created_by);
  if (!sender) {
    const error = "Nenhum e-mail de envio configurado. Conecte seu Gmail em Configurações → E-mail de envio.";
    await admin.from("communications").update({ status: "failed", error, notified_at: new Date().toISOString() }).eq("id", id);
    return { ok: false, error };
  }
  try {
    const attachments = await loadAttachments(admin, c.attachments ?? []);
    const body = await withSignature(admin, c.body, c.organization_id, actingUserId ?? c.created_by);
    await sender.send({ to: c.to_email, subject: c.subject, text: body, html: textToEmailHtml(body), attachments });
    await admin.from("communications").update({ status: "sent", sent_at: new Date().toISOString(), error: null, notified_at: new Date().toISOString() }).eq("id", id);
    return { ok: true };
  } catch (err) {
    const error = sender.explain(err);
    await admin.from("communications").update({ status: "failed", error, notified_at: new Date().toISOString() }).eq("id", id);
    return { ok: false, error };
  }
}

/**
 * Agendamentos vencidos: e-mails são enviados; WhatsApp e ofícios geram um aviso
 * "hora de enviar" (o envio desses depende de um clique do advogado).
 */
export async function dispatchDueCommunications(limit = 50) {
  const admin = getSupabaseAdminClient();
  const { data: due } = await admin
    .from("communications")
    .select("id, organization_id, kind, subject, recipient_name, to_email, created_by")
    .eq("status", "scheduled")
    .is("notified_at", null)
    .lte("send_at", new Date().toISOString())
    .order("send_at")
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let reminded = 0;
  for (const c of (due ?? []) as (Pick<CommunicationRow, "id" | "organization_id" | "kind" | "subject" | "recipient_name" | "to_email" | "created_by">)[]) {
    // Reserva (evita envio duplicado em execuções concorrentes)
    const { data: claimed } = await admin
      .from("communications")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", c.id)
      .is("notified_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const who = c.recipient_name ?? c.to_email ?? "cliente";
    if (c.kind === "email") {
      const result = await sendCommunicationEmail(c.id, c.created_by);
      if (result.ok) {
        sent++;
        await notifyUser(admin, c.organization_id, c.created_by, "E-mail enviado", `${c.subject} — para ${who}`, c.id);
      } else {
        failed++;
        await notifyUser(admin, c.organization_id, c.created_by, "Falha ao enviar e-mail agendado", `${c.subject}: ${result.error}`, c.id);
      }
    } else {
      reminded++;
      await notifyUser(
        admin,
        c.organization_id,
        c.created_by,
        `Hora de enviar: ${COMMUNICATION_KIND_LABELS[c.kind]}`,
        `${c.subject || "Comunicação"} — para ${who}. Abra para enviar.`,
        c.id,
      );
    }
  }
  return { sent, failed, reminded };
}
