"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Building2, Handshake, Mail, Pencil, Phone, Plus, Search, Trash2, User } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/app-shell";
import { processLabel } from "@/domain/processes/types";
import { LinkClientButton } from "@/components/processes/link-client-button";
import { formatDocument, formatPhone } from "@/domain/shared/document";
import { PARTNER_CATEGORIES, partnerCategoryLabel, useDeletePartner, usePartnerProcesses, usePartners, useSavePartner, type PartnerInput } from "@/hooks/use-partners";
import { useCan } from "@/hooks/use-workspace";
import type { PartnerRow } from "@/types/db";

const ALL = "all";
const fold = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function PartnersPage() {
  const { data: partners, isLoading } = usePartners();
  const { data: links = [] } = usePartnerProcesses();
  const remove = useDeletePartner();
  const canEdit = useCan("clients:update");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [editing, setEditing] = useState<Partial<PartnerRow> | null>(null);
  const [viewing, setViewing] = useState<PartnerRow | null>(null);

  const list = useMemo(
    () =>
      (partners ?? []).filter((p) => {
        if (category !== ALL && p.category !== category) return false;
        if (!search.trim()) return true;
        const hay = fold([p.name, p.trade_name, p.document, p.oab, p.email, p.phone, p.address_city, p.specialties, p.notes, partnerCategoryLabel(p.category)].join(" "));
        return fold(search).split(/\s+/).every((w) => hay.includes(w));
      }),
    [partners, search, category],
  );
  const processesOf = (id: string) => links.filter((l) => l.partner_id === id);

  return (
    <div>
      <PageHeader
        title="Parceiros"
        description="Correspondentes, escritórios parceiros, peritos, contadores e indicações — com os processos em parceria e a divisão de honorários."
        actions={canEdit && <Button onClick={() => setEditing({})}><Plus /> Novo parceiro</Button>}
      />
      <div className="space-y-4 p-4 md:p-8">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, OAB, cidade, área de atuação…" className="pl-9" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as categorias</SelectItem>
              {PARTNER_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !list.length ? (
          <EmptyState
            icon={Handshake}
            title={partners?.length ? "Nenhum parceiro encontrado" : "Nenhum parceiro"}
            description="Cadastre correspondentes, peritos, contadores e escritórios parceiros para vinculá-los aos processos."
            action={canEdit && <Button onClick={() => setEditing({})}><Plus /> Cadastrar parceiro</Button>}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Parceiro</th>
                  <th className="px-4 py-2.5 font-medium">Categoria</th>
                  <th className="px-4 py-2.5 font-medium">Contato</th>
                  <th className="px-4 py-2.5 font-medium">Cidade</th>
                  <th className="px-4 py-2.5 text-right font-medium">Processos</th>
                  <th className="px-4 py-2.5 text-right font-medium">Honorários</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-t transition hover:bg-accent/40" onClick={() => setViewing(p)}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        <Avatar name={p.name} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 font-medium">
                            {p.name}
                            {!p.is_active && <Badge variant="secondary" className="text-[11px]">inativo</Badge>}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {[p.trade_name, p.oab && `OAB ${p.oab}`, p.document && formatDocument(p.document)].filter(Boolean).join(" · ") || (p.kind === "company" ? "Pessoa jurídica" : "Pessoa física")}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{partnerCategoryLabel(p.category)}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{[p.email, p.phone && formatPhone(p.phone)].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{[p.address_city, p.address_state].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-4 py-3 text-right">{processesOf(p.id).length}</td>
                    <td className="px-4 py-3 text-right">{p.fee_percent != null ? `${p.fee_percent}%` : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {canEdit && <Button variant="ghost" size="icon-sm" aria-label="Editar" onClick={() => setEditing(p)}><Pencil /></Button>}
                      {canEdit && (
                        <Button variant="ghost" size="icon-sm" aria-label="Remover" onClick={() => confirm(`Remover ${p.name}? Os processos ficam sem este parceiro.`) && remove.mutate(p.id)}>
                          <Trash2 />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <PartnerDialog initial={editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <PartnerDetail
          partner={viewing}
          processes={processesOf(viewing.id)}
          onClose={() => setViewing(null)}
          onEdit={canEdit ? () => { setEditing(viewing); setViewing(null); } : undefined}
        />
      )}
    </div>
  );
}

function PartnerDetail({
  partner: p,
  processes,
  onClose,
  onEdit,
}: {
  partner: PartnerRow;
  processes: ReturnType<typeof usePartnerProcesses>["data"] & object;
  onClose: () => void;
  onEdit?: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {p.kind === "company" ? <Building2 className="size-4" /> : <User className="size-4" />} {p.name}
          </DialogTitle>
          <DialogDescription>{[partnerCategoryLabel(p.category), p.trade_name, p.oab && `OAB ${p.oab}`].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid gap-1.5">
            {p.email && <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" /><a className="hover:underline" href={`mailto:${p.email}`}>{p.email}</a></p>}
            {p.phone && <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /><a className="hover:underline" href={`https://wa.me/55${p.phone}`} target="_blank" rel="noreferrer">{formatPhone(p.phone)}</a></p>}
            {p.document && <p className="text-muted-foreground">{p.kind === "company" ? "CNPJ" : "CPF"}: {formatDocument(p.document)}</p>}
            {(p.address_city || p.address_state) && <p className="text-muted-foreground">{[p.address_city, p.address_state].filter(Boolean).join("/")}</p>}
            {p.specialties && <p><span className="text-muted-foreground">Áreas de atuação:</span> {p.specialties}</p>}
            {p.fee_percent != null && <p><span className="text-muted-foreground">Honorários (padrão):</span> {p.fee_percent}%</p>}
            {p.bank_info && <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Dados para repasse:</span> {p.bank_info}</p>}
            {p.notes && <p className="whitespace-pre-wrap rounded-xl bg-secondary/60 p-3 text-[13px]">{p.notes}</p>}
          </div>
          <div>
            <p className="mb-1 font-medium">Processos em parceria ({processes.length})</p>
            {processes.length ? (
              <div className="space-y-1">
                {processes.map((pr) => (
                  <div key={pr.id} className="flex items-center gap-1">
                  <Link href={`/processos/${pr.id}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/60">
                    <BriefcaseBusiness className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{processLabel(pr)}</span>
                    {pr.client?.name && <span className="truncate text-xs text-muted-foreground">{pr.client.name}</span>}
                    {pr.partner_fee_percent != null && <Badge variant="outline">{pr.partner_fee_percent}%</Badge>}
                  </Link>
                  <LinkClientButton processId={pr.id} size="xs" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum. Vincule o parceiro no cadastro do processo (campo “Parceiro”).</p>
            )}
          </div>
        </div>
        <DialogFooter>
          {onEdit && <Button variant="outline" onClick={onEdit}><Pencil /> Editar</Button>}
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PartnerDialog({ initial, onClose, onSaved }: { initial: Partial<PartnerRow>; onClose: () => void; onSaved?: (p: PartnerRow) => void }) {
  const save = useSavePartner();
  const [f, setF] = useState<PartnerInput>({ kind: "individual", category: "correspondente", is_active: true, ...initial, name: initial.name ?? "" });
  const set = <K extends keyof PartnerInput>(k: K, v: PartnerInput[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const text = (k: keyof PartnerInput) => ({ value: (f[k] as string | null | undefined) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar parceiro" : "Novo parceiro"}</DialogTitle>
          <DialogDescription>Quem atua com você nos processos: correspondentes, peritos, contadores, escritórios e indicações.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Categoria</Label>
            <Select value={f.category} onValueChange={(v) => set("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PARTNER_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo</Label>
            <Select value={f.kind} onValueChange={(v) => set("kind", v as PartnerRow["kind"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Pessoa física</SelectItem>
                <SelectItem value="company">Pessoa jurídica</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Nome</Label>
            <Input autoFocus {...text("name")} placeholder="Nome completo ou razão social" />
          </div>
          {f.kind === "company" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Nome fantasia</Label>
              <Input {...text("trade_name")} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>{f.kind === "company" ? "CNPJ" : "CPF"}</Label>
            <Input {...text("document")} inputMode="numeric" />
          </div>
          <div className="grid gap-1.5">
            <Label>OAB</Label>
            <Input {...text("oab")} placeholder="12345/PA" />
          </div>
          <div className="grid gap-1.5">
            <Label>E-mail</Label>
            <Input type="email" {...text("email")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Telefone / WhatsApp</Label>
            <Input {...text("phone")} placeholder="(91) 99999-9999" />
          </div>
          <div className="grid gap-1.5">
            <Label>Cidade</Label>
            <Input {...text("address_city")} />
          </div>
          <div className="grid gap-1.5">
            <Label>UF</Label>
            <Input {...text("address_state")} maxLength={2} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Áreas de atuação</Label>
            <Input {...text("specialties")} placeholder="Trabalhista, previdenciário, cálculos judiciais…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Divisão de honorários padrão (%)</Label>
            <Input type="number" min={0} max={100} step="0.5" value={f.fee_percent ?? ""} onChange={(e) => set("fee_percent", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Site</Label>
            <Input {...text("website")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Dados para repasse (PIX, banco)</Label>
            <Textarea {...text("bank_info")} className="min-h-[56px]" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea {...text("notes")} />
          </div>
          <label className="flex items-center justify-between text-sm sm:col-span-2">
            Parceiro ativo
            <Switch checked={f.is_active ?? true} onCheckedChange={(v) => set("is_active", v)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate(f, { onSuccess: (p) => (onSaved ? onSaved(p) : onClose()) })}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
