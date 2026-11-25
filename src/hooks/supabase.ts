"use client";

import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";

export const sb = () => getSupabaseBrowserClient();

/** Lança o erro do Supabase (para TanStack Query tratar) ou devolve os dados. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const pendingSync = new Map<string, ReturnType<typeof setTimeout>>();

/** Sincroniza imediatamente (botão Salvar). */
export async function syncEventNow(eventId: string) {
  const previous = pendingSync.get(eventId);
  if (previous) clearTimeout(previous);
  pendingSync.delete(eventId);
  await fetch(`/api/events/${eventId}/sync`, { method: "POST" }).catch(() => undefined);
}

/**
 * Envia o evento às agendas externas conectadas (Google, Outlook, iCloud) com todos os detalhes.
 * Agrupa alterações seguidas (1,5 s) para não sobrecarregar as APIs.
 */
export function syncEventOutbound(eventId: string) {
  const previous = pendingSync.get(eventId);
  if (previous) clearTimeout(previous);
  pendingSync.set(
    eventId,
    setTimeout(() => {
      pendingSync.delete(eventId);
      void fetch(`/api/events/${eventId}/sync`, { method: "POST" }).catch(() => undefined);
    }, 1500),
  );
}
