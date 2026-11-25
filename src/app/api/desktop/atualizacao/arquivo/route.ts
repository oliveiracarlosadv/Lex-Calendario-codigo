import { createWriteStream, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

/**
 * Atualização por arquivo: recebe o instalador (.exe / .pkg / .deb) ou o pacote (.zip / .tar.gz), grava em dados/ e
 * pede ao inicializador que o instale. O app reinicia na nova versão, mantendo os dados.
 */
export async function POST(request: Request) {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  if (!/\.(zip|tar\.gz|tgz|exe|pkg|deb)$/i.test(name)) return fail("Escolha o instalador do Lex Calendário baixado (.exe no Windows, .pkg no Mac, .deb no Linux).");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail("Arquivo grande demais para ser um pacote do Lex.");
  if (!request.body) return fail("Arquivo vazio.");
  const dir = process.env.LEX_DATA_DIR ?? "";
  const ext = name.match(/\.(zip|exe|pkg|deb)$/i)?.[0].toLowerCase() ?? ".tar.gz";
  const dest = path.join(dir, `pacote-atualizacao${ext}`);
  try {
    await pipeline(Readable.fromWeb(request.body as WebReadableStream), createWriteStream(dest));
  } catch (e) {
    rmSync(dest, { force: true });
    return fail(`Falha ao receber o arquivo: ${(e as Error).message}`, 500);
  }
  if (!existsSync(dest)) return fail("Falha ao receber o arquivo.", 500);
  writeFileSync(path.join(dir, "atualizacao.json"), JSON.stringify({ state: "instalando", notes: "Pacote recebido. Preparando a instalação…", checkedAt: new Date().toISOString() }));
  writeFileSync(path.join(dir, "atualizar-arquivo"), dest);
  return json({ ok: true });
}
