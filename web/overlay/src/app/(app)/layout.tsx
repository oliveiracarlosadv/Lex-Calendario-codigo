"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import "@/components/layout/install-app";
import { LogoMark, OliveBranch } from "@/components/layout/logo";
import { WorkspaceProvider, type Workspace } from "@/hooks/use-workspace";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase/client";
import { startGoogleSync } from "@/infrastructure/web/google";
import { installWebShims } from "@/infrastructure/web/shims";
import type { CategoryRow, MembershipRow, OrganizationRow, ProfileRow } from "@/types/db";

installWebShims();

/** Abre (ou cria, na primeira vez) o banco deste aparelho e carrega o escritório. */
async function loadWorkspace(): Promise<Workspace> {
  const sb = getSupabaseBrowserClient();
  let { data: { user } } = await sb.auth.getUser();
  if (!user) {
    await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
    const { data, error } = await sb.auth.signInAnonymously({ options: { data: { full_name: "Você", organization_name: "Meu escritório" } } });
    if (error) throw error;
    user = data.user;
  }
  const userId = user!.id;
  const { data: profile } = await sb.from("profiles").select("*").eq("id", userId).single<ProfileRow>();
  const orgId = profile!.current_organization_id!;
  const [{ data: organization }, { data: memberships }, { data: categories }] = await Promise.all([
    sb.from("organizations").select("*").eq("id", orgId).single<OrganizationRow>(),
    sb.from("memberships").select("organization_id, user_id, role").eq("organization_id", orgId),
    sb.from("event_categories").select("*").eq("organization_id", orgId).order("position"),
  ]);
  const ids = (memberships ?? []).map((m) => m.user_id as string);
  const { data: profiles } = await sb.from("profiles").select("id, full_name, email, avatar_url").in("id", ids);
  const members = (memberships ?? []).map((m) => ({ ...(m as MembershipRow), profile: profiles?.find((p) => p.id === m.user_id) ?? null })) as MembershipRow[];
  return {
    userId,
    email: user!.email ?? "",
    isAnonymous: true,
    profile: profile!,
    organization: organization!,
    role: members.find((m) => m.user_id === userId)?.role ?? "admin",
    members,
    categories: (categories ?? []) as CategoryRow[],
  };
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    // Conexão ruim na primeira abertura: oferece tentar de novo em vez de ficar parado nesta tela
    const hint = setTimeout(() => setSlow(true), 12_000);
    const slow = setTimeout(() => setError("A abertura demorou mais que o esperado. Confira a internet e tente de novo."), 90_000);
    loadWorkspace()
      .then((w) => {
        setWorkspace(w);
        void startGoogleSync(w.organization.id, w.userId);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => {
        clearTimeout(slow);
        clearTimeout(hint);
      });
    return () => {
      clearTimeout(slow);
      clearTimeout(hint);
    };
  }, []);

  if (!workspace)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <LogoMark className="size-14 rounded-2xl" />
        <OliveBranch className="h-8 w-32 text-olive-600 dark:text-olive-300" />
        {error ? (
          <>
            <p className="font-medium">Não foi possível abrir sua agenda.</p>
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            <button onClick={() => window.location.reload()} className="text-sm text-primary hover:underline">Tentar novamente</button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Preparando sua agenda…</p>
            <p className="max-w-xs text-xs text-muted-foreground">Na primeira vez pode levar até um minuto. Seus dados ficam guardados só neste aparelho.</p>
            {slow && (
              <button onClick={() => window.location.reload()} className="rounded-lg border px-3 py-1.5 text-sm text-primary">
                Demorando? Toque para recarregar
              </button>
            )}
          </>
        )}
      </div>
    );

  return (
    <WorkspaceProvider value={workspace}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
