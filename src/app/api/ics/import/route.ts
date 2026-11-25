import { parseIcs } from "@/infrastructure/integrations/ics/ics";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Envie um arquivo .ics");
  if (file.size > 10 * 1024 * 1024) return fail("Arquivo acima de 10 MB");

  let events;
  try {
    events = parseIcs(await file.text());
  } catch {
    return fail("Arquivo ICS inválido");
  }
  const { data: categories } = await ctx.supabase.from("event_categories").select("id, kind").eq("organization_id", ctx.orgId);
  const custom = categories?.find((c) => c.kind === "custom")?.id ?? null;

  const rows = events
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      organization_id: ctx.orgId,
      title: e.title.slice(0, 300),
      kind: "custom",
      category_id: custom,
      description_text: e.description,
      location: e.location,
      starts_at: e.startsAt,
      ends_at: e.endsAt < e.startsAt ? e.startsAt : e.endsAt,
      all_day: e.allDay,
      recurrence_rule: e.recurrenceRule,
      created_by: ctx.user.id,
      responsible_id: ctx.user.id,
      source: "ics",
    }));

  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error, count } = await ctx.supabase.from("events").insert(rows.slice(i, i + 500), { count: "exact" });
    if (error) return fail(error.message, 500);
    imported += count ?? 0;
  }
  return json({ imported });
}
