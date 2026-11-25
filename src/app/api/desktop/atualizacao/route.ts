import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const dir = () => process.env.LEX_DATA_DIR ?? "";
const read = (name: string) => {
  try {
    return readFileSync(path.join(dir(), name), "utf8").trim();
  } catch {
    return "";
  }
};

/** Situação da atualização do app desktop (versão instalada e resultado da última atualização por arquivo). */
export async function GET() {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  let status: Record<string, unknown> = {};
  try {
    status = JSON.parse(read("atualizacao.json") || "{}");
  } catch {
    status = {};
  }
  return json({
    ...status,
    current: process.env.LEX_DESKTOP_VERSION ?? "dev",
    platform: process.platform,
    arch: process.arch,
    updatedFrom: read("atualizado-de.txt") || null,
  });
}

/** visto: o usuário já viu o aviso de "atualizado". */
export async function POST(request: Request) {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  switch (body.action) {
    case "visto":
      rmSync(path.join(dir(), "atualizado-de.txt"), { force: true });
      return json({ ok: true });
    default:
      return fail("Ação inválida");
  }
}
