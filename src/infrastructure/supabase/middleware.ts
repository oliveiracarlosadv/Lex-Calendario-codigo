import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { serverSupabaseUrl } from "@/lib/request-origin";

// Rotas de API validam a autenticação por conta própria (respostas JSON 401, webhooks, cron, desktop)
const PUBLIC_PATHS = ["/inicio", "/entrar", "/cadastro", "/recuperar-senha", "/auth", "/api/", "/local/", "/termos", "/privacidade"];

/**
 * Reescreve (sem redirecionar) para outra página, mantendo o endereço e a origem do navegador.
 * Redirecionamentos absolutos do Next.js trocam 127.0.0.1 por "localhost", o que quebraria
 * cookies e o acesso ao backend local do aplicativo desktop.
 */
function rewriteTo(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const res = NextResponse.rewrite(url);
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(serverSupabaseUrl(publicEnv.supabaseUrl), publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path.startsWith(p));

  // Sem sessão: entra automaticamente (sem conta) e segue para a página pedida
  if (!user && !isPublic) {
    return rewriteTo(request, "/inicio", response);
  }

  if (user && !path.startsWith("/auth/mfa") && !path.startsWith("/api")) {
    // MFA: se o usuário possui fator verificado, exige AAL2 para áreas autenticadas
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2" && !isPublic) {
      return rewriteTo(request, "/auth/mfa", response);
    }
  }


  return response;
}
