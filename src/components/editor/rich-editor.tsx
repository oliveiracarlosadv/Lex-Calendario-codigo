"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface RichEditorProps {
  content: Record<string, unknown> | null;
  editable?: boolean;
  placeholder?: string;
  onChange?: (doc: Record<string, unknown>, text: string) => void;
}

function ToolButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn("rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground", active && "bg-accent text-foreground")}
        aria-label={label}
      >
        <Icon className="size-4" />
      </button>
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Endereço do link", previous ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  const groups: { icon: LucideIcon; label: string; active?: boolean; run: () => void }[][] = [
    [
      { icon: Heading1, label: "Título", active: editor.isActive("heading", { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
      { icon: Heading2, label: "Subtítulo", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { icon: Heading3, label: "Seção", active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    ],
    [
      { icon: Bold, label: "Negrito (⌘B)", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
      { icon: Italic, label: "Itálico (⌘I)", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
      { icon: UnderlineIcon, label: "Sublinhado (⌘U)", active: editor.isActive("underline"), run: () => editor.chain().focus().toggleUnderline().run() },
      { icon: Strikethrough, label: "Tachado", active: editor.isActive("strike"), run: () => editor.chain().focus().toggleStrike().run() },
      { icon: Code, label: "Código", active: editor.isActive("codeBlock"), run: () => editor.chain().focus().toggleCodeBlock().run() },
      { icon: Link2, label: "Link", active: editor.isActive("link"), run: setLink },
    ],
    [
      { icon: List, label: "Lista", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
      { icon: ListOrdered, label: "Lista numerada", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
      { icon: ListChecks, label: "Checklist", active: editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
      { icon: Quote, label: "Citação", active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
      { icon: Table2, label: "Tabela", run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { icon: Minus, label: "Divisória", run: () => editor.chain().focus().setHorizontalRule().run() },
    ],
    [
      { icon: Undo2, label: "Desfazer", run: () => editor.chain().focus().undo().run() },
      { icon: Redo2, label: "Refazer", run: () => editor.chain().focus().redo().run() },
    ],
  ];
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b bg-background/90 px-1 py-1 backdrop-blur">
      {groups.map((g, i) => (
        <div key={i} className="flex items-center gap-0.5 border-r pr-1 last:border-r-0">
          {g.map((b) => (
            <ToolButton key={b.label} icon={b.icon} label={b.label} active={b.active} onClick={b.run} />
          ))}
        </div>
      ))}
      {editor.isActive("table") && (
        <div className="flex items-center gap-1 pl-1 text-[11.5px]">
          {[
            ["+ coluna", () => editor.chain().focus().addColumnAfter().run()],
            ["+ linha", () => editor.chain().focus().addRowAfter().run()],
            ["− coluna", () => editor.chain().focus().deleteColumn().run()],
            ["− linha", () => editor.chain().focus().deleteRow().run()],
            ["Excluir tabela", () => editor.chain().focus().deleteTable().run()],
          ].map(([label, fn]) => (
            <button key={label as string} type="button" onClick={fn as () => void} className="rounded px-1.5 py-1 text-muted-foreground hover:bg-accent">
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Editor rico no estilo Notion (TipTap/ProseMirror): títulos, listas, checklist,
 * tabelas, links, citações e blocos de código. Atalhos Markdown: "# ", "- ", "[ ] ", "> ", "```".
 */
export function RichEditor({ content, editable = true, placeholder, onChange }: RichEditorProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: !editable, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      Placeholder.configure({ placeholder: placeholder ?? "Escreva aqui… Use # para títulos, - para listas, [ ] para checklist." }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: content ?? "",
    editorProps: {
      attributes: {
        class: "prose prose-neutral dark:prose-invert max-w-none px-1 py-4 text-[15px] leading-relaxed prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:my-2 prose-a:text-primary",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (!onChange) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onChange(e.getJSON() as Record<string, unknown>, e.getText()), 600);
    },
  });

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!editor) return <div className="min-h-[220px] animate-pulse rounded-xl bg-muted/40" />;
  return (
    <div className="lex-editor rounded-xl border bg-background">
      {editable && <Toolbar editor={editor} />}
      <div className="px-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
