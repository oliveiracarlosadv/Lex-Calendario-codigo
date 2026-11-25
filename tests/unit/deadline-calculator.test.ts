import { describe, expect, it } from "vitest";
import { computeDeadline, easterSunday, isBusinessDay, nationalHolidays, toISODate } from "@/domain/events/deadline-calculator";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe("feriados", () => {
  it("calcula a Páscoa", () => {
    expect(toISODate(easterSunday(2026))).toBe("2026-04-05");
    expect(toISODate(easterSunday(2025))).toBe("2025-04-20");
  });
  it("inclui Carnaval, Sexta-feira Santa, Corpus Christi e Consciência Negra", () => {
    const h = nationalHolidays(2026);
    expect(h.has("2026-02-16")).toBe(true);
    expect(h.has("2026-02-17")).toBe(true);
    expect(h.has("2026-04-03")).toBe(true);
    expect(h.has("2026-06-04")).toBe(true);
    expect(h.has("2026-11-20")).toBe(true);
  });
});

describe("contagem de prazos (CPC arts. 219, 220 e 224)", () => {
  it("exclui o dia do começo e conta apenas dias úteis", () => {
    // Intimação na segunda 05/10/2026 → 5 dias úteis: 06, 07, 08, 09, 13 (12/10 é feriado)
    expect(toISODate(computeDeadline(d("2026-10-05"), 5))).toBe("2026-10-13");
  });

  it("15 dias úteis atravessando feriados de novembro", () => {
    // 29/10/2026 (qui) → pula 02/11, 20/11 e fins de semana
    expect(toISODate(computeDeadline(d("2026-10-29"), 15))).toBe("2026-11-23");
  });

  it("suspende durante o recesso forense (20/12 a 20/01)", () => {
    // 17/12/2026 (qui): 18/12 conta (1), recesso até 20/01, retoma 21/01 (2)...
    expect(toISODate(computeDeadline(d("2026-12-17"), 5))).toBe("2027-01-26");
  });

  it("prorroga dias corridos que vencem em dia sem expediente", () => {
    // 10 dias corridos a partir de 01/10/2026 → 11/10 (domingo) → 13/10 (12 é feriado)
    expect(toISODate(computeDeadline(d("2026-10-01"), 10, { businessDays: false }))).toBe("2026-10-13");
  });

  it("respeita feriados locais informados", () => {
    expect(isBusinessDay(d("2026-08-14"), { extraHolidays: ["2026-08-14"] })).toBe(false);
  });
});
