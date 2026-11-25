import { serializeIcs } from "@/infrastructure/integrations/ics/ics";
import { fail, getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const url = new URL(request.url);
  const eventId = url.searchParams.get("event");

  let query = ctx.supabase
    .from("events")
    .select("id, title, description_text, location, starts_at, ends_at, all_day, status, kind, meeting_url, updated_at, recurrence_rule, process:processes(title, number)")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null);
  query = eventId ? query.eq("id", eventId) : query.gte("starts_at", new Date(Date.now() - 365 * 864e5).toISOString());
  const { data, error } = await query.limit(5000);
  if (error) return fail(error.message, 500);

  const { data: reminders } = await ctx.supabase.from("event_reminders").select("event_id, offset_minutes").eq("user_id", ctx.user.id);
  const ics = serializeIcs(
    (data ?? []).map((e) => {
      const proc = Array.isArray(e.process) ? e.process[0] : e.process;
      return {
        uid: `${e.id}@lexcalendario`,
        title: e.title,
        description: [e.description_text, proc && (proc.title || proc.number) ? `Processo: ${[proc.title, proc.number].filter(Boolean).join(" · ")}` : null].filter(Boolean).join("\n") || null,
        location: e.location,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        allDay: e.all_day,
        status: e.status,
        url: e.meeting_url,
        updatedAt: e.updated_at,
        recurrenceRule: e.recurrence_rule,
        alarmsMinutes: (reminders ?? []).filter((r) => r.event_id === e.id).map((r) => r.offset_minutes),
      };
    }),
  );
  const filename = eventId ? "compromisso.ics" : "lex-calendario.ics";
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
