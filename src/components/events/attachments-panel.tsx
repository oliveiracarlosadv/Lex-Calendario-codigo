"use client";

import { useRef, useState } from "react";
import { FileImage, FileSpreadsheet, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPTED_FILES, openAttachment, useAttachmentMutations, useAttachments } from "@/hooks/use-event-workspace";
import { useCan } from "@/hooks/use-workspace";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";

const iconFor = (mime: string) =>
  mime.startsWith("image/") ? FileImage : /sheet|excel|csv/.test(mime) ? FileSpreadsheet : FileText;

export function AttachmentsPanel(scope: { eventId?: string; processId?: string; clientId?: string }) {
  const { data: files = [] } = useAttachments(scope);
  const { upload, remove } = useAttachmentMutations(scope);
  const canDelete = useCan("attachments:delete");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Anexos</h2>
        <Button variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <Upload /> {upload.isPending ? "Enviando…" : "Enviar"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload.mutate(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) upload.mutate(Array.from(e.dataTransfer.files));
        }}
        className={cn("rounded-xl border border-dashed p-3 transition", over && "border-primary bg-primary/5")}
      >
        {!files.length && (
          <p className="flex items-center justify-center gap-2 py-4 text-center text-sm text-muted-foreground">
            <Paperclip className="size-4" /> Arraste PDF, DOCX, XLSX, imagens e outros documentos (até 50 MB).
          </p>
        )}
        <ul className="space-y-1">
          {files.map((f) => {
            const Icon = iconFor(f.mime_type);
            return (
              <li key={f.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/50">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <button onClick={() => void openAttachment(f)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium hover:underline">{f.file_name}</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {formatBytes(f.size_bytes)} · {formatDateTime(f.created_at)}
                  </span>
                </button>
                {canDelete && (
                  <button onClick={() => confirm(`Remover "${f.file_name}"?`) && remove.mutate(f)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label="Remover anexo">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
