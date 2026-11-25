import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, requireServerEnv } from "@/lib/env";
import { serverSupabaseUrl } from "@/lib/request-origin";

/** Cliente com a sessão do usuário (respeita RLS). Server Components, Route Handlers e Server Actions. */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(serverSupabaseUrl(publicEnv.supabaseUrl), publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components não podem gravar cookies; o middleware renova a sessão.
        }
      },
    },
  });
}

/** Cliente administrativo (ignora RLS). Uso exclusivo em cron, webhooks e integrações. */
export function getSupabaseAdminClient() {
  return createClient(serverSupabaseUrl(publicEnv.supabaseUrl), requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  return { supabase, user };
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autenticado");
    this.name = "UnauthorizedError";
  }
}
