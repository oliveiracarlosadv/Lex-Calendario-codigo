"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { publicEnv } from "@/lib/env";

const LABELS: Record<string, string> = {
  event_categories: "categorias",
  clients: "clientes",
  processes: "processos",
  events: "compromissos",
  event_checklist_items: "etapas de checklist",
  event_reminders: "lembretes",
  event_comments: "comentários",
  event_attachments: "anexos",
  process_movements: "movimentações",
  oab_monitors: "OABs monitoradas",
  intimations: "intimações",
  ai_suggestions: "sugestões da IA",
};

export function BackupSettings() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [withFiles, setWithFiles] = useState(true);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [busy, setBusy] = useState(false);

  async function restore(file: File) {
    if (!confirm(`Restaurar o backup "${file.name}"? Os dados serão mesclados com os atuais (nada é apagado).`)) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("configuracoes", restoreSettings ? "1" : "0");
      const res = await fetch("/api/backup/import", { method: "POST", body });
      const json = (await res.json()) as { error?: string; imported?: Record<string, number>; failed?: Record<string, number>; files?: number };
      if (!res.ok) throw new Error(json.error ?? "Falha na restauração");
      const parts = Object.entries(json.imported ?? {}).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${LABELS[t] ?? t}`);
      const failed = Object.values(json.failed ?? {}).reduce((a, b) => a + b, 0);
      toast.success("Backup restaurado", { description: `${parts.join(", ") || "nenhum dado novo"}${json.files ? `, ${json.files} arquivo(s)` : ""}${failed ? ` · ${failed} item(ns) ignorado(s) por duplicidade` : ""}.` });
      void qc.invalidateQueries();
      // Perfil, escritório (logomarca, endereço) e preferências vêm carregados com a página: recarrega para mostrá-los
      if (restoreSettings) window.setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DatabaseBackup className="size-4" /> Exportar backup</CardTitle>
          <CardDescription>
            Gera um arquivo com tudo o que está cadastrado e configurado: compromissos, checklists, lembretes, comentários, convidados, clientes,
            contatos dos clientes, parceiros, responsáveis e equipe, processos e anotações, movimentações, intimações, OABs monitoradas, sugestões da IA, comunicações e modelos,
            categorias e cores, o seu perfil (nome, função, OAB, CPF, telefone) e o escritório (nome, CNPJ, logomarca, endereço e feriados).
            Senhas e tokens de contas conectadas não são exportados (por segurança, reconecte após restaurar).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between text-sm">
            Incluir anexos (PDF, DOCX, imagens…)
            <Switch checked={withFiles} onCheckedChange={setWithFiles} />
          </label>
          <Button asChild>
            <a href={`/api/backup/export${withFiles ? "?arquivos=1" : ""}`}><Download /> Baixar backup (.json)</a>
          </Button>
          {publicEnv.localMode && !publicEnv.webMode && (
            <p className="text-xs text-muted-foreground">
              Backup automático: o app salva uma cópia por dia em <strong>Documentos/Lex Calendário/backups</strong> (mantém as 10 mais recentes). Os dados de trabalho ficam em local protegido do sistema (no Mac: Biblioteca/Application Support/Lex Calendário).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="size-4" /> Importar / restaurar backup</CardTitle>
          <CardDescription>
            Restaura um arquivo gerado pelo Lex Calendário — neste ou em outro computador. Os dados são mesclados: itens já existentes são
            atualizados e nada é apagado. Clientes são reconhecidos pelo CPF/CNPJ e processos pelo número.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between text-sm">
            Restaurar também o perfil, o escritório (nome, CNPJ, logomarca, endereço) e as preferências
            <Switch checked={restoreSettings} onCheckedChange={setRestoreSettings} />
          </label>
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} {busy ? "Restaurando…" : "Escolher arquivo de backup"}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void restore(f);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
