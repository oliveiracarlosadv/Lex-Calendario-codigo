"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Apple não oferece OAuth para calendários: a API oficial é o CalDAV do iCloud com senha de app. */
export function AppleConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [cal, setCal] = useState({ url: "https://caldav.icloud.com", username: "", password: "" });
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/caldav/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cal) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; created?: number };
      if (!res.ok) throw new Error(json.error ?? "Falha na conexão");
      toast.success("Calendário da Apple conectado", { description: json.created !== undefined ? `${json.created} compromisso(s) importado(s)` : undefined });
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
      setCal({ ...cal, password: "" });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Entrar com Apple (iCloud)</DialogTitle>
          <DialogDescription>
            Em appleid.apple.com → Iniciar sessão e segurança → Senhas de apps, gere uma senha para o Lex Calendário e informe abaixo com seu Apple ID.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Apple ID (e-mail)</Label><Input value={cal.username} onChange={(e) => setCal({ ...cal, username: e.target.value })} autoComplete="off" /></div>
          <div className="grid gap-1.5"><Label>Senha de app</Label><Input type="password" value={cal.password} onChange={(e) => setCal({ ...cal, password: e.target.value })} autoComplete="new-password" placeholder="xxxx-xxxx-xxxx-xxxx" /></div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Outro servidor CalDAV (Nextcloud, Fastmail…)</summary>
            <Input className="mt-2" value={cal.url} onChange={(e) => setCal({ ...cal, url: e.target.value })} />
          </details>
        </div>
        <DialogFooter>
          <Button disabled={!cal.username || !cal.password || busy} onClick={() => void connect()}>
            {busy && <Loader2 className="animate-spin" />} Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
