"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProcessClientDialog } from "@/components/intimations/register-from-intimation";
import { useProcesses } from "@/hooks/use-records";
import { useCan } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

/**
 * "Vincular ao cliente": aparece onde houver um processo cadastrado ainda sem cliente.
 * Abre a mesma janela das intimações (cliente existente ou novo, sugerido pelas partes publicadas).
 * Some sozinho quando o processo já tem cliente.
 */
export function LinkClientButton({
  processId,
  number,
  size = "sm",
  variant = "outline",
  className,
}: {
  processId?: string | null;
  /** Alternativa ao id: número do processo (com ou sem pontuação). */
  number?: string | null;
  size?: "sm" | "xs" | "default";
  variant?: "outline" | "default" | "ghost" | "secondary";
  className?: string;
}) {
  const canEdit = useCan("processes:update");
  const { data: processes } = useProcesses();
  const [open, setOpen] = useState(false);
  const digits = number?.replace(/\D/g, "");
  const p = processId
    ? processes?.find((x) => x.id === processId)
    : digits
      ? processes?.find((x) => x.number?.replace(/\D/g, "") === digits)
      : undefined;
  if (!canEdit || !p || p.client_id) return null;

  return (
    <>
      <Button
        type="button"
        size={size === "xs" ? "sm" : size}
        variant={variant}
        className={cn(size === "xs" && "h-6 px-2 text-[11px]", className)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Este processo ainda não tem cliente"
      >
        <UserPlus /> Vincular ao cliente
      </Button>
      {open && (
        <ProcessClientDialog
          open={open}
          onOpenChange={setOpen}
          source={{ processId: p.id, number: p.number ?? "", tribunal: p.tribunal, organ: p.court_division, className: p.procedural_class }}
        />
      )}
    </>
  );
}
