import { describe, expect, it } from "vitest";
import { can } from "@/domain/identity/permissions";
import { checklistProgress, isOverdue, validateEventDraft } from "@/domain/events/rules";

describe("permissões", () => {
  it("restringe gestão de equipe ao administrador", () => {
    expect(can("admin", "team:manage")).toBe(true);
    expect(can("partner", "team:manage")).toBe(false);
  });
  it("secretária agenda mas não exclui", () => {
    expect(can("secretary", "events:create")).toBe(true);
    expect(can("secretary", "events:delete_own")).toBe(false);
  });
  it("sem papel, nada é permitido", () => {
    expect(can(null, "events:create")).toBe(false);
  });
});

describe("regras de eventos", () => {
  it("calcula progresso do checklist", () => {
    expect(checklistProgress([])).toBe(0);
    expect(checklistProgress([{ isDone: true }, { isDone: false }, { isDone: true }])).toBe(67);
  });
  it("prazo vencido e aberto está atrasado; audiência passada não", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(isOverdue({ endsAt: "2026-10-09T23:59:00Z", status: "scheduled", kind: "deadline" }, now)).toBe(true);
    expect(isOverdue({ endsAt: "2026-10-09T23:59:00Z", status: "done", kind: "deadline" }, now)).toBe(false);
    expect(isOverdue({ endsAt: "2026-10-09T23:59:00Z", status: "scheduled", kind: "hearing" }, now)).toBe(false);
    // importado do Google: sem controle de conclusão no Lex
    expect(isOverdue({ endsAt: "2026-10-09T23:59:00Z", status: "scheduled", kind: "deadline", source: "google" }, now)).toBe(false);
  });
  it("valida título e intervalo", () => {
    const start = new Date("2026-10-10T10:00:00Z");
    expect(validateEventDraft({ title: " ", kind: "meeting", startsAt: start, endsAt: start, allDay: false }).ok).toBe(false);
    expect(validateEventDraft({ title: "Reunião", kind: "meeting", startsAt: start, endsAt: new Date(start.getTime() - 1), allDay: false }).ok).toBe(false);
    expect(validateEventDraft({ title: "Reunião", kind: "meeting", startsAt: start, endsAt: start, allDay: false }).ok).toBe(true);
  });
});
