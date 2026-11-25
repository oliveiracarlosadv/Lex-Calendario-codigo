/**
 * Numeração única de processos (Resolução CNJ nº 65/2008).
 * Formato: NNNNNNN-DD.AAAA.J.TR.OOOO
 *   N = sequencial · D = dígito verificador (módulo 97, ISO 7064)
 *   A = ano · J = segmento do Judiciário · TR = tribunal · O = origem
 */

import { onlyDigits } from "@/domain/shared/document";

export interface CnjNumberParts {
  sequential: string;
  checkDigits: string;
  year: string;
  segment: string;
  court: string;
  origin: string;
}

const CNJ_REGEX = /^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})$/;

export function parseCnjNumber(value: string): CnjNumberParts | null {
  const digits = onlyDigits(value);
  if (digits.length !== 20) return null;
  const m = CNJ_REGEX.exec(digits);
  if (!m) return null;
  const [, sequential, checkDigits, year, segment, court, origin] = m;
  return { sequential, checkDigits, year, segment, court, origin };
}

/** Módulo 97 sobre string numérica longa, em blocos (evita overflow). */
function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
  }
  return remainder;
}

export function computeCnjCheckDigits(parts: Omit<CnjNumberParts, "checkDigits">): string {
  const base = `${parts.sequential}${parts.year}${parts.segment}${parts.court}${parts.origin}00`;
  return String(98 - mod97(base)).padStart(2, "0");
}

export function isValidCnjNumber(value: string): boolean {
  const parts = parseCnjNumber(value);
  if (!parts) return false;
  return computeCnjCheckDigits(parts) === parts.checkDigits;
}

export function formatCnjNumber(value: string): string {
  const p = parseCnjNumber(value);
  if (!p) return value;
  return `${p.sequential}-${p.checkDigits}.${p.year}.${p.segment}.${p.court}.${p.origin}`;
}

const SEGMENTS: Record<string, string> = {
  "1": "Supremo Tribunal Federal",
  "2": "Conselho Nacional de Justiça",
  "3": "Superior Tribunal de Justiça",
  "4": "Justiça Federal",
  "5": "Justiça do Trabalho",
  "6": "Justiça Eleitoral",
  "7": "Justiça Militar da União",
  "8": "Justiça Estadual",
  "9": "Justiça Militar Estadual",
};

const STATE_COURTS: Record<string, string> = {
  "01": "AC", "02": "AL", "03": "AP", "04": "AM", "05": "BA", "06": "CE", "07": "DFT", "08": "ES",
  "09": "GO", "10": "MA", "11": "MT", "12": "MS", "13": "MG", "14": "PA", "15": "PB", "16": "PR",
  "17": "PE", "18": "PI", "19": "RJ", "20": "RN", "21": "RS", "22": "RO", "23": "RR", "24": "SC",
  "25": "SE", "26": "SP", "27": "TO",
};

export function describeSegment(segment: string): string {
  return SEGMENTS[segment] ?? "Desconhecido";
}

/** Sigla do tribunal (ex.: TJPA, TRT8, TRF1) a partir do número CNJ. */
export function tribunalAcronym(value: string): string | null {
  const p = parseCnjNumber(value);
  if (!p) return null;
  const tr = Number(p.court);
  switch (p.segment) {
    case "8":
      return STATE_COURTS[p.court] ? `TJ${STATE_COURTS[p.court]}` : null;
    case "5":
      return tr === 0 ? "TST" : `TRT${tr}`;
    case "4":
      return tr === 0 ? "CJF" : `TRF${tr}`;
    case "6":
      return tr === 0 ? "TSE" : `TRE-${Object.values(STATE_COURTS)[tr - 1] ?? tr}`;
    case "3":
      return "STJ";
    case "1":
      return "STF";
    case "9":
      return ({ "13": "TJMMG", "21": "TJMRS", "26": "TJMSP" } as Record<string, string>)[p.court] ?? null;
    case "7":
      return "STM";
    default:
      return null;
  }
}
