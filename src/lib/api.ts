import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { Role } from "@/domain/identity/permissions";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireServerEnv } from "./env";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Usuário autenticado + organização atual + papel (via RLS). */
export async function getUserContext() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("current_organization_id, full_name").eq("id", user.id).single();
  const orgId = profile?.current_organization_id as string | undefined;
  if (!orgId) return null;
  const { data: membership } = await supabase.from("memberships").select("role").eq("organization_id", orgId).eq("user_id", user.id).single();
  return { supabase, user, orgId, role: (membership?.role ?? "assistant") as Role };
}

/** Rotas de cron: a Vercel envia "Authorization: Bearer $CRON_SECRET". */
export function isAuthorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Token determinístico para validar webhooks (Google channel token / Graph clientState). */
export function webhookToken(connectionId: string) {
  return createHmac("sha256", requireServerEnv("ENCRYPTION_KEY")).update(`webhook:${connectionId}`).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
