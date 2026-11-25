"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EVENT_KINDS, EVENT_KIND_LABELS, type EventKind } from "@/domain/events/types";
import { useCategories, useCategoryMutations } from "@/hooks/use-records";
import { useCan } from "@/hooks/use-workspace";

export function CategoriesSettings() {
  const { data: categories = [] } = useCategories();
  const { update, create, remove } = useCategoryMutations();
  const canManage = useCan("categories:manage");
  const [draft, setDraft] = useState<{ name: string; color: string; kind: EventKind }>({ name: "", color: "#556B2F", kind: "custom" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categorias e cores</CardTitle>
        <CardDescription>Escolha a cor de cada tipo de compromisso. As mudanças valem para todo o escritório.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl border px-3 py-2">
            <input type="color" value={c.color} disabled={!canManage} onChange={(e) => update.mutate({ id: c.id, color: e.target.value.toUpperCase() })} className="size-8 cursor-pointer rounded-lg border bg-transparent p-0.5" aria-label={`Cor de ${c.name}`} />
            <Input defaultValue={c.name} disabled={!canManage} onBlur={(e) => e.target.value !== c.name && update.mutate({ id: c.id, name: e.target.value })} className="h-8 flex-1" />
            <span className="hidden text-xs text-muted-foreground sm:block">{EVENT_KIND_LABELS[c.kind]}</span>
            <Switch checked={c.is_visible} disabled={!canManage} onCheckedChange={(v) => update.mutate({ id: c.id, is_visible: v })} aria-label="Visível" />
            {canManage && (
              <Button variant="ghost" size="icon-sm" onClick={() => confirm(`Remover a categoria "${c.name}"?`) && remove.mutate(c.id)} aria-label="Remover"><Trash2 /></Button>
            )}
          </div>
        ))}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 pt-3">
            <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })} className="size-9 cursor-pointer rounded-lg border bg-transparent p-0.5" aria-label="Cor" />
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nova categoria (ex.: Perícia)" className="min-w-[200px] flex-1" />
            <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as EventKind })}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{EVENT_KINDS.map((k) => <SelectItem key={k} value={k}>{EVENT_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
            <Button disabled={!draft.name.trim()} onClick={() => { create.mutate(draft); setDraft({ ...draft, name: "" }); }}><Plus /> Adicionar</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
