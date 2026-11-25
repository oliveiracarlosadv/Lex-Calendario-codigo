import { writeFileSync } from "node:fs";
import path from "node:path";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Desinstalar pelo app: "app" (mantém os dados) ou "tudo" (dados vão para a Lixeira). */
export async function POST(request: Request) {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  if (body.mode !== "app" && body.mode !== "tudo") return fail("Escolha o que remover.");
  writeFileSync(path.join(process.env.LEX_DATA_DIR ?? "", "desinstalar"), body.mode);
  return json({ ok: true });
}
