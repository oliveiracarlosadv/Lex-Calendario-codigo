import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/infrastructure/crypto/secrets";
import { explainSmtpError, verifySmtp } from "@/infrastructure/notifications/smtp";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from "@/infrastructure/integrations/google/google-calendar";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUBLIC_COLUMNS = "id, host, port, secure, username, from_name, from_email, last_test_at, last_error";

/** Conta de e-mail (SMTP) usada para enviar comunicações aos clientes. A senha nunca volta ao navegador. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { data } = await getSupabaseAdminClient()
    .from("mail_accounts")
    .select(PUBLIC_COLUMNS)
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  const { data: google } = await getSupabaseAdminClient()
    .from("calendar_connections")
    .select("account_email, scopes")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.user.id)
    .eq("provider", "google")
    .eq("is_active", true)
    .maybeSingle();
  const gmailReady = !!google?.scopes?.includes(GMAIL_SEND_SCOPE);
  return json({
    account: data ?? null,
    gmail: gmailReady ? { email: google?.account_email ?? null, replies: !!google?.scopes?.includes(GMAIL_READ_SCOPE) } : null,
    googleEmail: (google?.account_email as string | null) ?? null,
    googleAvailable: !!process.env.GOOGLE_CLIENT_ID,
  });
}

const Body = z.object({
  host: z.string().min(3).max(200),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(3).max(200),
  password: z.string().max(500).optional(),
  fromName: z.string().max(200).nullish(),
  fromEmail: z.string().email(),
});

/** Salva a conta e testa a conexão com o servidor de e-mail. */
export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Confira os dados da conta de e-mail.");
  const b = parsed.data;
  const admin = getSupabaseAdminClient();
  const { data: existing } = await admin
    .from("mail_accounts")
    .select("id, password_enc")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  const password = b.password?.trim() ? b.password.replace(/\s+/g, "") : decryptSecret(existing?.password_enc as string | null);
  if (!password) return fail("Informe a senha (senha de app) da conta de e-mail.");

  let lastError: string | null = null;
  try {
    await verifySmtp({ host: b.host.trim(), port: b.port, secure: b.secure, username: b.username.trim(), password, fromName: b.fromName ?? null, fromEmail: b.fromEmail });
  } catch (err) {
    lastError = explainSmtpError(err);
  }
  const row = {
    organization_id: ctx.orgId,
    user_id: ctx.user.id,
    host: b.host.trim(),
    port: b.port,
    secure: b.secure,
    username: b.username.trim(),
    password_enc: encryptSecret(password),
    from_name: b.fromName?.trim() || null,
    from_email: b.fromEmail.trim(),
    last_test_at: new Date().toISOString(),
    last_error: lastError,
  };
  const { error } = await admin.from("mail_accounts").upsert(row, { onConflict: "organization_id,user_id" });
  if (error) return fail(error.message, 500);
  return lastError ? fail(`Conta salva, mas o teste falhou: ${lastError}`, 422) : json({ ok: true });
}

export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  await getSupabaseAdminClient().from("mail_accounts").delete().eq("organization_id", ctx.orgId).eq("user_id", ctx.user.id);
  return json({ ok: true });
}
