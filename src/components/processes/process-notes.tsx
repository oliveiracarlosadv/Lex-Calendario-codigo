"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, Pencil, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { sb, unwrap } from "@/hooks/supabase";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatDateTime } from "@/lib/utils";

interface NoteRow {
  id: string;
  process_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export function useProcessNotes(processId: string) {
  return useQuery({
    queryKey: ["process-notes", processId],
    queryFn: async () =>
      unwrap(await sb().from("process_notes").select("*").eq("process_id", processId).order("created_at")) as NoteRow[],
  });
}

/** Quantidade de anotações por processo (para a Central de Processos). */
export function useProcessNoteCounts() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: ["process-notes", "counts", organization.id],
    queryFn: async () => {
      const rows = unwrap(await sb().from("process_notes").select("process_id").eq("organization_id", organization.id).limit(20000)) as { process_id: string }[];
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.process_id, (map.get(r.process_id) ?? 0) + 1);
      return map;
    },
  });
}

function useNoteMutations(processId: string) {
  const qc = useQueryClient();
  const { organization, userId } = useWorkspace();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["process-notes"] });
  const add = useMutation({
    mutationFn: async (body: string) =>
      unwrap(await sb().from("process_notes").insert({ organization_id: organization.id, process_id: processId, author_id: userId, body }).select("id")),
    onSuccess: refresh,
    onError: (e: Error) => toast.error("Anotação não salva", { description: e.message }),
  });
  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => unwrap(await sb().from("process_notes").update({ body }).eq("id", id).select("id")),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("process_notes").delete().eq("id", id).select("id")),
    onSuccess: refresh,
  });
  return { add, update, remove };
}

/** Anotações do processo: numeradas do mais antigo para o mais novo, com autor e data. */
export function ProcessNotes({ processId, compact }: { processId: string; compact?: boolean }) {
  const { data: notes = [] } = useProcessNotes(processId);
  const { add, update, remove } = useNoteMutations(processId);
  const { members, userId, role } = useWorkspace();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const author = (id: string | null) => members.find((m) => m.user_id === id)?.profile;
  const canManage = (n: NoteRow) => n.author_id === userId || role === "admin" || role === "partner";

  function save() {
    if (!body.trim()) return;
    add.mutate(body.trim(), { onSuccess: () => setBody("") });
  }

  const list = (
    <div className="space-y-3">
      {notes.map((n, i) => {
        const a = author(n.author_id);
        return (
          <div key={n.id} className="group flex gap-3">
            <Avatar name={a?.full_name} src={a?.avatar_url} className="size-7" />
            <div className="min-w-0 flex-1 rounded-xl bg-secondary/60 px-3 py-2">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="rounded-md bg-primary/10 px-1.5 font-semibold tabular-nums text-primary">{i + 1}</span>
                <span className="font-semibold">{a?.full_name ?? "Membro"}</span>
                <span className="text-muted-foreground">
                  {formatDateTime(n.created_at)}
                  {n.updated_at && new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 60_000 ? " · editada" : ""}
                </span>
                {canManage(n) && (
                  <span className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => setEditing({ id: n.id, body: n.body })} className="text-muted-foreground hover:text-foreground" aria-label="Editar anotação">
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => confirm("Excluir esta anotação?") && remove.mutate(n.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Excluir anotação"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {editing?.id === n.id ? (
                <div className="mt-1 space-y-2">
                  <Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                    <Button
                      size="sm"
                      disabled={!editing.body.trim()}
                      onClick={() => update.mutate({ id: n.id, body: editing.body.trim() }, { onSuccess: () => setEditing(null) })}
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              )}
            </div>
          </div>
        );
      })}
      {!notes.length && <p className="py-2 text-center text-sm text-muted-foreground">Nenhuma anotação ainda.</p>}
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
          placeholder="Escreva uma anotação sobre o processo… (⌘↵ para salvar)"
          className="min-h-[60px]"
        />
        <Button size="icon" onClick={save} disabled={!body.trim() || add.isPending} aria-label="Salvar anotação">
          <Send />
        </Button>
      </div>
    </div>
  );

  if (compact) return list;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><NotebookPen className="size-4" /> Anotações{notes.length ? ` (${notes.length})` : ""}</CardTitle>
      </CardHeader>
      <CardContent>{list}</CardContent>
    </Card>
  );
}

/** Anotações do processo numa janela (Central de Processos e ficha do cliente). */
export function ProcessNotesDialog({ processId, title, onClose }: { processId: string; title: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><NotebookPen className="size-4" /> Anotações</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <ProcessNotes processId={processId} compact />
      </DialogContent>
    </Dialog>
  );
}
