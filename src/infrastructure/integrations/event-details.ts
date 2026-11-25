/**
 * Monta a descrição enviada ao Google Agenda / Outlook / iCloud com TUDO o que foi
 * preenchido no Lex Calendário, em ordem de prioridade de leitura:
 *   1. tipo, prioridade e status · 2. quando, local e link · 3. processo · 4. cliente
 *   5. responsável · 6. descrição (editor rico) · 7. checklist · 8. lembretes
 *   9. anexos · 10. comentários recentes · rodapé com data de atualização.
 * Gera HTML (subconjunto aceito pelo Google Agenda e pelo Outlook) e texto puro (CalDAV).
 */
import { EVENT_KIND_LABELS, PRIORITY_LABELS, REMINDER_PRESETS, STATUS_LABELS, type EventKind, type EventPriority, type EventStatus } from "@/domain/events/types";
import { formatDocument, formatPhone } from "@/domain/shared/document";

export interface EventDetailsInput {
  title: string;
  kind: EventKind;
  priority: EventPriority;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  location: string | null;
  meetingUrl: string | null;
  hearingMode?: "online" | "presencial" | null;
  tribunal: string | null;
  courtDivision: string | null;
  description: unknown | null; // documento TipTap/ProseMirror (JSON)
  descriptionText: string | null;
  process: {
    title?: string | null;
    number: string | null;
    proceduralClass?: string | null;
    subject?: string | null;
    tribunal?: string | null;
    courtDivision?: string | null;
    opposingParty?: string | null;
    clientRole?: string | null;
    activeParties?: string[];
    passiveParties?: string[];
  } | null;
  client: { name: string; document?: string | null; phone?: string | null; email?: string | null } | null;
  responsible: string | null;
  /** Tarefa anterior relacionada (normalmente já concluída) */
  related?: { title: string; kind: EventKind; startsAt: string; allDay: boolean; completedAt: string | null; done: boolean } | null;
  checklist: { title: string; isDone: boolean }[];
  reminders: number[];
  attachments: { name: string; sizeBytes: number }[];
  comments: { author: string; body: string; createdAt: string }[];
  appUrl?: string | null;
  updatedAt?: Date;
}

const KIND_ICON: Record<EventKind, string> = {
  hearing: "⚖️", deadline: "⏰", task: "📋", meeting: "🤝", diligence: "🚗", consultation: "💬", service: "📞", reminder: "🔔", custom: "📌",
};
const PRIORITY_ICON: Record<EventPriority, string> = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" };
const MAX_LENGTH = 7800; // margem para o limite de 8.192 caracteres do Google Agenda

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function when(input: EventDetailsInput) {
  const tz = input.timezone || "America/Sao_Paulo";
  const date = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  if (input.allDay) return `${date(input.startsAt)} (dia inteiro)`;
  const sameDay = date(input.startsAt) === date(input.endsAt);
  return sameDay
    ? `${date(input.startsAt)}, das ${time(input.startsAt)} às ${time(input.endsAt)}`
    : `${date(input.startsAt)} ${time(input.startsAt)} até ${date(input.endsAt)} ${time(input.endsAt)}`;
}

// ─────────────── Editor rico (TipTap/ProseMirror JSON) → HTML simples / texto ───────────────

interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PMNode[];
}

function inlineHtml(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "<br>";
      if (n.type !== "text") return inlineHtml(n.content);
      let t = esc(n.text ?? "");
      for (const m of n.marks ?? []) {
        if (m.type === "bold") t = `<b>${t}</b>`;
        else if (m.type === "italic") t = `<i>${t}</i>`;
        else if (m.type === "underline") t = `<u>${t}</u>`;
        else if (m.type === "strike") t = `<s>${t}</s>`;
        else if (m.type === "code") t = `<code>${t}</code>`;
        else if (m.type === "link" && typeof m.attrs?.href === "string") t = `<a href="${esc(m.attrs.href)}">${t}</a>`;
      }
      return t;
    })
    .join("");
}

