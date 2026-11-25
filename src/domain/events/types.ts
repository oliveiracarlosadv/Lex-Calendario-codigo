/** Linguagem ubíqua do contexto "Agenda Jurídica". */

export const EVENT_KINDS = [
  "hearing",
  "deadline",
  "task",
  "meeting",
  "diligence",
  "consultation",
  "service",
  "reminder",
  "custom",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  hearing: "Audiência",
  deadline: "Prazo",
  task: "Tarefa",
  meeting: "Reunião",
  diligence: "Diligência",
  consultation: "Consulta",
  service: "Atendimento",
  reminder: "Lembrete",
  custom: "Evento personalizado",
};

export const DEFAULT_KIND_COLORS: Record<EventKind, string> = {
  hearing: "#D93F3F",
  deadline: "#E8833A",
  task: "#5856D6",
  meeting: "#3478F6",
  diligence: "#8E5BD9",
  consultation: "#2BA59A",
  service: "#556B2F",
  reminder: "#E5B800",
  custom: "#8E8E93",
};

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type EventPriority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<EventPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export const STATUSES = ["scheduled", "in_progress", "done", "cancelled", "postponed"] as const;
export type EventStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Agendado",
  in_progress: "Em andamento",
  done: "Concluído",
  cancelled: "Cancelado",
  postponed: "Adiado",
};

/** Antecedências de lembrete oferecidas na interface (em minutos). */
export const REMINDER_PRESETS = [
  { minutes: 30, label: "30 minutos antes" },
  { minutes: 60, label: "1 hora antes" },
  { minutes: 120, label: "2 horas antes" },
  { minutes: 1440, label: "1 dia antes" },
  { minutes: 4320, label: "3 dias antes" },
  { minutes: 10080, label: "7 dias antes" },
  { minutes: 21600, label: "15 dias antes" },
  { minutes: 43200, label: "30 dias antes" },
] as const;

export type NotificationChannel = "in_app" | "push" | "email";

export interface LegalEvent {
  id: string;
  organizationId: string;
  title: string;
  kind: EventKind;
  categoryId: string | null;
  description: unknown | null;
  descriptionText: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  recurrenceRule: string | null;
  location: string | null;
  meetingUrl: string | null;
  clientId: string | null;
  processId: string | null;
  tribunal: string | null;
  courtDivision: string | null;
  responsibleId: string | null;
  priority: EventPriority;
  status: EventStatus;
  color: string | null;
  isPrivate: boolean;
  source: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  eventId: string;
  title: string;
  isDone: boolean;
  position: number;
  doneAt: string | null;
}

export interface EventCategory {
  id: string;
  kind: EventKind;
  name: string;
  color: string;
  isVisible: boolean;
  position: number;
}

/** Marca das tarefas concluídas, antes do nome (no Lex e no Google Agenda). */
export const DONE_MARK = "✔️";
const DONE_PREFIX = /^\s*(?:✔️|✔|✅|☑️|☑)\s*/u;

export const hasDoneMark = (title: string) => DONE_PREFIX.test(title);
export const stripDoneMark = (title: string) => title.replace(DONE_PREFIX, "");

/** Nome exibido: concluída → "✔️ Nome". O nome salvo no banco fica sem a marca. */
export function displayTitle(title: string, status?: string | null): string {
  const clean = stripDoneMark(title);
  return status === "done" ? `${DONE_MARK} ${clean}` : clean;
}
