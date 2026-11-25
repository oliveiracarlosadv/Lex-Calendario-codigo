"use client";

import { useState } from "react";
import { FileKey2, Loader2, Radar, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BR_STATES } from "@/domain/clients/types";
import { useOabMonitorMutations, useOabMonitors, useSyncIntimations } from "@/hooks/use-intimations";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatDateTime } from "@/lib/utils";

export function TribunalsSettings() {
  const { profile } = useWorkspace();
  const { data: monitors = [] } = useOabMonitors();
  const { add, remove, toggle } = useOabMonitorMutations();
  const sync = useSyncIntimations();
  const [oab, setOab] = useState({ number: profile.oab_number ?? "", state: profile.oab_state ?? "PA" });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Radar className="size-4" /> Intimações pela OAB</CardTitle>
          <CardDescription>
            O Lex consulta o <strong>Diário de Justiça Eletrônico Nacional (DJEN/CNJ)</strong> — onde todos os tribunais publicam as intimações — várias vezes ao dia.
            Cada intimação nova cadastra o processo (se ainda não existir), registra a movimentação, sugere o prazo contado da publicação e avisa você com notificação no computador.
            Não é preciso senha.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {monitors.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm">
              <span className="font-semibold">OAB {m.oab_number}/{m.oab_state}</span>
              <span className="text-xs text-muted-foreground">{m.last_checked_at ? `Última busca: ${formatDateTime(m.last_checked_at)}` : "Aguardando primeira busca"}</span>
              {m.last_error && <Badge variant="destructive" title={m.last_error}>Erro na última busca</Badge>}
              <div className="ml-auto flex items-center gap-2">
                <Switch checked={m.is_active} onCheckedChange={(v) => toggle.mutate({ id: m.id, active: v })} aria-label="Ativo" />
                <Button variant="ghost" size="icon-sm" onClick={() => confirm("Parar de monitorar esta OAB?") && remove.mutate(m.id)} aria-label="Remover"><Trash2 /></Button>
              </div>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto] sm:items-end">
            <div className="grid gap-1.5"><Label>Número da OAB</Label><Input value={oab.number} onChange={(e) => setOab({ ...oab, number: e.target.value })} placeholder="12345" inputMode="numeric" /></div>
            <div className="grid gap-1.5">
              <Label>UF</Label>
              <Select value={oab.state} onValueChange={(v) => setOab({ ...oab, state: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BR_STATES.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button
              disabled={!/^\d{1,7}[A-Za-z]?$/.test(oab.number.trim()) || add.isPending}
              onClick={() => add.mutate({ number: oab.number.trim(), state: oab.state }, { onSuccess: () => sync.mutate() })}
            >
              Monitorar
            </Button>
          </div>
          {monitors.length > 0 && (
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar intimações agora
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileKey2 className="size-4" /> Certificado digital A1</CardTitle>
          <CardDescription>
            Estrutura pronta para autenticação por certificado ICP-Brasil (arquivo .pfx/.p12) nos sistemas processuais: armazenamento protegido,
            senha criptografada e registro de validade. Será habilitado com os conectores que exigem certificado.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
