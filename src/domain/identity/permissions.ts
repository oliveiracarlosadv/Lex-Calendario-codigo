/**
 * Controle de acesso baseado em papéis (RBAC).
 * Espelha as políticas RLS do banco — a interface usa esta matriz para
 * ocultar ações; o banco é a fonte de verdade da autorização.
 */

export const ROLES = ["admin", "partner", "lawyer", "assistant", "secretary"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  partner: "Sócio",
  lawyer: "Advogado",
  assistant: "Assistente",
  secretary: "Secretária",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Acesso total, incluindo equipe, integrações e faturamento.",
  partner: "Gestão completa do escritório, processos e clientes.",
  lawyer: "Gerencia seus processos, clientes e compromissos.",
  assistant: "Apoio jurídico: agenda, checklists, anexos e andamentos.",
  secretary: "Agenda, lembretes e cadastro de clientes.",
};

export type Permission =
  | "team:manage"
  | "billing:manage"
  | "organization:update"
  | "categories:manage"
  | "integrations:manage"
  | "clients:create"
  | "clients:update"
  | "clients:delete"
  | "processes:create"
  | "processes:update"
  | "processes:delete"
  | "processes:view_confidential"
  | "events:create"
  | "events:update"
  | "events:delete_any"
  | "events:delete_own"
  | "attachments:delete"
  | "suggestions:decide"
  | "monitoring:manage";

const MATRIX: Record<Role, readonly Permission[]> = {
  admin: [
    "team:manage", "billing:manage", "organization:update", "categories:manage", "integrations:manage",
    "clients:create", "clients:update", "clients:delete",
    "processes:create", "processes:update", "processes:delete", "processes:view_confidential",
    "events:create", "events:update", "events:delete_any", "events:delete_own",
    "attachments:delete", "suggestions:decide", "monitoring:manage",
  ],
  partner: [
    "organization:update", "categories:manage", "integrations:manage",
    "clients:create", "clients:update", "clients:delete",
    "processes:create", "processes:update", "processes:delete", "processes:view_confidential",
    "events:create", "events:update", "events:delete_any", "events:delete_own",
    "attachments:delete", "suggestions:decide", "monitoring:manage",
  ],
  lawyer: [
    "categories:manage", "integrations:manage",
    "clients:create", "clients:update",
    "processes:create", "processes:update",
    "events:create", "events:update", "events:delete_own",
    "attachments:delete", "suggestions:decide", "monitoring:manage",
  ],
  assistant: [
    "integrations:manage", "processes:update",
    "events:create", "events:update", "events:delete_own",
    "attachments:delete", "suggestions:decide",
  ],
  secretary: ["integrations:manage", "clients:create", "clients:update", "events:create", "events:update"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}
