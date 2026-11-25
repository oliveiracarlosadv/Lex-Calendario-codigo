"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, Phone, Plus, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatPhone } from "@/domain/shared/document";
import { sb, unwrap } from "@/hooks/supabase";
import { useCan, useWorkspace } from "@/hooks/use-workspace";

export interface ClientContactRow {
  id: string;
  client_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  receives_communications: boolean;
}

const RELATIONSHIPS = ["Cônjuge", "Filho(a)", "Pai/Mãe", "Familiar", "Secretário(a)", "Contador(a)", "Representante legal", "Sócio(a)", "Procurador(a)", "Outro"];

export function useClientContacts(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["client-contacts", clientId],
    enabled: !!clientId,
    queryFn: async () => unwrap(await sb().from("client_contacts").select("*").eq("client_id", clientId!).order("name")) as ClientContactRow[],
  });
}

function useContactMutations(clientId: string) {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["client-contacts", clientId] });
  const save = useMutation({
    mutationFn: async (c: Partial<ClientContactRow> & { name: string }) => {
      const payload = {
        organization_id: organization.id,
        client_id: clientId,
        name: c.name.trim(),
        relationship: c.relationship?.trim() || null,
        email: c.email?.trim().toLowerCase() || null,
        phone: c.phone?.replace(/\D/g, "") || null,
        notes: c.notes?.trim() || null,
        receives_communications: c.receives_communications ?? true,
      };
      if (c.id) return unwrap(await sb().from("client_contacts").update(payload).eq("id", c.id).select("id"));
      return unwrap(await sb().from("client_contacts").insert({ ...payload, created_by: userId }).select("id"));
    },
    onSuccess: () => {
      toast.success("Contato salvo");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("client_contacts").delete().eq("id", id).select("id")),
    onSuccess: refresh,
  });
  return { save, remove };
}

/** Pessoas terceiras ligadas ao cliente (familiar, secretária, contador…) que recebem comunicações. */
export function ClientContacts({ clientId }: { clientId: string }) {
  const { data: contacts = [] } = useClientContacts(clientId);
  const { remove } = useContactMutations(clientId);
  const canEdit = useCan("clients:update");
  const [editing, setEditing] = useState<Partial<ClientContactRow> | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><UsersRound className="size-4" /> Contatos para comunicação</CardTitle>
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing({})}><Plus /> Novo</Button>}
      </CardHeader>
      <CardContent className="space-y-2">
        {contacts.map((c) => (
          <div key={c.id} className="group rounded-xl border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              {c.relationship && <span className="text-xs text-muted-foreground">{c.relationship}</span>}
              {canEdit && (
                <span className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => setEditing(c)} className="text-muted-foreground hover:text-foreground" aria-label="Editar contato"><Pencil className="size-3.5" /></button>
                  <button onClick={() => confirm(`Excluir o contato ${c.name}?`) && remove.mutate(c.id)} className="text-muted-foreground hover:text-destructive" aria-label="Excluir contato">
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              )}
            </div>
            {c.email && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3" /><a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a></p>}
            {c.phone && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="size-3" /><a className="hover:underline" href={`https://wa.me/55${c.phone}`} target="_blank" rel="noreferrer">{formatPhone(c.phone)}</a>
              </p>
            )}
            {!c.receives_communications && <p className="text-[11px] text-muted-foreground">Não recebe comunicações</p>}
          </div>
        ))}
        {!contacts.length && <p className="text-xs text-muted-foreground">Cadastre um familiar, secretária, contador ou representante para receber as comunicações do cliente.</p>}
      </CardContent>
      {editing && <ContactDialog clientId={clientId} initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ContactDialog({ clientId, initial, onClose }: { clientId: string; initial: Partial<ClientContactRow>; onClose: () => void }) {
  const { save } = useContactMutations(clientId);
  const [f, setF] = useState<Partial<ClientContactRow>>({ receives_communications: true, ...initial });
  const set = (k: keyof ClientContactRow) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const emailOk = !f.email || /^\S+@\S+\.\S+$/.test(f.email);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{f.id ? "Editar contato" : "Novo contato do cliente"}</DialogTitle>
          <DialogDescription>Pessoa terceira que pode receber e-mails e mensagens sobre o cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Nome</Label>
            <Input autoFocus value={f.name ?? ""} onChange={set("name")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Vínculo com o cliente</Label>
            <Input value={f.relationship ?? ""} onChange={set("relationship")} list="lex-vinculos" placeholder="Cônjuge, secretária, contador…" />
            <datalist id="lex-vinculos">{RELATIONSHIPS.map((r) => <option key={r} value={r} />)}</datalist>
          </div>
          <div className="grid gap-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={f.email ?? ""} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Telefone / WhatsApp</Label>
            <Input value={f.phone ?? ""} onChange={set("phone")} placeholder="(91) 99999-9999" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Observações</Label>
            <Input value={f.notes ?? ""} onChange={set("notes")} />
          </div>
          <label className="flex items-center justify-between text-sm sm:col-span-2">
            Recebe comunicações do escritório
            <Switch checked={f.receives_communications ?? true} onCheckedChange={(v) => setF((p) => ({ ...p, receives_communications: v }))} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={(f.name ?? "").trim().length < 2 || !emailOk || save.isPending}
            onClick={() => save.mutate({ ...f, name: f.name ?? "" }, { onSuccess: onClose })}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
