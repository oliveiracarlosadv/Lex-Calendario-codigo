"use client";

import { BackupReminder } from "@/components/layout/backup-reminder";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { QuickCreateDialog } from "@/components/events/quick-create-dialog";
import { useEventsRealtime } from "@/hooks/use-events";
import { publicEnv } from "@/lib/env";
import { useUiStore } from "@/stores/ui-store";
import { AppSidebar, SidebarContent } from "./app-sidebar";
import { CommandSearch } from "./command-search";
import { AccountButton } from "./account-button";
import { NotificationsBell } from "./notifications-bell";
import { SyncButton } from "./sync-button";
import { DesktopHeartbeat } from "./desktop-heartbeat";
import { UpdateNotice } from "@/components/settings/update-settings";
import { OAuthListener } from "./oauth-listener";
import { LogoMark } from "./logo";

/** Na versão web, o login com Google aparece quando a credencial do site está configurada. */
const showGoogle = !publicEnv.webMode || !!publicEnv.googleWebClientId;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { mobileNavOpen, setMobileNavOpen, setSearchOpen } = useUiStore();
  const pathname = usePathname();
  useEventsRealtime();

  useEffect(() => setMobileNavOpen(false), [pathname, setMobileNavOpen]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <AppSidebar />
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent>
          <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior compacta (somente telas pequenas e ações globais) */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 lg:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menu">
            <Menu />
          </Button>
          <LogoMark className="size-6" />
          <div className="flex-1" />
          {!publicEnv.webMode && (
            <Button variant="ghost" size="icon-sm" onClick={() => setSearchOpen(true)} aria-label="Buscar">
              <Search />
            </Button>
          )}
          {showGoogle && <SyncButton compact />}
          {!publicEnv.webMode && <NotificationsBell />}
          {showGoogle && <AccountButton />}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandSearch />
      <BackupReminder />
      <QuickCreateDialog />
      <DesktopHeartbeat />
      <UpdateNotice />
      <OAuthListener />
    </div>
  );
}

/** Ações do topo para páginas (busca + notificações) em telas grandes. */
export function TopActions() {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  return (
    <div className="hidden items-center gap-1 lg:flex">
      {!publicEnv.webMode && (
      <button
        onClick={() => setSearchOpen(true)}
        className="flex h-8 w-56 items-center gap-2 rounded-lg border bg-surface px-2.5 text-[13px] text-muted-foreground transition hover:bg-accent"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Buscar</span>
        <kbd className="rounded border bg-background px-1.5 text-[10px]">⌘K</kbd>
      </button>
      )}
      {showGoogle && <SyncButton />}
      {!publicEnv.webMode && <NotificationsBell />}
      {showGoogle && <AccountButton />}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <TopActions />
      </div>
    </div>
  );
}
