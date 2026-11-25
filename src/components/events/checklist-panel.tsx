"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { checklistProgress } from "@/domain/events/rules";
import { useChecklist, useChecklistMutations } from "@/hooks/use-event-workspace";
import { cn } from "@/lib/utils";
import type { ChecklistRow } from "@/types/db";

export function ChecklistPanel({ eventId }: { eventId: string }) {
  const { data: items = [] } = useChecklist(eventId);
  const { add, toggle, rename, remove, reorder } = useChecklistMutations(eventId);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const progress = checklistProgress(items.map((i) => ({ isDone: i.is_done })));
  const done = items.filter((i) => i.is_done).length;

  function onDrop(target: ChecklistRow) {
    if (!dragId || dragId === target.id) return;
    const from = items.findIndex((i) => i.id === dragId);
    const to = items.findIndex((i) => i.id === target.id);
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorder.mutate(next);
    setDragId(null);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Checklist</h2>
        <span className="text-xs text-muted-foreground">
          {done}/{items.length} · {progress}%
        </span>
      </div>
      <Progress value={progress} />
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li
            key={item.id}
            draggable
            onDragStart={() => setDragId(item.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(item)}
            className={cn("group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/50", dragId === item.id && "opacity-50")}
          >
            <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
            <Checkbox checked={item.is_done} onCheckedChange={() => toggle.mutate(item)} className="rounded-full" />
            <input
              defaultValue={item.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== item.title && rename.mutate({ id: item.id, title: e.target.value.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className={cn("min-w-0 flex-1 bg-transparent text-sm outline-none", item.is_done && "text-muted-foreground line-through")}
            />
            <button onClick={() => remove.mutate(item.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label="Remover etapa">
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          add.mutate(draft.trim());
          setDraft("");
        }}
        className="flex items-center gap-2 rounded-lg px-1 py-1"
      >
        <Plus className="ml-5 size-4 text-muted-foreground" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Adicionar etapa…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </form>
    </section>
  );
}
