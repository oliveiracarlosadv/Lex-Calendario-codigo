import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMUNICATION_KIND_LABELS, COMMUNICATION_STATUS_LABELS, type CommunicationKind, type CommunicationStatus } from "@/domain/communications/types";
import { EVENT_KIND_LABELS, PRIORITY_LABELS, STATUS_LABELS, type EventKind, type EventPriority, type EventStatus } from "@/domain/events/types";
import { processLabel } from "@/domain/processes/types";
import { formatDocument, formatPhone } from "@/domain/shared/document";

/**
 * Histórico do cliente: todos os compromissos e tarefas do calendário ligados a ele
 * (diretamente ou por um processo dele), com checklist, além das comunicações enviadas
 * e das intimações dos seus processos. Usado na tela do cliente e nas exportações.
 */

type Row = Record<string, unknown>;

export interface HistoryEvent {
  id: string;
  title: string;
  kind: EventKind;
  status: EventStatus;
  priority: EventPriority;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  description_text: string | null;
  process_number: string | null;
  responsible: string | null;
  checklist: { title: string; is_done: boolean }[];
  created_at: string;
}

export interface HistoryCommunication {
  id: string;
  kind: CommunicationKind;
  status: CommunicationStatus;
  subject: string;
  body: string;
  to_email: string | null;
  to_phone: string | null;
  deadline_at: string | null;
  send_at: string | null;
  sent_at: string | null;
  process_number: string | null;
  created_at: string;
}

export interface HistoryIntimation {
  id: string;
  process_number: string;
  tribunal: string | null;
  communication_type: string | null;
  document_type: string | null;
  available_at: string | null;
  published_at: string | null;
  text: string | null;
}

export interface ClientHistory {
  client: Row & { id: string; name: string };
  processes: { id: string; title: string | null; number: string | null; tribunal: string | null; court_division: string | null; status: string; procedural_class: string | null }[];
  events: HistoryEvent[];
  communications: HistoryCommunication[];
  intimations: HistoryIntimation[];
  summary: { total: number; tasks: number; done: number; pending: number; overdue: number; upcoming: number; communications: number };
}

const BATCH = 200;

async function inBatches<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(...(await load(ids.slice(i, i + BATCH))));
  return out;
}

