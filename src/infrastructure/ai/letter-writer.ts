import "server-only";
import { z } from "zod";
import { AiUnavailableError, chatWithFallback, resolveAi, stripFences } from "./config";

/**
 * Redação de comunicações (e-mails, ofícios, WhatsApp) pela IA escolhida em
 * Configurações → Agente de inteligência artificial.
 */

export const LetterSchema = z.object({ assunto: z.string(), corpo: z.string() });
export type Letter = z.infer<typeof LetterSchema>;

const LETTER_JSON_SCHEMA = {
  type: "object",
  properties: { assunto: { type: "string" }, corpo: { type: "string" } },
  required: ["assunto", "corpo"],
};

export { AiUnavailableError };

function parseLetter(content: string): Letter {
  const clean = stripFences(content);
  try {
    const parsed = LetterSchema.safeParse(JSON.parse(clean));
    if (parsed.success) return parsed.data;
  } catch {
    // o modelo respondeu em texto livre: primeira linha vira o assunto
  }
  const [first, ...rest] = clean.split("\n");
  return { assunto: first.replace(/^(assunto:)\s*/i, "").trim(), corpo: rest.join("\n").trim() };
}

export async function writeLetter(orgId: string, system: string, user: string): Promise<Letter & { model: string }> {
  const ai = await resolveAi(orgId);
  const { text: content, model } = await chatWithFallback(orgId, ai, {
    system,
    user: ai.protocol === "ollama" ? user : `${user}\n\nResponda somente com JSON: {"assunto": "...", "corpo": "..."}`,
    temperature: 0.4,
    jsonSchema: LETTER_JSON_SCHEMA,
    timeoutMs: 180_000,
  });
  return { ...parseLetter(content), model };
}
