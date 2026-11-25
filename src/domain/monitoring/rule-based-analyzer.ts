/**
 * Analisador determinístico de movimentações processuais.
 * Identifica audiências designadas, prazos e marcos relevantes e sugere
 * compromissos na agenda. Serve como base (offline, auditável) para o motor de IA.
 */

import { computeDeadline, toISODate } from "@/domain/events/deadline-calculator";
import type { ProcessMovement } from "@/domain/processes/types";
import type { AnalysisContext, MovementAnalyzer, SuggestionDraft } from "./types";

const BR_OFFSET = "-03:00";

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, "três": 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, quarenta_e_cinco: 45,
  sessenta: 60, noventa: 90,
};

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const pad = (n: number) => String(n).padStart(2, "0");

/** Extrai a primeira data (dd/mm/aaaa ou "dd de mês de aaaa") e horário do texto. */
export function extractDateTime(text: string): { date: string; time: string | null } | null {
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let index = -1;
  if (numeric) {
    d = Number(numeric[1]);
    m = Number(numeric[2]);
    y = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    index = numeric.index + numeric[0].length;
  } else {
    const written = /(\d{1,2})(?:º|°)?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i.exec(text);
    if (written && MONTHS[normalize(written[2])] !== undefined) {
      d = Number(written[1]);
      m = MONTHS[normalize(written[2])];
      y = Number(written[3]);
      index = written.index + written[0].length;
    }
  }
  if (!y || !m || !d || m > 12 || d > 31) return null;

  const tail = text.slice(Math.max(0, index - 5), index + 60);
  const t = /(?:às|as|a partir das)?\s*(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?/i.exec(tail);
  let time: string | null = null;
  if (t) {
    const hh = Number(t[1]);
    const mm = Number(t[2] ?? 0);
    if (hh <= 23 && mm <= 59) time = `${pad(hh)}:${pad(mm)}`;
  }
  return { date: `${y}-${pad(m)}-${pad(d)}`, time };
}

/** Extrai a quantidade de dias de prazo ("prazo de 15 (quinze) dias", "em cinco dias úteis"). */
export function extractDeadlineDays(text: string): { days: number; business: boolean } | null {
  const n = normalize(text);
  const re = /(?:prazo\s+(?:legal\s+)?de|no\s+prazo\s+de|em|dentro\s+de)\s+(\d{1,3}|[a-z]+(?:\s+e\s+[a-z]+)?)\s*(?:\([a-z\s]+\))?\s*(dias?|horas?)\s*(uteis|corridos)?/;
  const match = re.exec(n);
  if (!match) return null;
  const raw = match[1].trim();
  let days = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw.replace(/\s+/g, "_")];
  if (!days) return null;
  if (match[2].startsWith("hora")) days = Math.max(1, Math.ceil(days / 24));
  return { days, business: match[3] !== "corridos" };
}

interface ActRule {
  pattern: RegExp;
  label: string;
  defaultDays: number;
  laborDays?: number;
}

/** Atos com prazos legais típicos quando o despacho não fixa o prazo. */
const ACT_RULES: ActRule[] = [
  { pattern: /contestar|apresentar contestacao|oferecer contestacao/, label: "Contestação", defaultDays: 15 },
  { pattern: /embargos de declaracao/, label: "Embargos de declaração", defaultDays: 5 },
  { pattern: /contrarraz/, label: "Contrarrazões", defaultDays: 15, laborDays: 8 },
  { pattern: /recurso ordinario/, label: "Recurso ordinário", defaultDays: 8 },
  { pattern: /apelacao|apelar/, label: "Apelação", defaultDays: 15 },
  { pattern: /agravo de instrumento/, label: "Agravo de instrumento", defaultDays: 15 },
  { pattern: /recurso inominado/, label: "Recurso inominado", defaultDays: 10 },
  { pattern: /replica|impugnacao a contestacao|impugnar a contestacao/, label: "Réplica", defaultDays: 15 },
  { pattern: /laudo|pericia/, label: "Manifestação sobre laudo", defaultDays: 15, laborDays: 8 },
  { pattern: /cumprimento de sentenca|pagar o debito|pagamento voluntario/, label: "Pagamento voluntário (art. 523 CPC)", defaultDays: 15 },
  { pattern: /especificar provas|especificacao de provas/, label: "Especificação de provas", defaultDays: 15 },
  { pattern: /emendar a inicial|emenda a inicial/, label: "Emenda à inicial", defaultDays: 15 },
  { pattern: /manifest/, label: "Manifestação", defaultDays: 5 },
];

const HEARING_TYPES: [RegExp, string][] = [
  [/conciliacao/, "conciliação"],
  [/mediacao/, "mediação"],
  [/instrucao e julgamento/, "instrução e julgamento"],
  [/instrucao/, "instrução"],
  [/\buna\b|una /, "una"],
  [/custodia/, "custódia"],
  [/sessao de julgamento|julgamento/, "julgamento"],
  [/inicial/, "inicial"],
];

const REMINDER_MARKERS: [RegExp, string][] = [
  [/sentenca|julgo (im)?procedente|julgo extint/, "Sentença publicada — avaliar recurso"],
  [/acordao|acordaram/, "Acórdão publicado — avaliar recurso"],
  [/transit(ado|o) em julgado/, "Trânsito em julgado — iniciar cumprimento/arquivamento"],
  [/alvara/, "Alvará expedido — acompanhar levantamento"],
  [/pericia (designada|agendada)|designo pericia|nomeio perito/, "Perícia — acompanhar agendamento e quesitos"],
  [/citacao (positiva|realizada|efetivada)|citado/, "Citação efetivada — acompanhar prazo de defesa"],
  [/penhora|bloqueio (via )?(sisbajud|bacenjud)/, "Constrição patrimonial — verificar impugnação"],
];

