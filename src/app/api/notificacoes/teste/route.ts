import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Cria uma notificação de teste (aparece no app e, no desktop, como notificação do sistema). */
export async function POST() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  // Notificações são criadas pelo servidor (o usuário não tem permissão de inserir via RLS)
  const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? getSupabaseAdminClient() : ctx.supabase;
  const { error } = await db.from("notifications").insert({
    organization_id: ctx.orgId,
    user_id: ctx.user.id,
    title: "Notificação de teste",
    body: "Se você está vendo isto, os avisos do Lex Calendário estão funcionando.",
    link: "/notificacoes",
    kind: "test",
  });
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
