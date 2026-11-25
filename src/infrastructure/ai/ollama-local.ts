import "server-only";
import { spawn, execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { optionalServerEnv } from "@/lib/env";

/**
 * IA gratuita no computador do usuário (Ollama): verificação, instalação pelo próprio
 * app (download do site oficial ollama.com), inicialização e download do modelo.
 * Usado no app desktop; na versão web só informa a situação.
 */

const run = promisify(execFile);

export const OLLAMA_URL = (optionalServerEnv("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434").replace(/\/$/, "");

export const LOCAL_MODELS = [
  { id: "qwen2.5:7b", label: "Recomendado — melhor redação", size: "4,7 GB", ram: "8 GB de memória ou mais" },
  { id: "qwen2.5:3b", label: "Leve — para computadores mais simples", size: "1,9 GB", ram: "4 GB de memória" },
] as const;

const modelFile = () => (process.env.LEX_DATA_DIR ? path.join(process.env.LEX_DATA_DIR, "ia-modelo.txt") : null);

/** Modelo local em uso: AI_MODEL (configuração) → escolha salva no app → recomendado. */
export function localModel(): string {
  const env = optionalServerEnv("AI_MODEL");
  if (env) return env;
  const file = modelFile();
  if (file) {
    try {
      const saved = readFileSync(file, "utf8").trim();
      if (saved) return saved;
    } catch {
      // sem escolha salva
    }
  }
  return LOCAL_MODELS[0].id;
}

export function saveLocalModel(id: string) {
  const file = modelFile();
  if (file) writeFileSync(file, id);
}

// ───────────────────────────── Situação ─────────────────────────────

function appCandidates(): string[] {
  const home = homedir();
  if (process.platform === "darwin") return ["/Applications/Ollama.app", path.join(home, "Applications", "Ollama.app")];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return [path.join(local, "Programs", "Ollama", "ollama app.exe"), path.join(local, "Programs", "Ollama", "ollama.exe")];
  }
  return [path.join(home, ".local", "share", "lex-ollama", "bin", "ollama"), "/usr/local/bin/ollama", "/usr/bin/ollama"];
}

export const installedPath = () => appCandidates().find((p) => existsSync(p)) ?? null;

async function api<T>(p: string, init?: RequestInit, timeoutMs = 3000): Promise<T | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}${p}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface OllamaStatus {
  desktop: boolean;
  platform: NodeJS.Platform;
  installed: boolean;
  running: boolean;
  version: string | null;
  model: string;
  modelInstalled: boolean;
  installedModels: string[];
  models: typeof LOCAL_MODELS;
  job: InstallJob;
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  const version = await api<{ version: string }>("/api/version");
  const tags = version ? await api<{ models: { name: string }[] }>("/api/tags") : null;
  const names = (tags?.models ?? []).map((m) => m.name);
  const model = localModel();
  return {
    desktop: process.env.LEX_DESKTOP === "1",
    platform: process.platform,
    installed: !!version || !!installedPath(),
    running: !!version,
    version: version?.version ?? null,
    model,
    modelInstalled: names.some((n) => n === model || n === `${model}:latest`),
    installedModels: names,
    models: LOCAL_MODELS,
    job: job(),
  };
}

// ───────────────────────────── Tarefa em andamento ─────────────────────────────

export interface InstallJob {
  state: "idle" | "running" | "done" | "error";
  step: string;
  progress: number | null; // 0..1
  error: string | null;
  startedAt: string | null;
}

const g = globalThis as unknown as { __lexOllamaJob?: InstallJob };
const job = (): InstallJob => (g.__lexOllamaJob ??= { state: "idle", step: "", progress: null, error: null, startedAt: null });
const update = (patch: Partial<InstallJob>) => Object.assign(job(), patch);

/** Inicia a instalação (ou só o modelo, se o Ollama já existir) em segundo plano. */
export function startSetup(model: string): InstallJob {
  if (job().state === "running") return job();
  if (!LOCAL_MODELS.some((m) => m.id === model)) model = LOCAL_MODELS[0].id;
  saveLocalModel(model);
  update({ state: "running", step: "Preparando…", progress: null, error: null, startedAt: new Date().toISOString() });
  void (async () => {
    try {
      if (!(await api("/api/version"))) {
        if (!installedPath()) await install();
        await startServer();
      }
      await pullModel(model);
      update({ state: "done", step: "IA pronta para usar", progress: 1 });
    } catch (e) {
      update({ state: "error", error: (e as Error).message, progress: null });
    }
  })();
  return job();
}

