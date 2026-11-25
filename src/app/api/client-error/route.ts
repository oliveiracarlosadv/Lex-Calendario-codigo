export const dynamic = "force-dynamic";

/** Recebe erros da interface e os grava no log do servidor (no app desktop: dados/lex.log). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { message?: string; stack?: string; url?: string; digest?: string };
  console.error("[interface] erro:", body.message, "| tela:", body.url, "| digest:", body.digest, "\n", body.stack ?? "");
  return new Response(null, { status: 204 });
}
