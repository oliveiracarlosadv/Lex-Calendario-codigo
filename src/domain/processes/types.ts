export const PROCESS_STATUSES = ["active", "suspended", "appeal", "archived", "closed"] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const PROCESS_STATUS_LABELS: Record<ProcessStatus, string> = {
  active: "Em andamento",
  suspended: "Suspenso",
  appeal: "Em grau de recurso",
  archived: "Arquivado",
  closed: "Encerrado",
};

export const COURT_SYSTEMS = ["pje", "esaj", "projudi", "eproc", "tucujuris", "other"] as const;
export type CourtSystem = (typeof COURT_SYSTEMS)[number];

export const COURT_SYSTEM_LABELS: Record<CourtSystem, string> = {
  pje: "PJe",
  esaj: "e-SAJ",
  projudi: "Projudi",
  eproc: "eproc",
  tucujuris: "Tucujuris",
  other: "Outro",
};

export interface LegalProcess {
  id: string;
  organizationId: string;
  number: string;
  proceduralClass: string | null;
  subject: string | null;
  tribunal: string | null;
  courtDivision: string | null;
  courtSystem: CourtSystem;
  clientId: string | null;
  responsibleId: string | null;
  status: ProcessStatus;
  lastMovementAt: string | null;
  lastMovementSummary: string | null;
  nextHearingAt: string | null;
  nextDeadlineAt: string | null;
  isMonitored: boolean;
}

export interface ProcessMovement {
  id?: string;
  processId: string;
  occurredAt: string;
  code?: number | null;
  title: string;
  description?: string | null;
  source: string;
  externalId?: string | null;
  raw?: unknown;
}

/**
 * Como o processo aparece no app: nome dado pelo advogado e número CNJ, quando houver.
 * Ex.: "Cobrança — contra Banco X · 0801234-16.2025.8.14.0301".
 */
export function processLabel(p: { title?: string | null; number?: string | null } | null | undefined, sep = " · "): string {
  if (!p) return "";
  const title = p.title?.trim();
  const number = p.number?.trim();
  if (title && number) return `${title}${sep}${number}`;
  return title || number || "Processo sem nome";
}
