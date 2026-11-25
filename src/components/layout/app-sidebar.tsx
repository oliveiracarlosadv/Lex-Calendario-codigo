"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MiniCalendar } from "@/components/calendar/mini-calendar";
import { CategoryFilter } from "@/components/calendar/category-filter";
import { useIntimations } from "@/hooks/use-intimations";
import { useSuggestions } from "@/hooks/use-records";
import { publicEnv } from "@/lib/env";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { InstallAppButton } from "./install-app";
import { FOOTER_ITEMS, NAV_ITEMS, WEB_ITEMS, type NavItem } from "./nav-items";
import { UserMenu } from "./user-menu";

function NavLink({ item, onNavigate, badge }: { item: NavItem; onNavigate?: () => void; badge?: number }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href.split("/").slice(0, 2).join("/")}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
        active ? "bg-accent font-medium text-foreground" : "text-foreground/75 hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <item.icon className={cn("size-[17px]", active ? "text-primary" : "text-muted-foreground")} />
      <span className="flex-1 truncate">{item.label}</span>
      {!!badge && <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground">{badge}</span>}
    </Link>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: suggestions } = useSuggestions();
  const { data: unreadIntimations } = useIntimations("unread");
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href="/calendario" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        <nav className="space-y-0.5">
          {NAV_ITEMS.filter((item) => !publicEnv.webMode || WEB_ITEMS.includes(item.href)).map((item) => (
            <NavLink
              key={item.href}
              item={item}
              onNavigate={onNavigate}
              badge={item.href === "/monitoramento" ? suggestions?.length : item.href === "/intimacoes" ? unreadIntimations?.length : undefined}
            />
          ))}
        </nav>
        {pathname.startsWith("/calendario") && (
          <>
            <MiniCalendar />
            <CategoryFilter />
          </>
        )}
      </div>
      <div className="shrink-0 space-y-0.5 border-t px-3 py-3">
        {FOOTER_ITEMS.filter((item) => !publicEnv.webMode || WEB_ITEMS.includes(item.href)).map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
        {publicEnv.webMode && <InstallAppButton />}
        {!publicEnv.webMode && <UserMenu />}
        <Link href="/sobre" onClick={onNavigate} className="block px-2 pt-1 text-[11px] text-muted-foreground hover:text-foreground">
          Lex Calendário · versão {publicEnv.appVersion}
        </Link>
      </div>
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside className="hidden w-[260px] shrink-0 border-r bg-sidebar lg:block">
      <SidebarContent />
    </aside>
  );
}
