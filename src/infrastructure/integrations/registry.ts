import "server-only";
import { caldavCalendarAdapter } from "./caldav/caldav-calendar";
import { googleCalendarAdapter } from "./google/google-calendar";
import { outlookCalendarAdapter } from "./microsoft/outlook-calendar";
import type { CalendarProviderAdapter, ConnectionRow } from "./types";

export const PROVIDER_LABELS: Record<ConnectionRow["provider"], string> = {
  google: "Google Calendar",
  microsoft: "Outlook / Microsoft 365",
  caldav: "Apple Calendar (iCloud / CalDAV)",
};

export function adapterFor(provider: ConnectionRow["provider"]): CalendarProviderAdapter {
  switch (provider) {
    case "google":
      return googleCalendarAdapter;
    case "microsoft":
      return outlookCalendarAdapter;
    case "caldav":
      return caldavCalendarAdapter;
  }
}
