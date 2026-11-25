import "server-only";
import { optionalServerEnv, publicEnv } from "@/lib/env";

export interface ReminderEmail {
  to: string;
  name: string | null;
  title: string;
  when: string;
  kindLabel: string;
  location?: string | null;
  processNumber?: string | null;
  link: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderReminderEmail(r: ReminderEmail) {
  const rows = [
    ["Tipo", r.kindLabel],
    ["Quando", r.when],
    r.location ? ["Local", r.location] : null,
    r.processNumber ? ["Processo", r.processNumber] : null,
  ].filter(Boolean) as [string, string][];
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;padding:32px;border:1px solid #e8e8ed">
    <tr><td style="font-size:13px;color:#556b2f;font-weight:600;letter-spacing:.02em">Lex Calendário · Lembrete</td></tr>
    <tr><td style="font-size:22px;font-weight:600;padding:8px 0 4px;letter-spacing:-.01em">${esc(r.title)}</td></tr>
    <tr><td style="font-size:15px;color:#6e6e73;padding-bottom:20px">Olá${r.name ? `, ${esc(r.name.split(" ")[0])}` : ""}! Este é o seu lembrete.</td></tr>
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;font-size:14px"><span style="color:#6e6e73;display:inline-block;width:90px">${k}</span>${esc(v)}</td></tr>`,
      )
      .join("")}
    <tr><td style="padding-top:24px"><a href="${r.link}" style="background:#556b2f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:500;display:inline-block">Abrir compromisso</a></td></tr>
  </table>
  <p style="font-size:12px;color:#86868b">Você recebe este e-mail porque configurou lembretes no Lex Calendário.<br>Ajuste suas preferências em ${publicEnv.appUrl}/configuracoes/notificacoes</p>
  </td></tr></table></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = optionalServerEnv("RESEND_API_KEY");
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: optionalServerEnv("EMAIL_FROM") ?? "Lex Calendário <agenda@lexcalendario.com.br>",
      to: [to],
      subject,
      html,
    }),
  });
  return res.ok;
}
