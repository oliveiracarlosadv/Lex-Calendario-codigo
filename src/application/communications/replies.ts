import "server-only";
import { GMAIL_READ_SCOPE, refreshGoogle } from "@/infrastructure/integrations/google/google-calendar";
import { getAccessToken } from "@/infrastructure/integrations/token-store";
import type { ConnectionRow } from "@/infrastructure/integrations/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";

/**
 * Respostas aos e-mails de comentário viram comentários do compromisso.
 * O Lex lê somente as mensagens das conversas que ele mesmo iniciou (comment_mail_threads).
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

function findPart(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

const htmlToPlain = (html: string) =>
  html
    .replace(/<(br|\/p|\/div)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

/** Fica só com o texto novo da resposta (sem a mensagem citada nem assinatura automática). */
export function extractReplyText(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");
  const cuts = [
    /\n(?:Em|On)\s[^\n]*(?:\n[^\n]*)?(?:escreveu|wrote):/i, // "Em seg., 9 de out. … escreveu:"
    /\n-{2,}\s*(?:Mensagem original|Original Message|Forwarded message|Mensagem encaminhada)/i,
    /\n_{6,}/,
    /\n(?:De|From):\s[^\n]+\n(?:Enviad[ao] em|Sent|Data|Date):/i,
    /\nNovo comentário em\n/i,
    /\nEnviado pelo Lex Calendário/i,
  ];
  let end = text.length;
  for (const re of cuts) {
    const m = re.exec(`\n${text}`);
    if (m && m.index < end) end = m.index;
  }
  text = text.slice(0, end);
  // Linhas citadas (">") e assinaturas "Enviado do meu iPhone"
  const lines = text.split("\n").filter((l) => !/^\s*>/.test(l));
  const sig = lines.findIndex((l) => /^(--\s*$|Enviado do meu|Sent from my|Obter o Outlook)/i.test(l.trim()));
  return (sig >= 0 ? lines.slice(0, sig) : lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseFrom(value: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(value);
  const email = (m ? m[2] : value).trim().toLowerCase();
  const name = (m ? m[1] : "").trim() || email;
  return { name, email };
}

let lastRun = 0;

/** Importa as respostas novas (no máximo a cada 90 segundos). */
export async function importMailReplies(force = false) {
  if (!force && Date.now() - lastRun < 90_000) return { imported: 0, skipped: true };
  lastRun = Date.now();
  const admin = getSupabaseAdminClient();
  const { data: conns } = await admin.from("calendar_connections").select("*").eq("provider", "google").eq("is_active", true).like("scopes", `%${GMAIL_READ_SCOPE}%`);
  let imported = 0;

  for (const conn of (conns ?? []) as ConnectionRow[]) {
    const { data: threads } = await admin.from("comment_mail_threads").select("thread_id, event_id").eq("connection_id", conn.id).order("created_at", { ascending: false }).limit(500);
    const eventOf = new Map(((threads ?? []) as { thread_id: string; event_id: string }[]).map((t) => [t.thread_id, t.event_id]));
    if (!eventOf.size) continue;
    try {
      const token = await getAccessToken(conn, refreshGoogle);
      const headers = { Authorization: `Bearer ${token}` };
      const q = encodeURIComponent('newer_than:21d -from:me subject:"Novo comentário"');
      const list = (await (await fetch(`${GMAIL}/messages?q=${q}&maxResults=50`, { headers })).json()) as { messages?: { id: string; threadId: string }[] };
      for (const m of list.messages ?? []) {
        const eventId = eventOf.get(m.threadId);
        if (!eventId) continue;
        const ref = `gmail:${m.id}`;
        const { data: exists } = await admin.from("event_comments").select("id").eq("event_id", eventId).eq("external_ref", ref).maybeSingle();
        if (exists) continue;
        const res = await fetch(`${GMAIL}/messages/${m.id}?format=full`, { headers });
        if (!res.ok) continue;
        const msg = (await res.json()) as GmailMessage;
        const from = parseFrom(msg.payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "");
        if (!from.email || from.email === (conn.account_email ?? "").toLowerCase()) continue;
        const plain = findPart(msg.payload, "text/plain") ?? htmlToPlain(findPart(msg.payload, "text/html") ?? "");
        const body = extractReplyText(plain).slice(0, 10000);
        if (!body) continue;
        const { data: ev } = await admin.from("events").select("organization_id, title, responsible_id, created_by").eq("id", eventId).maybeSingle();
        if (!ev) continue;
        const { error } = await admin.from("event_comments").insert({
          organization_id: ev.organization_id,
          event_id: eventId,
          author_id: conn.user_id,
          author_name: from.name,
          author_email: from.email,
          body,
          external_ref: ref,
          ...(msg.internalDate ? { created_at: new Date(Number(msg.internalDate)).toISOString() } : {}),
        });
        if (error) continue;
        imported++;
        const users = [...new Set([ev.responsible_id, ev.created_by, conn.user_id].filter(Boolean))] as string[];
        await admin.from("notifications").insert(
          users.map((user_id) => ({
            organization_id: ev.organization_id,
            user_id,
            title: `Resposta por e-mail de ${from.name}`,
            body: `${ev.title}: ${body.slice(0, 160)}`,
            link: `/eventos/${eventId}`,
            kind: "event_change",
          })),
        );
      }
    } catch (e) {
      console.error(`[gmail] respostas: ${(e as Error).message}`);
    }
  }
  return { imported };
}
