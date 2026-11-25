import { googleCalendarAdapter } from "./google/google-calendar";
import type { CalendarProviderAdapter, ConnectionRow } from "./types";

export const PROVIDER_LABELS: Record<ConnectionRow["provider"], string> = {
  google: "Google Calendar",
  microsoft: "Outlook / Microsoft 365",
  caldav: "Apple Calendar (iCloud / CalDAV)",
};

/** Versão web: só o Google Agenda, que aceita chamadas direto do navegador. */
export function adapterFor(_provider: ConnectionRow["provider"]): CalendarProviderAdapter {
  return googleCalendarAdapter;
}
