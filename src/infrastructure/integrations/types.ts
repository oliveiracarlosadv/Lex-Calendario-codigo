import type { SharedPayload } from "./shared-payload";
/** Contratos comuns aos provedores de calendário externos. */

export interface ExternalEvent {
  externalId: string;
  etag?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string; // ISO
  endsAt: string; // ISO
  allDay: boolean;
  cancelled: boolean;
  recurrenceRule?: string | null;
  lexEventId?: string | null; // presente quando o evento nasceu no Lex
  attendees?: { email: string; name?: string | null; status?: string | null; comment?: string | null; self?: boolean; organizer?: boolean }[];
  /** false quando o usuário desta conta é apenas convidado (o organizador é outra pessoa) */
  organizerSelf?: boolean;
  organizerEmail?: string | null;
  /** convidados podem alterar o evento (definido pelo organizador) */
  guestsCanModify?: boolean;
  /** dados do Lex enviados pelo organizador (outra instalação do Lex) */
  shared?: SharedPayload | null;
}

export interface OutboundEvent {
  id: string;
  title: string;
  descriptionText: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  status: string;
  meetingUrl: string | null;
  processNumber?: string | null;
  clientName?: string | null;
  /** Descrição completa (todos os campos do Lex, por prioridade) em HTML e texto. */
  detailsHtml?: string | null;
  detailsText?: string | null;
  /** Lembretes do responsável (minutos de antecedência). */
  reminders?: number[];
  /** Convidados (e-mails) — o Google/Outlook enviam o convite. */
  attendees?: { email: string; name?: string | null }[];
  /** Convidados podem alterar data/hora no Google Agenda */
  guestsCanModify?: boolean;
  /** Organizador: dados do Lex que acompanham o evento para as instalações dos convidados */
  shared?: SharedPayload | null;
  /**
   * Este usuário é convidado: envia só o que um convidado pode mudar (nome, data, hora e local,
   * se o organizador permitir) e os próprios comentários, pela observação da resposta ao convite.
   */
  guest?: { readOnly: boolean; selfComment: string | null } | null;
}

export interface PushOptions {
  /** Avisar os convidados por e-mail (só quando muda data, hora, local, link ou convidados) */
  notifyGuests: boolean;
}

export interface ConnectionRow {
  id: string;
  organization_id: string;
  user_id: string;
  provider: "google" | "microsoft" | "caldav";
  account_email: string | null;
  external_calendar_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  caldav_url: string | null;
  caldav_username: string | null;
  caldav_password_enc: string | null;
  sync_token: string | null;
  webhook_channel_id: string | null;
  webhook_resource_id: string | null;
  webhook_expires_at: string | null;
  last_push_error?: string | null;
  scopes?: string | null;
}

export interface PullResult {
  events: ExternalEvent[];
  nextSyncToken: string | null;
  fullSync: boolean;
}

export interface CalendarProviderAdapter {
  push(
    conn: ConnectionRow,
    event: OutboundEvent,
    existingExternalId?: string | null,
    opts?: PushOptions,
  ): Promise<{ externalId: string; etag: string | null; forbidden?: boolean }>;
  remove(conn: ConnectionRow, externalId: string): Promise<void>;
  pull(conn: ConnectionRow): Promise<PullResult>;
}

/** Texto padrão de descrição enviado aos calendários externos. */
export function outboundDescription(e: OutboundEvent): string {
  if (e.detailsText) return e.detailsText;
  return [
    e.descriptionText,
    e.processNumber ? `Processo: ${e.processNumber}` : null,
    e.clientName ? `Cliente: ${e.clientName}` : null,
    e.meetingUrl ? `Link: ${e.meetingUrl}` : null,
    "— Gerenciado pelo Lex Calendário",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Descrição em HTML (Google Agenda e Outlook aceitam negrito, listas e links). */
export function outboundDescriptionHtml(e: OutboundEvent): string {
  return e.detailsHtml ?? outboundDescription(e).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
}

/** Data (AAAA-MM-DD) no fuso informado. */
export function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
