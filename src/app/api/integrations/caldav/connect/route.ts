import { z } from "zod";
import { pullConnection } from "@/application/sync/calendar-sync";
import { encryptSecret } from "@/infrastructure/crypto/secrets";
import { listCaldavCalendars } from "@/infrastructure/integrations/caldav/caldav-calendar";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({ url: z.string().url(), username: z.string().min(3), password: z.string().min(4), calendarUrl: z.string().url().optional() });

export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Dados inválidos");
  const { url, username, password, calendarUrl } = parsed.data;
  const creds = { caldav_url: url, caldav_username: username, caldav_password_enc: encryptSecret(password) };

  let calendars;
  try {
    calendars = await listCaldavCalendars(creds);
  } catch {
    return fail("Não foi possível autenticar no servidor CalDAV. Confira o Apple ID e a senha de app.", 401);
  }
  const target = calendarUrl ?? calendars[0]?.url;
  if (!target) return fail("Nenhuma agenda encontrada nesta conta.", 404);

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("calendar_connections")
    .upsert(
      { organization_id: ctx.orgId, user_id: ctx.user.id, provider: "caldav", account_email: username, external_calendar_id: target, ...creds, is_active: true, last_error: null },
      { onConflict: "user_id,provider,external_calendar_id" },
    )
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Falha ao salvar", 500);
  const result = await pullConnection(data.id).catch((e) => ({ error: (e as Error).message }));
  return json({ id: data.id, calendars, ...result });
}
