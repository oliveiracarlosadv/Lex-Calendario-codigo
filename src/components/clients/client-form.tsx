"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BR_STATES } from "@/domain/clients/types";
import { formatCEP, formatDocument, formatPhone, isValidCNPJ, isValidCPF, onlyDigits } from "@/domain/shared/document";
import { useSaveClient } from "@/hooks/use-records";
import type { ClientRow } from "@/types/db";

type Draft = Partial<ClientRow>;

export function ClientFormDialog({
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
  const save = useSaveClient();
  const [c, setC] = useState<Draft>(initial ?? { kind: "individual" });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setC((prev) => ({ ...prev, [k]: v }));
  const isCompany = c.kind === "company";

  async function lookupCep(cep: string) {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const json = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (json.erro) return;
      setC((prev) => ({
        ...prev,
        address_street: prev.address_street || json.logradouro || null,
        address_district: prev.address_district || json.bairro || null,
        address_city: json.localidade ?? prev.address_city ?? null,
        address_state: json.uf ?? prev.address_state ?? null,
      }));
    } catch {
      /* consulta de CEP é apenas conveniência */
    }
  }

  const [looking, setLooking] = useState(false);

  /** Preenche os campos vazios com os dados públicos do CNPJ (Receita Federal). */
  async function fillFromCnpj() {
    const doc = onlyDigits(c.document);
    if (!isValidCNPJ(doc)) return toast.error("CNPJ inválido.");
    setLooking(true);
    try {
      const res = await fetch(`/api/cnpj/${doc}`);
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        razaoSocial?: string;
        nomeFantasia?: string | null;
        cep?: string | null;
        logradouro?: string | null;
        numero?: string | null;
        complemento?: string | null;
        bairro?: string | null;
        municipio?: string | null;
        uf?: string | null;
        email?: string | null;
        telefone?: string | null;
        situacao?: string | null;
      };
      if (!res.ok || !d.razaoSocial) return void toast.error(d.error ?? "Não foi possível consultar o CNPJ.");
      setC((prev) => ({
        ...prev,
        kind: "company",
        name: prev.name?.trim() ? prev.name : d.razaoSocial,
        trade_name: prev.trade_name || d.nomeFantasia || null,
        address_zip: prev.address_zip || (d.cep ? onlyDigits(d.cep) : null),
        address_street: prev.address_street || d.logradouro || null,
        address_number: prev.address_number || d.numero || null,
        address_complement: prev.address_complement || d.complemento || null,
        address_district: prev.address_district || d.bairro || null,
        address_city: prev.address_city || d.municipio || null,
        address_state: prev.address_state || d.uf || null,
        email: prev.email || (d.email ? d.email.toLowerCase() : null),
        phone: prev.phone || (d.telefone ? onlyDigits(d.telefone) : null),
      }));
      toast.success("Dados do CNPJ preenchidos", { description: d.situacao ? `Situação cadastral: ${d.situacao}. Confira antes de salvar.` : "Confira antes de salvar." });
    } finally {
      setLooking(false);
    }
  }

  async function submit() {
    if (!c.name?.trim()) return toast.error("Informe o nome.");
    const doc = onlyDigits(c.document);
    if (doc) {
      const valid = doc.length === 14 ? isValidCNPJ(doc) : doc.length === 11 ? isValidCPF(doc) : false;
      if (!valid) return toast.error(doc.length === 14 ? "CNPJ inválido." : doc.length === 11 ? "CPF inválido." : "Informe o CPF (11 números) ou o CNPJ (14 números).");
    }
    const row = await save.mutateAsync({
      ...c,
      name: c.name.trim(),
      document: doc || null,
      phone: onlyDigits(c.phone) || null,
      secondary_phone: onlyDigits(c.secondary_phone) || null,
      address_zip: onlyDigits(c.address_zip) || null,
    });
    onOpenChange(false);
    onSaved?.(row.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{c.id ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>Dados cadastrais, contato e endereço.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="inline-flex w-fit rounded-lg bg-secondary p-[3px]">
            {(["individual", "company"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                className="rounded-md px-3 py-1 text-[13px] font-medium text-muted-foreground transition data-[on=true]:bg-background data-[on=true]:text-foreground data-[on=true]:shadow-soft"
                data-on={c.kind === k}
              >
                {k === "individual" ? "Pessoa física" : "Pessoa jurídica"}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{isCompany ? "Razão social" : "Nome completo"}</Label>
              <Input value={c.name ?? ""} onChange={(e) => set("name", e.target.value)} autoFocus />
            </div>
            {isCompany && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Nome fantasia</Label>
                <Input value={c.trade_name ?? ""} onChange={(e) => set("trade_name", e.target.value)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>CPF ou CNPJ</Label>
              <div className="flex gap-2">
                <Input
                  value={formatDocument(c.document)}
                  inputMode="numeric"
                  placeholder={isCompany ? "00.000.000/0000-00" : "000.000.000-00"}
                  onChange={(e) => {
                    const doc = onlyDigits(e.target.value).slice(0, 14);
                    set("document", doc);
                    // CNPJ completo: passa para pessoa jurídica
                    if (doc.length === 14 && isValidCNPJ(doc) && !isCompany) {
                      set("kind", "company");
                      toast.info("CNPJ informado: cadastro alterado para pessoa jurídica.");
                    }
                  }}
                />
                {onlyDigits(c.document).length === 14 && (
                  <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={looking} onClick={() => void fillFromCnpj()}>
                    {looking ? <Loader2 className="animate-spin" /> : <Search />} Buscar dados
                  </Button>
                )}
              </div>
              {onlyDigits(c.document).length === 14 && <p className="text-[11px] text-muted-foreground">“Buscar dados” preenche razão social, nome fantasia, endereço e contato pelo cadastro público da Receita.</p>}
            </div>
            {!isCompany && (
              <div className="grid gap-1.5">
                <Label>Data de nascimento</Label>
                <Input type="date" value={c.birth_date ?? ""} onChange={(e) => set("birth_date", e.target.value || null)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={c.email ?? ""} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Telefone / WhatsApp</Label>
              <Input value={formatPhone(c.phone)} inputMode="tel" onChange={(e) => set("phone", onlyDigits(e.target.value).slice(0, 11))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>CEP</Label>
              <Input value={formatCEP(c.address_zip)} inputMode="numeric" onChange={(e) => set("address_zip", onlyDigits(e.target.value).slice(0, 8))} onBlur={(e) => void lookupCep(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-4">
              <Label>Logradouro</Label>
              <Input value={c.address_street ?? ""} onChange={(e) => set("address_street", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Número</Label>
              <Input value={c.address_number ?? ""} onChange={(e) => set("address_number", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-4">
              <Label>Complemento</Label>
              <Input value={c.address_complement ?? ""} onChange={(e) => set("address_complement", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Bairro</Label>
              <Input value={c.address_district ?? ""} onChange={(e) => set("address_district", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-3">
              <Label>Cidade</Label>
              <Input value={c.address_city ?? ""} onChange={(e) => set("address_city", e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-1">
              <Label>UF</Label>
              <Select value={c.address_state ?? ""} onValueChange={(v) => set("address_state", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {BR_STATES.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2 rounded-xl border p-3">
            <Label>Contrato de honorários</Label>
            <div className="flex gap-2">
              {(
                [
                  ["trabalho", "Por trabalho", "por causa ou serviço"],
                  ["fixo", "Fixo", "mensal / avença"],
                ] as const
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set("contract_type", c.contract_type === id ? null : id)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-left text-sm transition ${c.contract_type === id ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"}`}
                >
                  {label}
                  <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
            {c.contract_type && (
              <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder={c.contract_type === "fixo" ? "Valor mensal (R$)" : "Valor / % (R$)"}
                  value={c.contract_value ?? ""}
                  onChange={(e) => set("contract_value", e.target.value === "" ? null : Number(e.target.value))}
                />
                <Input
                  placeholder={c.contract_type === "fixo" ? "Ex.: vencimento dia 10, inclui consultas" : "Ex.: 30% do êxito + R$ 2.000 de entrada"}
                  value={c.contract_notes ?? ""}
                  onChange={(e) => set("contract_notes", e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Observações</Label>
            <Textarea value={c.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
