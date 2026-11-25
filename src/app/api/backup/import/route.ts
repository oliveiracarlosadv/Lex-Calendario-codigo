import { importBackup } from "@/application/backup/backup";
import { can } from "@/domain/identity/permissions";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Restaura um backup do Lex Calendário (mescla com os dados atuais; não apaga nada). */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!can(ctx.role, "organization:update")) return fail("Apenas administradores e sócios restauram backups.", 403);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Restauração indisponível neste servidor.", 501);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Envie o arquivo de backup (.json)");
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return fail("Arquivo inválido: não é um JSON de backup.");
  }
  try {
    const summary = await importBackup(data, ctx.orgId, ctx.user.id, { restoreSettings: form.get("configuracoes") !== "0" });
    return json(summary);
  } catch (e) {
    return fail((e as Error).message, 400);
  }
}