export async function loadClientHistory(sb: SupabaseClient, orgId: string, clientId: string): Promise<ClientHistory | null> {
  const { data: client } = await sb.from("clients").select("*").eq("organization_id", orgId).eq("id", clientId).maybeSingle();
  if (!client) return null;
  const { data: procs } = await sb
    .from("processes")
    .select("id, title, number, tribunal, court_division, status, procedural_class")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at");
  const processes = (procs ?? []) as ClientHistory["processes"];
  const processIds = processes.map((p) => p.id);
  const numberOf = new Map(processes.map((p) => [p.id, processLabel(p)]));

  const cols = "id, title, kind, status, priority, starts_at, ends_at, all_day, location, description_text, process_id, responsible_id, created_at, collaborator:collaborators(name), partner:partners(name)";
  const { data: direct } = await sb.from("events").select(cols).eq("organization_id", orgId).eq("client_id", clientId).is("deleted_at", null).limit(5000);
  const viaProcess = processIds.length
    ? await inBatches(processIds, async (chunk) => {
        const { data } = await sb.from("events").select(cols).eq("organization_id", orgId).in("process_id", chunk).is("deleted_at", null).limit(5000);
        return (data ?? []) as Row[];
      })
    : [];
  const byId = new Map<string, Row>();
  for (const e of [...((direct ?? []) as Row[]), ...viaProcess]) byId.set(e.id as string, e);
  const eventRows = [...byId.values()];

  const eventIds = eventRows.map((e) => e.id as string);
  const checklist = await inBatches(eventIds, async (chunk) => {
    const { data } = await sb.from("event_checklist_items").select("event_id, title, is_done, position").in("event_id", chunk).order("position");
    return (data ?? []) as { event_id: string; title: string; is_done: boolean }[];
  });

  // Processos de outros clientes citados nos eventos diretos
  const extraProcessIds = [...new Set(eventRows.map((e) => e.process_id as string | null).filter((id): id is string => !!id && !numberOf.has(id)))];
  if (extraProcessIds.length) {
    const extra = await inBatches(extraProcessIds, async (chunk) => {
      const { data } = await sb.from("processes").select("id, title, number").in("id", chunk);
      return (data ?? []) as { id: string; title: string | null; number: string | null }[];
    });
    for (const p of extra) numberOf.set(p.id, processLabel(p));
  }

  const { data: members } = await sb.from("profiles").select("id, full_name, email");
  const nameOf = new Map(((members ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((m) => [m.id, m.full_name || m.email || null]));

  const events: HistoryEvent[] = eventRows
    .map((e) => ({
      id: e.id as string,
      title: e.title as string,
      kind: e.kind as EventKind,
      status: e.status as EventStatus,
      priority: e.priority as EventPriority,
      starts_at: e.starts_at as string,
      ends_at: e.ends_at as string,
      all_day: !!e.all_day,
      location: (e.location as string | null) ?? null,
      description_text: (e.description_text as string | null) ?? null,
      process_number: e.process_id ? (numberOf.get(e.process_id as string) ?? null) : null,
      responsible:
        (e.collaborator as { name: string } | null)?.name ??
        (e.partner as { name: string } | null)?.name ??
        (e.responsible_id ? (nameOf.get(e.responsible_id as string) ?? null) : null),
      checklist: checklist.filter((c) => c.event_id === e.id).map(({ title, is_done }) => ({ title, is_done })),
      created_at: e.created_at as string,
    }))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));

  const { data: comms } = await sb
    .from("communications")
    .select("id, kind, status, subject, body, to_email, to_phone, deadline_at, send_at, sent_at, process_id, created_at")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(2000);
  const communications: HistoryCommunication[] = ((comms ?? []) as Row[]).map((c) => ({
    ...(c as unknown as HistoryCommunication),
    process_number: c.process_id ? (numberOf.get(c.process_id as string) ?? null) : null,
  }));

  const intimations = processIds.length
    ? await inBatches(processIds, async (chunk) => {
        const { data } = await sb
          .from("intimations")
          .select("id, process_number, tribunal, communication_type, document_type, available_at, published_at, text")
          .in("process_id", chunk)
          .order("available_at", { ascending: false })
          .limit(1000);
        return (data ?? []) as HistoryIntimation[];
      })
    : [];

  const now = new Date().toISOString();
  const open = (e: HistoryEvent) => e.status !== "done" && e.status !== "cancelled";
  return {
    client: client as ClientHistory["client"],
    processes,
    events,
    communications,
    intimations,
    summary: {
      total: events.length,
      tasks: events.filter((e) => e.kind === "task").length,
      done: events.filter((e) => e.status === "done").length,
      pending: events.filter(open).length,
      overdue: events.filter((e) => open(e) && e.ends_at < now).length,
      upcoming: events.filter((e) => open(e) && e.starts_at >= now).length,
      communications: communications.length,
    },
  };
}

// ───────────────────────────── Formatos de exportação ─────────────────────────────

const TZ = "America/Sao_Paulo";
const dt = (iso: string | null | undefined, allDay = false) => {
  const d = iso ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short", ...(allDay ? {} : { timeStyle: "short" }) }).format(d);
};
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

/** CSV no padrão do Excel em português: separador ";" e BOM UTF-8. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

export function historyToCsv(h: ClientHistory) {
  const rows: (string | null)[][] = [
    ...h.events.map((e) => [
      dt(e.starts_at, e.all_day),
      "Calendário",
      EVENT_KIND_LABELS[e.kind] ?? e.kind,
      e.title,
      STATUS_LABELS[e.status] ?? e.status,
      PRIORITY_LABELS[e.priority] ?? e.priority,
      e.process_number,
      e.responsible,
      e.checklist.length ? e.checklist.map((c) => `${c.is_done ? "[x]" : "[ ]"} ${c.title}`).join(" | ") : "",
      e.description_text,
    ]),
    ...h.communications.map((c) => [
      dt(c.sent_at ?? c.send_at ?? c.created_at),
      "Comunicação",
      COMMUNICATION_KIND_LABELS[c.kind],
      c.subject,
      COMMUNICATION_STATUS_LABELS[c.status],
      c.deadline_at ? `Prazo ${day(c.deadline_at)}` : "",
      c.process_number,
      c.to_email ?? c.to_phone,
      "",
      c.body,
    ]),
    ...h.intimations.map((i) => [
      day(i.published_at ?? i.available_at),
      "Intimação",
      [i.communication_type, i.document_type].filter(Boolean).join(" — "),
      i.tribunal,
      "",
      "",
      i.process_number,
      "",
      "",
      i.text?.slice(0, 2000) ?? "",
    ]),
  ];
  return toCsv(["Data", "Origem", "Tipo", "Título / assunto", "Situação", "Prioridade / prazo", "Processo", "Responsável / destinatário", "Checklist", "Detalhes"], rows);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Botão de imprimir; com autoPrint, a janela "Salvar como PDF" abre sozinha. */