function hearingSuggestion(text: string, norm: string, movement: ProcessMovement, ctx: AnalysisContext): SuggestionDraft | null {
  const isHearing =
    /audiencia/.test(norm) &&
    /(designad|redesignad|marcad|agendad|designo|redesigno|remarcad|pautad|inclu[ií]d[oa] em pauta)/.test(norm);
  const isSession = /(sessao de julgamento|incluido em pauta|pauta de julgamento)/.test(norm);
  if (!isHearing && !isSession) return null;
  if (/cancelad|retirad[oa] de pauta|adiad[oa] sine die/.test(norm)) return null;

  const when = extractDateTime(text);
  const type = HEARING_TYPES.find(([re]) => re.test(norm))?.[1];
  const label = isSession && !isHearing ? "Sessão de julgamento" : `Audiência${type ? ` de ${type}` : ""}`;
  const virtual = /(videoconferencia|telepresencial|virtual|teams|zoom|google meet)/.test(norm);

  const startsAt = when ? `${when.date}T${when.time ?? "09:00"}:00${BR_OFFSET}` : null;
  const endsAt = startsAt ? new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString() : null;

  return {
    kind: "hearing",
    title: `${label} — ${ctx.clientName ?? ctx.processNumber}`,
    startsAt,
    endsAt,
    rationale: `Movimentação de ${new Date(movement.occurredAt).toLocaleDateString("pt-BR")}: "${movement.title}". ${
      when ? "" : "Data não identificada no texto — confirme antes de aceitar. "
    }${virtual ? "Indícios de audiência por videoconferência." : ""}`.trim(),
    confidence: when ? (when.time ? 0.92 : 0.8) : 0.55,
    analyzer: "rules",
    payload: { hearingType: type ?? null, virtual, movementTitle: movement.title },
  };
}

function deadlineSuggestion(norm: string, movement: ProcessMovement, ctx: AnalysisContext): SuggestionDraft | null {
  const isIntimation = /(intime-se|intimem-se|intimacao|intimad[oa]|cite-se|citacao|publicad[oa]|vista as partes|abra-se vista|concedo o prazo|no prazo de)/.test(norm);
  if (!isIntimation) return null;

  const explicit = extractDeadlineDays(norm);
  const act = ACT_RULES.find((r) => r.pattern.test(norm));
  if (!explicit && !act) return null;

  const isLabor = ctx.jurisdiction === "labor";
  const days = explicit?.days ?? (isLabor && act?.laborDays ? act.laborDays : act!.defaultDays);
  const business = explicit?.business ?? true;

  const start = new Date(movement.occurredAt);
  const due = computeDeadline(start, days, { businessDays: business, extraHolidays: ctx.extraHolidays });
  const dueISO = toISODate(due);

  return {
    kind: "deadline",
    title: `Prazo: ${act?.label ?? "Manifestação"} (${days} dias${business ? " úteis" : ""}) — ${ctx.clientName ?? ctx.processNumber}`,
    startsAt: `${dueISO}T00:00:00${BR_OFFSET}`,
    endsAt: `${dueISO}T23:59:00${BR_OFFSET}`,
    rationale:
      `Termo inicial considerado: ${start.toLocaleDateString("pt-BR")} (data da movimentação). ` +
      `Contagem conforme CPC arts. 219, 220 e 224${explicit ? "" : `; prazo legal presumido para ${act!.label.toLowerCase()}`}. ` +
      "Confira a data efetiva da intimação/ciência no sistema do tribunal.",
    confidence: explicit ? 0.85 : 0.6,
    analyzer: "rules",
    payload: { days, business, act: act?.label ?? null, termStart: toISODate(start) },
  };
}

function reminderSuggestions(norm: string, movement: ProcessMovement, ctx: AnalysisContext): SuggestionDraft[] {
  const at = new Date(new Date(movement.occurredAt).getTime() + 24 * 3600 * 1000);
  at.setHours(9, 0, 0, 0);
  return REMINDER_MARKERS.filter(([re]) => re.test(norm)).map(([, label]) => ({
    kind: "reminder" as const,
    title: `${label} — ${ctx.clientName ?? ctx.processNumber}`,
    startsAt: at.toISOString(),
    endsAt: new Date(at.getTime() + 30 * 60 * 1000).toISOString(),
    rationale: `Marco processual identificado: "${movement.title}".`,
    confidence: 0.7,
    analyzer: "rules" as const,
    payload: { movementTitle: movement.title },
  }));
}

export class RuleBasedMovementAnalyzer implements MovementAnalyzer {
  readonly name = "rules";

  async analyze(movement: ProcessMovement, ctx: AnalysisContext): Promise<SuggestionDraft[]> {
    const text = `${movement.title}. ${movement.description ?? ""}`;
    const norm = normalize(text);
    const out: SuggestionDraft[] = [];

    const hearing = hearingSuggestion(text, norm, movement, ctx);
    if (hearing) out.push(hearing);

    // Um despacho que designa audiência raramente fixa também prazo; evita duplicidade.
    const deadline = hearing ? null : deadlineSuggestion(norm, movement, ctx);
    if (deadline) out.push(deadline);

    if (!hearing && !deadline) out.push(...reminderSuggestions(norm, movement, ctx));
    return out;
  }
}
