export type ClientKind = "individual" | "company";

export interface Client {
  id: string;
  organizationId: string;
  kind: ClientKind;
  name: string;
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  addressZip: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
}

export function formatAddress(c: Partial<Client>): string {
  const line1 = [c.addressStreet, c.addressNumber].filter(Boolean).join(", ");
  const line2 = [c.addressComplement, c.addressDistrict].filter(Boolean).join(" · ");
  const city = [c.addressCity, c.addressState].filter(Boolean).join("/");
  return [line1, line2, city, c.addressZip].filter(Boolean).join(" — ");
}

export const BR_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/**
 * Heurística: nomes com termos empresariais ou de entes públicos indicam pessoa jurídica.
 * Fronteiras de palavra cientes de acentos (\b do JavaScript trata "í" como separador).
 */
const COMPANY_TERMS =
  /(?<![\p{L}\p{N}])(ltda|s\/?a|eireli|epp|cia|companhia|banco|instituto|associa[cç][aã]o|cooperativa|condom[ií]nio|munic[ií]pio|estado|uni[aã]o|inss|fazenda|empresa|com[eé]rcio|ind[uú]stria|servi[cç]os|construtora|editora)(?![\p{L}\p{N}])/iu;

export function looksLikeCompany(name: string): boolean {
  return COMPANY_TERMS.test(name);
}
