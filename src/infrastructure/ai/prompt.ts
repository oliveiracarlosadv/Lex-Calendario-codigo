import { z } from "zod";
import type { ProcessMovement } from "@/domain/processes/types";
import type { AnalysisContext, SuggestionDraft } from "@/domain/monitoring/types";

/** Contrato de saída comum a todos os modelos (open source ou comerciais). */
export const SuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      kind: z.enum(["hearing", "deadline", "reminder"]),
      title: z.string(),
      date: z.string().describe("Data no formato AAAA-MM-DD, ou string vazia se não houver"),
      time: z.string().describe("Horário HH:MM (24h), ou string vazia"),
      deadline_days: z.number().int().describe("Quantidade de dias do prazo, 0 se não se aplicar"),
      business_days: z.boolean(),
      rationale: z.string(),
      confidence: z.number(),
    }),
  ),
});
export type SuggestionOutput = z.infer<typeof SuggestionSchema>;

/** JSON Schema equivalente (para Ollama "format" e endpoints compatíveis). */
export const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["hearing", "deadline", "reminder"] },
          title: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          deadline_days: { type: "integer" },
          business_days: { type: "boolean" },
          rationale: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["kind", "title", "date", "time", "deadline_days", "business_days", "rationale", "confidence"],
      },
    },
  },
  required: ["suggestions"],
} as const;

export const SYSTEM_PROMPT = `Você é um assistente de controladoria jurídica brasileira. Analise UMA movimentação processual e
identifique somente compromissos que o advogado precisa agendar:
- "hearing": audiência ou sessão de julgamento designada/redesignada (extraia data e hora);
- "deadline": prazo para a parte (informe deadline_days e se conta em dias úteis — CPC art. 219; CLT art. 775);
- "reminder": marco que exige acompanhamento (sentença, acórdão, trânsito em julgado, alvará, perícia).
Não invente datas: se o texto não trouxer a data, deixe "date" vazio. Não sugira nada para atos meramente
ordinatórios sem efeito para a parte (ex.: "conclusos para despacho", "juntada de petição").
Títulos curtos em português, no formato "Audiência de instrução", "Prazo: contestação", "Avaliar recurso".
Responda apenas com JSON no formato {"suggestions": [...]}; lista vazia se nada for necessário.`;

export function userPrompt(movement: ProcessMovement, ctx: AnalysisContext) {
  return (
    `Processo: ${ctx.processNumber} (${ctx.tribunal ?? "tribunal não informado"}; ramo: ${ctx.jurisdiction ?? "não informado"})\n` +
    `Data da movimentação: ${movement.occurredAt}\n` +
    `Movimentação: ${movement.title}\n` +
    `Complemento: ${movement.description ?? "(sem complemento)"}`
  );
}

export function toDrafts(output: SuggestionOutput, ctx: AnalysisContext, model: string): SuggestionDraft[] {
  return output.suggestions.map((s) => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : "";
    const validTime = /^\d{2}:\d{2}$/.test(s.time) ? s.time : "";
    const startsAt = validDate ? `${validDate}T${validTime || (s.kind === "deadline" ? "00:00" : "09:00")}:00-03:00` : null;
    const endsAt = startsAt
      ? s.kind === "deadline"
        ? `${validDate}T23:59:00-03:00`
        : new Date(new Date(startsAt).getTime() + 3600_000).toISOString()
      : null;
    return {
      kind: s.kind,
      title: `${s.title} — ${ctx.clientName ?? ctx.processNumber}`,
      startsAt,
      endsAt,
      rationale: s.rationale,
      confidence: Math.max(0, Math.min(1, s.confidence)),
      analyzer: "llm" as const,
      payload: { deadlineDays: s.deadline_days || null, businessDays: s.business_days, model },
    };
  });
}
