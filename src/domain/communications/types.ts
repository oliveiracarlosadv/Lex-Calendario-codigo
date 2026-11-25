/** Comunicações com clientes: e-mails, ofícios e mensagens de WhatsApp. */

export const COMMUNICATION_KINDS = ["email", "oficio", "whatsapp"] as const;
export type CommunicationKind = (typeof COMMUNICATION_KINDS)[number];
export const COMMUNICATION_KIND_LABELS: Record<CommunicationKind, string> = {
  email: "E-mail",
  oficio: "Ofício",
  whatsapp: "WhatsApp",
};

export const COMMUNICATION_STATUSES = ["draft", "scheduled", "sent", "failed", "cancelled"] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];
export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  sent: "Enviada",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export interface CommunicationAttachment {
  name: string;
  path: string;
  size: number;
  mime: string;
}

/** Variáveis aceitas nos modelos ({{cliente}}, {{processo}}...). */
export const TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: "cliente", label: "Nome do cliente" },
  { key: "primeiro_nome", label: "Primeiro nome do cliente" },
  { key: "documento", label: "CPF/CNPJ do cliente" },
  { key: "processo", label: "Número do processo (ou o nome, se ainda não tiver número)" },
  { key: "nome_processo", label: "Nome do processo" },
  { key: "tribunal", label: "Tribunal" },
  { key: "vara", label: "Vara / órgão julgador" },
  { key: "parte_contraria", label: "Parte contrária" },
  { key: "ultima_movimentacao", label: "Última movimentação" },
  { key: "data_evento", label: "Data do compromisso" },
  { key: "local_evento", label: "Local do compromisso" },
  { key: "prazo", label: "Prazo informado" },
  { key: "advogado", label: "Seu nome" },
  { key: "oab", label: "Sua OAB" },
  { key: "escritorio", label: "Nome do escritório" },
  { key: "hoje", label: "Data de hoje (por extenso)" },
  { key: "ano", label: "Ano atual" },
];

/**
 * Substitui {{variavel}} pelos valores; variáveis sem valor ficam como "[variavel]"
 * para o advogado completar antes do envio.
 */
export function fillTemplate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => {
    const value = vars[key.toLowerCase()];
    return value && value.trim() ? value : `[${key}]`;
  });
}

/** Marcadores ainda não preenchidos: [cliente], [Destinatário]... */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\[([^\]\n]{2,40})\]/g)].map((m) => m[1]))];
}

export function longDate(d = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function formatDeadline(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Link do WhatsApp com a mensagem pronta (número brasileiro com DDI 55). */
export function whatsappLink(phone: string, text: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Texto simples → HTML de e-mail (parágrafos e quebras de linha). */
export function textToEmailHtml(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html lang="pt-BR"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f">${paragraphs}</body></html>`;
}
