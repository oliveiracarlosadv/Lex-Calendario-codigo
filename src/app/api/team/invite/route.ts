import { z } from "zod";
import { can, ROLES } from "@/domain/identity/permissions";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email(), role: z.enum(ROLES) });

export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  if (!can(ctx.role, "team:manage")) return fail("Apenas administradores convidam membros.", 403);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("E-mail ou papel inválido");
  const email = parsed.data.email.toLowerCase();

  // RLS garante que só admin/sócio registram o convite
  const { error } = await ctx.supabase
    .from("invitations")
    .upsert({ organization_id: ctx.orgId, email, role: parsed.data.role, invited_by: ctx.user.id, accepted_at: null }, { onConflict: "organization_id,email" });
  if (error) return fail(error.message, 500);

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { error: inviteError } = await getSupabaseAdminClient().auth.admin.inviteUserByEmail(email, {
      redirectTo: `${publicEnv.appUrl}/auth/callback?next=/configuracoes/perfil`,
    });
    // Usuário já existente: o convite fica registrado e vale no próximo cadastro/organização
    if (inviteError && !/already/i.test(inviteError.message)) return fail(inviteError.message, 500);
  }
  return json({ ok: true });
}
