import { DomainError, err, ok, type Result } from "@/domain/shared/result";
import type { ChecklistItem, EventKind, EventPriority, EventStatus, LegalEvent } from "./types";

/** Percentual de conclusão do checklist (0–100, inteiro). */
export function checklistProgress(items: Pick<ChecklistItem, "isDone">[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.isDone).length;
  return Math.round((done / items.length) * 100);
}

export function isOverdue(
  event: Pick<LegalEvent, "endsAt" | "status" | "kind"> & { source?: string },
  now: Date = new Date(),
): boolean {
  if (event.status === "done" || event.status === "cancelled") return false;
  // Eventos importados de outras agendas não têm controle de conclusão no Lex
  if (event.source && !["lex", "ai"].includes(event.source)) return false;
  if (!["deadline", "task", "diligence", "reminder"].includes(event.kind)) return false;
  return new Date(event.endsAt).getTime() < now.getTime();
}

export function isCritical(event: Pick<LegalEvent, "priority" | "kind" | "startsAt" | "status">, now = new Date()) {
  if (event.status === "done" || event.status === "cancelled") return false;
  if (event.priority === "critical") return true;
  const hoursUntil = (new Date(event.startsAt).getTime() - now.getTime()) / 36e5;
  return event.kind === "deadline" && hoursUntil >= -24 && hoursUntil <= 48;
}

export interface EventDraft {
  title: string;
  kind: EventKind;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  priority?: EventPriority;
  status?: EventStatus;
}

export function validateEventDraft(draft: EventDraft): Result<EventDraft> {
  if (!draft.title.trim()) return err(new DomainError("Informe um título para o compromisso.", "title_required"));
  if (Number.isNaN(draft.startsAt.getTime()) || Number.isNaN(draft.endsAt.getTime()))
    return err(new DomainError("Data ou horário inválido.", "invalid_date"));
  if (draft.endsAt < draft.startsAt)
    return err(new DomainError("O término deve ser posterior ao início.", "invalid_range"));
  return ok({ ...draft, title: draft.title.trim() });
}

/** Prioridade sugerida conforme o tipo e a proximidade. */
export function suggestPriority(kind: EventKind, startsAt: Date, now = new Date()): EventPriority {
  const days = (startsAt.getTime() - now.getTime()) / 864e5;
  if (kind === "deadline") return days <= 2 ? "critical" : days <= 7 ? "high" : "medium";
  if (kind === "hearing") return days <= 3 ? "critical" : "high";
  return "medium";
}

/** Lembretes padrão por tipo (minutos de antecedência). */
export function defaultRemindersFor(kind: EventKind): number[] {
  switch (kind) {
    case "deadline":
      return [10080, 4320, 1440];
    case "hearing":
      return [10080, 1440, 120];
    case "diligence":
      return [1440, 60];
    case "task":
      return [1440, 120];
    default:
      return [60];
  }
}
