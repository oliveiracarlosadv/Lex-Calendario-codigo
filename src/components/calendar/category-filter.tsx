"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useCategories } from "@/hooks/use-records";
import { useCalendarStore } from "@/stores/calendar-store";

export function CategoryFilter() {
  const { data: categories } = useCategories();
  const { hiddenCategories, toggleCategory, onlyMine, setOnlyMine } = useCalendarStore();

  return (
    <div className="space-y-2">
      <p className="px-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Agendas</p>
      <div className="space-y-0.5">
        {(categories ?? []).map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-accent/60">
            <Checkbox color={c.color} checked={!hiddenCategories.includes(c.id)} onCheckedChange={() => toggleCategory(c.id)} />
            <span className="truncate">{c.name}</span>
          </label>
        ))}
      </div>
      <label className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-accent/60">
        Somente meus compromissos
        <Switch checked={onlyMine} onCheckedChange={setOnlyMine} />
      </label>
    </div>
  );
}
