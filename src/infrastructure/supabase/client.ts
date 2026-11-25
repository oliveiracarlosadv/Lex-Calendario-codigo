"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  // Modo local: o backend embutido é servido pela mesma origem da página
  const url = publicEnv.localMode ? `${window.location.origin}/local` : publicEnv.supabaseUrl;
  browserClient ??= createBrowserClient(url, publicEnv.supabaseAnonKey);
  return browserClient;
}
