import { writeFileSync } from "node:fs";
import path from "node:path";
import { fail, getUserContext, json } from "@/lib/api";
import { can } from "@/domain/identity/permissions";

export const dynamic = "force-dynamic";

/**
 * Limpar todas as informações: o inicializador envia os dados do app para a Lixeira e
 * reinicia o Lex do zero. O servidor sai para liberar o banco de dados.
 */
export async function POST(request: Request) {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!can(ctx.role, "organization:update")) return fail("Apenas administradores podem apagar as informações.", 403);
  const body = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm?.trim().toUpperCase() !== "APAGAR") return fail("Digite APAGAR para confirmar.");
  writeFileSync(path.join(process.env.LEX_DATA_DIR ?? "", "limpar-tudo"), new Date().toISOString());
  setTimeout(() => process.exit(3), 300);
  return json({ ok: true });
}
