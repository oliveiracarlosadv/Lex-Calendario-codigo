"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CollaboratorDialog } from "@/components/events/responsible-select";
import { formatPhone } from "@/domain/shared/document";
import { useCollaborators, useDeleteCollaborator, useSaveCollaborator } from "@/hooks/use-collaborators";
import type { CollaboratorRow } from "@/types/db";
import { TeamSettings } from "./team-settings";

/** Configurações → Equipe: membros com conta e responsáveis cadastrados (sem conta). */
export function TeamTab() {
  return (
    <div className="space-y-6">
      <CollaboratorsSettings />
      <TeamSettings />
    </div>
  );
}

export function CollaboratorsSettings() {
  const { data: collaborators = [] } = useCollaborators();
  const save = useSaveCollaborator();
  const remove = useDeleteCollaborator();
  const [editing, setEditing] = useState<Partial<CollaboratorRow> | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Responsáveis pelas tarefas</CardTitle>
          <CardDescription>
            Pessoas que recebem tarefas sem precisar usar o app: estagiários, colegas, secretárias, correspondentes. Com e-mail, são convidadas e avisadas a cada tarefa.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing({})}><Plus /> Cadastrar</Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {collaborators.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent/60">
            <UserRound className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {c.name}
                {c.role && <Badge variant="outline" className="text-[11px]">{c.role}</Badge>}
                {!c.is_active && <Badge variant="secondary" className="text-[11px]">inativo</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{[c.email, c.phone && formatPhone(c.phone), c.oab && `OAB ${c.oab}`].filter(Boolean).join(" · ") || "Sem contato"}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => save.mutate({ ...c, is_active: !c.is_active })}>{c.is_active ? "Desativar" : "Ativar"}</Button>
            <Button variant="ghost" size="icon-sm" aria-label="Editar" onClick={() => setEditing(c)}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Remover" onClick={() => confirm(`Remover ${c.name}? As tarefas dele(a) ficam sem esse responsável.`) && remove.mutate(c.id)}><Trash2 /></Button>
          </div>
        ))}
        {!collaborators.length && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum responsável cadastrado. Também é possível cadastrar direto na tarefa, no campo Responsável.</p>}
      </CardContent>
      {editing && <CollaboratorDialog initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
