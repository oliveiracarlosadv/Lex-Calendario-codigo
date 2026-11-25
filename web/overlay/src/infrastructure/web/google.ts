import { pullConnection } from "@/application/sync/calendar-sync";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { publicEnv } from "@/lib/env";

/**
 * Login com Google na versão web, sem servidor: o Google devolve um acesso de 1 hora
 * diretamente ao aparelho. Depois disso, o Lex renova o acesso ao abrir ou ao tocar em Sincronizar.
 */
// Somente leitura: o celular mostra a agenda, mas não altera nada no Google
const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events.readonly";
const TOKEN = "lex-google-token";
const STATE = "lex-google-state";
const FAILED = "lex-google-erro";
const HINT = "lex-google-conta";
const RENEWED = "lex-google-renovado";

interface Saved {
  token: string;
  exp: number;
  fresh?: boolean;
}

function saved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(TOKEN) ?? "null") as Saved | null;
  } catch {
    return null;
  }
}

export function currentGoogleToken() {
  const s = saved();
  return s && s.exp - Date.now() > 120_000 ? s.token : null;
}

/** Vai para o Google. silent: renova sem perguntar nada, se a conta já autorizou o Lex. */
export function startGoogleLogin(opts: { silent?: boolean } = {}) {
  const state = crypto.randomUUID();
  localStorage.setItem(STATE, JSON.stringify({ state, back: location.pathname + location.search }));
  const hint = localStorage.getItem(HINT);
  const params = new URLSearchParams({
    client_id: publicEnv.googleWebClientId,
    redirect_uri: `${location.origin}${process.env.NEXT_PUBLIC_BASE_PATH}/auth-google/`,
    response_type: "token",
    scope: SCOPES,
    include_granted_scopes: "true",
    state,
    prompt: opts.silent ? "none" : "select_account",
    ...(hint ? { login_hint: hint } : {}),
  });
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function activeConnections() {
  const { data } = await getSupabaseBrowserClient().from("calendar_connections").select("id, account_email").eq("is_active", true);
  return (data ?? []) as { id: string; account_email: string | null }[];
}

let running: Promise<{ connections: number; sent: number; received: number; deleted: number; errors: string[] }> | null = null;

/** Traz as novidades do Google Agenda (a versão web só lê). */
export function syncGoogle() {
  running ??= (async () => {
    const conns = await activeConnections();
    let sent = 0;
    let received = 0;
    let deleted = 0;
    const errors: string[] = [];
    for (const c of conns) {
      try {
        const pulled = await pullConnection(c.id);
        received += pulled.created + pulled.updated;
        deleted += pulled.deleted;
      } catch (e) {
        const message = (e as Error).message.slice(0, 300);
        errors.push(message);
        await getSupabaseBrowserClient().from("calendar_connections").update({ last_error: message }).eq("id", c.id);
      }
    }
    return { connections: conns.length, sent, received, deleted, errors };
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Botão Sincronizar: com o acesso vencido, renova no Google e sincroniza na volta. */
export async function syncOrRenew() {
  if (currentGoogleToken()) return syncGoogle();
  const failed = localStorage.getItem(FAILED);
  localStorage.removeItem(FAILED);
  startGoogleLogin({ silent: !failed });
  return new Promise<never>(() => undefined); // a página está indo para o Google
}

export const pushIfConnected = async (_eventId: string) => ({ pushed: 0 });

export async function disconnectGoogle(id: string) {
  await getSupabaseBrowserClient().from("calendar_connections").delete().eq("id", id);
  for (const key of [TOKEN, HINT, FAILED]) localStorage.removeItem(key);
}

const notify = (status: "conectado" | "erro") => window.postMessage({ type: "lex-oauth", provider: "google", status }, location.origin);

/** Ao abrir o app: conclui o login que acabou de voltar do Google e mantém a agenda em dia. */
export async function startGoogleSync(orgId: string, userId: string) {
  if (!publicEnv.googleWebClientId) return;
  const sb = getSupabaseBrowserClient();
  const s = saved();
  if (s?.fresh) {
    localStorage.setItem(TOKEN, JSON.stringify({ token: s.token, exp: s.exp }));
    try {
      const info = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${s.token}` } })).json()) as { email?: string };
      if (info.email) localStorage.setItem(HINT, info.email);
      const { error } = await sb
        .from("calendar_connections")
        .upsert(
          { organization_id: orgId, user_id: userId, provider: "google", account_email: info.email ?? null, external_calendar_id: "primary", is_active: true, last_error: null },
          { onConflict: "user_id,provider,external_calendar_id" },
        );
      if (error) throw error;
      notify("conectado");
    } catch {
      notify("erro");
    }
  } else if (localStorage.getItem(FAILED) === "access_denied") {
    localStorage.removeItem(FAILED);
  }

  let conns = await activeConnections();
  // Cópia na memória (o banco guardado estava ocupado por outra janela): refaz a conexão já autorizada
  const account = localStorage.getItem(HINT);
  if (!conns.length && account) {
    await sb
      .from("calendar_connections")
      .upsert(
        { organization_id: orgId, user_id: userId, provider: "google", account_email: account, external_calendar_id: "primary", is_active: true, last_error: null },
        { onConflict: "user_id,provider,external_calendar_id" },
      );
    conns = await activeConnections();
  }
  if (!conns.length) return;
  // Como no computador: mantém a agenda em dia sozinha. Sem acesso válido, renova no Google
  // sem perguntar nada (no máximo uma vez a cada 10 minutos, para nunca entrar em ciclo).
  const tick = () => {
    if (!navigator.onLine || document.visibilityState !== "visible") return;
    if (currentGoogleToken()) void syncGoogle();
    else if (!localStorage.getItem(FAILED) && Date.now() - Number(localStorage.getItem(RENEWED) ?? 0) > 10 * 60_000) {
      localStorage.setItem(RENEWED, String(Date.now()));
      startGoogleLogin({ silent: true });
    }
  };
  tick();
  setInterval(tick, 30_000);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("online", tick);
}

/** Renovação automática falhou (o Google quer confirmar a conta): o aviso no calendário pede um toque. */
export const googleNeedsAttention = () => !!localStorage.getItem(FAILED) && !currentGoogleToken();
