"use client";

import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarStore } from "@/stores/calendar-store";
import { cn } from "@/lib/utils";

export function MiniCalendar() {
  const { date, setDate } = useCalendarStore();
  const focus = new Date(date);
  const [month, setMonth] = useState(startOfMonth(focus));
  const today = new Date();

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    const list: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) list.push(d);
    return list;
  }, [month]);

  return (
    <div className="select-none px-1">
      <div className="mb-1 flex items-center justify-between px-1">
        <p className="text-[13px] font-semibold capitalize">{format(month, "MMMM yyyy", { locale: ptBR })}</p>
        <div className="flex">
          <button className="rounded-md p-1 text-muted-foreground hover:bg-accent" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">
            <ChevronLeft className="size-4" />
          </button>
          <button className="rounded-md p-1 text-muted-foreground hover:bg-accent" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10.5px] font-medium uppercase text-muted-foreground">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-[12px]">
        {days.map((d) => {
          const isToday = isSameDay(d, today);
          const selected = isSameDay(d, focus);
          return (
            <button
              key={d.toISOString()}
              onClick={() => setDate(d)}
              className={cn(
                "mx-auto my-[1px] flex size-7 items-center justify-center rounded-full transition-colors",
                !isSameMonth(d, month) && "text-muted-foreground/45",
                isToday && "bg-[hsl(var(--today))] font-semibold text-white",
                !isToday && selected && "bg-foreground font-semibold text-background",
                !isToday && !selected && "hover:bg-accent",
              )}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
