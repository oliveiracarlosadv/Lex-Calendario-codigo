"use client";

import { createContext, useContext } from "react";
import { can, type Permission, type Role } from "@/domain/identity/permissions";
import type { CategoryRow, MembershipRow, OrganizationRow, ProfileRow } from "@/types/db";

export interface Workspace {
  userId: string;
  email: string;
  /** Usando sem conta (dados locais/sessão anônima). */
  isAnonymous: boolean;
  profile: ProfileRow;
  organization: OrganizationRow;
  role: Role;
  members: MembershipRow[];
  categories: CategoryRow[];
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ value, children }: { value: Workspace; children: React.ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace fora do WorkspaceProvider");
  return ctx;
}

export function useCan(permission: Permission) {
  return can(useWorkspace().role, permission);
}

export function useMemberName() {
  const { members } = useWorkspace();
  return (id: string | null | undefined) => members.find((m) => m.user_id === id)?.profile?.full_name ?? "—";
}
