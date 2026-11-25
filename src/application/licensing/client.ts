import "server-only";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import type { LicenseStatus } from "./server";

/**
 * Aplicativo instalado: conversa com o servidor de assinaturas e guarda a sessão no
 * computador. Só existe quando a versão foi gerada com o endereço do servidor
 * (variável LICENSE_SERVER_URL no GitHub); sem ele, o Lex continua livre.
 */

export const licenseServer = () => (process.env.NEXT_PUBLIC_LICENSE_SERVER ?? "").trim().replace(/\/$/, "");
export const licenseRequired = () => process.env.LEX_DESKTOP === "1" && !!process.env.LEX_DATA_DIR && /^https:\/\//.test(licenseServer());

/** Sem internet, vale a última consulta por este prazo. */
const OFFLINE_DAYS = 7;
const REFRESH_MS = 6 * 3600_000;

interface Saved {
  token: string;
  status: LicenseStatus;
  checkedAt: string;
}

export interface LocalLicense {
  required: boolean;
  signedIn: boolean;
  status: LicenseStatus | null;
  /** Pode usar o aplicativo agora */
  allowed: boolean;
  offline: boolean;
}

const file = () => path.join(process.env.LEX_DATA_DIR as string, "assinatura.json");

function read(): Saved | null {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Saved) : null;
  } catch {
    return null;
  }
}
const write = (saved: Saved) => writeFileSync(file(), JSON.stringify(saved), { mode: 0o600 });

export class LicenseClientError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function call<T>(p: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${licenseServer()}${p}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new LicenseClientError("Sem conexão com o servidor de assinaturas. Verifique a internet.", 0);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new LicenseClientError(json.error ?? "O servidor de assinaturas recusou o pedido.", res.status);
  return json;
}

const usable = (s: LicenseStatus) => s.state !== "expired" && (!s.until || new Date(s.until).getTime() > Date.now() - 5 * 864e5);

export async function localLicense(forceRefresh = false): Promise<LocalLicense> {
  if (!licenseRequired()) return { required: false, signedIn: false, status: null, allowed: true, offline: false };
  let saved = read();
  if (!saved) return { required: true, signedIn: false, status: null, allowed: false, offline: false };
  let offline = false;
  if (forceRefresh || Date.now() - new Date(saved.checkedAt).getTime() > REFRESH_MS || !usable(saved.status)) {
    try {
      saved = { token: saved.token, status: await call<LicenseStatus>("/api/licenca/status", { token: saved.token }), checkedAt: new Date().toISOString() };
      write(saved);
    } catch (e) {
      if ((e as LicenseClientError).status === 401) {
        rmSync(file(), { force: true });
        return { required: true, signedIn: false, status: null, allowed: false, offline: false };
      }
      offline = true;
    }
  }
  const fresh = Date.now() - new Date(saved.checkedAt).getTime() < OFFLINE_DAYS * 864e5;
  return { required: true, signedIn: true, status: saved.status, allowed: usable(saved.status) && fresh, offline };
}

export const requestLoginCode = (email: string) => call<{ ok: boolean }>("/api/licenca/codigo", { method: "POST", body: { email } });

export async function signInLocal(email: string, code: string) {
  const data = await call<{ token: string; status: LicenseStatus }>("/api/licenca/entrar", { method: "POST", body: { email, code, device: hostname() } });
  write({ token: data.token, status: data.status, checkedAt: new Date().toISOString() });
}

export async function subscribeLocal(name: string, document: string) {
  const saved = read();
  if (!saved) throw new LicenseClientError("Entre com o seu e-mail primeiro.", 401);
  return call<{ url: string }>("/api/licenca/assinar", { method: "POST", token: saved.token, body: { name, document } });
}

export async function signOutLocal() {
  const saved = read();
  if (saved) await call("/api/licenca/status", { method: "DELETE", token: saved.token }).catch(() => undefined);
  rmSync(file(), { force: true });
}
