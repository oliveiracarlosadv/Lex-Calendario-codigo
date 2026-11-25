import { dispatchDueReminders } from "@/application/notifications/dispatch-reminders";
import { fail, isAuthorizedCron, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return fail("Não autorizado", 401);
  return json(await dispatchDueReminders());
}
