import { utimes, writeFile } from "node:fs/promises";

export const dynamic = "force-dynamic";

/** Aplicativo desktop: registra que há uma janela aberta (o inicializador encerra após inatividade). */
export async function POST() {
  const file = process.env.LEX_HEARTBEAT_FILE;
  if (process.env.LEX_DESKTOP !== "1" || !file) return new Response(null, { status: 204 });
  const now = new Date();
  await writeFile(file, String(now.getTime())).catch(() => utimes(file, now, now).catch(() => undefined));
  return new Response(null, { status: 204 });
}
