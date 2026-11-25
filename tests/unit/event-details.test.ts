import { describe, expect, it } from "vitest";
import { buildEventDetails, richTextToHtml } from "@/infrastructure/integrations/event-details";

const base = {
  title: "Audiência de instrução",
  kind: "hearing" as const,
  priority: "critical" as const,
  status: "scheduled" as const,
  startsAt: "2026-10-22T13:00:00.000Z",
  endsAt: "2026-10-22T14:30:00.000Z",
  allDay: false,
  timezone: "America/Sao_Paulo",
  location: "Fórum Cível de Belém — Sala 3",
  meetingUrl: "https://teams.microsoft.com/l/abc",
  tribunal: null,
  courtDivision: null,
  description: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Estratégia" }] },
      { type: "paragraph", content: [{ type: "text", text: "Ouvir a testemunha ", marks: [] }, { type: "text", text: "Maria", marks: [{ type: "bold" }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Levar <documentos>" }] }] }] },
    ],
  },
  descriptionText: null,
  process: {
    number: "0801234-16.2025.8.14.0301",
    proceduralClass: "Procedimento Comum Cível",
    tribunal: "TJPA",
    courtDivision: "5ª Vara Cível",
    opposingParty: "Banco Exemplo S.A.",
    activeParties: ["Marcos Albuquerque"],
    passiveParties: ["Banco Exemplo S.A."],
  },
  client: { name: "Marcos Albuquerque", phone: "91987654321", email: "marcos@email.com", document: "52998224725" },
  responsible: "Dra. Helena Duarte",
  checklist: [
    { title: "Confirmar presença do cliente", isDone: true },
    { title: "Preparar minuta de acordo", isDone: false },
  ],
  reminders: [60, 1440],
  attachments: [{ name: "procuracao.pdf", sizeBytes: 250_000 }],
  comments: [{ author: "Ana", body: "Cliente confirmou presença.", createdAt: "2026-10-20T15:00:00.000Z" }],
  appUrl: "http://127.0.0.1:47830/eventos/1",
  updatedAt: new Date("2026-10-21T12:00:00.000Z"),
};

describe("descrição para o Google Agenda", () => {
  it("organiza tudo por prioridade de leitura", () => {
    const { html, text } = buildEventDetails(base);
    const order = ["AUDIÊNCIA", "Quando e onde", "Processo", "Cliente", "Responsável", "Descrição", "Checklist", "Lembretes", "Anexos", "Comentários"].map((t) => text.indexOf(t));
    expect(order.every((pos) => pos >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("🔴 Prioridade Crítica");
    expect(text).toContain("0801234-16.2025.8.14.0301");
    expect(text).toContain("Polo ativo: Marcos Albuquerque");
    expect(text).toContain("Polo passivo: Banco Exemplo S.A.");
    expect(text).toContain("Vara / Órgão: 5ª Vara Cível");
    expect(text).toContain("Tribunal: TJPA");
    expect(text).toContain("(91) 98765-4321");
    expect(text).toContain("Checklist (1/2 · 50%)");
    expect(html).toContain("<ol><li>✅ <s>Confirmar presença do cliente</s></li><li>⬜ Preparar minuta de acordo</li></ol>");
    expect(text).toContain("1. ✅ Confirmar presença do cliente");
    expect(text).toContain("2. ⬜ Preparar minuta de acordo");
    expect(text).toContain("1 dia antes · 1 hora antes");
    expect(html).toContain('<a href="https://teams.microsoft.com/l/abc">');
  });

  it("converte o editor rico e escapa HTML", () => {
    const html = richTextToHtml(base.description);
    expect(html).toContain("<b>Estratégia</b>");
    expect(html).toContain("<b>Maria</b>");
    expect(html).toContain("<li>Levar &lt;documentos&gt;</li>");
  });

  it("respeita o limite de tamanho do Google", () => {
    const long = { ...base, comments: Array.from({ length: 5 }, () => ({ author: "Ana", body: "x".repeat(3000), createdAt: base.updatedAt.toISOString() })) };
    const { html } = buildEventDetails(long);
    expect(html.length).toBeLessThanOrEqual(8192);
    expect(html).toContain("Gerenciado pelo Lex Calendário");
  });
});

describe("tarefa relacionada na descrição do Google", () => {
  it("informa a tarefa concluída e a data de execução", () => {
    const { html } = buildEventDetails({
      title: "Acompanhar despacho",
      kind: "task",
      priority: "medium",
      status: "scheduled",
      startsAt: "2026-10-20T13:00:00.000Z",
      endsAt: "2026-10-20T14:00:00.000Z",
      allDay: false,
      timezone: "America/Sao_Paulo",
      location: null,
      meetingUrl: null,
      tribunal: null,
      courtDivision: null,
      description: null,
      descriptionText: null,
      process: null,
      client: null,
      responsible: null,
      related: { title: "Protocolar petição", kind: "task", startsAt: "2026-10-05T12:00:00.000Z", allDay: false, completedAt: "2026-10-06T18:30:00.000Z", done: true },
      checklist: [],
      reminders: [],
      attachments: [],
      comments: [],
    });
    expect(html).toContain("Tarefa relacionada");
    expect(html).toContain("Protocolar petição — executada em 06/10/2026");
  });
});

describe("marca de tarefa concluída", () => {
  it("coloca ✔️ antes do nome só quando concluída e não duplica", async () => {
    const { displayTitle, stripDoneMark, hasDoneMark } = await import("@/domain/events/types");
    expect(displayTitle("Protocolar petição", "done")).toBe("✔️ Protocolar petição");
    expect(displayTitle("✔️ Protocolar petição", "done")).toBe("✔️ Protocolar petição");
    expect(displayTitle("✔️ Protocolar petição", "scheduled")).toBe("Protocolar petição");
    expect(hasDoneMark("✅ Reunião")).toBe(true);
    expect(stripDoneMark("✔ Reunião")).toBe("Reunião");
  });
});

describe("comentários na descrição do Google", () => {
  it("ficam numerados do mais antigo para o mais novo", () => {
    const { html } = buildEventDetails({
      ...base,
      comments: [
        { author: "Bia", body: "Segundo", createdAt: "2026-10-21T10:00:00.000Z" },
        { author: "Ana", body: "Primeiro", createdAt: "2026-10-20T10:00:00.000Z" },
      ],
    });
    expect(html.indexOf("Primeiro")).toBeLessThan(html.indexOf("Segundo"));
    expect(html).toContain("<b>1.</b> <i>Ana");
    expect(html).toContain("<b>2.</b> <i>Bia");
  });
});
