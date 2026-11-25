"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { handleLocal } from "@/infrastructure/web/backend";

let browserClient: SupabaseClient | undefined;

/** Versão web: o "servidor" do Supabase é atendido dentro do próprio navegador. */
export function getSupabaseBrowserClient() {
  browserClient ??= createClient(`${window.location.origin}/local`, "lex-local", {
    global: { fetch: (input, init) => handleLocal(new Request(input, init)) },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "lex-web-sessao" },
  });
  return browserClient;
}