function blockHtml(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "paragraph":
          return `${inlineHtml(n.content) || ""}<br>`;
        case "heading":
          return `<br><b>${inlineHtml(n.content)}</b><br>`;
        case "bulletList":
          return `<ul>${(n.content ?? []).map((li) => `<li>${blockHtml(li.content).replace(/<br>$/, "")}</li>`).join("")}</ul>`;
        case "orderedList":
          return `<ol>${(n.content ?? []).map((li) => `<li>${blockHtml(li.content).replace(/<br>$/, "")}</li>`).join("")}</ol>`;
        case "taskList":
          return (n.content ?? []).map((li) => `${li.attrs?.checked ? "✅" : "⬜"} ${blockHtml(li.content).replace(/<br>$/, "")}<br>`).join("");
        case "blockquote":
          return `<i>“${blockHtml(n.content).replace(/<br>$/, "")}”</i><br>`;
        case "codeBlock":
          return `<code>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code><br>`;
        case "horizontalRule":
          return "──────────<br>";
        case "table":
          return (n.content ?? [])
            .map((row) => (row.content ?? []).map((cell) => blockHtml(cell.content).replace(/<br>/g, " ").trim()).join(" | "))
            .join("<br>") + "<br>";
        default:
          return n.content ? blockHtml(n.content) : "";
      }
    })
    .join("");
}

export function richTextToHtml(doc: unknown): string {
  const node = doc as PMNode | null;
  if (!node || !Array.isArray(node.content)) return "";
  return blockHtml(node.content).replace(/(<br>){3,}/g, "<br><br>").replace(/^(<br>)+|(<br>)+$/g, "");
}

