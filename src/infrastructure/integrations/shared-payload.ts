/**
 * Dados do Lex que acompanham o evento no Google Agenda (propriedades "shared", visíveis nas
 * cópias de todos os convidados). É assim que outra instalação do Lex — a do convidado —
 * recebe comentários, checklist, tipo, prioridade e situação do compromisso.
 *
 * O organizador escreve; os convidados só leem. Os comentários dos convidados voltam pela
 * observação da resposta ao convite (campo que todo convidado pode alterar), mesmo quando o
 * organizador marca o evento como "somente leitura".
 */
export interface SharedComment {
  /** id do comentário na instalação do organizador */
  i: string;
  /** nome do autor */
  n: string;
  /** e-mail do autor (quando conhecido) */
  e: string | null;
  /** data ISO */
  t: string;
  /** texto */
  b: string;
}

export interface SharedPayload {
  v: 1;
  /** e-mail do organizador */
  by: string;
  /** somente leitura para convidados (ainda podem comentar) */
  ro: boolean;
  kind?: string;
  priority?: string;
  status?: string;
  /** modalidade da audiência */
  hm?: string | null;
  /** checklist */
  ck: { t: string; d: boolean }[];
  /** comentários, do mais antigo para o mais novo */
  cm: SharedComment[];
}

const CHUNK = 900; // limite do Google: 1024 caracteres por valor
const MAX_CHUNKS = 28; // ~25 kB de um total de 32 kB
const KEYS = Array.from({ length: MAX_CHUNKS }, (_, i) => `lex${i}`);

/** Separador entre comentários do convidado na observação da resposta ao convite. */
export const GUEST_COMMENT_SEPARATOR = "\n———\n";

/** Divide o JSON em propriedades lex0…lexN (sempre todas as chaves, para apagar restos antigos). */
export function encodeShared(payload: SharedPayload): Record<string, string> {
  const p: SharedPayload = { ...payload, cm: payload.cm.map((c) => ({ ...c, b: c.b.slice(0, 1500) })) };
  let json = JSON.stringify(p);
  // Não cabe: descarta os comentários mais antigos até caber
  while (json.length > CHUNK * MAX_CHUNKS && p.cm.length > 1) {
    p.cm = p.cm.slice(1);
    json = JSON.stringify(p);
  }
  // Fatia por caracteres, sem partir pares substitutos (emoji)
  const chars = Array.from(json);
  const out: Record<string, string> = { lexn: "0" };
  let n = 0;
  for (let i = 0; i < chars.length && n < MAX_CHUNKS; n++) {
    let piece = "";
    while (i < chars.length && piece.length + chars[i].length <= CHUNK) piece += chars[i++];
    out[KEYS[n]] = piece;
  }
  out.lexn = String(n);
  for (let k = n; k < MAX_CHUNKS; k++) out[KEYS[k]] = "";
  return out;
}

export function decodeShared(props: Record<string, string> | null | undefined): SharedPayload | null {
  if (!props?.lexn) return null;
  const n = Number(props.lexn);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) return null;
  try {
    const parsed = JSON.parse(KEYS.slice(0, n).map((k) => props[k] ?? "").join("")) as SharedPayload;
    if (parsed?.v !== 1 || !Array.isArray(parsed.cm)) return null;
    return { ...parsed, ck: Array.isArray(parsed.ck) ? parsed.ck : [] };
  } catch {
    return null;
  }
}
