import { COMMUNICATION_KIND_LABELS, type CommunicationKind } from "@/domain/communications/types";
import { fail, getUserContext } from "@/lib/api";
import { officeHeaderHtml, type OfficeIdentity } from "@/domain/office/letterhead";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Documento da comunicação (ofício, carta ou e-mail) para imprimir/salvar em PDF
 * (?formato=html) ou abrir no Word (?formato=doc).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { id } = await params;
  const { data: c } = await ctx.supabase.from("communications").select("kind, subject, body, created_at").eq("id", id).eq("organization_id", ctx.orgId).maybeSingle();
  if (!c) return fail("Comunicação não encontrada", 404);
  const { data: org } = await ctx.supabase.from("organizations").select("name, document, settings").eq("id", ctx.orgId).maybeSingle();
  const word = new URL(request.url).searchParams.get("formato") === "doc";
  const paragraphs = (c.body as string)
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const title = (c.subject as string) || COMMUNICATION_KIND_LABELS[c.kind as CommunicationKind];
  const html = `<!doctype html><html lang="pt-BR"${word ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : ""}><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page{size:A4;margin:2.5cm 2cm 2cm 3cm}
  body{font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.5;color:#000;max-width:16cm;margin:2cm auto}
  p{margin:0 0 12pt;text-align:justify}
  @media print{body{margin:0}.noprint{display:none}}
</style></head><body>
${word ? "" : '<p class="noprint" style="text-align:right;font-family:sans-serif"><button onclick="print()">Imprimir / salvar em PDF</button></p>'}
${org ? officeHeaderHtml(org as OfficeIdentity, { logo: !word }) : ""}
${paragraphs}
</body></html>`;
  const slug = title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "comunicacao";
  return new Response(html, {
    headers: word
      ? { "Content-Type": "application/msword; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}.doc"`, "Cache-Control": "no-store" }
      : { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
