"use client";

import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCommentMutations, useComments } from "@/hooks/use-event-workspace";
import { useWorkspace } from "@/hooks/use-workspace";
import { formatDateTime } from "@/lib/utils";

export function CommentsPanel({ eventId }: { eventId: string }) {
  const { data } = useComments(eventId);
  // Do mais antigo (1) para o mais novo, para ler a conversa em sequência
  const comments = [...(data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const { add, remove } = useCommentMutations(eventId);
  const { members, userId } = useWorkspace();
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(true);
  const author = (id: string) => members.find((m) => m.user_id === id)?.profile;

  function send() {
    if (!body.trim()) return;
    add.mutate({ body: body.trim(), email });
    setBody("");
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold">Comentários{comments.length ? ` (${comments.length})` : ""}</h2>
      <ul className="space-y-3">
        {comments.map((c, i) => {
          const a = author(c.author_id);
          // Comentário de fora: convidado, outra instalação do Lex ou resposta por e-mail
          const external = c.author_name ?? null;
          const via = c.external_ref?.startsWith("gmail:") ? "por e-mail" : c.external_ref?.startsWith("google:") ? "convidado" : external ? "convidado" : null;
          return (
            <li key={c.id} className="group flex gap-3">
              <Avatar name={external ?? a?.full_name} src={external ? undefined : a?.avatar_url} className="size-7" />
              <div className="min-w-0 flex-1 rounded-xl bg-secondary/60 px-3 py-2">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="rounded-md bg-primary/10 px-1.5 font-semibold tabular-nums text-primary">{i + 1}</span>
                  <span className="font-semibold">{external ?? a?.full_name ?? "Membro"}</span>
                  {via && <span className="rounded-full bg-amber-500/15 px-1.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">{via}</span>}
                  <span className="text-muted-foreground">{formatDateTime(c.created_at)}</span>
                  {c.author_id === userId && !external && (
                    <button onClick={() => remove.mutate(c.id)} className="ml-auto text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label="Excluir comentário">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Escreva um comentário para a equipe… (⌘↵ para enviar)"
          className="min-h-[44px]"
        />
        <Button size="icon" onClick={send} disabled={!body.trim() || add.isPending} aria-label="Enviar comentário">
          <Send />
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="size-3.5 accent-[hsl(var(--primary))]" />
        Enviar este comentário por e-mail aos convidados e ao responsável da tarefa
      </label>
    </section>
  );
}
