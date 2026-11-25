import { exportBackup, primaryOrganization } from "@/application/backup/backup";
import { can } from "@/domain/identity/permissions";
import { fail, getUserContext, isAuthorizedCron } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Exporta o backup completo (?arquivos=1 inclui os anexos). Também usado pelo backup automático do app desktop. */
export async function GET(request: Request) {
  const includeFiles = new URL(request.url).searchParams.get("arquivos") === "1";
  let orgId: string;
  let userId: string | null;
  if (isAuthorizedCron(request)) {
    const primary = await primaryOrganization();
    if (!primary) return fail("Nenhum escritório para exportar", 404);
    ({ orgId, userId } = primary);
  } else {
    const ctx = await getUserContext();
    if (!ctx) return fail("Não autenticado", 401);
    if (!can(ctx.role, "organization:update")) return fail("Apenas administradores e sócios exportam o backup completo.", 403);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Backup indisponível neste servidor.", 501);
    orgId = ctx.orgId;
    userId = ctx.user.id;
  }
  const backup = await exportBackup(orgId, userId, { includeFiles });
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new Response(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="lex-calendario-backup-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
