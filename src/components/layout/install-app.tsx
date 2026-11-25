"use client";

import { useEffect, useState } from "react";
import { Download, MoreVertical, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// O navegador avisa uma única vez, logo ao abrir a página: guarda o aviso até o clique no botão
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
// iPadOS se apresenta como Mac, mas tem tela de toque
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** "Instalar": salva o Lex na tela inicial do aparelho (PWA). Some quando já está instalado. */
export function InstallAppButton() {
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const refresh = () => setInstalled(isInstalled());
    refresh();
    listeners.add(refresh);
    return () => void listeners.delete(refresh);
  }, []);

  if (installed) return null;

  async function install() {
    if (!deferred) return setHelp(true);
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") deferred = null;
  }

  const ios = help && isIos();
  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] text-foreground/75 transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <Download className="size-[17px] text-muted-foreground" />
        <span className="flex-1 truncate text-left">Instalar</span>
      </button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Instalar o Lex Calendário</DialogTitle>
            <DialogDescription>O Lex fica na tela inicial, com ícone próprio, e abre como um aplicativo.</DialogDescription>
          </DialogHeader>
          {ios ? (
            <ol className="space-y-3 text-sm">
              <li className="flex items-center gap-2.5"><Share className="size-5 shrink-0 text-primary" /> <span>1. Toque em <b className="font-medium">Compartilhar</b>, na barra do Safari.</span></li>
              <li className="flex items-center gap-2.5"><SquarePlus className="size-5 shrink-0 text-primary" /> <span>2. Toque em <b className="font-medium">Adicionar à Tela de Início</b>.</span></li>
              <li className="flex items-center gap-2.5"><Download className="size-5 shrink-0 text-primary" /> <span>3. Toque em <b className="font-medium">Adicionar</b>.</span></li>
            </ol>
          ) : (
            <ol className="space-y-3 text-sm">
              <li className="flex items-center gap-2.5"><MoreVertical className="size-5 shrink-0 text-primary" /> <span>1. Abra o <b className="font-medium">menu do navegador</b>.</span></li>
              <li className="flex items-center gap-2.5"><Download className="size-5 shrink-0 text-primary" /> <span>2. Toque em <b className="font-medium">Instalar aplicativo</b> ou <b className="font-medium">Adicionar à tela inicial</b>.</span></li>
            </ol>
          )}
          <DialogFooter>
            <Button onClick={() => setHelp(false)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
