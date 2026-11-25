import { toast } from "sonner";
import { exportBackup, importBackup } from "@/application/backup/backup";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { publicEnv } from "@/lib/env";
import { handleLocal } from "./backend";
import { disconnectGoogle, pushIfConnected, syncGoogle, syncOrRenew } from "./google";

/**
 * A versão web não tem servidor: as chamadas a /api são atendidas aqui. O que depende de
 * servidor (Google, tribunais, envio de e-mail) responde com um aviso amigável.
 */
const UNAVAILABLE = "Este recurso funciona no app de computador do Lex Calendário.";

async function context() {
  const sb = getSupabaseBrowserClient();
  const { data } = await sb.auth.getUser();
  const userId = data.user!.id;
  const { data: p } = await sb.from("profiles").select("current_organization_id").eq("id", userId).single();
  return { userId, orgId: (p as { current_organization_id: string }).current_organization_id };
}

async function saveBackup(withFiles: boolean) {
  const { orgId, userId } = await context();
  const backup = await exportBackup(orgId, userId, { includeFiles: withFiles });
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
  a.download = `lex-calendario-backup-${date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function handleApi(path: string, init?: RequestInit): Promise<Response> {
  if (path.startsWith("/api/health")) return Response.json({ ok: true });
  if (path.startsWith("/api/integrations/providers")) return Response.json({ google: !!publicEnv.googleWebClientId });
  if (path.startsWith("/api/integrations/sincronizar")) return Response.json(await syncOrRenew());
  const connection = path.match(/^\/api\/integrations\/connections\/([^/?]+)(\/sync)?/);
  if (connection?.[2]) return Response.json(await syncGoogle());
  if (connection && init?.method === "DELETE") {
    await disconnectGoogle(connection[1]);
    return Response.json({ ok: true });
  }
  const eventSync = path.match(/^\/api\/events\/([^/?]+)\/sync/);
  if (eventSync) return Response.json(await pushIfConnected(eventSync[1]).catch(() => ({ pushed: 0 })));
  if (path.startsWith("/api/backup/import")) {
    try {
      const form = init?.body as FormData;
      const data = JSON.parse(await (form.get("file") as File).text());
      const { orgId, userId } = await context();
      return Response.json(await importBackup(data, orgId, userId, { restoreSettings: form.get("configuracoes") !== "0" }));
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  return Response.json({ error: UNAVAILABLE }, { status: 501 });
}

let installed = false;

export function installWebShims() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (path.startsWith("/api/")) return handleApi(path, init);
    if (path.startsWith("/local/")) return handleLocal(new Request(new URL(path, location.origin), init));
    return nativeFetch(input, init);
  };

  // Links de download do backup: o arquivo é gerado aqui mesmo
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("/api/backup/export")) void saveBackup(href.includes("arquivos=1"));
    else toast.info(UNAVAILABLE);
  }, true);

  // Anexos: abre o arquivo guardado no banco do navegador
  const nativeOpen = window.open.bind(window);
  window.open = (url, target, features) => {
    const href = String(url ?? "");
    if (href.startsWith("/api/")) {
      toast.info(UNAVAILABLE);
      return null;
    }
    if (!href.includes("/local/storage/")) return nativeOpen(url, target, features);
    const win = nativeOpen("about:blank", "_blank");
    void handleLocal(new Request(href)).then(async (res) => {
      if (win) win.location.href = URL.createObjectURL(await res.blob());
    });
    return win;
  };
}
