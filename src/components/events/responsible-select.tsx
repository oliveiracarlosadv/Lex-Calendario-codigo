"use client";

import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollaborators, useDeleteCollaborator, useSaveCollaborator, type CollaboratorInput } from "@/hooks/use-collaborators";
import { useWorkspace } from "@/hooks/use-workspace";
import { partnerCategoryLabel, usePartners } from "@/hooks/use-partners";
import type { CollaboratorRow } from "@/types/db";

const NONE = "__none";
const NEW = "__novo";
const MANAGE = "__gerenciar";

export interface ResponsibleValue {
  responsibleId: string | null;
  collaboratorId: string | null;
  partnerId?: string | null;
}

/** Pessoa escolhida (responsável cadastrado ou parceiro), para convite e aviso por e-mail. */
export interface ResponsiblePerson {
  name: string;
  email: string | null;
}

/**
 * Responsável da tarefa: membros com conta no app ou pessoas cadastradas como
 * responsáveis (estagiários, colegas, correspondentes, convidados por e-mail).
 * Com uma pessoa cadastrada, o usuário atual continua dono dos lembretes.
 */
export function ResponsibleSelect({
  value,
  onChange,
  allowNone = true,
  className,
}: {
  value: ResponsibleValue;
  onChange: (v: ResponsibleValue, person: ResponsiblePerson | null) => void;
  allowNone?: boolean;
  className?: string;
}) {
  const { members, userId } = useWorkspace();
  const { data: collaborators = [] } = useCollaborators();
  const { data: partners = [] } = usePartners();
  const activePartners = partners.filter((p) => p.is_active || p.id === value.partnerId);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const active = collaborators.filter((c) => c.is_active || c.id === value.collaboratorId);
  const current = value.partnerId ? `p:${value.partnerId}` : value.collaboratorId ? `c:${value.collaboratorId}` : (value.responsibleId ?? NONE);

  function select(v: string) {
    if (v === NEW) return setCreating(true);
    if (v === MANAGE) return setManaging(true);
    if (v === NONE) return onChange({ responsibleId: null, collaboratorId: null, partnerId: null }, null);
    if (v.startsWith("c:")) {
      const c = collaborators.find((x) => x.id === v.slice(2)) ?? null;
      return onChange({ responsibleId: value.responsibleId ?? userId, collaboratorId: v.slice(2), partnerId: null }, c);
    }
    if (v.startsWith("p:")) {
      const p = partners.find((x) => x.id === v.slice(2)) ?? null;
      return onChange({ responsibleId: value.responsibleId ?? userId, collaboratorId: null, partnerId: v.slice(2) }, p);
    }
    onChange({ responsibleId: v, collaboratorId: null, partnerId: null }, null);
  }

  return (
    <>
      <Select value={current} onValueChange={select}>
        <SelectTrigger className={className}><SelectValue /></SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE} className="text-muted-foreground">Sem responsável (remover)</SelectItem>}
          <SelectGroup>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.profile?.full_name ?? m.profile?.email ?? "Membro"}
                {m.user_id === userId ? " (eu)" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
          {!!active.length && (
            <SelectGroup>
              {active.map((c) => (
                <SelectItem key={c.id} value={`c:${c.id}`}>
                  {c.name}
                  {c.role ? ` — ${c.role}` : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {!!activePartners.length && (
            <SelectGroup>
              {activePartners.map((p) => (
                <SelectItem key={p.id} value={`p:${p.id}`}>
                  {p.name} — parceiro ({partnerCategoryLabel(p.category).toLowerCase()})
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectItem value={NEW} className="text-primary">+ Cadastrar outro responsável…</SelectItem>
          {!!collaborators.length && <SelectItem value={MANAGE} className="text-muted-foreground">Gerenciar / excluir responsáveis…</SelectItem>}
        </SelectContent>
      </Select>
      {managing && (
        <ManageResponsiblesDialog
          onClose={() => setManaging(false)}
          onDeleted={(id) => {
            // Excluído o responsável desta tarefa: a tarefa fica sem ele
            if (id === value.collaboratorId) onChange({ responsibleId: value.responsibleId, collaboratorId: null, partnerId: null }, null);
          }}
        />
      )}
      {creating && (
        <CollaboratorDialog
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            onChange({ responsibleId: value.responsibleId ?? userId, collaboratorId: c.id, partnerId: null }, c);
          }}
        />
      )}
    </>
  );
}

const ROLES = ["Advogado(a)", "Estagiário(a)", "Secretário(a)", "Assistente", "Correspondente", "Perito(a)", "Outro"];

export function CollaboratorDialog({ initial, onClose, onSaved }: { initial?: Partial<CollaboratorRow>; onClose: () => void; onSaved?: (c: CollaboratorRow) => void }) {
  const save = useSaveCollaborator();
  const [form, setForm] = useState<CollaboratorInput>({
    id: initial?.id,
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    role: initial?.role ?? "",
    oab: initial?.oab ?? "",
  });
  const set = (k: keyof CollaboratorInput) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const emailOk = !form.email || /^\S+@\S+\.\S+$/.test(form.email);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar responsável" : "Cadastrar responsável"}</DialogTitle>
          <DialogDescription>
            Pessoa que pode receber tarefas mesmo sem usar o app. Com e-mail, ela é convidada para a tarefa e recebe o aviso por e-mail.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Nome</Label>
            <Input autoFocus value={form.name} onChange={set("name")} placeholder="Nome completo" />
          </div>
          <div className="grid gap-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={form.email ?? ""} onChange={set("email")} placeholder="pessoa@exemplo.com" />
          </div>
          <div className="grid gap-1.5">
            <Label>Telefone / WhatsApp</Label>
            <Input value={form.phone ?? ""} onChange={set("phone")} placeholder="(91) 99999-9999" />
          </div>
          <div className="grid gap-1.5">
            <Label>Função</Label>
            <Input value={form.role ?? ""} onChange={set("role")} list="lex-funcoes" placeholder="Estagiário(a)" />
            <datalist id="lex-funcoes">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
          </div>
          <div className="grid gap-1.5">
            <Label>OAB (se houver)</Label>
            <Input value={form.oab ?? ""} onChange={set("oab")} placeholder="12345/PA" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={form.name.trim().length < 2 || !emailOk || save.isPending}
            onClick={() => save.mutate(form, { onSuccess: (c) => (onSaved ? onSaved(c) : onClose()) })}
          >
            {save.isPending && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lista os responsáveis cadastrados para editar ou excluir, sem sair da tarefa. */
function ManageResponsiblesDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: (id: string) => void }) {
  const { data: collaborators = [] } = useCollaborators();
  const remove = useDeleteCollaborator();
  const [editing, setEditing] = useState<CollaboratorRow | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Responsáveis cadastrados</DialogTitle>
          <DialogDescription>Excluir um responsável o retira da lista e das tarefas em que ele estava (as tarefas continuam).</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
          {collaborators.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-accent/60">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{[c.role, c.email].filter(Boolean).join(" · ") || "—"}</span>
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={`Editar ${c.name}`} onClick={() => setEditing(c)}><Pencil /></Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Excluir ${c.name}`}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={remove.isPending}
                onClick={() => confirm(`Excluir o responsável “${c.name}”?`) && remove.mutate(c.id, { onSuccess: () => onDeleted(c.id) })}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {!collaborators.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum responsável cadastrado.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Parceiros são gerenciados no menu Parceiros (lá também é possível desativá-los ou excluí-los).</p>
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
        {editing && <CollaboratorDialog initial={editing} onClose={() => setEditing(null)} />}
      </DialogContent>
    </Dialog>
  );
}

export interface CoResponsible {
  type: "member" | "collaborator" | "partner";
  id: string;
}

/**
 * Responsáveis adicionais da tarefa (além do principal): advogados da equipe,
 * responsáveis cadastrados e parceiros.
 */
export function CoResponsibles({
  value,
  onChange,
  exclude,
}: {
  value: CoResponsible[];
  onChange: (list: CoResponsible[], added: (ResponsiblePerson & { ref: CoResponsible }) | null) => void;
  exclude?: CoResponsible[];
}) {
  const { members } = useWorkspace();
  const { data: collaborators = [] } = useCollaborators();
  const { data: partners = [] } = usePartners();
  const key = (r: CoResponsible) => `${r.type}:${r.id}`;
  const taken = new Set([...value, ...(exclude ?? [])].map(key));

  const options = [
    ...members.map((m) => ({ ref: { type: "member" as const, id: m.user_id }, name: m.profile?.full_name ?? m.profile?.email ?? "Membro", email: m.profile?.email ?? null, hint: "advogado(a) da equipe" })),
    ...collaborators.filter((c) => c.is_active).map((c) => ({ ref: { type: "collaborator" as const, id: c.id }, name: c.name, email: c.email, hint: c.role ?? "responsável" })),
    ...partners.filter((p) => p.is_active).map((p) => ({ ref: { type: "partner" as const, id: p.id }, name: p.name, email: p.email, hint: "parceiro" })),
  ];
  const nameOf = (r: CoResponsible) => options.find((o) => key(o.ref) === key(r))?.name ?? "Responsável removido";
  const available = options.filter((o) => !taken.has(key(o.ref)));

  return (
    <div className="space-y-1.5">
      {!!value.length && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((r) => (
            <span key={key(r)} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
              {nameOf(r)}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => key(x) !== key(r)), null)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remover ${nameOf(r)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {!!available.length && (
        <Select
          value=""
          onValueChange={(v) => {
            const o = available.find((x) => key(x.ref) === v);
            if (o) onChange([...value, o.ref], { name: o.name, email: o.email, ref: o.ref });
          }}
        >
          <SelectTrigger className="h-8 text-xs text-muted-foreground"><SelectValue placeholder="+ Adicionar outro responsável" /></SelectTrigger>
          <SelectContent>
            {available.map((o) => (
              <SelectItem key={key(o.ref)} value={key(o.ref)}>
                {o.name} — {o.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
