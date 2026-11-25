import type { ProcessMovement } from "@/domain/processes/types";

export type SuggestionKind = "hearing" | "deadline" | "reminder";

export interface SuggestionDraft {
  kind: SuggestionKind;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  rationale: string;
  confidence: number;
  analyzer: "rules" | "llm";
  payload?: Record<string, unknown>;
}

export interface AnalysisContext {
  processNumber: string;
  tribunal?: string | null;
  /** Segmento: "trabalhista" usa prazos de 8 dias para recursos (CLT). */
  jurisdiction?: "civil" | "labor" | "criminal" | "federal_small_claims" | "other";
  clientName?: string | null;
  extraHolidays?: string[];
}

/** Porta (DDD): analisadores de movimentação — regras, LLM, ou combinação. */
export interface MovementAnalyzer {
  readonly name: string;
  analyze(movement: ProcessMovement, ctx: AnalysisContext): Promise<SuggestionDraft[]>;
}

export interface FetchedProcess {
  number: string;
  proceduralClass?: string | null;
  subject?: string | null;
  courtDivision?: string | null;
  tribunal?: string | null;
  judge?: string | null;
  status?: string | null;
  parties?: { name: string; role: string }[];
  hearings?: { at: string; kind: string }[];
  movements: Omit<ProcessMovement, "processId">[];
}

/** Porta (DDD): conectores com sistemas processuais (PJe, e-SAJ, Projudi, eproc, DataJud, TJPA...). */
export interface TribunalConnector {
  readonly id: string;
  readonly label: string;
  supports(processNumber: string, tribunal?: string | null): boolean;
  fetch(processNumber: string): Promise<FetchedProcess | null>;
}
