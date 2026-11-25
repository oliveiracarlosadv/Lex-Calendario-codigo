import { checkProcess } from "@/application/monitoring/process-monitor";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, isAuthorizedCron, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Consulta, em lotes, os processos monitorados há mais tempo sem verificação. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return fail("Não autorizado", 401);
  const admin = getSupabaseAdminClient();
  const { data: processes } = await admin
    .from("processes")
    .select("id")
    .eq("is_monitored", true)
    .not("number", "is", null)
    .in("status", ["active", "suspended", "appeal"])
    .order("monitoring_checked_at", { ascending: true, nullsFirst: true })
    .limit(40);

  let movements = 0;
  let suggestions = 0;
  const started = Date.now();
  for (const p of processes ?? []) {
    if (Date.now() - started > 270_000) break; // margem para o limite da função
    const r = await checkProcess(p.id, admin).catch(() => ({ inserted: 0, suggestions: 0 }));
    movements += r.inserted;
    suggestions += r.suggestions;
  }
  return json({ checked: processes?.length ?? 0, movements, suggestions });
}
