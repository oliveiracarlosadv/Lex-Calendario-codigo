"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Mail, MapPin, Pencil, Phone, Plus, Send, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityFeed } from "@/components/events/activity-feed";
import { AttachmentsPanel } from "@/components/events/attachments-panel";
import { ProcessFormDialog } from "@/components/processes/process-form";
import { formatAddress } from "@/domain/clients/types";
import { formatDocument, formatPhone } from "@/domain/shared/document";
import { useArchiveClient, useClient, useDeleteClient } from "@/hooks/use-records";
import { CommunicationDialog } from "@/components/communications/communication-dialog";
import { CommunicationList } from "@/components/communications/communications-page";
import type { CommunicationRow } from "@/hooks/use-communications";
import { useCan } from "@/hooks/use-workspace";
import { formatDate } from "@/lib/utils";
import { ClientFormDialog } from "./client-form";
import { ClientHistory, ClientHistoryExport } from "./client-history";
import { ClientProcesses } from "./client-processes";
import { ClientContacts } from "./client-contacts";

export function ClientDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: c, isLoading } = useClient(id);
  const [composer, setComposer] = useState<{ initial?: Partial<CommunicationRow> } | null>(null);
  const archive = useArchiveClient();
  const remove = useDeleteClient();
  const [editing, setEditing] = useState(false);
  const [newProcess, setNewProcess] = useState(false);
  const canEdit = useCan("clients:update");
  const canDelete = useCan("clients:delete");
  const canCreateProcess = useCan("processes:create");

  if (isLoading || !c) return <div className="space-y-3 p-8"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /></div>;

  const address = formatAddress({
    addressStreet: c.address_street, addressNumber: c.address_number, addressComplement: c.address_complement,
    addressDistrict: c.address_district, addressCity: c.address_city, addressState: c.address_state, addressZip: c.address_zip,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8">
      <Button variant="ghost" size="sm" asChild><Link href="/clientes"><ArrowLeft /> Clientes</Link></Button>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={c.name} className="size-14 text-base" />
        <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            {c.kind === "company" ? "Pessoa jurídica" : "Pessoa física"} {c.document && `· ${formatDocument(c.document)}`} · cliente desde {formatDate(c.created_at)}
          </p>
          {c.contract_type && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.contract_type === "fixo" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-blue-500/15 text-blue-700 dark:text-blue-400"}`}>
                Contrato {c.contract_type === "fixo" ? "fixo (mensal)" : "por trabalho"}
              </span>
              {c.contract_value != null && (
                <span className="text-muted-foreground">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(c.contract_value))}
                  {c.contract_type === "fixo" ? "/mês" : ""}
                </span>
              )}
              {c.contract_notes && <span className="text-muted-foreground">· {c.contract_notes}</span>}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={() => setComposer({ initial: { client_id: id } })}><Send /> Comunicar</Button>
        <ClientHistoryExport clientId={id} />
        {canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Editar</Button>}
        {canDelete && (
          <Button variant="ghost" onClick={() => confirm("Arquivar este cliente?") && archive.mutate(id, { onSuccess: () => router.push("/clientes") })}>
            <Archive /> Arquivar
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() =>
              confirm(
                `Excluir definitivamente o cliente “${c.name}”?\n\nOs processos, compromissos e comunicações dele continuam no Lex, mas sem o cliente vinculado. Os documentos anexados diretamente ao cliente são apagados.\n\nSe quiser apenas tirar da lista, use “Arquivar”.`,
              ) && remove.mutate(id, { onSuccess: () => router.push("/clientes") })
            }
          >
            <Trash2 /> Excluir
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <ClientProcesses clientId={id} onNewProcess={canCreateProcess ? () => setNewProcess(true) : undefined} />

          <ClientHistory clientId={id} />

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Comunicações</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setComposer({ initial: { client_id: id } })}><Plus /> Nova</Button>
            </CardHeader>
            <CardContent>
              <CommunicationList clientId={id} compact onEdit={(c) => setComposer({ initial: c })} />
            </CardContent>
          </Card>

          <ActivityFeed type="client" id={id} />
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contato</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{c.email ? <a className="hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : "—"}</p>
              <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{c.phone ? <a className="hover:underline" href={`https://wa.me/55${c.phone}`} target="_blank" rel="noreferrer">{formatPhone(c.phone)}</a> : "—"}</p>
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{address || "—"}</p>
              {c.notes && <p className="whitespace-pre-wrap rounded-xl bg-secondary/60 p-3 text-[13px]">{c.notes}</p>}
            </CardContent>
          </Card>
          <ClientContacts clientId={id} />
          <AttachmentsPanel clientId={id} />
        </aside>
      </div>

      {composer && (
        <CommunicationDialog key={composer.initial?.id ?? "nova"} open onOpenChange={(o) => !o && setComposer(null)} initial={composer.initial} />
      )}
      {editing && <ClientFormDialog open={editing} onOpenChange={setEditing} initial={c} />}
      {newProcess && <ProcessFormDialog open={newProcess} onOpenChange={setNewProcess} initial={{ client_id: id }} onSaved={(pid) => router.push(`/processos/${pid}`)} />}
    </div>
  );
}
