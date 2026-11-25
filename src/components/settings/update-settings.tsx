"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileArchive, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatDateTime } from "@/lib/utils";

interface UpdateInfo {
  current: string;
  latest?: string;
  state?: "atualizado" | "disponivel" | "baixando" | "instalando" | "erro";
  checkedAt?: string;
  error?: string;
  notes?: string;
  platform: string;
  arch: string;
  updatedFrom: string | null;
}

const isDesktopHost = () => typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname);

function useUpdateInfo(poll = false) {
  return useQuery({
    queryKey: ["desktop-update"],
    enabled: isDesktopHost(),
    refetchInterval: poll ? 3000 : false,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/desktop/atualizacao");
      if (!res.ok) throw new Error();
      return (await res.json()) as UpdateInfo;
    },
  });
}

/** Nome do pacote certo para este computador. */
function expectedPackage(platform: string, arch: string) {
  if (platform === "darwin") return arch === "arm64" ? "LexCalendario-Instalador-macOS-AppleSilicon.pkg" : "LexCalendario-Instalador-macOS-Intel.pkg";
  if (platform === "win32") return "LexCalendario-Instalador-Windows.exe";
  return "LexCalendario-Instalador-Linux.deb";
}

/** Instalador com assistente (.exe/.pkg/.deb) ou pacote compactado (.zip/.tar.gz). */
const PACKAGE_RE = /\.(zip|tar\.gz|tgz|exe|pkg|deb)$/i;

/** Espera o servidor voltar (depois de atualizar ou limpar) e recarrega o app. */
function reloadWhenBack(path = "/calendario") {
  const started = Date.now();
  const tick = async () => {
    const ok = await fetch("/api/health", { cache: "no-store" }).then((r) => r.ok).catch(() => false);
    if (ok && Date.now() - started > 8000) window.location.href = path;
    else if (Date.now() - started < 5 * 60_000) setTimeout(() => void tick(), 2000);
  };
  setTimeout(() => void tick(), 3000);
}

/** Configurações → Aplicativo: versão instalada e atualização a partir do arquivo baixado. */
export function UpdateSettings() {
  const qc = useQueryClient();
  const { data, isError } = useUpdateInfo(true);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [updatingSince, setUpdatingSince] = useState<number | null>(null);

  if (isError || !data) return null;
  const installing = data.state === "instalando" || data.state === "baixando";

  const expected = expectedPackage(data.platform, data.arch);

  function upload(file: File) {
    if (!PACKAGE_RE.test(file.name)) return toast.error(`Escolha o pacote do Lex Calendário (${expected}).`);
    if (!confirm(`Atualizar o Lex Calendário com “${file.name}”?\n\nO Lex faz um backup, instala e reabre sozinho. Pode levar até 3 minutos. Seus dados são mantidos — não é preciso apagar nada nem restaurar backup.`)) return;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/desktop/atualizacao/arquivo");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && setUploading(e.loaded / e.total);
    xhr.onload = () => {
      setUploading(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        setUpdatingSince(Date.now());
        void qc.invalidateQueries({ queryKey: ["desktop-update"] });
        reloadWhenBack();
      } else {
        const msg = (() => {
          try {
            return (JSON.parse(xhr.responseText) as { error?: string }).error;
          } catch {
            return null;
          }
        })();
        toast.error("Não foi possível atualizar", { description: msg ?? `Erro ${xhr.status}` });
      }
    };
    xhr.onerror = () => {
      setUploading(null);
      toast.error("Falha ao enviar o arquivo.");
    };
    setUploading(0);
    xhr.send(file);
  }

  return (
    <>
    {updatingSince && <UpdatingOverlay since={updatingSince} />}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RefreshCw className="size-4" /> Atualizações</CardTitle>
        <CardDescription>
          Baixe o pacote da nova versão e escolha-o aqui: o Lex faz o backup e se atualiza sem perder nenhum dado. Também funciona dar dois cliques no app da nova versão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="text-sm">Versão instalada {data.current}</Badge>
          {installing && (
            <Badge variant="outline"><Loader2 className="size-3 animate-spin" /> {data.state === "baixando" ? "Baixando" : "Instalando"} {data.latest ?? "nova versão"}…</Badge>
          )}
          {data.state === "disponivel" && <Badge variant="warning">Versão {data.latest} disponível</Badge>}
          {data.checkedAt && !installing && <span className="text-xs text-muted-foreground">Última atualização: {formatDateTime(data.checkedAt)}</span>}
        </div>
        {data.state === "erro" && data.error && <p className="text-sm text-destructive">{data.error}</p>}
        {uploading != null && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Enviando o pacote… {Math.round(uploading * 100)}%</p>
            <Progress value={Math.round(uploading * 100)} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Antes de qualquer atualização o Lex salva sozinho um backup completo em <b className="font-medium">Documentos › Lex Calendário › backups</b>. Se o backup falhar, a atualização não é feita.
        </p>
        {data.state === "instalando" && data.notes && <p className="text-xs">{data.notes}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => input.current?.click()} disabled={uploading != null || installing}>
            <Upload /> Atualizar a partir do arquivo…
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileArchive className="size-3.5" /> Use o arquivo <b className="font-medium">{expected}</b> (o pacote .zip/.tar.gz também funciona)</span>
          <input
            ref={input}
            type="file"
            accept=".exe,.pkg,.deb,.zip,.gz,.tgz,application/zip,application/gzip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f);
            }}
          />
        </div>
      </CardContent>
    </Card>
    </>
  );
}

