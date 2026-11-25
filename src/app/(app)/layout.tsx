import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { LicenseGate } from "@/components/licensing/license-gate";
import { WorkspaceProvider, type Workspace } from "@/hooks/use-workspace";
import { getSupabaseServerClient } from "@/infrastructure/supabase/server";
import type { CategoryRow, MembershipRow, OrganizationRow, ProfileRow } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/inicio");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<ProfileRow>();
  if (!profile?.current_organization_id) redirect("/entrar?erro=sem-organizacao");
  const orgId = profile.current_organization_id;

  const [{ data: organization }, { data: memberships }, { data: categories }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).single<OrganizationRow>(),
    supabase.from("memberships").select("organization_id, user_id, role").eq("organization_id", orgId),
    supabase.from("event_categories").select("*").eq("organization_id", orgId).order("position"),
  ]);
  if (!organization) redirect("/entrar?erro=sem-organizacao");

  const memberIds = (memberships ?? []).map((m) => m.user_id as string);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", memberIds);
  const members: MembershipRow[] = (memberships ?? []).map((m) => ({
    ...(m as MembershipRow),
    profile: profiles?.find((p) => p.id === m.user_id) ?? null,
  }));
  const role = members.find((m) => m.user_id === user.id)?.role ?? "assistant";

  const workspace: Workspace = {
    userId: user.id,
    email: user.email ?? "",
    isAnonymous: !!user.is_anonymous,
    profile,
    organization,
    role,
    members,
    categories: (categories ?? []) as CategoryRow[],
  };

  return (
    <WorkspaceProvider value={workspace}>
      <LicenseGate>
        <AppShell>{children}</AppShell>
      </LicenseGate>
    </WorkspaceProvider>
  );
}
