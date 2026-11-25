"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Download, Plus, Search, User, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/app-shell";
import { formatDocument, formatPhone } from "@/domain/shared/document";
import { useClients } from "@/hooks/use-records";
import { useCan } from "@/hooks/use-workspace";
import { ClientFormDialog } from "./client-form";

export function ClientsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: clients, isLoading } = useClients(search);
  const canCreate = useCan("clients:create");

  return (
    <div>
      <PageHeader
        title="Clientes"
        description={`${clients?.length ?? 0} cliente(s) cadastrado(s)`}
        actions={
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><Download /> Exportar todos</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem asChild>
                  <a href="/api/clientes/exportar?formato=csv" download>Planilha (Excel/CSV) — cadastro e resumo</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/api/clientes/exportar?formato=pdf" target="_blank" rel="noreferrer">PDF — lista de clientes</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/api/clientes/exportar?formato=json" download>Completo (JSON) — cadastro e histórico</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canCreate && <Button onClick={() => setOpen(true)}><Plus /> Novo cliente</Button>}
          </div>
        }
      />
      <div className="space-y-4 p-4 md:p-8">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, e-mail, CPF ou CNPJ" className="pl-9" />
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : !clients?.length ? (
          <EmptyState icon={Users} title="Nenhum cliente" description="Cadastre clientes para vincular processos, compromissos e documentos." action={canCreate && <Button onClick={() => setOpen(true)}><Plus /> Cadastrar cliente</Button>} />
        ) : (
          <div className="overflow-hidden rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">CPF/CNPJ</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Contato</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Cidade</th>
                  <th className="px-4 py-2.5 text-right font-medium">Processos</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-t transition hover:bg-accent/40" onClick={() => router.push(`/clientes/${c.id}`)}>
                    <td className="px-4 py-3">
                      <Link href={`/clientes/${c.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <Avatar name={c.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            {c.kind === "company" ? <Building2 className="size-3" /> : <User className="size-3" />}
                            {c.kind === "company" ? "Pessoa jurídica" : "Pessoa física"}
                            {c.contract_type && (
                              <span className={`ml-1 rounded-full px-1.5 text-[10.5px] font-medium ${c.contract_type === "fixo" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-blue-500/15 text-blue-700 dark:text-blue-400"}`}>
                                {c.contract_type === "fixo" ? "contrato fixo" : "por trabalho"}
                              </span>
                            )}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 tabular-nums text-muted-foreground md:table-cell">{formatDocument(c.document) || "—"}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      <span className="block">{c.email ?? "—"}</span>
                      <span className="block text-xs">{formatPhone(c.phone)}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{[c.address_city, c.address_state].filter(Boolean).join("/") || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.processes?.[0]?.count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <ClientFormDialog open={open} onOpenChange={setOpen} onSaved={(id) => router.push(`/clientes/${id}`)} />}
    </div>
  );
}
