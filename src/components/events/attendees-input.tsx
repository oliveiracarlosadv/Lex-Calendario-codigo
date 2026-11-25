"use client";

import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { useClients } from "@/hooks/use-records";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import type { Attendee } from "@/types/db";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const STATUS: Record<string, { label: string; cls: string }> = {
  accepted: { label: "confirmou", cls: "text-emerald-600" },
  declined: { label: "recusou", cls: "text-red-600" },
  tentative: { label: "talvez", cls: "text-amber-600" },
  needsAction: { label: "aguardando", cls: "text-muted-foreground" },
};

/**
 * Convidados do compromisso. Com uma conta Google/Microsoft conectada, o próprio
 * Google Agenda/Outlook envia o convite por e-mail e devolve as respostas.
 */
export function AttendeesInput({ value, onChange, compact }: { value: Attendee[]; onChange: (v: Attendee[]) => void; compact?: boolean }) {
  const [draft, setDraft] = useState("");
  const { data: clients = [] } = useClients();
  const { members } = useWorkspace();
  const suggestions = [
    ...clients.filter((c) => c.email).map((c) => ({ email: c.email!, name: c.name })),
    ...members.filter((m) => m.profile?.email).map((m) => ({ email: m.profile!.email!, name: m.profile?.full_name ?? null })),
  ].filter((s) => !value.some((v) => v.email.toLowerCase() === s.email.toLowerCase()));

  function add(raw: string) {
    const parts = raw.split(/[,;\s]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    const next = [...value];
    for (const email of parts) {
      if (!EMAIL.test(email) || next.some((v) => v.email.toLowerCase() === email)) continue;
      const known = suggestions.find((s) => s.email.toLowerCase() === email);
      next.push({ email, name: known?.name ?? null, status: "needsAction" });
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((a) => (
            <li key={a.email} className="flex items-center gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {a.name ? <><span className="font-medium">{a.name}</span> <span className="text-muted-foreground">· {a.email}</span></> : a.email}
              </span>
              {a.status && STATUS[a.status] && <span className={cn("text-xs", STATUS[a.status].cls)}>{STATUS[a.status].label}</span>}
              <button type="button" onClick={() => onChange(value.filter((v) => v.email !== a.email))} className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label={`Remover ${a.email}`}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5">
        <UserPlus className="size-4 shrink-0 text-muted-foreground" />
        <input
          list="lex-attendee-suggestions"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={compact ? "Adicionar convidado (e-mail)" : "Convidados: digite o e-mail e tecle Enter"}
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          type="email"
          autoComplete="off"
        />
        <datalist id="lex-attendee-suggestions">
          {suggestions.map((s) => <option key={s.email} value={s.email}>{s.name ?? ""}</option>)}
        </datalist>
      </div>
    </div>
  );
}