export function htmlToText(html: string): string {
  // Listas numeradas viram "1. ", "2. "...; as demais, marcadores
  html = html.replace(/<ol>(.*?)<\/ol>/gs, (_m, inner: string) => {
    let n = 0;
    return inner.replace(/<li>/g, () => `${++n}. `);
  });
  return html
    .replace(/<li>/g, "• ")
    .replace(/<\/li>|<br>|<\/ul>|<\/ol>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ───────────────────────────── Montagem ─────────────────────────────

export function buildEventDetails(input: EventDetailsInput): { html: string; text: string } {
  const sections: string[] = [];
  const section = (title: string, body: string) => body && sections.push(`<b>${title}</b><br>${body}`);
  const line = (label: string, value: string | null | undefined) => (value ? `${label}: ${esc(value)}<br>` : "");

  // 1. Classificação
  sections.push(
    `${KIND_ICON[input.kind]} <b>${EVENT_KIND_LABELS[input.kind].toUpperCase()}</b> · ${PRIORITY_ICON[input.priority]} Prioridade ${PRIORITY_LABELS[input.priority]} · ${STATUS_LABELS[input.status]}`,
  );

  // 2. Quando e onde
  section(
    "📅 Quando e onde",
    `${esc(when(input))}<br>${input.hearingMode ? `${input.hearingMode === "online" ? "💻 Audiência ON-LINE" : "🏛️ Audiência PRESENCIAL"}<br>` : ""}${line("📍 Local", input.location)}${input.meetingUrl ? `🔗 Link: <a href="${esc(input.meetingUrl)}">${esc(input.meetingUrl)}</a><br>` : ""}`,
  );

  // 3. Processo
  const p = input.process;
  const tribunal = input.tribunal ?? p?.tribunal ?? null;
  const division = input.courtDivision ?? p?.courtDivision ?? null;
  if (p || tribunal || division) {
    section(
      "⚖️ Processo",
      line("Nome", p?.title) +
        line("Número", p?.number) +
        line("Polo ativo", p?.activeParties?.length ? p.activeParties.join("; ") : null) +
        line("Polo passivo", p?.passiveParties?.length ? p.passiveParties.join("; ") : null) +
        line("Vara / Órgão", division) +
        line("Tribunal", tribunal) +
        line("Classe", p?.proceduralClass) +
        line("Assunto", p?.subject) +
        line("Polo do cliente", p?.clientRole),
    );
  }

  // 4. Cliente
  const c = input.client;
  if (c) {
    section(
      "👤 Cliente",
      line("Nome", c.name) + line("CPF/CNPJ", c.document ? formatDocument(c.document) : null) + line("Telefone", c.phone ? formatPhone(c.phone) : null) + line("E-mail", c.email),
    );
  }

  // 5. Responsável
  if (input.responsible) section("🧑‍⚖️ Responsável", `${esc(input.responsible)}<br>`);

  // 5-A. Tarefa relacionada
  if (input.related) {
    const r = input.related;
    const tz = input.timezone || "America/Sao_Paulo";
    const fmt = (iso: string, withTime: boolean) =>
      new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(iso));
    const status = r.done
      ? `executada em ${fmt(r.completedAt ?? r.startsAt, !!r.completedAt)}`
      : `prevista para ${fmt(r.startsAt, !r.allDay)} (ainda não concluída)`;
    section("🔗 Tarefa relacionada", `${KIND_ICON[r.kind]} ${esc(r.title)} — ${status}<br>`);
  }

  // 6. Descrição
  const desc = richTextToHtml(input.description) || (input.descriptionText ? esc(input.descriptionText).replace(/\n/g, "<br>") : "");
  if (desc) section("📝 Descrição", `${desc}<br>`);

  // 7. Checklist
  if (input.checklist.length) {
    const done = input.checklist.filter((i) => i.isDone).length;
    const pct = Math.round((done / input.checklist.length) * 100);
    section(
      `✅ Checklist (${done}/${input.checklist.length} · ${pct}%)`,
      `<ol>${input.checklist.map((i) => `<li>${i.isDone ? `✅ <s>${esc(i.title)}</s>` : `⬜ ${esc(i.title)}`}</li>`).join("")}</ol>`,
    );
  }

  // 8. Lembretes
  if (input.reminders.length) {
    const labels = [...input.reminders]
      .sort((a, b) => b - a)
      .map((m) => REMINDER_PRESETS.find((r) => r.minutes === m)?.label ?? `${m} minutos antes`);
    section("🔔 Lembretes", `${esc(labels.join(" · "))}<br>`);
  }

  // 9. Anexos
  if (input.attachments.length) {
    const kb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
    section("📎 Anexos (no Lex Calendário)", input.attachments.map((a) => `• ${esc(a.name)} (${kb(a.sizeBytes)})`).join("<br>") + "<br>");
  }

  // 10. Comentários: do mais antigo (1) para o mais novo, para ler em sequência
  if (input.comments.length) {
    const fmt = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone || "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
    const ordered = [...input.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const MAX = 30; // limite de tamanho da descrição do Google
    const shown = ordered.slice(-MAX);
    const offset = ordered.length - shown.length;
    section(
      "💬 Comentários",
      (offset ? `<i>(${offset} comentário(s) anterior(es) no Lex Calendário)</i><br><br>` : "") +
        shown
          .map((m, i) => `<b>${offset + i + 1}.</b> <i>${esc(m.author)} · ${fmt(m.createdAt)}</i><br>${esc(m.body).replace(/\n/g, "<br>")}`)
          .join("<br><br>") +
        "<br>",
    );
  }

  const updated = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone || "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(input.updatedAt ?? new Date());
  const footer = `<i>— Gerenciado pelo Lex Calendário · atualizado em ${updated}. Edite os detalhes no Lex; alterações feitas aqui na descrição são substituídas na próxima sincronização.</i>${
    input.appUrl ? `<br><a href="${esc(input.appUrl)}">Abrir no Lex Calendário</a>` : ""
  }`;

  let html = `${sections.join("<br>")}<br>${footer}`;
  if (html.length > MAX_LENGTH) {
    html = `${html.slice(0, MAX_LENGTH - footer.length - 80).replace(/<[^>]*$/, "")}<br>… (conteúdo resumido — veja tudo no Lex Calendário)<br>${footer}`;
  }
  return { html, text: htmlToText(html) };
}
