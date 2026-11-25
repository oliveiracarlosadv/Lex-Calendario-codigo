import { historyToCsv, historyToHtml, loadClientHistory } from "@/application/clients/history";
import { officeHeaderHtml, type OfficeIdentity } from "@/domain/office/letterhead";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "cliente";

/**
 * Histórico completo do cliente (compromissos, tarefas, comunicações e intimações).
 * ?formato=json (padrão, usado na tela) · csv (planilha) · html (relatório para imprimir/PDF) · download=1
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { id } = await params;
  const history = await loadClientHistory(ctx.supabase, ctx.orgId, id);
  if (!history) return fail("Cliente não encontrado", 404);

  const url = new URL(request.url);
  const format = url.searchParams.get("formato") ?? "json";
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const base = `historico-${slug(history.client.name)}-${date}`;
  const download = url.searchParams.get("download") === "1";

  if (format === "csv") {
    return new Response(historyToCsv(history), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" },
    });
  }
  if (format === "html") {
    const { data: org } = await ctx.supabase.from("organizations").select("name, document, settings").eq("id", ctx.orgId).maybeSingle();
    return new Response(historyToHtml(history, (org?.name as string) ?? "", org ? officeHeaderHtml(org as OfficeIdentity) : "", url.searchParams.get("imprimir") === "1"), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...(download ? { "Content-Disposition": `attachment; filename="${base}.html"` } : {}),
      },
    });
  }
  if (download) {
    return new Response(JSON.stringify({ app: "lex-calendario", kind: "client-history", exportedAt: new Date().toISOString(), ...history }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.json"`, "Cache-Control": "no-store" },
    });
  }
  return json(history);
}
