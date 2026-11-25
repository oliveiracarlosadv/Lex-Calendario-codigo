/**
 * Value objects para documentos brasileiros (CPF e CNPJ).
 * Validação pelos dígitos verificadores oficiais da Receita Federal.
 */

export const onlyDigits = (value: string | null | undefined): string => (value ?? "").replace(/\D/g, "");

const allSameDigits = (digits: string) => /^(\d)\1+$/.test(digits);

export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || allSameDigits(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || allSameDigits(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

export type DocumentKind = "cpf" | "cnpj";

export function detectDocument(value: string): DocumentKind | null {
  const digits = onlyDigits(value);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

export function isValidDocument(value: string): boolean {
  const kind = detectDocument(value);
  if (kind === "cpf") return isValidCPF(value);
  if (kind === "cnpj") return isValidCNPJ(value);
  return false;
}

export function formatDocument(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value ?? "";
}

export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value ?? "";
}

export function formatCEP(value: string | null | undefined): string {
  const d = onlyDigits(value);
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, "$1-$2") : (value ?? "");
}
