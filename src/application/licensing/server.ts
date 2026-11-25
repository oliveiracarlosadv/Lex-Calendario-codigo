import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sendSmtp } from "@/infrastructure/notifications/smtp";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/server";
import { optionalServerEnv, requireServerEnv } from "@/lib/env";

/**
 * Servidor de assinaturas (roda na instalação na nuvem do titular do Lex).
 * Entrada por e-mail + código, período de teste e cobrança mensal pelo Asaas.
 *
 * Configuração (variáveis de ambiente do servidor):
 *   ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, ASAAS_SANDBOX=1 (testes)
 *   LICENSE_PRICE (ex.: 49.90) · LICENSE_TRIAL_DAYS (padrão 14)
 *   LICENSE_SMTP_HOST, LICENSE_SMTP_PORT, LICENSE_SMTP_USER, LICENSE_SMTP_PASSWORD, LICENSE_SMTP_FROM
 *   LICENSE_ADMIN_EMAILS (quem vê a lista de assinantes, separados por vírgula)
 */

export class LicenseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const GRACE_DAYS = 5;
const DAY = 864e5;
export const trialDays = () => Math.max(0, Number(optionalServerEnv("LICENSE_TRIAL_DAYS") ?? 14) || 14);
export const price = () => Number((optionalServerEnv("LICENSE_PRICE") ?? "0").replace(",", ".")) || 0;
const normalize = (email: string) => email.trim().toLowerCase();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const codeHash = (email: string, code: string) => createHmac("sha256", requireServerEnv("ENCRYPTION_KEY")).update(`licenca:${email}:${code}`).digest("hex");

interface Account {
  id: string;
  email: string;
  name: string | null;
  document: string | null;
  status: "trial" | "active" | "overdue" | "canceled";
  trial_ends_at: string;
  paid_until: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
}

export interface LicenseStatus {
  email: string;
  name: string | null;
  /** trial: em teste · active: assinatura em dia · expired: precisa assinar ou pagar */
  state: "trial" | "active" | "expired";
  until: string | null;
  subscribed: boolean;
  price: number;
}

function toStatus(a: Account): LicenseStatus {
  const now = Date.now();
  const paid = a.paid_until ? new Date(a.paid_until).getTime() : 0;
  // Pagamento em dia; quem atrasa tem alguns dias de tolerância antes de bloquear
  const active = paid > now || (paid > 0 && a.status !== "canceled" && paid + GRACE_DAYS * DAY > now);
  const state = active ? "active" : new Date(a.trial_ends_at).getTime() > now ? "trial" : "expired";
  return {
    email: a.email,
    name: a.name,
    state,
    until: state === "active" ? a.paid_until : state === "trial" ? a.trial_ends_at : null,
    subscribed: !!a.asaas_subscription_id && a.status !== "canceled",
    price: price(),
  };
}

// ───────────────────────────── Entrada por e-mail + código ─────────────────────────────

export async function requestCode(rawEmail: string) {
  const email = normalize(rawEmail);
  const admin = getSupabaseAdminClient();
  const { data: last } = await admin.from("license_codes").select("sent_at").eq("email", email).maybeSingle();
  if (last && Date.now() - new Date(last.sent_at as string).getTime() < 60_000) throw new LicenseError("Aguarde um minuto para pedir outro código.", 429);

  const host = optionalServerEnv("LICENSE_SMTP_HOST");
  const user = optionalServerEnv("LICENSE_SMTP_USER");
  const password = optionalServerEnv("LICENSE_SMTP_PASSWORD");
  if (!host || !user || !password) throw new LicenseError("O envio de e-mails do servidor de assinaturas não está configurado.", 503);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await admin
    .from("license_codes")
    .upsert({ email, code_hash: codeHash(email, code), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), attempts: 0, sent_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) throw new LicenseError("Não foi possível gerar o código.", 500);

  const port = Number(optionalServerEnv("LICENSE_SMTP_PORT") ?? 465);
  await sendSmtp(
    { host, port, secure: port === 465, username: user, password, fromName: "Lex Calendário", fromEmail: optionalServerEnv("LICENSE_SMTP_FROM") ?? user },
    {
      to: email,
      subject: `${code} é o seu código do Lex Calendário`,
      text: `Seu código para entrar no Lex Calendário: ${code}\n\nEle vale por 15 minutos. Se você não pediu este código, ignore este e-mail.`,
      html: `<p>Seu código para entrar no <b>Lex Calendário</b>:</p><p style="font-size:28px;letter-spacing:6px"><b>${code}</b></p><p>Ele vale por 15 minutos. Se você não pediu este código, ignore este e-mail.</p>`,
    },
  ).catch(() => {
    throw new LicenseError("Não foi possível enviar o e-mail com o código. Tente de novo em instantes.", 502);
  });
}

