/**
 * Serialização e leitura de iCalendar (RFC 5545).
 * Exportação implementada sem dependências; importação via ical.js.
 */
import ICAL from "ical.js";

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  status?: string;
  categories?: string[];
  url?: string | null;
  updatedAt?: string;
  recurrenceRule?: string | null;
  alarmsMinutes?: number[];
}

const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function dateValue(iso: string, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso))
    .replace(/-/g, "");
}

/** Dobra linhas em 75 octetos, como exige a RFC 5545 (§3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (size + len > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function serializeIcs(events: IcsEvent[], calendarName = "Lex Calendário"): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lex Calendario//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:America/Sao_Paulo",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utcStamp(e.updatedAt ?? new Date().toISOString())}`);
    if (e.allDay) {
      const start = dateValue(e.startsAt);
      let endDate = new Date(e.endsAt);
      if (dateValue(e.endsAt) <= start) endDate = new Date(new Date(e.startsAt).getTime() + 864e5);
      else endDate = new Date(endDate.getTime() + 864e5);
      lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${dateValue(endDate.toISOString())}`);
    } else {
      lines.push(`DTSTART:${utcStamp(e.startsAt)}`, `DTEND:${utcStamp(e.endsAt)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
    if (e.recurrenceRule) lines.push(`RRULE:${e.recurrenceRule}`);
    lines.push(`STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
    for (const minutes of e.alarmsMinutes ?? []) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:-PT${minutes}M`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function parseIcs(content: string): IcsEvent[] {
  const root = new ICAL.Component(ICAL.parse(content));
  return root.getAllSubcomponents("vevent").map((vevent) => {
    const event = new ICAL.Event(vevent);
    const allDay = event.startDate.isDate;
    const start = event.startDate.toJSDate();
    let end = event.endDate ? event.endDate.toJSDate() : new Date(start.getTime() + (allDay ? 864e5 : 3600e3));
    if (allDay) end = new Date(end.getTime() - 60_000); // DTEND de dia inteiro é exclusivo
    const rrule = vevent.getFirstPropertyValue("rrule");
    const status = String(vevent.getFirstPropertyValue("status") ?? "").toLowerCase();
    return {
      uid: event.uid || crypto.randomUUID(),
      title: event.summary || "(sem título)",
      description: event.description || null,
      location: event.location || null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      allDay,
      status: status === "cancelled" ? "cancelled" : "scheduled",
      recurrenceRule: rrule ? String(rrule) : null,
    };
  });
}
