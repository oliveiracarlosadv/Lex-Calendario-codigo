"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronsUpDown, LogOut, Monitor, Moon, Power, Shield, Sun, User } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/domain/identity/permissions";
import { useWorkspace } from "@/hooks/use-workspace";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { publicEnv } from "@/lib/env";

export function UserMenu() {
  const { profile, organization, role, email } = useWorkspace();
  const { setTheme, theme } = useTheme();
  const router = useRouter();

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    router.replace("/entrar");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-accent/60">
        <Avatar name={profile.full_name} src={profile.avatar_url} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{profile.full_name ?? email}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {organization.name} · {ROLE_LABELS[role]}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/configuracoes/perfil">
            <User /> Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/configuracoes/seguranca">
            <Shield /> Segurança e MFA
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Aparência</DropdownMenuLabel>
        {[
          { v: "light", label: "Claro", icon: Sun },
          { v: "dark", label: "Escuro", icon: Moon },
          { v: "system", label: "Automático", icon: Monitor },
        ].map((t) => (
          <DropdownMenuItem key={t.v} onSelect={() => setTheme(t.v)}>
            <t.icon /> {t.label} {theme === t.v && <span className="ml-auto text-primary">●</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {publicEnv.localMode ? (
          <DropdownMenuItem
            destructive
            onSelect={async () => {
              if (!confirm("Encerrar o Lex Calendário? Os lembretes deixam de ser enviados até você abrir o app de novo.")) return;
              await fetch("/api/desktop/shutdown", { method: "POST" }).catch(() => undefined);
              window.close();
            }}
          >
            <Power /> Sair do Lex Calendário
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem destructive onSelect={signOut}>
            <LogOut /> Sair
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
