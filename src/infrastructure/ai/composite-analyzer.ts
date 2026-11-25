import "server-only";
import { computeDeadline, toISODate } from "@/domain/events/deadline-calculator";
import { RuleBasedMovementAnalyzer } from "@/domain/monitoring/rule-based-analyzer";
import type { AnalysisContext, MovementAnalyzer, SuggestionDraft } from "@/domain/monitoring/types";
import type { ProcessMovement } from "@/domain/processes/types";
import { chat, stripFences, type ResolvedAi } from "./config";
import { SUGGESTION_JSON_SCHEMA, SYSTEM_PROMPT, SuggestionSchema, toDrafts, userPrompt } from "./prompt";

/** Modelo de linguagem escolhido em Configurações → Agente de inteligência artificial. */
class LlmMovementAnalyzer implements MovementAnalyzer {
  readonly name = "llm";
  constructor(private readonly ai: ResolvedAi) {}

  async analyze(movement: ProcessMovement, ctx: AnalysisContext): Promise<SuggestionDraft[]> {
    const content = await chat(this.ai, { system: SYSTEM_PROMPT, user: userPrompt(movement, ctx), temperature: 0, jsonSchema: SUGGESTION_JSON_SCHEMA });
    const parsed = SuggestionSchema.safeParse(JSON.parse(stripFences(content) || "{}"));
    return parsed.success ? toDrafts(parsed.data, ctx, this.ai.model) : [];
  }
}

const AMBIGUOUS = /(intim|despacho|decis|audi[eê]ncia|prazo|manifest|sess[aã]o|pauta|cite-se|vista)/i;

/**
 * Motor de IA jurídica: regras determinísticas primeiro (rápidas e auditáveis);
 * o modelo de linguagem é consultado quando as regras não encontram nada num texto relevante
 * ou quando a confiança é baixa. Se o modelo estiver indisponível, valem as regras. Os prazos sugeridos pelo modelo são recalculados
 * pelo domínio (CPC), nunca aceitos como data "pronta".
 */
export class CompositeMovementAnalyzer implements MovementAnalyzer {
  readonly name = "composite";
  private readonly rules = new RuleBasedMovementAnalyzer();
  private readonly llm: MovementAnalyzer | null;

  /** ai: IA do escritório (resolveAi); sem ela, ou com a IA desligada, valem só as regras. */
  constructor(ai?: ResolvedAi | null) {
    this.llm = ai && ai.protocol !== "none" && (ai.protocol !== "anthropic" || ai.apiKey) ? new LlmMovementAnalyzer(ai) : null;
  }

  async analyze(movement: ProcessMovement, ctx: AnalysisContext): Promise<SuggestionDraft[]> {
    const fromRules = await this.rules.analyze(movement, ctx);
    const text = `${movement.title} ${movement.description ?? ""}`;
    const needsLlm =
      this.llm && AMBIGUOUS.test(text) && (fromRules.length === 0 || fromRules.every((s) => s.confidence < 0.7));
    if (!needsLlm) return fromRules;

    try {
      const fromLlm = (await this.llm!.analyze(movement, ctx)).map((s) => {
        const days = Number(s.payload?.deadlineDays ?? 0);
        if (s.kind !== "deadline" || !days) return s;
        const due = toISODate(
          computeDeadline(new Date(movement.occurredAt), days, {
            businessDays: s.payload?.businessDays !== false,
            extraHolidays: ctx.extraHolidays,
          }),
        );
        return { ...s, startsAt: `${due}T00:00:00-03:00`, endsAt: `${due}T23:59:00-03:00` };
      });
      return fromLlm.length ? fromLlm : fromRules;
    } catch (error) {
      console.error("[ia] falha no analisador LLM; mantendo regras", error);
      return fromRules;
    }
  }
}
