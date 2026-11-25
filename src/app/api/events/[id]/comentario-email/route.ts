import { z } from "zod";
import { resolveMailSender } from "@/application/communications/deliver";
import { displayTitle } from "@/domain/events/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ commentId: z.string().uuid() });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Envia o comentário novo por e-mail (Gmail ou SMTP do advogado) aos convidados e ao
 * responsável da tarefa, com a conversa numerada do mais antigo para o mais novo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Pedido inválido");

  const { data: e } = await ctx.supabase
    .from("events")
    .select("title, status, starts_at, all_day, attendees, collaborator:collaborators(name, email), partner:partners(name, email), client:clients(name), process:processes(title, number)")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!e) return fail("Compromisso não encontrado", 404);

  const admin = getSupabaseAdminClient();
  const sender = await resolveMailSender(admin, ctx.orgId, ctx.user.id);
  if (!sender) return json({ sent: 0, reason: "no-sender" });

  const own = new Set([sender.address.toLowerCase(), (ctx.user.email ?? "").toLowerCase()]);
  const recipients = new Map<string, string | null>();
  for (const a of (e.attendees as { email: string; name?: string | null }[] | null) ?? []) recipients.set(a.email.toLowerCase(), a.name ?? null);
  for (const p of [one(e.collaborator as unknown as { name: string; email: string | null } | null), one(e.partner as unknown as { name: string; email: string | null } | null)]) {
    if (p?.email) recipients.set(p.email.toLowerCase(), p.name);
  }
  for (const o of own) recipients.delete(o);
  if (!recipients.size) return json({ sent: 0, reason: "no-recipients" });

  const { data: comments } = await ctx.supabase.from("event_comments").select("id, body, created_at, author_id").eq("event_id", id).order("created_at");
  const list = (comments ?? []) as { id: string; body: string; created_at: string; author_id: string }[];
  const { data: people } = await ctx.supabase.from("profiles").select("id, full_name");
  const nameOf = (uid: string) => ((people ?? []) as { id: string; full_name: string | null }[]).find((p) => p.id === uid)?.full_name ?? "Equipe";
  const idx = list.findIndex((c) => c.id === parsed.data.commentId);
  if (idx < 0) return fail("Comentário não encontrado", 404);
  const fmt = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const title = displayTitle(String(e.title), e.status as string);
  const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", ...(e.all_day ? {} : { timeStyle: "short" }) }).format(new Date(e.starts_at as string));
  const latest = list[idx];
  // Dados do caso, antes do comentário
  const clientName = one(e.client as unknown as { name: string } | null)?.name ?? null;
  const proc = one(e.process as unknown as { title: string | null; number: string | null } | null);
  const caseLines: [string, string][] = [
    ["Cliente", clientName ?? "—"],
    ["Número do processo", proc?.number ?? "—"],
    ["Nome do processo", proc?.title ?? "—"],
  ];
  const history = list.slice(Math.max(0, idx - 9), idx);

  const text = [
    `Novo comentário (nº ${idx + 1}) em: ${title}`,
    `Quando: ${when}`,
    "",
    ...caseLines.map(([k, v]) => `${k}: ${v}`),
    "",
    `${idx + 1}. ${nameOf(latest.author_id)} · ${fmt(latest.created_at)}`,
    latest.body,
    ...(history.length ? ["", "— Comentários anteriores —", ...history.map((c, i) => `${idx - history.length + i + 1}. ${nameOf(c.author_id)} · ${fmt(c.created_at)}\n${c.body}`)] : []),
    "",
    "Para comentar, basta responder este e-mail: sua resposta entra como comentário no compromisso.",
  ].join("\n");
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1d1d1f;line-height:1.5">
<p style="color:#6e6e73;margin:0">Novo comentário em</p>
<h2 style="font-size:18px;margin:2px 0 4px">${esc(title)}</h2>
<p style="color:#6e6e73;margin:0 0 12px">${esc(when)}</p>
<table cellpadding="3" style="border-collapse:collapse;margin:0 0 16px;font-size:14px">${caseLines
    .map(([k, v]) => `<tr><td style="color:#6e6e73;padding-right:14px">${k}</td><td><b>${esc(v)}</b></td></tr>`)
    .join("")}</table>
<div style="border-left:3px solid #556b2f;padding:4px 12px;margin-bottom:16px"><b>${idx + 1}.</b> <i>${esc(nameOf(latest.author_id))} · ${fmt(latest.created_at)}</i><br>${esc(latest.body).replace(/\n/g, "<br>")}</div>
${history.length ? `<p style="color:#6e6e73;font-size:13px">Comentários anteriores</p>${history.map((c, i) => `<p style="font-size:13px;color:#3a3a3c"><b>${idx - history.length + i + 1}.</b> <i>${esc(nameOf(c.author_id))} · ${fmt(c.created_at)}</i><br>${esc(c.body).replace(/\n/g, "<br>")}</p>`).join("")}` : ""}
<p style="color:#86868b;font-size:12px;margin-top:24px">Para comentar, basta responder este e-mail: sua resposta entra como comentário no compromisso. Enviado pelo Lex Calendário.</p></body></html>`;

  try {
    const result = (await sender.send({ to: [...recipients.keys()].join(", "), subject: `Novo comentário: ${title}`, text, html })) as { threadId?: string | null } | undefined;
    // Guarda a conversa: as respostas a este e-mail viram comentários do compromisso
    if (sender.connectionId && result?.threadId) {
      await admin
        .from("comment_mail_threads")
        .upsert({ organization_id: ctx.orgId, event_id: id, connection_id: sender.connectionId, thread_id: result.threadId }, { onConflict: "connection_id,thread_id", ignoreDuplicates: true });
    }
  } catch (err) {
    return fail(sender.explain(err), 422);
  }
  return json({ sent: recipients.size });
}