async function download(url: string, dest: string, label: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Não foi possível baixar o Ollama (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  let done = 0;
  const body = Readable.fromWeb(res.body as WebReadableStream);
  body.on("data", (chunk: Buffer) => {
    done += chunk.length;
    if (total) update({ step: `${label} (${Math.round(done / 1048576)} de ${Math.round(total / 1048576)} MB)`, progress: done / total });
  });
  await pipeline(body, createWriteStream(dest));
}

async function install() {
  if (process.env.LEX_DESKTOP !== "1") throw new Error("A instalação automática está disponível no aplicativo instalado no computador.");
  const work = await mkdtemp(path.join(tmpdir(), "lex-ollama-"));
  try {
    if (process.platform === "darwin") {
      const zip = path.join(work, "Ollama-darwin.zip");
      await download("https://ollama.com/download/Ollama-darwin.zip", zip, "Baixando o Ollama");
      update({ step: "Instalando o Ollama em Aplicativos…", progress: null });
      let target = "/Applications";
      try {
        await run("ditto", ["-x", "-k", zip, target]);
      } catch {
        target = path.join(homedir(), "Applications");
        mkdirSync(target, { recursive: true });
        await run("ditto", ["-x", "-k", zip, target]);
      }
      await run("xattr", ["-dr", "com.apple.quarantine", path.join(target, "Ollama.app")]).catch(() => undefined);
    } else if (process.platform === "win32") {
      const exe = path.join(work, "OllamaSetup.exe");
      await download("https://ollama.com/download/OllamaSetup.exe", exe, "Baixando o Ollama");
      update({ step: "Instalando o Ollama…", progress: null });
      await run(exe, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], { timeout: 10 * 60_000 });
    } else {
      const tgz = path.join(work, "ollama-linux.tgz");
      const arch = process.arch === "arm64" ? "arm64" : "amd64";
      await download(`https://ollama.com/download/ollama-linux-${arch}.tgz`, tgz, "Baixando o Ollama");
      update({ step: "Instalando o Ollama…", progress: null });
      const dir = path.join(homedir(), ".local", "share", "lex-ollama");
      mkdirSync(dir, { recursive: true });
      await run("tar", ["-xzf", tgz, "-C", dir]);
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  if (!installedPath()) throw new Error("O Ollama não foi encontrado após a instalação.");
}

/** Liga o Ollama (que passa a abrir sozinho com o computador, no Mac e no Windows). */
export async function startServer() {
  if (await api("/api/version")) return;
  const app = installedPath();
  if (!app) throw new Error("O Ollama não está instalado.");
  update({ step: "Iniciando a IA…", progress: null });
  if (process.platform === "darwin") {
    spawn("open", ["-g", "-a", app], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    spawn(app, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else {
    spawn(app, ["serve"], { detached: true, stdio: "ignore" }).unref();
  }
  for (let i = 0; i < 60; i++) {
    if (await api("/api/version")) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("O Ollama foi instalado, mas não iniciou. Abra o app Ollama uma vez e tente de novo.");
}

async function pullModel(model: string) {
  const tags = await api<{ models: { name: string }[] }>("/api/tags");
  if ((tags?.models ?? []).some((m) => m.name === model || m.name === `${model}:latest`)) return;
  update({ step: `Baixando o modelo ${model}…`, progress: 0 });
  const res = await fetch(`${OLLAMA_URL}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }) });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar o modelo (HTTP ${res.status}).`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
      if (msg.error) throw new Error(msg.error);
      if (msg.total && msg.completed) {
        update({
          step: `Baixando o modelo ${model} (${(msg.completed / 1e9).toFixed(1)} de ${(msg.total / 1e9).toFixed(1)} GB)`,
          progress: msg.completed / msg.total,
        });
      } else if (msg.status) {
        update({ step: msg.status === "success" ? "Modelo instalado" : `Modelo: ${msg.status}` });
      }
    }
  }
}

// ───────────────────────────── Desinstalação ─────────────────────────────

/**
 * Remove o Ollama deste computador: encerra o programa, apaga o aplicativo e os modelos
 * baixados (pasta .ollama, vários GB). Só no aplicativo instalado.
 */
export async function uninstall() {
  if (process.env.LEX_DESKTOP !== "1") throw new Error("A desinstalação está disponível no aplicativo instalado no computador.");
  if (job().state === "running") throw new Error("Aguarde a instalação em andamento terminar.");
  const home = homedir();
  const quiet = (cmd: string, args: string[], timeout = 30_000) => run(cmd, args, { timeout }).catch(() => undefined);
  const remove = (target: string) => rm(target, { recursive: true, force: true });

  if (process.platform === "darwin") {
    await quiet("osascript", ["-e", 'quit app "Ollama"']);
    await quiet("pkill", ["-x", "ollama"]);
    await quiet("pkill", ["-x", "Ollama"]);
    for (const app of appCandidates()) await remove(app).catch(() => undefined);
    await remove(path.join(home, "Library", "Application Support", "Ollama")).catch(() => undefined);
  } else if (process.platform === "win32") {
    await quiet("taskkill", ["/IM", "ollama app.exe", "/F"]);
    await quiet("taskkill", ["/IM", "ollama.exe", "/F"]);
    const dir = path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "Ollama");
    const uninstaller = path.join(dir, "unins000.exe");
    if (existsSync(uninstaller)) await quiet(uninstaller, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], 5 * 60_000);
    await remove(dir).catch(() => undefined);
  } else {
    const own = path.join(home, ".local", "share", "lex-ollama");
    await quiet("pkill", ["-f", path.join(own, "bin", "ollama")]);
    await remove(own).catch(() => undefined);
  }
  if (installedPath()) {
    throw new Error("Não foi possível remover o Ollama automaticamente (ele foi instalado fora do Lex ou exige senha de administrador). Remova pelo próprio sistema.");
  }
  // Modelos baixados
  await remove(path.join(home, ".ollama")).catch(() => undefined);
  update({ state: "idle", step: "", progress: null, error: null });
}
