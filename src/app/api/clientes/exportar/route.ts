import { clientsToCsv, clientsToHtml, loadAllClients, loadClientHistory } from "@/application/clients/history";
import { officeHeaderHtml, type OfficeIdentity } from "@/domain/office/letterhead";
import { fail, getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Exporta todos os clientes. ?formato=csv (planilha com cadastro e resumo do histórico)
 * json (cadastro completo + histórico de cada cliente) ou pdf (lista para salvar em PDF).
 */
export async function GET(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const format = new URL(request.url).searchParams.get("formato") ?? "csv";
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const clients = await loadAllClients(ctx.supabase, ctx.orgId);

  if (format === "json") {
    const full = [];
    for (const c of clients) {
      const h = await loadClientHistory(ctx.supabase, ctx.orgId, c.id as string);
      full.push({ ...c, processes: h?.processes ?? [], events: h?.events ?? [], communications: h?.communications ?? [], intimations: h?.intimations ?? [] });
    }
    return new Response(JSON.stringify({ app: "lex-calendario", kind: "clients", exportedAt: new Date().toISOString(), clients: full }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="clientes-${date}.json"`, "Cache-Control": "no-store" },
    });
  }
  if (format === "pdf") {
    const { data: org } = await ctx.supabase.from("organizations").select("name, document, settings").eq("id", ctx.orgId).maybeSingle();
    return new Response(clientsToHtml(clients, org ? officeHeaderHtml(org as OfficeIdentity) : "", true), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(clientsToCsv(clients), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="clientes-${date}.csv"`, "Cache-Control": "no-store" },
  });
}
