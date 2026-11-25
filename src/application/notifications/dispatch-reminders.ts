import "server-only";
import { EVENT_KIND_LABELS, type EventKind } from "@/domain/events/types";
import { renderReminderEmail, sendEmail } from "@/infrastructure/notifications/email";
import { sendPush } from "@/infrastructure/notifications/web-push";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { publicEnv } from "@/lib/env";

function relative(minutes: number) {
  if (minutes < 60) return `em ${minutes} minutos`;
  if (minutes < 1440) return `em ${Math.round(minutes / 60)} hora${minutes >= 120 ? "s" : ""}`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? "amanhã" : `em ${days} dias`;
}

/** Dispara lembretes vencidos em todos os canais configurados. Idempotente. */
export async function dispatchDueReminders(limit = 200) {
  const admin = getSupabaseAdminClient();
  const { data: due } = await admin
    .from("event_reminders")
    .select(
      "id, user_id, offset_minutes, channels, organization_id, event:events(id, title, kind, starts_at, all_day, location, status, deleted_at, process:processes(title, number))",
    )
    .is("sent_at", null)
    .lte("remind_at", new Date().toISOString())
    .order("remind_at")
    .limit(limit);

  let sent = 0;
  for (const r of due ?? []) {
    // Marca primeiro (evita envio duplicado em execuções concorrentes)
    const { data: claimed } = await admin
      .from("event_reminders")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", r.id)
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const event = (Array.isArray(r.event) ? r.event[0] : r.event) as {
      id: string; title: string; kind: EventKind; starts_at: string; all_day: boolean; location: string | null;
      status: string; deleted_at: string | null; process: { title: string | null; number: string | null } | { title: string | null; number: string | null }[] | null;
    } | null;
    if (!event || event.deleted_at || event.status === "cancelled" || event.status === "done") continue;

    const kindLabel = EVENT_KIND_LABELS[event.kind];
    const when = new Date(event.starts_at).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "full",
      timeStyle: event.all_day ? undefined : "short",
    });
    const title = `${kindLabel} ${relative(r.offset_minutes)}`;
    const body = `${event.title} — ${when}`;
    const link = `/eventos/${event.id}`;
    const channels = (r.channels ?? []) as string[];

    // A linha em "notifications" também vira notificação nativa do sistema (app desktop)
    if (channels.includes("in_app") || channels.includes("push")) {
      await admin.from("notifications").insert({
        organization_id: r.organization_id,
        user_id: r.user_id,
        title,
        body,
        link,
        kind: "reminder",
      });
    }
    if (channels.includes("push")) {
      const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", r.user_id);
      const expired = await sendPush(subs ?? [], { title, body, url: link, tag: `event-${event.id}` });
      if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
    }
    if (channels.includes("email")) {
      const { data: profile } = await admin.from("profiles").select("email, full_name").eq("id", r.user_id).single();
      if (profile?.email) {
        const proc = Array.isArray(event.process) ? event.process[0] : event.process;
        await sendEmail(
          profile.email,
          `⏰ ${title}: ${event.title}`,
          renderReminderEmail({
            to: profile.email,
            name: profile.full_name,
            title: event.title,
            when,
            kindLabel,
            location: event.location,
            processNumber: proc ? [proc.title, proc.number].filter(Boolean).join(" · ") || null : null,
            link: `${publicEnv.appUrl}${link}`,
          }),
        );
      }
    }
    sent++;
  }
  return { sent, notifications: await collectSystemNotifications(admin) };
}

/**
 * Notificações da plataforma ainda não mostradas pelo sistema operacional (lembretes,
 * intimações, testes). O aplicativo desktop as exibe como notificações nativas.
 */
export async function collectSystemNotifications(admin = getSupabaseAdminClient()) {
  const { data } = await admin
    .from("notifications")
    .select("id, title, body, link")
    .is("system_sent_at", null)
    .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  const rows = (data ?? []) as { id: string; title: string; body: string | null; link: string | null }[];
  if (rows.length) await admin.from("notifications").update({ system_sent_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  return rows.map((r) => ({ title: r.title, body: r.body ?? "", url: r.link ?? "/notificacoes" }));
}
