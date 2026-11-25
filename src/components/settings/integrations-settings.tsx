"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarSync, Download, Loader2, Unplug, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnections } from "@/hooks/use-records";
import { openOAuthWindow } from "@/lib/oauth-popup";
import { formatDateTime } from "@/lib/utils";

// Somente Google por decisão de produto (Microsoft e Apple desativados na interface)
const PROVIDERS = {
  google: { name: "Google Agenda", desc: "Sincronização nos dois sentidos a cada 30 segundos, com descrição completa, checklist, convidados e lembretes.", logo: "G" },
} as const;

export function IntegrationsSettings() {
  const qc = useQueryClient();
  const { data: connections = [] } = useConnections();
  const [caldavOpen, setCaldavOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cal, setCal] = useState({ url: "https://caldav.icloud.com", username: "", password: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  async function call(url: string, init: RequestInit, ok: string) {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => ({}))) as { error?: string; created?: number; updated?: number; deleted?: number; imported?: number };
    if (!res.ok) throw new Error(json.error ?? "Falha na operação");
    toast.success(ok, {
      description: json.imported !== undefined ? `${json.imported} compromisso(s) importado(s)` : json.created !== undefined ? `${json.created} novos · ${json.updated} atualizados · ${json.deleted} removidos` : undefined,
    });
    void qc.invalidateQueries({ queryKey: ["connections"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calendários conectados</CardTitle>
          <CardDescription>Compromissos criados no Lex vão para o calendário conectado; os criados lá aparecem aqui automaticamente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map((key) => {
            const p = PROVIDERS[key];
            const conns = connections.filter((c) => c.provider === key);
            return (
              <div key={key} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-lg font-semibold">{p.logo}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-[13px] text-muted-foreground">{p.desc}</p>
                  </div>
                  <Button variant="outline" onClick={() => openOAuthWindow(key)}>Entrar com Google</Button>
                </div>
                {conns.map((c) => (
                  <div key={c.id} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
                    <Badge variant={c.last_error ? "destructive" : c.last_push_error ? "warning" : "success"}>{c.last_error ? "Erro" : c.last_push_error ? "Envio pendente" : "Conectado"}</Badge>
                    <span className="min-w-0 flex-1 truncate">{c.account_email ?? c.external_calendar_id}</span>
                    <span className="text-xs text-muted-foreground">{c.last_synced_at ? `Sincronizado ${formatDateTime(c.last_synced_at)}` : "Aguardando primeira sincronização"}</span>
                    <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => void run(c.id, () => call(`/api/integrations/connections/${c.id}/sync`, { method: "POST" }, "Sincronização concluída"))}>
                      {busy === c.id ? <Loader2 className="animate-spin" /> : <CalendarSync />} Sincronizar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => confirm("Desconectar este calendário?") && void run(`d-${c.id}`, () => call(`/api/integrations/connections/${c.id}`, { method: "DELETE" }, "Calendário desconectado"))}>
                      <Unplug /> Desconectar
                    </Button>
                    {c.last_error && <p className="w-full text-xs text-destructive">{c.last_error}</p>}
                    {c.last_push_error && (
                      <p className="w-full text-xs text-amber-700 dark:text-amber-400">
                        Último envio ao Google falhou{c.last_push_error_at ? ` (${formatDateTime(c.last_push_error_at)})` : ""}: {c.last_push_error}. O Lex tenta de novo a cada 30 segundos.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Arquivos ICS</CardTitle>
          <CardDescription>Importe agendas de outros sistemas ou exporte a sua para qualquer calendário compatível.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><a href="/api/ics/export"><Download /> Exportar agenda (.ics)</a></Button>
          <Button variant="outline" disabled={busy === "ics"} onClick={() => fileRef.current?.click()}>
            {busy === "ics" ? <Loader2 className="animate-spin" /> : <Upload />} Importar .ics
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const body = new FormData();
              body.append("file", file);
              void run("ics", () => call("/api/ics/import", { method: "POST", body }, "Importação concluída"));
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={caldavOpen} onOpenChange={setCaldavOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar Apple Calendar (CalDAV)</DialogTitle>
            <DialogDescription>
              Em appleid.apple.com → Iniciar sessão e segurança → Senhas de apps, gere uma senha para o Lex Calendário. Funciona também com Nextcloud, Fastmail e outros servidores CalDAV.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label>Servidor</Label><Input value={cal.url} onChange={(e) => setCal({ ...cal, url: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Apple ID (e-mail)</Label><Input value={cal.username} onChange={(e) => setCal({ ...cal, username: e.target.value })} autoComplete="off" /></div>
            <div className="grid gap-1.5"><Label>Senha de app</Label><Input type="password" value={cal.password} onChange={(e) => setCal({ ...cal, password: e.target.value })} autoComplete="new-password" placeholder="xxxx-xxxx-xxxx-xxxx" /></div>
          </div>
          <DialogFooter>
            <Button
              disabled={!cal.username || !cal.password || busy === "caldav"}
              onClick={() =>
                void run("caldav", async () => {
                  await call("/api/integrations/caldav/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cal) }, "Apple Calendar conectado");
                  setCaldavOpen(false);
                  setCal({ ...cal, password: "" });
                })
              }
            >
              {busy === "caldav" && <Loader2 className="animate-spin" />} Conectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
