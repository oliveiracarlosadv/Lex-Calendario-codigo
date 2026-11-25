"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, User, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { looksLikeCompany } from "@/domain/clients/types";
import { formatDocument, formatPhone, isValidCNPJ, isValidCPF, onlyDigits } from "@/domain/shared/document";
import { formatCnjNumber, tribunalAcronym } from "@/domain/processes/cnj-number";
import { sb, unwrap } from "@/hooks/supabase";
import { useMarkIntimationsRead } from "@/hooks/use-intimations";
import { useClients, useProcesses } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import type { IntimationRow, ProcessRow } from "@/types/db";

const ROLES = ["Autor", "Réu", "Reclamante", "Reclamado", "Requerente", "Requerido", "Exequente", "Executado", "Apelante", "Apelado", "Terceiro interessado"];
const NEW = "__novo__";


/** Partes (polo ativo/passivo) publicadas nas intimações do processo. */
export function useProcessParties(processId: string | null | undefined) {
  return useQuery({
    queryKey: ["process-parties", processId],
    enabled: !!processId,
    queryFn: async () => {
      const rows = unwrap(
        await sb().from("intimations").select("parties, available_at").eq("process_id", processId!).order("available_at", { ascending: false }).limit(20),
      ) as { parties: { nome: string; polo?: string }[] }[];
      const seen = new Map<string, { nome: string; polo?: string }>();
      for (const r of rows) for (const p of r.parties ?? []) if (!seen.has(p.nome.toUpperCase())) seen.set(p.nome.toUpperCase(), p);
      return [...seen.values()];
    },
  });
}

