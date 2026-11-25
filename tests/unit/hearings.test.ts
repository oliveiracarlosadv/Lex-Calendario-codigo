import { describe, expect, it } from "vitest";
import { daysUntil } from "@/components/dashboard/upcoming-hearings";

describe("contagem de dias para a audiência", () => {
  const now = new Date("2026-10-08T15:00:00-03:00");
  it("conta dias de calendário no fuso de Brasília", () => {
    expect(daysUntil("2026-10-08T23:30:00-03:00", now)).toBe(0);
    expect(daysUntil("2026-10-09T08:00:00-03:00", now)).toBe(1);
    expect(daysUntil("2026-10-15T09:00:00-03:00", now)).toBe(7);
  });
});
