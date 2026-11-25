import { resolveMailSender } from "@/application/communications/deliver";
import { EVENT_KIND_LABELS, PRIORITY_LABELS, type EventKind, type EventPriority } from "@/domain/events/types";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Envia ao responsável (pessoa cadastrada, sem conta no app) o aviso da tarefa pela conta de e-mail do advogado. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { id } = await params;
  const { data: e } = await ctx.supabase
    .from("events")
    .select("title, kind, priority, starts_at, ends_at, all_day, location, description_text, collaborator:collaborators(name, email), partner:partners(name, email), client:clients(name), process:processes(title, number, tribunal, court_division), checklist:event_checklist_items(title, is_done, position)")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!e) return fail("Compromisso não encontrado", 404);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  // Responsável adicional indicado (advogado da equipe, responsável cadastrado ou parceiro)
  const body = (await request.json().catch(() => ({}))) as { person?: { type?: string; id?: string } };
  let person: { name: string; email: string | null } | null = null;
  if (body.person?.id && body.person.type === "member") {
    const { data } = await ctx.supabase.from("profiles").select("full_name, email").eq("id", body.person.id).maybeSingle();
    person = data ? { name: (data.full_name as string) ?? (data.email as string), email: (data.email as string | null) ?? null } : null;
  } else if (body.person?.id && (body.person.type === "collaborator" || body.person.type === "partner")) {
    const { data } = await ctx.supabase.from(body.person.type === "partner" ? "partners" : "collaborators").select("name, email").eq("id", body.person.id).maybeSingle();
    person = data ? { name: data.name as string, email: (data.email as string | null) ?? null } : null;
  } else {
    person =
      one(e.collaborator as unknown as { name: string; email: string | null } | null) ??
      one(e.partner as unknown as { name: string; email: string | null } | null);
  }
  if (!person?.email) return json({ result: "no-email" });

  const sender = await resolveMailSender(getSupabaseAdminClient(), ctx.orgId, ctx.user.id);
  if (!sender) return json({ result: "no-account" });

  const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", ...(e.all_day ? {} : { timeStyle: "short" }) }).format(new Date(e.starts_at as string));
  const client = one(e.client as unknown as { name: string } | null);
  const process = one(e.process as unknown as { title: string | null; number: string | null; tribunal: string | null; court_division: string | null } | null);
  const checklist = [...((e.checklist as { title: string; is_done: boolean; position: number }[] | null) ?? [])].sort((a, b) => a.position - b.position);
  const { data: me } = await ctx.supabase.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle();
  const senderName = (me?.full_name as string | null) ?? "Escritório";

  const lines: [string, string][] = [
    ["Tipo", EVENT_KIND_LABELS[e.kind as EventKind] ?? String(e.kind)],
    ["Quando", when],
    ["Prioridade", PRIORITY_LABELS[e.priority as EventPriority] ?? String(e.priority)],
    ...(e.location ? ([["Local", e.location as string]] as [string, string][]) : []),
    ...(client ? ([["Cliente", client.name]] as [string, string][]) : []),
    ...(process ? ([["Processo", [process.title, process.number, process.tribunal, process.court_division].filter(Boolean).join(" · ")]] as [string, string][]) : []),
  ];
  const text = [
    `Olá, ${person.name.split(" ")[0]}!`,
    "",
    `${senderName} indicou você como responsável por: ${e.title}`,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(checklist.length ? ["", "Etapas:", ...checklist.map((c, i) => `${i + 1}. ${c.is_done ? "[feito] " : ""}${c.title}`)] : []),
    ...(e.description_text ? ["", String(e.description_text).slice(0, 3000)] : []),
  ].join("\n");
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1d1d1f;line-height:1.5">
<p>Olá, ${esc(person.name.split(" ")[0])}!</p>
<p>${esc(senderName)} indicou você como <b>responsável</b> por:</p>
<h2 style="font-size:19px;margin:8px 0 12px">${esc(e.title as string)}</h2>
<table cellpadding="4" style="border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="color:#6e6e73;padding-right:14px">${k}</td><td>${esc(v)}</td></tr>`).join("")}</table>
${checklist.length ? `<p style="margin-top:16px"><b>Etapas</b></p><ol>${checklist.map((c) => `<li>${c.is_done ? "✔ " : ""}${esc(c.title)}</li>`).join("")}</ol>` : ""}
${e.description_text ? `<p style="white-space:pre-wrap;margin-top:16px">${esc(String(e.description_text).slice(0, 3000))}</p>` : ""}
<p style="color:#86868b;font-size:12px;margin-top:24px">Enviado pelo Lex Calendário.</p></body></html>`;

  try {
    await sender.send({ to: person.email, subject: `Tarefa para você: ${e.title}`, text, html });
    return json({ result: "sent" });
  } catch (err) {
    return fail(sender.explain(err), 422);
  }
}
