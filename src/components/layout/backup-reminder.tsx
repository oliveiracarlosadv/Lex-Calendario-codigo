"use client";

import { useEffect, useState } from "react";
import { DatabaseBackup, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCan } from "@/hooks/use-workspace";

const KEY = "lex-backup-lembrete";
const WEEK = 7 * 864e5;
const DAY = 864e5;

/** A cada 7 dias abre uma janela convidando a salvar o backup completo num local escolhido pelo usuário. */
export function BackupReminder() {
  const allowed = useCan("organization:update");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    const check = () => {
      let next = 0;
      try {
        next = Number(window.localStorage.getItem(KEY) ?? 0);
        // Primeira vez: a janela aparece daqui a 7 dias
        if (!next) window.localStorage.setItem(KEY, String(Date.now() + WEEK));
      } catch {
        return;
      }
      if (next && Date.now() >= next) setOpen(true);
    };
    const first = window.setTimeout(check, 20_000);
    const id = window.setInterval(check, 60 * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [allowed]);

  function schedule(ms: number) {
    try {
      window.localStorage.setItem(KEY, String(Date.now() + ms));
    } catch {
      // sem armazenamento local: a janela volta na próxima abertura
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : schedule(DAY))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><DatabaseBackup className="size-4" /> Backup da semana</DialogTitle>
          <DialogDescription>
            Já faz 7 dias desde o último backup. Salve agora uma cópia completa — compromissos, clientes, processos, parceiros, equipe, perfil,
            escritório e anexos — num lugar seguro (pendrive, Google Drive, iCloud).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => schedule(DAY)}>Lembrar amanhã</Button>
          <Button asChild onClick={() => schedule(WEEK)}>
            <a href="/api/backup/export?arquivos=1" download><Download /> Salvar backup agora</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