export async function signIn(rawEmail: string, code: string, device: string | null): Promise<{ token: string; status: LicenseStatus }> {
  const email = normalize(rawEmail);
  const admin = getSupabaseAdminClient();
  const { data: row } = await admin.from("license_codes").select("code_hash, expires_at, attempts").eq("email", email).maybeSingle();
  const invalid = new LicenseError("Código incorreto ou vencido. Peça um novo código.", 401);
  if (!row || new Date(row.expires_at as string).getTime() < Date.now() || (row.attempts as number) >= 5) throw invalid;
  const expected = Buffer.from(row.code_hash as string);
  const given = Buffer.from(codeHash(email, code.replace(/\D/g, "")));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await admin.from("license_codes").update({ attempts: (row.attempts as number) + 1 }).eq("email", email);
    throw invalid;
  }
  await admin.from("license_codes").delete().eq("email", email);

  let { data: account } = await admin.from("license_accounts").select("*").eq("email", email).maybeSingle();
  if (!account) {
    const created = await admin
      .from("license_accounts")
      .insert({ email, trial_ends_at: new Date(Date.now() + trialDays() * DAY).toISOString() })
      .select("*")
      .single();
    if (created.error || !created.data) throw new LicenseError("Não foi possível criar a conta.", 500);
    account = created.data;
  }
  const token = randomBytes(32).toString("base64url");
  await admin.from("license_sessions").insert({ token_hash: sha(token), account_id: account.id, device: device?.slice(0, 120) ?? null });
  return { token, status: toStatus(account as Account) };
}

async function accountFor(token: string): Promise<Account> {
  const admin = getSupabaseAdminClient();
  const hash = sha(token);
  const { data: session } = await admin.from("license_sessions").select("account_id").eq("token_hash", hash).maybeSingle();
  if (!session) throw new LicenseError("Sessão encerrada. Entre de novo.", 401);
  const { data: account } = await admin.from("license_accounts").select("*").eq("id", session.account_id).maybeSingle();
  if (!account) throw new LicenseError("Conta não encontrada.", 401);
  const now = new Date().toISOString();
  await admin.from("license_sessions").update({ last_seen_at: now }).eq("token_hash", hash);
  await admin.from("license_accounts").update({ last_seen_at: now }).eq("id", account.id);
  return account as Account;
}

export const statusFor = async (token: string) => toStatus(await accountFor(token));

export async function signOut(token: string) {
  await getSupabaseAdminClient().from("license_sessions").delete().eq("token_hash", sha(token));
}

// ───────────────────────────── Asaas ─────────────────────────────