/** Zona de cuidado: limpar todas as informações e desinstalar. */
export function DangerZone() {
  const { data, isError } = useUpdateInfo();
  const [wipeOpen, setWipeOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  if (isError || !data) return null;
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-4" /> Limpar e desinstalar</CardTitle>
        <CardDescription>Ações definitivas. O que for apagado vai para a Lixeira do computador, de onde ainda pode ser recuperado.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-3">
          <p className="text-sm font-medium">Limpar todas as informações</p>
          <p className="mb-3 text-xs text-muted-foreground">Apaga compromissos, clientes, processos, comunicações, configurações e conexões. O Lex recomeça do zero, como recém-instalado.</p>
          <Button variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setWipeOpen(true)}>
            <Trash2 /> Limpar tudo…
          </Button>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-sm font-medium">Desinstalar o Lex Calendário</p>
          <p className="mb-3 text-xs text-muted-foreground">Remove o aplicativo, atalhos e início automático — e, se você quiser, também os dados e backups.</p>
          <Button variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setUninstallOpen(true)}>
            <Trash2 /> Desinstalar…
          </Button>
        </div>
      </CardContent>
      {wipeOpen && <WipeDialog onClose={() => setWipeOpen(false)} />}
      {uninstallOpen && <UninstallDialog onClose={() => setUninstallOpen(false)} />}
    </Card>
  );
}

function WipeDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [backup, setBackup] = useState(true);
  const [busy, setBusy] = useState(false);

  async function wipe() {
    setBusy(true);
    try {
      if (backup) {
        const a = document.createElement("a");
        a.href = "/api/backup/export?arquivos=1";
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.info("Salvando o backup…", { description: "Aguarde o download terminar antes de continuar." });
        await new Promise((r) => setTimeout(r, 6000));
      }
      const res = await fetch("/api/desktop/limpar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: text }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Falha ao limpar");
      toast.success("Apagando as informações…", { description: "O Lex reinicia do zero em instantes.", duration: 20_000 });
      reloadWhenBack("/");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Limpar todas as informações?</DialogTitle>
          <DialogDescription>
            Todos os compromissos, tarefas, clientes, processos, comunicações, modelos, parceiros, configurações e conexões (Google, Gmail) serão apagados deste computador.
            Os dados vão para a Lixeira. Os eventos que já estão no Google Agenda não são apagados de lá.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
          Baixar um backup completo antes de apagar (recomendado)
        </label>
        <div className="grid gap-1.5">
          <p className="text-sm">Para confirmar, digite <b>APAGAR</b>:</p>
          <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" disabled={text.trim().toUpperCase() !== "APAGAR" || busy} onClick={() => void wipe()}>
            {busy && <Loader2 className="animate-spin" />} Apagar tudo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UninstallDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"app" | "tudo">("app");
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);

  async function uninstall() {
    const res = await fetch("/api/desktop/desinstalar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return toast.error(body.error ?? "Falha ao desinstalar");
    setDone(true);
  }

  if (done) {
    return (
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desinstalando…</DialogTitle>
            <DialogDescription>
              O Lex Calendário está sendo removido{mode === "tudo" ? " junto com os dados (enviados para a Lixeira)" : "; seus dados e backups continuam guardados"}. Já pode fechar esta janela.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Desinstalar o Lex Calendário?</DialogTitle>
          <DialogDescription>Remove o aplicativo, o ícone/atalhos e o início automático com o computador.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {(
            [
              ["app", "Só o aplicativo", "Seus dados e backups ficam guardados — reinstalando, tudo volta como estava."],
              ["tudo", "Aplicativo e todos os dados", "Também envia para a Lixeira os dados, configurações e backups do Lex."],
            ] as const
          ).map(([id, label, desc]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition hover:bg-accent/50 ${mode === id ? "border-destructive bg-destructive/5" : ""}`}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>
        {mode === "tudo" && (
          <div className="grid gap-1.5">
            <p className="text-sm">Para confirmar, digite <b>APAGAR</b>:</p>
            <Input value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" disabled={mode === "tudo" && text.trim().toUpperCase() !== "APAGAR"} onClick={() => void uninstall()}>
            Desinstalar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aviso único depois de uma atualização: "Atualizado para a versão X". */
export function UpdateNotice() {
  const { data } = useUpdateInfo();
  const updatedFrom = data?.updatedFrom;
  const current = data?.current;
  useEffect(() => {
    if (!updatedFrom || updatedFrom === current) return;
    toast.success(`Lex Calendário atualizado para a versão ${current}`, {
      description: `Antes: ${updatedFrom}. Seus dados foram mantidos. Veja as novidades em Sobre.`,
      duration: 10_000,
    });
    void fetch("/api/desktop/atualizacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "visto" }) });
  }, [updatedFrom, current]);
  return null;
}

/** Tela enquanto a atualização acontece: o Lex fecha e reabre, então a página fica sem resposta por um tempo. */
function UpdatingOverlay({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secs = Math.floor((now - since) / 1000);
  const step = secs < 20 ? "Fazendo o backup dos seus dados…" : secs < 45 ? "Instalando a nova versão…" : "Reabrindo o Lex Calendário…";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 text-center backdrop-blur">
      <div className="max-w-sm space-y-3">
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        <p className="text-lg font-semibold">Atualizando o Lex Calendário</p>
        <p className="text-sm">{step}</p>
        <p className="text-xs text-muted-foreground">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · costuma levar de 1 a 3 minutos. Esta página recarrega sozinha quando terminar.
        </p>
        <p className="text-xs text-muted-foreground">
          Não feche o aplicativo e <b>não use “Apagar tudo” nem o desinstalador</b>: seus dados ficam guardados durante a atualização.
        </p>
        {secs > 300 && (
          <p className="text-xs text-amber-600">
            Está demorando mais que o normal. Feche esta janela e abra o Lex pelo ícone; se continuar na versão antiga, tente atualizar de novo.
          </p>
        )}
      </div>
    </div>
  );
}
