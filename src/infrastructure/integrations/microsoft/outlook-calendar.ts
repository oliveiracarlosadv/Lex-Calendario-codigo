import "server-only";
import { publicEnv, requireServerEnv } from "@/lib/env";
import { getAccessToken, postForm, type TokenResponse } from "../token-store";
import {
  dateInZone,
  outboundDescriptionHtml,
  type CalendarProviderAdapter,
  type ConnectionRow,
  type ExternalEvent,
  type PullResult,
} from "../types";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = ["offline_access", "openid", "email", "User.Read", "Calendars.ReadWrite"];
const tenant = () => process.env.MICROSOFT_TENANT_ID || "common";
const authority = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
export const microsoftRedirectUri = () => `${publicEnv.appUrl}/api/integrations/microsoft/callback`;

export function microsoftAuthUrl(state: string, codeChallenge: string) {
  const params = new URLSearchParams({
    client_id: requireServerEnv("MICROSOFT_CLIENT_ID"),
    response_type: "code",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    prompt: "select_account",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authority()}/authorize?${params}`;
}

/** Segredo opcional: o app desktop é um "cliente público" (PKCE). */
const msSecret = (): Record<string, string> =>
  process.env.MICROSOFT_CLIENT_SECRET ? { client_secret: process.env.MICROSOFT_CLIENT_SECRET } : {};

export function exchangeMicrosoftCode(code: string, codeVerifier: string) {
  return postForm<TokenResponse>(`${authority()}/token`, {
    client_id: requireServerEnv("MICROSOFT_CLIENT_ID"),
    ...msSecret(),
    code_verifier: codeVerifier,
    code,
    redirect_uri: microsoftRedirectUri(),
    grant_type: "authorization_code",
    scope: MS_SCOPES.join(" "),
  });
}

const refreshMicrosoft = (refreshToken: string) =>
  postForm<TokenResponse>(`${authority()}/token`, {
    client_id: requireServerEnv("MICROSOFT_CLIENT_ID"),
    ...msSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MS_SCOPES.join(" "),
  });

async function graph<T>(conn: ConnectionRow, pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(conn, refreshMicrosoft);
  const res = await fetch(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="UTC", odata.maxpagesize=100',
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) {
    const e = new Error(`Microsoft Graph ${res.status}: ${data.error?.message ?? ""}`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return data;
}

export async function microsoftUserEmail(conn: ConnectionRow) {
  const me = await graph<{ mail?: string; userPrincipalName?: string }>(conn, "/me?$select=mail,userPrincipalName");
  return me.mail ?? me.userPrincipalName ?? null;
}

interface GraphEvent {
  id: string;
  "@odata.etag"?: string;
  "@removed"?: { reason: string };
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  transactionId?: string;
}

const utc = (s: string) => new Date(s.endsWith("Z") ? s : `${s}Z`).toISOString();

export const outlookCalendarAdapter: CalendarProviderAdapter = {
  async push(conn, e, existingExternalId) {
    const body: Record<string, unknown> = {
      subject: e.title,
      body: { contentType: "html", content: outboundDescriptionHtml(e) },
      isReminderOn: !!e.reminders?.length,
      reminderMinutesBeforeStart: e.reminders?.length ? Math.min(...e.reminders) : undefined,
      location: e.location ? { displayName: e.location } : undefined,
      isAllDay: e.allDay,
      start: e.allDay
        ? { dateTime: `${dateInZone(e.startsAt, e.timezone)}T00:00:00`, timeZone: e.timezone }
        : { dateTime: e.startsAt.replace(/Z$/, ""), timeZone: "UTC" },
      end: e.allDay
        ? (() => {
            const d = new Date(`${dateInZone(e.startsAt, e.timezone)}T12:00:00Z`);
            const endDay = dateInZone(e.endsAt, e.timezone);
            const next = new Date(d);
            next.setUTCDate(next.getUTCDate() + 1);
            const end = endDay > d.toISOString().slice(0, 10) ? endDay : next.toISOString().slice(0, 10);
            return { dateTime: `${end}T00:00:00`, timeZone: e.timezone };
          })()
        : { dateTime: e.endsAt.replace(/Z$/, ""), timeZone: "UTC" },
      transactionId: existingExternalId ? undefined : `lex-${e.id}`,
      ...(e.attendees ? { attendees: e.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name ?? a.email }, type: "required" })) } : {}),
      categories: ["Lex Calendário"],
    };
    const res = existingExternalId
      ? await graph<GraphEvent>(conn, `/me/events/${encodeURIComponent(existingExternalId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await graph<GraphEvent>(conn, "/me/events", { method: "POST", body: JSON.stringify(body) });
    return { externalId: res.id, etag: res["@odata.etag"] ?? null };
  },

  async remove(conn, externalId) {
    try {
      await graph(conn, `/me/events/${encodeURIComponent(externalId)}`, { method: "DELETE" });
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
    }
  },

  async pull(conn): Promise<PullResult> {
    const fullSync = !conn.sync_token;
    let url =
      conn.sync_token ??
      `/me/calendarView/delta?startDateTime=${new Date(Date.now() - 90 * 864e5).toISOString()}&endDateTime=${new Date(
        Date.now() + 730 * 864e5,
      ).toISOString()}`;
    const events: ExternalEvent[] = [];
    let deltaLink: string | null = null;

    for (let guard = 0; guard < 100; guard++) {
      const page = await graph<{ value: GraphEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(conn, url);
      for (const g of page.value) {
        if (g["@removed"]) {
          events.push({ externalId: g.id, title: "", startsAt: new Date().toISOString(), endsAt: new Date().toISOString(), allDay: false, cancelled: true });
          continue;
        }
        if (!g.start || !g.end) continue;
        events.push({
          externalId: g.id,
          etag: g["@odata.etag"] ?? null,
          title: g.subject ?? "(sem título)",
          description: g.bodyPreview ?? null,
          location: g.location?.displayName || null,
          startsAt: utc(g.start.dateTime),
          endsAt: new Date(new Date(utc(g.end.dateTime)).getTime() - (g.isAllDay ? 60_000 : 0)).toISOString(),
          allDay: !!g.isAllDay,
          cancelled: !!g.isCancelled,
          lexEventId: g.transactionId?.startsWith("lex-") ? g.transactionId.slice(4) : null,
        });
      }
      if (page["@odata.nextLink"]) url = page["@odata.nextLink"];
      else {
        deltaLink = page["@odata.deltaLink"] ?? null;
        break;
      }
    }
    return { events, nextSyncToken: deltaLink, fullSync };
  },
};

/** Assinatura de notificações do Graph (validade máxima de ~3 dias para eventos). */
export async function subscribeOutlook(conn: ConnectionRow, clientState: string) {
  const expiration = new Date(Date.now() + 2.9 * 24 * 3600 * 1000).toISOString();
  const sub = await graph<{ id: string; expirationDateTime: string }>(conn, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created,updated,deleted",
      notificationUrl: `${publicEnv.appUrl}/api/integrations/microsoft/webhook`,
      resource: "/me/events",
      expirationDateTime: expiration,
      clientState,
    }),
  });
  return { subscriptionId: sub.id, expiresAt: sub.expirationDateTime };
}

export async function renewOutlookSubscription(conn: ConnectionRow) {
  if (!conn.webhook_channel_id) return null;
  const expiration = new Date(Date.now() + 2.9 * 24 * 3600 * 1000).toISOString();
  const sub = await graph<{ expirationDateTime: string }>(conn, `/subscriptions/${conn.webhook_channel_id}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime: expiration }),
  });
  return sub.expirationDateTime;
}
