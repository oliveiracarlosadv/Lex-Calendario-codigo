/**
 * Origem real da requisição (protocolo + host do cabeçalho). O Next.js normaliza
 * 127.0.0.1 para "localhost" em request.url/nextUrl; usar o Host preserva a mesma
 * origem da página (cookies e chamadas ao banco local continuam válidos).
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return host ? `${proto}://${host}` : url.origin;
}

/** URL do Supabase (ou do backend local, no modo desktop) para o lado do servidor. */
export function serverSupabaseUrl(fallback: string) {
  return process.env.LEX_LOCAL === "1" ? `http://127.0.0.1:${process.env.PORT ?? 47830}/local` : fallback;
}

/**
 * Redirecionamento com caminho relativo: o navegador resolve na mesma origem da página
 * (o Next.js reescreve 127.0.0.1 como "localhost" em URLs absolutas, o que quebraria
 * cookies e o acesso ao backend local).
 */
export function relativeRedirect(pathWithQuery: string, status = 307) {
  return new Response(null, { status, headers: { Location: pathWithQuery } });
}
