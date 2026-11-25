import { z } from "zod";
import { templateVariables } from "@/application/communications/context";
import { COMMUNICATION_KIND_LABELS, COMMUNICATION_KINDS } from "@/domain/communications/types";
import { AiUnavailableError, writeLetter } from "@/infrastructure/ai/letter-writer";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  kind: z.enum(COMMUNICATION_KINDS),
  instructions: z.string().max(4000).default(""),
  currentSubject: z.string().max(500).optional(),
  currentBody: z.string().max(20000).optional(),
  clientId: z.string().uuid().nullish(),
  processId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  deadline: z.string().nullish(),
});

const STYLE: Record<(typeof COMMUNICATION_KINDS)[number], string> = {
  email:
    "Escreva um e-mail profissional e cordial de advogado(a) para o(a) cliente, em linguagem clara e acessível (sem juridiquês desnecessário). Comece com 'Prezado(a) Nome,' e termine com 'Atenciosamente,' seguido do nome, OAB e escritório.",
  oficio:
    "Redija um ofício formal no padrão da redação oficial brasileira: cabeçalho 'OFÍCIO Nº ___/ANO', local e data, destinatário (com marcadores entre colchetes quando não informados), assunto, referência ao processo, corpo objetivo, fecho 'Atenciosamente,' e assinatura com nome e OAB.",
  whatsapp:
    "Escreva uma mensagem curta de WhatsApp (até 600 caracteres), cordial e direta, sem formatação complexa. Termine com o nome do escritório.",
};

/** Gera (ou reescreve) uma comunicação com a IA integrada (Ollama gratuito por padrão). */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Dados inválidos");
  const b = parsed.data;
  const vars = await templateVariables(ctx.supabase, ctx.orgId, ctx.user.id, b);
  const facts = Object.entries(vars)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const system = [
    "Você é assistente de redação de um escritório de advocacia brasileiro. Escreva em português do Brasil, com correção gramatical.",
    STYLE[b.kind],
    "Use apenas os fatos fornecidos. Nunca invente números de processo, datas, valores, nomes ou fundamentos legais; quando faltar uma informação necessária, deixe um marcador entre colchetes, por exemplo [data da audiência].",
    "O texto será revisado pelo advogado antes do envio.",
    'Responda em JSON com as chaves "assunto" (uma linha) e "corpo" (texto simples, parágrafos separados por linha em branco).',
  ].join("\n");

  const user = [
    `Tipo: ${COMMUNICATION_KIND_LABELS[b.kind]}`,
    facts ? `Dados disponíveis:\n${facts}` : "Sem dados de cliente ou processo.",
    b.instructions.trim() ? `Pedido do advogado: ${b.instructions.trim()}` : "Pedido do advogado: comunicação adequada ao contexto acima.",
    b.currentBody?.trim() ? `Rascunho atual (melhore mantendo as informações):\nAssunto: ${b.currentSubject ?? ""}\n${b.currentBody}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const letter = await writeLetter(ctx.orgId, system, user);
    return json({ subject: letter.assunto, body: letter.corpo, model: letter.model });
  } catch (err) {
    if (err instanceof AiUnavailableError) return fail(err.message, 503);
    return fail("A IA não conseguiu gerar o texto agora. Tente novamente.", 502);
  }
}
