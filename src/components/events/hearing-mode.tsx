"use client";

import { Building, MonitorPlay } from "lucide-react";
import { cn } from "@/lib/utils";

export type HearingMode = "online" | "presencial";

export const HEARING_MODE_LABELS: Record<HearingMode, string> = { online: "On-line", presencial: "Presencial" };

/** Seleção da modalidade da audiência: on-line ou presencial. */
export function HearingModeToggle({ value, onChange, className }: { value: HearingMode | null | undefined; onChange: (v: HearingMode | null) => void; className?: string }) {
  const option = (mode: HearingMode, Icon: typeof Building) => (
    <button
      type="button"
      onClick={() => onChange(value === mode ? null : mode)}
      aria-pressed={value === mode}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition",
        value === mode ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent",
      )}
    >
      <Icon className="size-4" /> {HEARING_MODE_LABELS[mode]}
    </button>
  );
  return (
    <div className={cn("flex gap-2", className)}>
      {option("presencial", Building)}
      {option("online", MonitorPlay)}
    </div>
  );
}
