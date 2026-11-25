import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fail, getUserContext, json } from "@/lib/api";

export const dynamic = "force-dynamic";

const CHOICES = ["padrao", "chrome", "edge", "brave", "safari", "firefox", "app"] as const;
type Choice = (typeof CHOICES)[number];

function installed(id: Choice): boolean {
  if (id === "padrao" || id === "app") return true;
  if (process.platform === "darwin") {
    const apps: Record<string, string> = {
      chrome: "Google Chrome.app",
      edge: "Microsoft Edge.app",
      brave: "Brave Browser.app",
      safari: "Safari.app",
      firefox: "Firefox.app",
    };
    return existsSync(path.join("/Applications", apps[id]));
  }
  if (process.platform === "win32") {
    const rel: Record<string, string> = {
      chrome: "Google\\Chrome\\Application\\chrome.exe",
      edge: "Microsoft\\Edge\\Application\\msedge.exe",
      brave: "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      firefox: "Mozilla Firefox\\firefox.exe",
      safari: "",
    };
    return !!rel[id] && [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].some((b) => b && existsSync(path.join(b, rel[id])));
  }
  const bins: Record<string, string[]> = { chrome: ["google-chrome", "google-chrome-stable"], edge: ["microsoft-edge"], brave: ["brave-browser"], firefox: ["firefox"], safari: [] };
  return (bins[id] ?? []).some((b) => (process.env.PATH ?? "").split(":").some((dir) => existsSync(path.join(dir, b))));
}

const file = () => path.join(process.env.LEX_DATA_DIR ?? "", "navegador.txt");

/** Navegador em que o app desktop abre (lido pelo inicializador a cada abertura). */
export async function GET() {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  // Sem escolha salva: no Windows, janela própria (ícone do Lex na barra de tarefas); nos demais, navegador padrão
  const fallback = process.platform === "win32" ? "app" : "padrao";
  let choice: string = fallback;
  try {
    choice = readFileSync(file(), "utf8").trim() || fallback;
  } catch {
    // sem escolha salva: navegador padrão do sistema
  }
  return json({ choice, platform: process.platform, options: CHOICES.map((id) => ({ id, installed: installed(id) })) });
}

export async function POST(request: Request) {
  if (process.env.LEX_DESKTOP !== "1") return fail("Disponível apenas no aplicativo desktop", 404);
  const ctx = await getUserContext();
  if (!ctx) return fail("Não autenticado", 401);
  const { choice } = (await request.json().catch(() => ({}))) as { choice?: string };
  if (!choice || !CHOICES.includes(choice as Choice)) return fail("Opção inválida");
  writeFileSync(file(), choice);
  return json({ ok: true });
}