export function RegisterFromIntimationDialog(props: { intimation: IntimationRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const i = props.intimation;
  return (
    <ProcessClientDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      intimation={i}
      source={{ processId: i.process_id, number: i.process_number, tribunal: i.tribunal, organ: i.organ, className: i.class_name, parties: i.parties ?? [] }}
    />
  );
}

/**
 * Cadastra/completa o processo para acompanhamento e o cliente (existente ou novo,
 * sugerido pelas partes publicadas no Diário). Usado nas intimações e na Central de Processos.
 */
export function ProcessClientDialog({
  source,
  intimation,
  open,
  onOpenChange,
}: {
  source: { processId: string | null; number: string; tribunal: string | null; organ: string | null; className: string | null; parties?: { nome: string; polo?: string }[] };
  intimation?: IntimationRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { organization, userId, members } = useWorkspace();
  const { data: clients = [] } = useClients();
  const { data: processes = [] } = useProcesses();
  const markRead = useMarkIntimationsRead();
  const existing: ProcessRow | null = useMemo(() => processes.find((p) => p.id === source.processId) ?? null, [processes, source.processId]);
  const { data: fetchedParties = [] } = useProcessParties(source.parties?.length ? null : source.processId);
  const parties = source.parties?.length ? source.parties : fetchedParties;
  const [p, setP] = useState({ proceduralClass: "", tribunal: "", courtDivision: "", clientRole: "", opposingParty: "", responsibleId: userId, monitored: true });
  const [clientMode, setClientMode] = useState<string>(NEW);
  const [c, setC] = useState({ kind: "individual" as "individual" | "company", name: "", document: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setP({
      proceduralClass: existing?.procedural_class ?? source.className ?? "",
      tribunal: existing?.tribunal ?? source.tribunal ?? tribunalAcronym(source.number) ?? "",
      courtDivision: existing?.court_division ?? source.organ ?? "",
      clientRole: existing?.client_role ?? "",
      opposingParty: existing?.opposing_party ?? "",
      responsibleId: existing?.responsible_id ?? userId,
      monitored: existing?.is_monitored ?? true,
    });
    setClientMode(existing?.client_id ?? NEW);
    setC({ kind: "individual", name: "", document: "", phone: "", email: "" });
  }, [open, existing, source.className, source.tribunal, source.organ, source.number, userId]);

  /** Escolhe uma parte da publicação como cliente: preenche nome, polo e parte contrária. */
  function pickParty(name: string, polo?: string) {
    const existingClient = clients.find((cl) => cl.name.toLowerCase() === name.toLowerCase());
    if (existingClient) setClientMode(existingClient.id);
    else {
      setClientMode(NEW);
      setC((prev) => ({ ...prev, name, kind: looksLikeCompany(name) ? "company" : "individual" }));
    }
    const others = parties.filter((x) => x.nome !== name && (polo ? x.polo !== polo : true)).map((x) => x.nome);
    setP((prev) => ({
      ...prev,
      clientRole: prev.clientRole || (polo === "A" ? "Autor" : polo === "P" ? "Réu" : ""),
      opposingParty: others.slice(0, 3).join("; ") || prev.opposingParty,
    }));
  }

  async function save() {
    let clientId: string | null = clientMode === NEW ? null : clientMode;
    if (clientMode === NEW && c.name.trim()) {
      const doc = onlyDigits(c.document);
      if (doc && !(c.kind === "company" ? isValidCNPJ(doc) : isValidCPF(doc))) return toast.error(c.kind === "company" ? "CNPJ inválido." : "CPF inválido.");
      setSaving(true);
      try {
        const row = unwrap(
          await sb()
            .from("clients")
            .insert({
              organization_id: organization.id,
              kind: c.kind,
              name: c.name.trim(),
              document: doc || null,
              phone: onlyDigits(c.phone) || null,
              email: c.email.trim() || null,
              created_by: userId,
              responsible_id: p.responsibleId,
            })
            .select("id")
            .single(),
        ) as { id: string };
        clientId = row.id;
      } catch (e) {
        setSaving(false);
        const msg = (e as Error).message;
        return toast.error(msg.includes("duplicate") ? "Já existe um cliente com este CPF/CNPJ." : "Não foi possível cadastrar o cliente", { description: msg });
      }
    }

    setSaving(true);
    const fields = {
      procedural_class: p.proceduralClass || null,
      tribunal: p.tribunal || null,
      court_division: p.courtDivision || null,
      client_id: clientId,
      client_role: p.clientRole || null,
      opposing_party: p.opposingParty || null,
      responsible_id: p.responsibleId,
      is_monitored: p.monitored,
    };
    try {
      let processId = existing?.id ?? source.processId;
      if (processId) {
        unwrap(await sb().from("processes").update(fields).eq("id", processId).select("id").single());
      } else {
        const row = unwrap(
          await sb()
            .from("processes")
            .insert({ ...fields, organization_id: organization.id, number: formatCnjNumber(source.number), created_by: userId })
            .select("id")
            .single(),
        ) as { id: string };
        processId = row.id;
        if (intimation) unwrap(await sb().from("intimations").update({ process_id: processId }).eq("id", intimation.id).select("id"));
      }
      // Compromissos já vinculados ao processo passam a mostrar o cliente
      if (clientId) await sb().from("events").update({ client_id: clientId }).eq("process_id", processId).is("client_id", null);
      if (intimation && !intimation.read_at) markRead.mutate([intimation.id]);
      for (const key of ["processes", "process", "clients", "intimations", "events", "suggestions", "dashboard", "communications"]) void qc.invalidateQueries({ queryKey: [key] });
      toast.success(existing && clientId && !intimation ? "Cliente vinculado ao processo" : "Processo cadastrado para acompanhamento", {
        description: clientId ? "Cliente vinculado." : undefined,
        action: { label: "Abrir processo", onClick: () => router.push(`/processos/${processId}`) },
      });
      onOpenChange(false);
    } catch (e) {
      toast.error("Não foi possível salvar o processo", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{intimation ? "Cadastrar processo e cliente" : "Vincular ao cliente"}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{source.number}</span> · {source.tribunal ?? "—"} —{" "}
            {parties.length ? "partes conforme as publicações no Diário. Confira e complete." : "nenhuma publicação com as partes ainda; informe o cliente manualmente."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {/* Cliente */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><UserCheck className="size-4" /> Cliente</h3>
            {parties.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Partes da publicação — clique em quem é o seu cliente:</p>
                <div className="flex flex-wrap gap-1.5">
                  {parties.map((party) => (
                    <button
                      type="button"
                      key={`${party.nome}-${party.polo}`}
                      onClick={() => pickParty(party.nome, party.polo)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[12.5px] transition hover:bg-accent",
                        (c.name === party.nome || clients.find((cl) => cl.id === clientMode)?.name === party.nome) && "border-primary bg-primary/10 text-primary",
                      )}
                    >
                      {party.nome}
                      {party.polo && <span className="ml-1 text-muted-foreground">({party.polo === "A" ? "polo ativo" : party.polo === "P" ? "polo passivo" : party.polo})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Select value={clientMode} onValueChange={setClientMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW}>+ Cadastrar novo cliente</SelectItem>
                {clients.map((cl) => <SelectItem key={cl.id} value={cl.id}>{cl.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {clientMode === NEW && (
              <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
                <div className="inline-flex w-fit rounded-lg bg-secondary p-[3px] sm:col-span-2">
                  {(["individual", "company"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setC({ ...c, kind: k })}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium text-muted-foreground transition data-[on=true]:bg-background data-[on=true]:text-foreground data-[on=true]:shadow-soft"
                      data-on={c.kind === k}
                    >
                      {k === "individual" ? <User className="size-3.5" /> : <Building2 className="size-3.5" />}
                      {k === "individual" ? "Pessoa física" : "Pessoa jurídica"}
                    </button>
                  ))}
                </div>
                <div className="grid gap-1.5 sm:col-span-2"><Label>Nome {c.kind === "company" ? "/ razão social" : "completo"}</Label><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label>{c.kind === "company" ? "CNPJ" : "CPF"} (opcional)</Label><Input value={formatDocument(c.document)} inputMode="numeric" onChange={(e) => setC({ ...c, document: onlyDigits(e.target.value).slice(0, c.kind === "company" ? 14 : 11) })} /></div>
                <div className="grid gap-1.5"><Label>Telefone / WhatsApp</Label><Input value={formatPhone(c.phone)} inputMode="tel" onChange={(e) => setC({ ...c, phone: onlyDigits(e.target.value).slice(0, 11) })} /></div>
                <div className="grid gap-1.5 sm:col-span-2"><Label>E-mail</Label><Input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
              </div>
            )}
          </section>

          {/* Processo */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Processo</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>Classe processual</Label><Input value={p.proceduralClass} onChange={(e) => setP({ ...p, proceduralClass: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Tribunal</Label><Input value={p.tribunal} onChange={(e) => setP({ ...p, tribunal: e.target.value.toUpperCase() })} /></div>
              <div className="grid gap-1.5 sm:col-span-2"><Label>Vara / Órgão julgador</Label><Input value={p.courtDivision} onChange={(e) => setP({ ...p, courtDivision: e.target.value })} /></div>
              <div className="grid gap-1.5">
                <Label>Polo do cliente</Label>
                <Select value={p.clientRole || "__"} onValueChange={(v) => setP({ ...p, clientRole: v === "__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__">Não informado</SelectItem>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Advogado responsável</Label>
                <Select value={p.responsibleId} onValueChange={(v) => setP({ ...p, responsibleId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name ?? "Membro"}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2"><Label>Parte contrária</Label><Input value={p.opposingParty} onChange={(e) => setP({ ...p, opposingParty: e.target.value })} /></div>
              <label className="flex items-center justify-between text-sm sm:col-span-2">
                Acompanhar este processo (novas intimações e movimentações)
                <Switch checked={p.monitored} onCheckedChange={(v) => setP({ ...p, monitored: v })} />
              </label>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={saving || (clientMode === NEW && !!c.name && c.name.trim().length < 2)}>
            {saving && <Loader2 className="animate-spin" />} {existing ? "Salvar cadastro" : "Cadastrar processo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
