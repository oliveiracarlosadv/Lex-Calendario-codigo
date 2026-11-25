"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { BriefcaseBusiness, CalendarDays, FileText, Plus, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useGlobalSearch } from "@/hooks/use-records";
import { NAV_ITEMS } from "./nav-items";
import { useUiStore } from "@/stores/ui-store";
import { formatDateTime } from "@/lib/utils";

const ICONS = { client: User, process: BriefcaseBusiness, event: CalendarDays, note: FileText };
const GROUPS = { client: "Clientes", process: "Processos", event: "Compromissos", note: "Anotações" };

export function CommandSearch() {
  const router = useRouter();
  const { searchOpen, setSearchOpen, openQuickCreate } = useUiStore();
  const [q, setQ] = useState("");
  const { data: results, isFetching } = useGlobalSearch(q);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(!useUiStore.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  function go(href: string) {
    setSearchOpen(false);
    setQ("");
    router.push(href);
  }

  const hrefFor = (type: string, id: string) =>
    type === "client" ? `/clientes/${id}` : type === "process" ? `/processos/${id}` : `/eventos/${id}`;

  const grouped = (results ?? []).reduce<Record<string, typeof results>>((acc, r) => {
    (acc[r.entity_type] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent hideClose className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Busca global</DialogTitle>
        <Command shouldFilter={false} className="flex flex-col" loop>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="Buscar clientes, processos, compromissos e anotações…"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            {isFetching && <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />}
          </div>
          <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
            {q.trim().length >= 2 && !isFetching && !results?.length && (
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">Nada encontrado para “{q}”.</Command.Empty>
            )}
            {q.trim().length < 2 && (
              <Command.Group heading="Ações rápidas" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                <Command.Item
                  onSelect={() => {
                    const start = new Date();
                    start.setMinutes(0, 0, 0);
                    start.setHours(start.getHours() + 1);
                    setSearchOpen(false);
                    openQuickCreate({ start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), allDay: false });
                  }}
                  className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
                >
                  <Plus className="size-4 text-muted-foreground" /> Novo compromisso
                </Command.Item>
                {NAV_ITEMS.map((n) => (
                  <Command.Item
                    key={n.href}
                    onSelect={() => go(n.href)}
                    className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground aria-selected:bg-accent"
                  >
                    <n.icon className="size-4 text-muted-foreground" /> Ir para {n.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {Object.entries(grouped).map(([type, items]) => (
              <Command.Group
                key={type}
                heading={GROUPS[type as keyof typeof GROUPS]}
                className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {items!.map((r) => {
                  const Icon = ICONS[r.entity_type];
                  return (
                    <Command.Item
                      key={`${type}-${r.id}`}
                      value={`${type}-${r.id}`}
                      onSelect={() => go(hrefFor(r.entity_type, r.id))}
                      className="flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-foreground aria-selected:bg-accent"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{r.title}</span>
                        {r.subtitle && <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>}
                      </span>
                      {r.starts_at && <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(r.starts_at)}</span>}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
          <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ navegar · ↵ abrir · esc fechar</span>
            <span>⌘K</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
