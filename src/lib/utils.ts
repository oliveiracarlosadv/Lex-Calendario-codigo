import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TZ = "America/Sao_Paulo";

/** Converte para Date aceitando "AAAA-MM-DD" (meio-dia, sem virar o dia pelo fuso) e ISO completo. */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  const d = parseDate(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...opts }).format(d);
}

/** Data sem hora (prazo, publicação, nascimento): usa só AAAA-MM-DD, qualquer que seja o formato recebido. */
export function formatDay(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return value ? formatDate(value.slice(0, 10), opts) : "—";
}

export function formatDateTime(iso: string | null | undefined, allDay = false) {
  if (!iso) return "—";
  return formatDate(iso, allDay ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(iso: string) {
  return formatDate(iso, { hour: "2-digit", minute: "2-digit" });
}

export function relativeDays(iso: string, now = new Date()) {
  const start = new Date(new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }));
  const today = new Date(now.toLocaleDateString("en-CA", { timeZone: TZ }));
  const diff = Math.round((start.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return diff > 0 ? `Em ${diff} dias` : `Há ${-diff} dias`;
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter((p) => !/^(d[aeo]s?|e|dra?\.?)$/i.test(p));
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Converte "AAAA-MM-DDTHH:mm" (input datetime-local, horário de Brasília) para ISO UTC. */
export function localInputToISO(value: string) {
  return new Date(`${value}:00-03:00`).toISOString();
}

/** ISO → valor para <input type="datetime-local"> no horário de Brasília. */
export function isoToLocalInput(iso: string) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

/** Cor de texto legível sobre um fundo hexadecimal. */
export function readableOn(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#1d1d1f" : "#ffffff";
}
