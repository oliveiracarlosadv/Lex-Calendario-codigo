import "server-only";
import { publicEnv, requireServerEnv } from "@/lib/env";
import { getAccessToken, postForm, type TokenResponse } from "../token-store";
import { decodeShared, encodeShared } from "../shared-payload";
import {
  dateInZone,
  outboundDescriptionHtml,
  type CalendarProviderAdapter,
  type ConnectionRow,
  type ExternalEvent,
  type OutboundEvent,
  type PullResult,
} from "../types";

const API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
/** Envio de e-mails aos clientes pelo Gmail do advogado (só enviar; o Lex não lê a caixa de entrada). */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Leitura das respostas aos e-mails de comentário (viram comentários no compromisso). */
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const googleRedirectUri = () => `${publicEnv.appUrl}/api/integrations/google/callback`;

export function googleAuthUrl(state: string, codeChallenge: string, opts: { gmail?: boolean } = {}) {
  const params = new URLSearchParams({
    client_id: requireServerEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: [...GOOGLE_SCOPES, ...(opts.gmail ? [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE] : [])].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** O segredo é opcional: clientes OAuth do tipo "app para computador" usam PKCE. */
const googleSecret = (): Record<string, string> =>
  process.env.GOOGLE_CLIENT_SECRET ? { client_secret: process.env.GOOGLE_CLIENT_SECRET } : {};

export function exchangeGoogleCode(code: string, codeVerifier: string) {
  return postForm<TokenResponse & { id_token?: string }>("https://oauth2.googleapis.com/token", {
    code,
    client_id: requireServerEnv("GOOGLE_CLIENT_ID"),
    ...googleSecret(),
    code_verifier: codeVerifier,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
}

export const refreshGoogle = (refreshToken: string) =>
  postForm<TokenResponse>("https://oauth2.googleapis.com/token", {
    refresh_token: refreshToken,
    client_id: requireServerEnv("GOOGLE_CLIENT_ID"),
    ...googleSecret(),
    grant_type: "refresh_token",
  });

export async function googleUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return ((await res.json()) as { email?: string }).email ?? null;
}

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  organizer?: { email?: string; self?: boolean };
  guestsCanModify?: boolean;
  attendees?: { email?: string; displayName?: string; responseStatus?: string; comment?: string; self?: boolean; organizer?: boolean }[];
}

async function api<T>(conn: ConnectionRow, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const token = await getAccessToken(conn, refreshGoogle);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 204) return { status: 204, data: undefined as T };
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok && res.status !== 410) throw new Error(`Google Calendar ${res.status}: ${data.error?.message ?? ""}`);
  return { status: res.status, data };
}

function toGoogle(e: OutboundEvent): Partial<GoogleEvent> & Record<string, unknown> {
  const reminders = [...new Set(e.reminders ?? [])].filter((m) => m >= 0 && m <= 40320).sort((a, b) => a - b).slice(0, 5);
  const base = {
    summary: e.title,
    description: outboundDescriptionHtml(e),
    // Lembretes do Lex viram notificações do Google Agenda (máx. 5, até 4 semanas)
    // Sem lembretes do Lex: volta ao padrão do Google e apaga os lembretes anteriores (o PATCH mescla
    // os campos, e o Google recusa "padrão" junto com lembretes personalizados).
    reminders: reminders.length ? { useDefault: false, overrides: reminders.map((minutes) => ({ method: "popup", minutes })) } : { useDefault: true, overrides: [] },
    location: e.location ?? undefined,
    status: e.status === "cancelled" ? "cancelled" : "confirmed",
    // Concluído fica verde também no Google Agenda (cor 10, "manjericão")
    ...(e.status === "done" ? { colorId: "10" } : {}),
    extendedProperties: { private: { lexEventId: e.id }, ...(e.shared ? { shared: encodeShared(e.shared) } : {}) },
    // Convidados podem mudar data/hora (a mudança volta para o Lex) e veem os demais convidados
    guestsCanModify: e.guestsCanModify ?? true,
    guestsCanSeeOtherGuests: true,
    ...(e.attendees ? { attendees: e.attendees.map((a) => ({ email: a.email, displayName: a.name ?? undefined })) } : {}),
  };
  if (e.allDay) {
    const start = dateInZone(e.startsAt, e.timezone);
    let end = dateInZone(e.endsAt, e.timezone);
    if (end <= start) {
      const d = new Date(`${start}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      end = d.toISOString().slice(0, 10);
    }
    // PATCH mescla os campos: o horário anterior precisa ser apagado (null) ao virar "dia inteiro"
    return { ...base, start: { date: start, dateTime: null, timeZone: null }, end: { date: end, dateTime: null, timeZone: null } };
  }
  const end = new Date(e.endsAt) > new Date(e.startsAt) ? e.endsAt : new Date(new Date(e.startsAt).getTime() + 30 * 60_000).toISOString();
  return {
    ...base,
    start: { dateTime: e.startsAt, timeZone: e.timezone, date: null },
    end: { dateTime: end, timeZone: e.timezone, date: null },
  };
}

function fromGoogle(g: GoogleEvent): ExternalEvent | null {
  const allDay = !!g.start?.date;
  const startsAt = allDay ? `${g.start!.date}T00:00:00-03:00` : g.start?.dateTime;
  const endsAt = allDay ? `${g.end?.date ?? g.start!.date}T00:00:00-03:00` : g.end?.dateTime;
  if (g.status !== "cancelled" && (!startsAt || !endsAt)) return null;
  // Convidado: o organizador é outra conta e esta conta está entre os convidados
  const isGuest = !!g.organizer && g.organizer.self !== true && (g.attendees ?? []).some((a) => a.self);
  return {
    organizerSelf: !isGuest,
    organizerEmail: g.organizer?.email ?? null,
    guestsCanModify: g.guestsCanModify,
    shared: decodeShared(g.extendedProperties?.shared),
    externalId: g.id,
    etag: g.etag ?? null,
    title: g.summary ?? "(sem título)",
    description: g.description ?? null,
    location: g.location ?? null,
    startsAt: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
    endsAt: endsAt ? new Date(new Date(endsAt).getTime() - (allDay ? 60_000 : 0)).toISOString() : new Date().toISOString(),
    allDay,
    cancelled: g.status === "cancelled",
    recurrenceRule: g.recurrence?.find((r) => r.startsWith("RRULE:"))?.slice(6) ?? null,
    lexEventId: g.extendedProperties?.private?.lexEventId ?? null,
    // Organizador: lista os convidados. Convidado: lista todos (inclusive ele e o organizador), com as respostas.
    attendees: (g.attendees ?? [])
      .filter((a) => a.email && (isGuest || (!a.self && !a.organizer)))
      .map((a) => ({
        email: a.email!,
        name: a.displayName ?? null,
        status: a.responseStatus ?? null,
        comment: a.comment ?? null,
        self: a.self === true,
        organizer: a.organizer === true,
      })),
  };
}

/**
 * Envio feito por um CONVIDADO: só o que ele pode mudar. Se o organizador não permitir alterações,
 * seguem apenas os comentários (na observação da resposta ao convite, que todo convidado pode editar).
 */
async function pushAsGuest(conn: ConnectionRow, event: OutboundEvent, externalId: string, notify: boolean) {
  const path = `${calendarPath(conn)}/events/${encodeURIComponent(externalId)}`;
  const { data: current } = await api<GoogleEvent>(conn, path);
  const attendeesPatch =
    event.guest?.selfComment != null && (current.attendees ?? []).some((a) => a.self && (a.comment ?? "") !== event.guest!.selfComment)
      ? { attendees: (current.attendees ?? []).map((a) => (a.self ? { ...a, comment: event.guest!.selfComment } : a)) }
      : {};
  const g = toGoogle(event);
  const fieldsPatch = event.guest?.readOnly ? {} : { summary: g.summary, location: g.location ?? null, start: g.start, end: g.end };
  const send = async (patch: Record<string, unknown>, updates: "all" | "none") => {
    if (!Object.keys(patch).length) return current;
    return (await api<GoogleEvent>(conn, `${path}?sendUpdates=${updates}`, { method: "PATCH", body: JSON.stringify(patch) })).data;
  };
  try {
    const data = await send({ ...fieldsPatch, ...attendeesPatch }, notify ? "all" : "none");
    return { externalId: data.id, etag: data.etag ?? null };
  } catch (error) {
    // "Shared properties can only be changed by the organizer": o organizador não permite alterações.
    if (!/403|organizer|forbidden/i.test((error as Error).message)) throw error;
    const data = await send(attendeesPatch, "none");
    return { externalId: data.id, etag: data.etag ?? null, forbidden: true };
  }
}

const calendarPath = (conn: ConnectionRow) => `/calendars/${encodeURIComponent(conn.external_calendar_id || "primary")}`;

export const googleCalendarAdapter: CalendarProviderAdapter = {
  async push(conn, event, existingExternalId, opts) {
    if (event.guest && existingExternalId) return pushAsGuest(conn, event, existingExternalId, opts?.notifyGuests ?? false);
    const body = JSON.stringify(toGoogle(event));
    // O Google envia e-mail aos convidados só no convite e quando muda data, hora, local, link ou
    // a lista de convidados. Descrição, checklist, comentários, status e cor atualizam em silêncio.
    const notify = !existingExternalId || (opts?.notifyGuests ?? true);
    const qs = event.attendees?.length ? `?sendUpdates=${notify ? "all" : "none"}` : "";
    const { data } = existingExternalId
      ? await api<GoogleEvent>(conn, `${calendarPath(conn)}/events/${encodeURIComponent(existingExternalId)}${qs}`, { method: "PATCH", body })
      : await api<GoogleEvent>(conn, `${calendarPath(conn)}/events${qs}`, { method: "POST", body });
    return { externalId: data.id, etag: data.etag ?? null };
  },

  async remove(conn, externalId) {
    const token = await getAccessToken(conn, refreshGoogle);
    // Cancelamento: os convidados são avisados
    const res = await fetch(`${API}${calendarPath(conn)}/events/${encodeURIComponent(externalId)}?sendUpdates=all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar ${res.status}`);
  },

  async pull(conn): Promise<PullResult> {
    const events: ExternalEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    let fullSync = !conn.sync_token;

    for (let guard = 0; guard < 50; guard++) {
      const params = new URLSearchParams({ maxResults: "250", showDeleted: "true", singleEvents: "false" });
      if (pageToken) params.set("pageToken", pageToken);
      if (conn.sync_token && !fullSync) params.set("syncToken", conn.sync_token);
      else params.set("timeMin", new Date(Date.now() - 90 * 864e5).toISOString());

      const { status, data } = await api<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
        conn,
        `${calendarPath(conn)}/events?${params}`,
      );
      if (status === 410) {
        // syncToken expirado: refaz a sincronização completa
        fullSync = true;
        conn.sync_token = null;
        pageToken = undefined;
        continue;
      }
      for (const item of data.items ?? []) {
        const mapped = fromGoogle(item);
        if (mapped) events.push(mapped);
      }
      pageToken = data.nextPageToken;
      if (!pageToken) {
        nextSyncToken = data.nextSyncToken ?? null;
        break;
      }
    }
    return { events, nextSyncToken, fullSync };
  },
};

/** Inscreve um canal de notificações push (webhook) para a agenda. Validade máxima: ~7 dias. */
export async function watchGoogleCalendar(conn: ConnectionRow, channelId: string, channelToken: string) {
  const { data } = await api<{ id: string; resourceId: string; expiration: string }>(
    conn,
    `${calendarPath(conn)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: `${publicEnv.appUrl}/api/integrations/google/webhook`,
        token: channelToken,
        params: { ttl: String(7 * 24 * 3600) },
      }),
    },
  );
  return { resourceId: data.resourceId, expiresAt: new Date(Number(data.expiration)).toISOString() };
}

export async function stopGoogleChannel(conn: ConnectionRow) {
  if (!conn.webhook_channel_id || !conn.webhook_resource_id) return;
  await api(conn, "/channels/stop", {
    method: "POST",
    body: JSON.stringify({ id: conn.webhook_channel_id, resourceId: conn.webhook_resource_id }),
  }).catch(() => undefined);
}
