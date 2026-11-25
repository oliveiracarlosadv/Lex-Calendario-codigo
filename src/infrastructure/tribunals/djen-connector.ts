import "server-only";

/**
 * Diário de Justiça Eletrônico Nacional (DJEN) — Plataforma de Comunicações Processuais do CNJ.
 * API pública: https://comunicaapi.pje.jus.br/api/v1/comunicacao
 * Consulta as intimações publicadas para um número de OAB, em todos os tribunais.
 */
const API = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";

export interface DjenLawyer {
  nome: string;
  numero_oab: string;
  uf_oab: string;
}

export interface DjenItem {
  id: number;
  hash?: string;
  numero_processo: string;
  numeroprocessocommascara?: string;
  siglaTribunal?: string;
  nomeOrgao?: string;
  nomeClasse?: string;
  tipoComunicacao?: string;
  tipoDocumento?: string;
  data_disponibilizacao?: string; // AAAA-MM-DD
  texto?: string;
  link?: string;
  meiocompleto?: string;
  ativo?: boolean;
  destinatarios?: { nome: string; polo?: string }[];
  destinatarioadvogados?: { advogado?: DjenLawyer }[];
}

export interface DjenQuery {
  oab?: string;
  uf?: string;
  /** nome completo do advogado */
  lawyerName?: string;
  /** nome completo da parte */
  partyName?: string;
  processNumber?: string;
  /** trecho exato no texto da publicação (CPF, CNPJ, número de documento, auto de infração, CDA…) */
  text?: string;
  from: string;
  to: string;
  maxPages?: number;
}

/** Consulta o DJEN por OAB, nome do advogado, nome da parte, número do processo ou trecho do texto. */
export async function searchDjen(q: DjenQuery): Promise<DjenItem[]> {
  const all: DjenItem[] = [];
  for (let page = 1; page <= (q.maxPages ?? 30); page++) {
    const qs = new URLSearchParams({
      dataDisponibilizacaoInicio: q.from,
      dataDisponibilizacaoFim: q.to,
      itensPorPagina: "100",
      pagina: String(page),
    });
    if (q.oab) qs.set("numeroOab", q.oab.replace(/\D/g, ""));
    if (q.uf) qs.set("ufOab", q.uf.toUpperCase());
    if (q.lawyerName) qs.set("nomeAdvogado", q.lawyerName.trim());
    if (q.partyName) qs.set("nomeParte", q.partyName.trim());
    if (q.processNumber) qs.set("numeroProcesso", q.processNumber.replace(/\D/g, ""));
    if (q.text) qs.set("texto", q.text.trim());
    // O serviço do CNJ oscila: tenta de novo em caso de limite (429) ou instabilidade (5xx)
    let res: Response | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      res = await fetch(`${API}?${qs}`, {
        headers: { Accept: "application/json", "User-Agent": "LexCalendario/1.0" },
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      }).catch(() => null);
      if (res && res.ok) break;
      if (res && res.status < 500 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, attempt * 3_000));
    }
    if (!res) throw new Error("DJEN indisponível no momento (sem resposta)");
    if (!res.ok) throw new Error(`DJEN indisponível no momento (HTTP ${res.status}); nova tentativa automática mais tarde`);
    const json = (await res.json()) as { count?: number; items?: DjenItem[] };
    const items = json.items ?? [];
    all.push(...items);
    if (items.length < 100 || all.length >= (json.count ?? 0)) break;
  }
  return all;
}

export function fetchDjenByOab(params: { oab: string; uf: string; from: string; to: string }): Promise<DjenItem[]> {
  return searchDjen(params);
}

/** Confere se a comunicação é destinada ao advogado desta OAB (a busca do DJEN pode trazer outros). */
export function isAddressedTo(item: DjenItem, oab: string, uf: string) {
  const number = oab.replace(/\D/g, "").replace(/^0+/, "");
  return (item.destinatarioadvogados ?? []).some(
    (d) => d.advogado && d.advogado.numero_oab.replace(/\D/g, "").replace(/^0+/, "") === number && d.advogado.uf_oab.toUpperCase() === uf.toUpperCase(),
  );
}

export const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
