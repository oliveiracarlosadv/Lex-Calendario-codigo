import { z } from "zod";
import { ollamaStatus, startServer, startSetup, uninstall } from "@/infrastructure/ai/ollama-local";
import { resolveAi } from "@/infrastructure/ai/config";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Situação da IA gratuita (Ollama) neste computador e andamento da instalação. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  // "external": o escritório escolheu outra IA (ChatGPT, Claude, Groq…) em Configurações
  const ai = await resolveAi(ctx.orgId);
  return json({ ...(await ollamaStatus()), provider: ai.provider, external: ai.protocol === "openai" || ai.protocol === "anthropic" });
}

const Body = z.object({ action: z.enum(["instalar", "ligar", "desinstalar"]), model: z.string().max(60).optional() });

/** desinstalar: remove o Ollama e os modelos · instalar: baixa e instala o Ollama (site oficial) e o modelo · ligar: inicia o Ollama já instalado. */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível no aplicativo instalado no computador. Na versão web, instale em ollama.com.", 400);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Pedido inválido");
  if (parsed.data.action === "desinstalar") {
    try {
      await uninstall();
    } catch (e) {
      return fail((e as Error).message, 500);
    }
    return json(await ollamaStatus());
  }
  if (parsed.data.action === "ligar") {
    try {
      await startServer();
    } catch (e) {
      return fail((e as Error).message, 500);
    }
    return json(await ollamaStatus());
  }
  startSetup(parsed.data.model ?? "");
  return json(await ollamaStatus());
}
