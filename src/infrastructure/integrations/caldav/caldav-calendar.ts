import "server-only";
import { createDAVClient, type DAVCalendar } from "tsdav";
import { decryptSecret } from "@/infrastructure/crypto/secrets";
import { parseIcs, serializeIcs } from "../ics/ics";
import { outboundDescription, type CalendarProviderAdapter, type ConnectionRow, type ExternalEvent, type PullResult } from "../types";

/**
 * Apple Calendar (iCloud) e demais servidores CalDAV (Fastmail, Nextcloud, Zimbra...).
 * iCloud: https://caldav.icloud.com — usar Apple ID + senha de app (appleid.apple.com).
 * O ID externo é a URL do objeto .ics no servidor.
 */
export const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";

async function client(conn: Pick<ConnectionRow, "caldav_url" | "caldav_username" | "caldav_password_enc">) {
  return createDAVClient({
    serverUrl: conn.caldav_url ?? ICLOUD_CALDAV_URL,
    credentials: { username: conn.caldav_username ?? "", password: decryptSecret(conn.caldav_password_enc) ?? "" },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

/** Lista as agendas disponíveis (para o usuário escolher na conexão). */
export async function listCaldavCalendars(conn: Pick<ConnectionRow, "caldav_url" | "caldav_username" | "caldav_password_enc">) {
  const c = await client(conn);
  const calendars = await c.fetchCalendars();
  return calendars
    .filter((cal) => !cal.components || cal.components.includes("VEVENT"))
    .map((cal) => ({ url: cal.url, name: typeof cal.displayName === "string" ? cal.displayName : "Agenda" }));
}

const calendarOf = (conn: ConnectionRow) => ({ url: conn.external_calendar_id }) as DAVCalendar;

export const caldavCalendarAdapter: CalendarProviderAdapter = {
  async push(conn, e, existingExternalId) {
    const c = await client(conn);
    const ics = serializeIcs(
      [
        {
          uid: `${e.id}@lexcalendario`,
          title: e.title,
          description: outboundDescription(e),
          location: e.location,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          allDay: e.allDay,
          status: e.status,
          url: e.meetingUrl,
          alarmsMinutes: e.reminders ?? [],
        },
      ],
      "Lex Calendário",
    );
    if (existingExternalId) {
      const res = await c.updateCalendarObject({ calendarObject: { url: existingExternalId, data: ics } });
      return { externalId: existingExternalId, etag: res.headers.get("etag") };
    }
    const base = conn.external_calendar_id.endsWith("/") ? conn.external_calendar_id : `${conn.external_calendar_id}/`;
    const filename = `lex-${e.id}.ics`;
    const res = await c.createCalendarObject({ calendar: calendarOf(conn), filename, iCalString: ics });
    if (!res.ok) throw new Error(`CalDAV ${res.status}`);
    return { externalId: new URL(filename, base).toString(), etag: res.headers.get("etag") };
  },

  async remove(conn, externalId) {
    const c = await client(conn);
    const res = await c.deleteCalendarObject({ calendarObject: { url: externalId } });
    if (!res.ok && res.status !== 404) throw new Error(`CalDAV ${res.status}`);
  },

  async pull(conn): Promise<PullResult> {
    const c = await client(conn);
    const objects = await c.fetchCalendarObjects({
      calendar: calendarOf(conn),
      timeRange: {
        start: new Date(Date.now() - 90 * 864e5).toISOString(),
        end: new Date(Date.now() + 730 * 864e5).toISOString(),
      },
    });
    const events: ExternalEvent[] = [];
    for (const obj of objects) {
      if (!obj.data) continue;
      try {
        for (const ev of parseIcs(String(obj.data))) {
          events.push({
            externalId: obj.url,
            etag: obj.etag ?? null,
            title: ev.title,
            description: ev.description,
            location: ev.location,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt,
            allDay: ev.allDay,
            cancelled: ev.status === "cancelled",
            recurrenceRule: ev.recurrenceRule,
            lexEventId: ev.uid.endsWith("@lexcalendario") ? ev.uid.replace("@lexcalendario", "") : null,
          });
          break; // um VEVENT mestre por objeto
        }
      } catch {
        // objeto malformado no servidor: ignora
      }
    }
    // CalDAV sem sync-collection: a sincronização é sempre "completa" na janela de datas
    return { events, nextSyncToken: null, fullSync: true };
  },
};
