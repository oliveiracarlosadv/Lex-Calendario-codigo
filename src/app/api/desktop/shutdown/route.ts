import { fail, getUserContext } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Aplicativo desktop: "Sair do Lex Calendário" (encerra o servidor local e o inicializador). */
export async function POST() {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  setTimeout(() => process.exit(0), 200);
  return Response.json({ ok: true });
}
