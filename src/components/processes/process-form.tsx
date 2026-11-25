"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatCnjNumber, isValidCnjNumber, parseCnjNumber, tribunalAcronym } from "@/domain/processes/cnj-number";
import { COURT_SYSTEMS, COURT_SYSTEM_LABELS, PROCESS_STATUSES, PROCESS_STATUS_LABELS, type CourtSystem, type ProcessStatus } from "@/domain/processes/types";
import { useClients, useSaveProcess } from "@/hooks/use-records";
import { usePartners } from "@/hooks/use-partners";
import { PartnerDialog } from "@/components/partners/partners-page";
import { useWorkspace } from "@/hooks/use-workspace";
import type { ProcessRow } from "@/types/db";

const NONE = "__none__";
const NEW_PARTNER = "__novo_parceiro__";
type Draft = Partial<ProcessRow>;

export function ProcessFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Draft;
  onSaved?: (id: string) => void;
}) {
  const save = useSaveProcess();
  const { data: clients } = useClients();
  const { data: partners } = usePartners();
  const [newPartner, setNewPartner] = useState(false);
  const { members, userId } = useWorkspace();
  const [p, setP] = useState<Draft>({ status: "active", court_system: "pje", instance: 1, is_monitored: true, responsible_id: userId, ...initial });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const numberOk = p.number ? isValidCnjNumber(p.number) : true;

  function onNumberBlur() {
    if (!p.number) return;
    const parsed = parseCnjNumber(p.number);
    if (!parsed) return;
    setP((prev) => ({ ...prev, number: formatCnjNumber(prev.number!), tribunal: prev.tribunal || tribunalAcronym(prev.number!) }));
  }

  async function submit() {
    const title = p.title?.trim() || null;
    const number = p.number?.trim() || null;
    if (!title && !number) return toast.error("Dê um nome ao processo (ex.: Cobrança — contra Banco X) ou informe o número.");
    if (number && !isValidCnjNumber(number) && !confirm("O número não segue o padrão CNJ (dígito verificador inválido). Salvar mesmo assim?")) return;
    const row = await save.mutateAsync({ ...p, title, number: number ? formatCnjNumber(number) : null });
    onOpenChange(false);
    onSaved?.(row.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{p.id ? "Editar processo" : "Novo processo"}</DialogTitle>
          <DialogDescription>Dê um nome ao processo; com o número CNJ, o tribunal é identificado automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Nome do processo</Label>
            <Input
              value={p.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Ex.: Cobrança — contra Banco X · Divórcio de Maria · Reclamação trabalhista contra Empresa Y"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Como você identifica o processo: a causa ou contra quem. Aparece em todo o app junto com o número.</p>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Número do processo (CNJ) — opcional até o ajuizamento</Label>
            <Input value={p.number ?? ""} onChange={(e) => set("number", e.target.value)} onBlur={onNumberBlur} placeholder="0000000-00.0000.0.00.0000" className="font-mono" />
            {!numberOk && <p className="text-xs text-destructive">Dígito verificador não confere (Res. CNJ 65/2008).</p>}
          </div>
          <div className="grid gap-1.5">
            <Label>Classe processual</Label>
            <Input value={p.procedural_class ?? ""} onChange={(e) => set("procedural_class", e.target.value)} placeholder="Procedimento Comum Cível" />
          </div>
          <div className="grid gap-1.5">
            <Label>Assunto</Label>
            <Input value={p.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Tribunal</Label>
            <Input value={p.tribunal ?? ""} onChange={(e) => set("tribunal", e.target.value.toUpperCase())} placeholder="TJPA" />
          </div>
          <div className="grid gap-1.5">
            <Label>Vara / Órgão julgador</Label>
            <Input value={p.court_division ?? ""} onChange={(e) => set("court_division", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Sistema</Label>
            <Select value={p.court_system} onValueChange={(v) => set("court_system", v as CourtSystem)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COURT_SYSTEMS.map((s) => <SelectItem key={s} value={s}>{COURT_SYSTEM_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={p.status} onValueChange={(v) => set("status", v as ProcessStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PROCESS_STATUSES.map((s) => <SelectItem key={s} value={s}>{PROCESS_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Cliente</Label>
            <Select value={p.client_id ?? NONE} onValueChange={(v) => set("client_id", v === NONE ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {clients?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Polo do cliente</Label>
            <Input value={p.client_role ?? ""} onChange={(e) => set("client_role", e.target.value)} placeholder="Autor, Réu, Reclamante…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Parte contrária</Label>
            <Input value={p.opposing_party ?? ""} onChange={(e) => set("opposing_party", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Advogado responsável</Label>
            <Select value={p.responsible_id ?? NONE} onValueChange={(v) => set("responsible_id", v === NONE ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Ninguém</SelectItem>
                {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name ?? "Membro"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Parceiro (correspondente, perito, indicação…)</Label>
            <Select
              value={p.partner_id ?? NONE}
              onValueChange={(v) => {
                if (v === NEW_PARTNER) return setNewPartner(true);
                const partner = partners?.find((x) => x.id === v);
                setP((prev) => ({ ...prev, partner_id: v === NONE ? null : v, partner_fee_percent: v === NONE ? null : (prev.partner_fee_percent ?? partner?.fee_percent ?? null) }));
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nenhum</SelectItem>
                {partners?.filter((x) => x.is_active || x.id === p.partner_id).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                <SelectItem value={NEW_PARTNER} className="text-primary">+ Cadastrar parceiro…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Honorários do parceiro (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step="0.5"
              disabled={!p.partner_id}
              value={p.partner_fee_percent ?? ""}
              onChange={(e) => set("partner_fee_percent", e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Valor da causa (R$)</Label>
            <Input type="number" step="0.01" value={p.claim_value ?? ""} onChange={(e) => set("claim_value", e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Distribuído em</Label>
            <Input type="date" value={p.distributed_at ?? ""} onChange={(e) => set("distributed_at", e.target.value || null)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea value={p.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <label className="flex items-center justify-between text-sm sm:col-span-2">
            Monitorar movimentações automaticamente
            <Switch checked={!!p.is_monitored} onCheckedChange={(v) => set("is_monitored", v)} />
          </label>
          <label className="flex items-center justify-between text-sm sm:col-span-2">
            Segredo de justiça (visível só a sócios, admin e responsável)
            <Switch checked={!!p.is_confidential} onCheckedChange={(v) => set("is_confidential", v)} />
          </label>
        </div>
        {newPartner && (
          <PartnerDialog
            initial={{}}
            onClose={() => setNewPartner(false)}
            onSaved={(x) => {
              setNewPartner(false);
              setP((prev) => ({ ...prev, partner_id: x.id, partner_fee_percent: prev.partner_fee_percent ?? x.fee_percent }));
            }}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
