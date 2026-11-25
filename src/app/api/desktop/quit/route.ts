import { safeEqual } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Aplicativo desktop: encerramento solicitado pelo instalador (atualização de versão). */
export async function POST(request: Request) {
  const token = process.env.LEX_DESKTOP_TOKEN;
  const given = request.headers.get("x-lex-desktop-token") ?? "";
  if (process.env.LEX_DESKTOP !== "1" || !token || !safeEqual(given, token)) return new Response("Forbidden", { status: 403 });
  setTimeout(() => process.exit(0), 150);
  return new Response("ok");
}