const AUTO_PRINT = (autoPrint: boolean) =>
  `<p class="noprint" style="text-align:right;font-family:sans-serif;font-size:12px;color:#6e6e73">${autoPrint ? 'Na janela que abriu, escolha <b>Salvar como PDF</b>. ' : ""}<button onclick="print()">Imprimir / salvar em PDF</button></p>${
    autoPrint ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},400)})</script>" : ""
  }`;

/** Relatório para imprimir ou salvar em PDF (Arquivo → Imprimir → Salvar como PDF). */
export function historyToHtml(h: ClientHistory, office: string, headerHtml = "", autoPrint = false) {
  const c = h.client as Row;
  const contact = [c.email, c.phone ? formatPhone(c.phone as string) : null].filter(Boolean).join(" · ");
  const timeline = [
    ...h.events.map((e) => ({
      when: e.starts_at,
      label: `${dt(e.starts_at, e.all_day)}`,
      tag: EVENT_KIND_LABELS[e.kind],
      title: e.title,
      meta: [STATUS_LABELS[e.status], e.process_number && `Processo ${e.process_number}`, e.responsible, e.location].filter(Boolean).join(" · "),
      extra: e.checklist.length
        ? `<ol>${e.checklist.map((i) => `<li>${i.is_done ? "☑" : "☐"} ${esc(i.title)}</li>`).join("")}</ol>`
        : "",
      done: e.status === "done",
    })),
    ...h.communications.map((m) => ({
      when: m.sent_at ?? m.send_at ?? m.created_at,
      label: dt(m.sent_at ?? m.send_at ?? m.created_at),
      tag: COMMUNICATION_KIND_LABELS[m.kind],
      title: m.subject || "(sem assunto)",
      meta: [COMMUNICATION_STATUS_LABELS[m.status], m.deadline_at && `Prazo ${day(m.deadline_at)}`, m.to_email ?? m.to_phone].filter(Boolean).join(" · "),
      // Teor da comunicação
      extra: m.body?.trim() ? `<div class="body">${esc(m.body.trim())}</div>` : "",
      done: m.status === "sent",
    })),
    ...h.intimations.map((i) => ({
      when: i.published_at ?? i.available_at ?? "",
      label: day(i.published_at ?? i.available_at),
      tag: "Intimação",
      title: [i.communication_type, i.document_type].filter(Boolean).join(" — ") || "Intimação",
      meta: [i.process_number, i.tribunal].filter(Boolean).join(" · "),
      extra: "",
      done: true,
    })),
  ].sort((a, b) => b.when.localeCompare(a.when));

  const s = h.summary;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Histórico — ${esc(c.name)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;margin:40px auto;max-width:820px;padding:0 24px;font-size:13px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:28px 0 8px;color:#556b2f}
  .muted{color:#6e6e73} .stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .stat{border:1px solid #e5e5ea;border-radius:10px;padding:8px 12px} .stat b{display:block;font-size:17px}
  table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #eee;padding:7px 6px;text-align:left;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;color:#86868b;font-weight:600}
  .tag{display:inline-block;border-radius:6px;background:#eef2e6;color:#3f5420;padding:1px 7px;font-size:11px;font-weight:600}
  .done{color:#86868b} ol{margin:4px 0 0;padding-left:18px}
  .body{white-space:pre-wrap;margin-top:6px;padding:8px 10px;border-left:3px solid #d9e2c8;background:#fafaf7;color:#1d1d1f;font-size:12px}
  @media print{body{margin:0}.noprint{display:none}}
</style></head><body>
${AUTO_PRINT(autoPrint)}
${headerHtml || `<p class="muted">${esc(office)} · Lex Calendário</p>`}
<h1>${esc(c.name)}</h1>
<p class="muted">${[c.document ? formatDocument(c.document as string) : null, contact].filter(Boolean).map(esc).join(" · ")}</p>
<p class="muted">Relatório gerado em ${dt(new Date().toISOString())}</p>
<div class="stats">
  <div class="stat"><b>${s.total}</b>entradas no calendário</div>
  <div class="stat"><b>${s.tasks}</b>tarefas</div>
  <div class="stat"><b>${s.done}</b>concluídas</div>
  <div class="stat"><b>${s.pending}</b>pendentes</div>
  <div class="stat"><b>${s.overdue}</b>atrasadas</div>
  <div class="stat"><b>${s.communications}</b>comunicações</div>
</div>
${h.processes.length ? `<h2>Processos</h2><table><tr><th>Número</th><th>Tribunal / vara</th><th>Classe</th></tr>${h.processes
    .map((p) => `<tr><td>${esc(processLabel(p))}</td><td>${esc([p.tribunal, p.court_division].filter(Boolean).join(" — "))}</td><td>${esc(p.procedural_class)}</td></tr>`)
    .join("")}</table>` : ""}
<h2>Histórico</h2>
<table><tr><th style="width:120px">Data</th><th>Entrada</th></tr>
${timeline
  .map(
    (t) => `<tr class="${t.done ? "done" : ""}"><td>${esc(t.label)}</td><td><span class="tag">${esc(t.tag)}</span> <b>${esc(t.title)}</b><div class="muted">${esc(t.meta)}</div>${t.extra}</td></tr>`,
  )
  .join("")}
</table>
${timeline.length ? "" : '<p class="muted">Nenhuma entrada.</p>'}
</body></html>`;
}

// ───────────────────────────── Todos os clientes ─────────────────────────────

interface ClientStats {
  processes: string[];
  events: number;
  tasks: number;
  done: number;
  pending: number;
  communications: number;
  lastEntry: string | null;
  nextEntry: string | null;
}

export async function loadAllClients(sb: SupabaseClient, orgId: string) {
  const all: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await sb.from("clients").select("*").eq("organization_id", orgId).order("name").range(offset, offset + 999);
    all.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const { data: procs } = await sb.from("processes").select("id, client_id, title, number").eq("organization_id", orgId).limit(20000);
  const { data: events } = await sb.from("events").select("id, client_id, process_id, kind, status, starts_at, ends_at").eq("organization_id", orgId).is("deleted_at", null).limit(50000);
  const { data: comms } = await sb.from("communications").select("client_id").eq("organization_id", orgId).limit(50000);
  const processClient = new Map(((procs ?? []) as Row[]).map((p) => [p.id as string, p.client_id as string | null]));
  const now = new Date().toISOString();
  return all.map((c): Row & { stats: ClientStats } => {
    const id = c.id as string;
    const ps = ((procs ?? []) as Row[]).filter((p) => p.client_id === id);
    const evs = ((events ?? []) as Row[]).filter((e) => e.client_id === id || (e.process_id && processClient.get(e.process_id as string) === id));
    const open = evs.filter((e) => e.status !== "done" && e.status !== "cancelled");
    const past = evs.filter((e) => (e.starts_at as string) < now).map((e) => e.starts_at as string).sort();
    const next = open.filter((e) => (e.starts_at as string) >= now).map((e) => e.starts_at as string).sort();
    return {
      ...c,
      stats: {
        processes: ps.map((p) => processLabel(p as { title: string | null; number: string | null })),
        events: evs.length,
        tasks: evs.filter((e) => e.kind === "task").length,
        done: evs.filter((e) => e.status === "done").length,
        pending: open.length,
        communications: ((comms ?? []) as Row[]).filter((m) => m.client_id === id).length,
        lastEntry: past.at(-1) ?? null,
        nextEntry: (next[0] as string | undefined) ?? null,
      },
    };
  });
}

export function clientsToCsv(clients: Awaited<ReturnType<typeof loadAllClients>>) {
  return toCsv(
    ["Nome", "Tipo", "Contrato", "Valor do contrato", "Condições do contrato", "CPF/CNPJ", "RG", "Nascimento", "E-mail", "Telefone", "Telefone 2", "CEP", "Endereço", "Número", "Complemento", "Bairro", "Cidade", "UF", "Etiquetas", "Observações", "Processos", "Entradas no calendário", "Tarefas", "Concluídas", "Pendentes", "Comunicações", "Última entrada", "Próxima entrada", "Arquivado", "Cadastrado em"],
    clients.map((c) => [
      c.name as string,
      c.kind === "company" ? "Pessoa jurídica" : "Pessoa física",
      c.contract_type === "fixo" ? "Fixo (mensal)" : c.contract_type === "trabalho" ? "Por trabalho" : "",
      c.contract_value != null ? String(c.contract_value).replace(".", ",") : "",
      c.contract_notes as string,
      c.document ? formatDocument(c.document as string) : "",
      c.rg as string,
      day(c.birth_date as string),
      c.email as string,
      c.phone ? formatPhone(c.phone as string) : "",
      c.secondary_phone ? formatPhone(c.secondary_phone as string) : "",
      c.address_zip as string,
      c.address_street as string,
      c.address_number as string,
      c.address_complement as string,
      c.address_district as string,
      c.address_city as string,
      c.address_state as string,
      Array.isArray(c.tags) ? (c.tags as string[]).join(", ") : "",
      c.notes as string,
      c.stats.processes.join(", "),
      c.stats.events,
      c.stats.tasks,
      c.stats.done,
      c.stats.pending,
      c.stats.communications,
      dt(c.stats.lastEntry),
      dt(c.stats.nextEntry),
      c.archived_at ? "Sim" : "Não",
      dt(c.created_at as string),
    ]),
  );
}

/** Lista de todos os clientes para imprimir ou salvar em PDF. */
export function clientsToHtml(clients: Awaited<ReturnType<typeof loadAllClients>>, headerHtml = "", autoPrint = false) {
  const rows = clients
    .map((c) => {
      const address = [[c.address_street, c.address_number].filter(Boolean).join(", "), c.address_district, [c.address_city, c.address_state].filter(Boolean).join("/")].filter(Boolean).join(" — ");
      return `<tr>
<td><b>${esc(c.name)}</b>${c.archived_at ? ' <span class="muted">(arquivado)</span>' : ""}<br><span class="muted">${esc(c.document ? formatDocument(c.document as string) : "")}</span></td>
<td>${esc([c.phone ? formatPhone(c.phone as string) : "", c.email].filter(Boolean).join(" · "))}<br><span class="muted">${esc(address)}</span></td>
<td>${esc(c.contract_type === "fixo" ? "Fixo (mensal)" : c.contract_type === "trabalho" ? "Por trabalho" : "—")}</td>
<td>${esc(c.stats.processes.join("; ") || "—")}</td>
<td style="text-align:right">${c.stats.pending}</td>
</tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Clientes</title>
<style>
  @page{size:A4 landscape;margin:1.5cm}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;margin:32px auto;max-width:1100px;padding:0 24px;font-size:12px}
  h1{font-size:20px;margin:0 0 4px} .muted{color:#6e6e73}
  table.list{width:100%;border-collapse:collapse;margin-top:14px} table.list td,table.list th{border-bottom:1px solid #eee;padding:6px;text-align:left;vertical-align:top}
  table.list th{font-size:10px;text-transform:uppercase;color:#86868b;font-weight:600}
  tr{page-break-inside:avoid}
  @media print{body{margin:0}.noprint{display:none}}
</style></head><body>
${AUTO_PRINT(autoPrint)}
${headerHtml}
<h1>Clientes</h1>
<p class="muted">${clients.length} cliente(s) · relatório gerado em ${dt(new Date().toISOString())}</p>
<table class="list"><thead><tr><th>Cliente</th><th>Contato e endereço</th><th>Contrato</th><th>Processos</th><th style="text-align:right">Pendências</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>`;
}
