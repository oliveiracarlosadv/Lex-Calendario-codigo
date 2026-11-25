import { describe, expect, it } from "vitest";
import { computeCnjCheckDigits, formatCnjNumber, isValidCnjNumber, parseCnjNumber, tribunalAcronym } from "@/domain/processes/cnj-number";

describe("numeração única CNJ", () => {
  it("valida o dígito verificador (módulo 97)", () => {
    expect(isValidCnjNumber("0801234-16.2025.8.14.0301")).toBe(true);
    expect(isValidCnjNumber("08012341620258140301")).toBe(true);
    expect(isValidCnjNumber("0801234-17.2025.8.14.0301")).toBe(false);
  });

  it("calcula dígitos que validam o próprio número", () => {
    const parts = { sequential: "0000456", year: "2025", segment: "5", court: "08", origin: "0005" };
    const dv = computeCnjCheckDigits(parts);
    expect(dv).toBe("14");
    expect(isValidCnjNumber(`0000456-${dv}.2025.5.08.0005`)).toBe(true);
  });

  it("formata e decompõe", () => {
    expect(formatCnjNumber("10023455120244013900")).toBe("1002345-51.2024.4.01.3900");
    expect(parseCnjNumber("abc")).toBeNull();
  });

  it("identifica o tribunal", () => {
    expect(tribunalAcronym("0801234-16.2025.8.14.0301")).toBe("TJPA");
    expect(tribunalAcronym("0000456-14.2025.5.08.0005")).toBe("TRT8");
    expect(tribunalAcronym("1002345-51.2024.4.01.3900")).toBe("TRF1");
  });
});

describe("nome do processo", () => {
  it("mostra nome e número, ou o que houver", async () => {
    const { processLabel } = await import("@/domain/processes/types");
    expect(processLabel({ title: "Cobrança — Banco X", number: "0801234-16.2025.8.14.0301" })).toBe("Cobrança — Banco X · 0801234-16.2025.8.14.0301");
    expect(processLabel({ title: "Divórcio Maria", number: null })).toBe("Divórcio Maria");
    expect(processLabel({ title: null, number: "0801234-16.2025.8.14.0301" })).toBe("0801234-16.2025.8.14.0301");
  });
});
