import { describe, expect, it } from "vitest";
import { formatDocument, isValidCNPJ, isValidCPF, isValidDocument } from "@/domain/shared/document";
import { looksLikeCompany } from "@/domain/clients/types";

describe("CPF", () => {
  it("aceita CPFs válidos", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("11144477735")).toBe(true);
  });
  it("rejeita dígitos verificadores errados e sequências repetidas", () => {
    expect(isValidCPF("529.982.247-24")).toBe(false);
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCPF("123")).toBe(false);
  });
});

describe("CNPJ", () => {
  it("aceita CNPJ válido", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
  });
  it("rejeita CNPJ inválido", () => {
    expect(isValidCNPJ("11.222.333/0001-82")).toBe(false);
    expect(isValidCNPJ("00000000000000")).toBe(false);
  });
});

describe("formatação", () => {
  it("formata CPF e CNPJ", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
  });
  it("detecta o tipo automaticamente", () => {
    expect(isValidDocument("52998224725")).toBe(true);
    expect(isValidDocument("11222333000181")).toBe(true);
  });
});

describe("pessoa física ou jurídica pelo nome", () => {
  it("reconhece empresas e entes públicos", () => {
    expect(looksLikeCompany("Banco Fictício S.A.")).toBe(true);
    expect(looksLikeCompany("Construtora Rio Guamá Ltda.")).toBe(true);
    expect(looksLikeCompany("Instituto Nacional do Seguro Social - INSS")).toBe(true);
  });
  it("não confunde nomes de pessoas com acentos", () => {
    expect(looksLikeCompany("Ana Beatriz Ferreira (fictícia)")).toBe(false);
    expect(looksLikeCompany("Patrícia Lúcia Garcia")).toBe(false);
    expect(looksLikeCompany("João Estadão Silva")).toBe(false);
  });
});

import { splitParties } from "@/domain/processes/parties";

describe("polo ativo e passivo", () => {
  it("usa as partes publicadas no Diário", () => {
    expect(splitParties({ parties: [{ nome: "A", polo: "A" }, { nome: "B", polo: "P" }] })).toEqual({ active: ["A"], passive: ["B"] });
  });
  it("deduz pelo polo do cliente quando não há publicação", () => {
    expect(splitParties({ clientName: "Cliente", clientRole: "Réu", opposingParty: "Autor X" })).toEqual({ active: ["Autor X"], passive: ["Cliente"] });
    expect(splitParties({ clientName: "Cliente", clientRole: "Reclamante", opposingParty: "Empresa Y" })).toEqual({ active: ["Cliente"], passive: ["Empresa Y"] });
  });
});
