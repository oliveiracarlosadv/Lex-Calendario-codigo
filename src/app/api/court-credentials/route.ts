import { z } from "zod";
import { encryptSecret } from "@/infrastructure/crypto/secrets";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const Body = z.object({
  tribunal: z.string().min(2).max(12),
  courtSystem: z.enum(["pje", "esaj", "projudi", "eproc", "tucujuris", "other"]),
  username: z.string().min(3).max(40),
  password: z.string().min(1).max(200),
});

/** Armazena credenciais de sistemas processuais criptografadas (somente o servidor lê). */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Dados inválidos");
  const { tribunal, courtSystem, username, password } = parsed.data;
  const { error } = await getSupabaseAdminClient()
    .from("court_credentials")
    .upsert(
      { organization_id: ctx.orgId, user_id: ctx.user.id, court_system: courtSystem, tribunal: tribunal.toUpperCase(), username: username.replace(/\D/g, "") || username, secret_enc: encryptSecret(password) },
      { onConflict: "user_id,court_system,tribunal" },
    );
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
