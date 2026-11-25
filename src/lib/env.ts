/** Leitura centralizada de variáveis de ambiente. */

export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  fullCalendarLicense: process.env.NEXT_PUBLIC_FULLCALENDAR_LICENSE_KEY ?? "",
  /** Aplicativo desktop/offline: banco local embutido, sem conta obrigatória. */
  localMode: process.env.NEXT_PUBLIC_LEX_LOCAL === "1",
  /** Versão web (GitHub Pages): roda inteira no navegador, com os dados no próprio aparelho. */
  webMode: process.env.NEXT_PUBLIC_LEX_WEB === "1",
  /** Versão web: ID público do cliente OAuth do Google (tipo "Aplicativo da Web"). */
  googleWebClientId: process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  /** Versão do app (definida no build da release a partir da tag, ex.: 1.3.0). */
  appVersion: (process.env.NEXT_PUBLIC_APP_VERSION ?? "").replace(/^v/, "") || "dev",
};

export const LEGAL_LINKS = {
  privacy: "/privacidade.html",
  terms: "/termos.html",
};

export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export const optionalServerEnv = (name: string): string | undefined => process.env[name] || undefined;