const asaasBase = () => (optionalServerEnv("ASAAS_SANDBOX") === "1" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");

async function asaas<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const key = optionalServerEnv("ASAAS_API_KEY");
  if (!key) throw new LicenseError("A cobrança (Asaas) não está configurada no servidor de assinaturas.", 503);
  const res = await fetch(`${asaasBase()}${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", access_token: key, "User-Agent": "LexCalendario" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new LicenseError("O Asaas não respondeu. Tente de novo em instantes.", 502);
  const json = (await res.json().catch(() => ({}))) as T & { errors?: { description?: string }[] };
  if (!res.ok) throw new LicenseError(json.errors?.[0]?.description ?? `O Asaas recusou o pedido (${res.status}).`, 502);
  return json;
}

/** Cria (ou reaproveita) a assinatura mensal no Asaas e devolve o link da cobrança em aberto. */
export async function subscribe(token: string, input: { name: string; document: string }): Promise<{ url: string }> {
  const account = await accountFor(token);
  const value = price();
  if (!value) throw new LicenseError("O valor da assinatura não está configurado no servidor.", 503);
  const admin = getSupabaseAdminClient();
  const document = input.document.replace(/\D/g, "");
  if (![11, 14].includes(document.length)) throw new LicenseError("Informe um CPF ou CNPJ válido.");

  let customerId = account.asaas_customer_id;
  if (!customerId) {
    customerId = (await asaas<{ id: string }>("/customers", { method: "POST", body: { name: input.name.trim(), email: account.email, cpfCnpj: document, externalReference: account.id } })).id;
    await admin.from("license_accounts").update({ asaas_customer_id: customerId, name: input.name.trim(), document }).eq("id", account.id);
  }
  let subscriptionId = account.status === "canceled" ? null : account.asaas_subscription_id;
  if (!subscriptionId) {
    subscriptionId = (
      await asaas<{ id: string }>("/subscriptions", {
        method: "POST",
        body: {
          customer: customerId,
          billingType: "UNDEFINED", // o assinante escolhe: Pix, boleto ou cartão
          value,
          cycle: "MONTHLY",
          nextDueDate: new Date(Date.now() + DAY).toISOString().slice(0, 10),
          description: "Assinatura mensal do Lex Calendário",
          externalReference: account.id,
        },
      })
    ).id;
    await admin.from("license_accounts").update({ asaas_subscription_id: subscriptionId, status: account.paid_until ? "overdue" : "trial" }).eq("id", account.id);
  }
  const payments = await asaas<{ data?: { invoiceUrl?: string; status?: string; dueDate?: string }[] }>(`/subscriptions/${subscriptionId}/payments`);
  const open = (payments.data ?? []).filter((p) => p.status === "PENDING" || p.status === "OVERDUE").sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
  const url = open?.invoiceUrl ?? payments.data?.[0]?.invoiceUrl;
  if (!url) throw new LicenseError("A cobrança ainda está sendo gerada. Tente de novo em um minuto.", 503);
  return { url };
}

/** Aviso do Asaas: pagamento confirmado, vencido ou assinatura cancelada. */
export async function handleAsaasEvent(body: { event?: string; payment?: { subscription?: string; customer?: string; dueDate?: string }; subscription?: { id?: string } }) {
  const admin = getSupabaseAdminClient();
  const event = body.event ?? "";
  const subscriptionId = body.payment?.subscription ?? body.subscription?.id ?? null;
  if (!subscriptionId) return;
  const { data: account } = await admin.from("license_accounts").select("id, paid_until").eq("asaas_subscription_id", subscriptionId).maybeSingle();
  if (!account) return;

  if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
    // Pago: vale um mês a partir do vencimento (ou de hoje, se pagou depois)
    const due = body.payment?.dueDate ? new Date(`${body.payment.dueDate}T12:00:00Z`).getTime() : Date.now();
    const from = new Date(Math.max(due, Date.now()));
    from.setUTCMonth(from.getUTCMonth() + 1);
    const current = account.paid_until ? new Date(account.paid_until as string).getTime() : 0;
    await admin.from("license_accounts").update({ status: "active", paid_until: new Date(Math.max(current, from.getTime())).toISOString() }).eq("id", account.id);
  } else if (event === "PAYMENT_OVERDUE") {
    await admin.from("license_accounts").update({ status: "overdue" }).eq("id", account.id);
  } else if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_CHARGEBACK_REQUESTED") {
    await admin.from("license_accounts").update({ status: "overdue", paid_until: new Date().toISOString() }).eq("id", account.id);
  } else if (event === "SUBSCRIPTION_DELETED" || event === "SUBSCRIPTION_INACTIVATED") {
    await admin.from("license_accounts").update({ status: "canceled" }).eq("id", account.id);
  }
}

export function isAsaasWebhook(request: Request) {
  const secret = optionalServerEnv("ASAAS_WEBHOOK_TOKEN");
  if (!secret) return false;
  const a = Buffer.from(request.headers.get("asaas-access-token") ?? "");
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ───────────────────────────── Painel do titular ─────────────────────────────

export const isLicenseAdmin = (email: string | null | undefined) =>
  !!email &&
  (optionalServerEnv("LICENSE_ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());

export async function listSubscribers() {
  const { data } = await getSupabaseAdminClient().from("license_accounts").select("*").order("created_at", { ascending: false }).limit(1000);
  return ((data ?? []) as Account[]).map((a) => ({ ...toStatus(a), document: a.document, createdAt: (a as unknown as { created_at: string }).created_at, lastSeenAt: (a as unknown as { last_seen_at: string | null }).last_seen_at }));
}

export const bearer = (request: Request) => (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
