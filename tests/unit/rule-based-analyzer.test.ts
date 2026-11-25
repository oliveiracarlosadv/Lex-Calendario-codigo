import { describe, expect, it } from "vitest";
import { extractDateTime, extractDeadlineDays, RuleBasedMovementAnalyzer } from "@/domain/monitoring/rule-based-analyzer";

const analyzer = new RuleBasedMovementAnalyzer();
const ctx = { processNumber: "0801234-16.2025.8.14.0301", clientName: "Marcos", jurisdiction: "civil" as const };
const mv = (title: string, description = "", occurredAt = "2026-10-05T15:00:00-03:00") => ({ processId: "p", occurredAt, title, description, source: "test" });

describe("extração de datas e prazos", () => {
  it("lê datas numéricas e por extenso com horário", () => {
    expect(extractDateTime("designada para 22/10/2026 às 10h00")).toEqual({ date: "2026-10-22", time: "10:00" });
    expect(extractDateTime("no dia 3 de novembro de 2026, às 14:30")).toEqual({ date: "2026-11-03", time: "14:30" });
  });
  it("lê prazos em algarismos e por extenso", () => {
    expect(extractDeadlineDays("no prazo de 15 (quinze) dias")).toEqual({ days: 15, business: true });
    expect(extractDeadlineDays("Intime-se para manifestação em cinco dias")).toEqual({ days: 5, business: true });
    expect(extractDeadlineDays("prazo de 10 dias corridos")).toEqual({ days: 10, business: false });
  });
});

describe("analisador por regras", () => {
  it("sugere audiência designada com data e hora", async () => {
    const [s] = await analyzer.analyze(mv("Audiência de conciliação designada", "Designo audiência de conciliação para 22/10/2026 às 10h00, por videoconferência."), ctx);
    expect(s.kind).toBe("hearing");
    expect(s.startsAt).toBe("2026-10-22T10:00:00-03:00");
    expect(s.title).toContain("conciliação");
    expect(s.payload?.virtual).toBe(true);
  });

  it("sugere prazo expresso contado em dias úteis", async () => {
    const [s] = await analyzer.analyze(mv("Intimação", "Intime-se a parte autora para, no prazo de 5 (cinco) dias, manifestar-se sobre a contestação."), ctx);
    expect(s.kind).toBe("deadline");
    expect(s.startsAt?.slice(0, 10)).toBe("2026-10-13");
  });

  it("usa prazo legal presumido quando o despacho não fixa", async () => {
    const [s] = await analyzer.analyze(mv("Intimação", "Intimem-se as partes para apresentar contrarrazões ao recurso de apelação."), ctx);
    expect(s.kind).toBe("deadline");
    expect(s.payload?.days).toBe(15);
  });

  it("aplica prazo trabalhista de 8 dias para contrarrazões", async () => {
    const [s] = await analyzer.analyze(mv("Intimação", "Intime-se a reclamada para contrarrazões."), { ...ctx, jurisdiction: "labor" });
    expect(s.payload?.days).toBe(8);
  });

  it("gera lembrete para sentença e ignora atos ordinatórios", async () => {
    const [s] = await analyzer.analyze(mv("Julgado procedente o pedido", "Sentença: julgo procedente o pedido."), ctx);
    expect(s.kind).toBe("reminder");
    expect(await analyzer.analyze(mv("Conclusos para despacho"), ctx)).toEqual([]);
  });

  it("não sugere audiência cancelada", async () => {
    expect(await analyzer.analyze(mv("Audiência cancelada", "Audiência designada para 22/10/2026 foi cancelada."), ctx)).toEqual([]);
  });
});
