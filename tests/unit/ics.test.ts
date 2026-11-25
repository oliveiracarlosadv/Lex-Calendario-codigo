import { describe, expect, it } from "vitest";
import { parseIcs, serializeIcs } from "@/infrastructure/integrations/ics/ics";

describe("ICS", () => {
  const events = [
    {
      uid: "abc@lexcalendario",
      title: "Audiência de instrução; sala 3, Fórum",
      description: "Levar testemunhas\nConfirmar pauta",
      location: "Fórum Cível de Belém",
      startsAt: "2026-10-22T13:00:00.000Z",
      endsAt: "2026-10-22T14:00:00.000Z",
      allDay: false,
      alarmsMinutes: [60, 1440],
    },
    { uid: "dl@lexcalendario", title: "Prazo: contestação", startsAt: "2026-10-26T03:00:00.000Z", endsAt: "2026-10-27T03:00:00.000Z", allDay: true },
  ];

  it("gera iCalendar válido com escape, alarmes e CRLF", () => {
    const ics = serializeIcs(events);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("SUMMARY:Audiência de instrução\; sala 3\\, Fórum");
    expect(ics).toContain("DTSTART:20261022T130000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261026");
    expect(ics).toContain("TRIGGER:-PT1440M");
  });

  it("faz o caminho de ida e volta", () => {
    const parsed = parseIcs(serializeIcs(events));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe(events[0].title);
    expect(parsed[0].description).toBe(events[0].description);
    expect(parsed[0].startsAt).toBe(events[0].startsAt);
    expect(parsed[1].allDay).toBe(true);
  });
});
