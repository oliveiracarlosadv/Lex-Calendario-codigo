import "server-only";
import { tribunalAcronym } from "@/domain/processes/cnj-number";
import type { AnalysisContext } from "@/domain/monitoring/types";
import { CompositeMovementAnalyzer } from "@/infrastructure/ai/composite-analyzer";
import { resolveAi } from "@/infrastructure/ai/config";
import { decryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { buildConnectors, fetchFromTribunals } from "@/infrastructure/tribunals/registry";

type Admin = ReturnType<typeof getSupabaseAdminClient>;

function jurisdictionOf(number: string): AnalysisContext["jurisdiction"] {
  const t = tribunalAcronym(number) ?? "";
  if (t.startsWith("TRT") || t === "TST") return "labor";
  if (t.startsWith("TRF")) return "federal_small_claims";
  return "civil";
}

/** Consulta um processo nos tribunais, grava novas movimentações e gera sugestões. */
export async function checkProcess(processId: string, admin: Admin = getSupabaseAdminClient()) {
  const { data: process } = await admin
    .from("processes")
    .select("id, organization_id, number, tribunal, responsible_id, created_by, client:clients(name)")
    .eq("id", processId)
    .single();
  if (!process) return { inserted: 0, suggestions: 0, errors: ["Processo não encontrado"] };
  if (!process.number) return { inserted: 0, suggestions: 0, errors: ["Processo sem número: informe o número CNJ para consultar o tribunal."] };

  const ownerId = (process.responsible_id ?? process.created_by) as string | null;
  const connectors = buildConnectors(async (tribunal) => {
    if (!ownerId) return null;
    const { data } = await admin
      .from("court_credentials")
      .select("username, secret_enc")
      .eq("user_id", ownerId)
      .eq("court_system", "pje")
      .eq("tribunal", tribunal)
      .maybeSingle();
    const password = decryptSecret(data?.secret_enc ?? null);
    return data?.username && password ? { username: data.username, password } : null;
  });

  const { data: fetched, connector, errors } = await fetchFromTribunals(connectors, process.number, process.tribunal);
  await admin.from("processes").update({ monitoring_checked_at: new Date().toISOString() }).eq("id", processId);
  if (!fetched) return { inserted: 0, suggestions: 0, errors, connector };

  const rows = fetched.movements.map((m) => ({
    organization_id: process.organization_id,
    process_id: processId,
    occurred_at: m.occurredAt,
    code: m.code ?? null,
    title: m.title.slice(0, 500),
    description: m.description ?? null,
    source: m.source,
    external_id: m.externalId ?? `${m.occurredAt}:${m.title}`.slice(0, 200),
    raw: m.raw ?? null,
  }));
  const { data: inserted } = await admin
    .from("process_movements")
    .upsert(rows, { onConflict: "process_id,source,external_id", ignoreDuplicates: true })
    .select("id");

  // Completa metadados ausentes do processo
  await admin
    .from("processes")
    .update({
      procedural_class: fetched.proceduralClass ?? undefined,
      subject: fetched.subject ?? undefined,
      court_division: fetched.courtDivision ?? undefined,
      tribunal: process.tribunal ?? fetched.tribunal ?? undefined,
    })
    .eq("id", processId)
    .is("procedural_class", null);

  const suggestions = await analyzePendingMovements(processId, admin);
  return { inserted: inserted?.length ?? 0, suggestions, errors, connector };
}

/** Analisa movimentações ainda não analisadas do processo e grava sugestões. */
export async function analyzePendingMovements(processId: string, admin: Admin = getSupabaseAdminClient()) {
  const { data: process } = await admin
    .from("processes")
    .select("id, organization_id, number, tribunal, client:clients(name)")
    .eq("id", processId)
    .single();
  if (!process) return 0;

  const { data: pending } = await admin
    .from("process_movements")
    .select("*")
    .eq("process_id", processId)
    .is("analyzed_at", null)
    .gte("occurred_at", new Date(Date.now() - 45 * 864e5).toISOString())
    .order("occurred_at", { ascending: true })
    .limit(30);

  const analyzer = new CompositeMovementAnalyzer(await resolveAi(process.organization_id as string));
  const client = process.client as { name?: string } | { name?: string }[] | null;
  const clientName = Array.isArray(client) ? client[0]?.name : client?.name;
  const ctx: AnalysisContext = {
    processNumber: process.number,
    tribunal: process.tribunal,
    jurisdiction: jurisdictionOf(process.number),
    clientName: clientName ?? null,
  };

  let created = 0;
  for (const m of pending ?? []) {
    const drafts = await analyzer.analyze(
      {
        id: m.id,
        processId,
        occurredAt: m.occurred_at,
        code: m.code,
        title: m.title,
        description: m.description,
        source: m.source,
      },
      ctx,
    );
    if (drafts.length) {
      const { error } = await admin.from("ai_suggestions").insert(
        drafts.map((d) => ({
          organization_id: process.organization_id,
          process_id: processId,
          movement_id: m.id,
          kind: d.kind,
          title: d.title.slice(0, 300),
          starts_at: d.startsAt,
          ends_at: d.endsAt,
          rationale: d.rationale,
          confidence: Number(d.confidence.toFixed(2)),
          analyzer: d.analyzer,
          payload: d.payload ?? {},
        })),
      );
      if (!error) created += drafts.length;
    }
    await admin.from("process_movements").update({ analyzed_at: new Date().toISOString() }).eq("id", m.id);
  }
  return created;
}
