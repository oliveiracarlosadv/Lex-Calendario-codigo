import { describe, expect, it } from "vitest";
import { fillTemplate, formatDeadline, mailtoLink, textToEmailHtml, unfilledPlaceholders, whatsappLink } from "@/domain/communications/types";

describe("modelos de comunicação", () => {
  it("preenche variáveis e marca as que faltam", () => {
    const text = fillTemplate("Prezado(a) {{cliente}}, processo {{ processo }} — prazo {{prazo}}.", { cliente: "Ana", processo: "0801234-16.2025.8.14.0301", prazo: "" });
    expect(text).toBe("Prezado(a) Ana, processo 0801234-16.2025.8.14.0301 — prazo [prazo].");
    expect(unfilledPlaceholders(text)).toEqual(["prazo"]);
  });

  it("formata prazo, WhatsApp e mailto", () => {
    expect(formatDeadline("2026-12-01")).toBe("01/12/2026");
    expect(whatsappLink("(91) 99999-8888", "Olá!")).toBe("https://wa.me/5591999998888?text=Ol%C3%A1!");
    expect(mailtoLink("a@b.com", "Assunto", "Corpo")).toBe("mailto:a%40b.com?subject=Assunto&body=Corpo");
  });

  it("converte texto em HTML de e-mail escapando caracteres", () => {
    const html = textToEmailHtml("Linha 1\nLinha <2>\n\nParágrafo");
    expect(html).toContain("Linha 1<br>Linha &lt;2&gt;");
    expect(html.match(/<p /g)).toHaveLength(2);
  });
});
