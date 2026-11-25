/**
 * Tipos das linhas do banco usados pela interface.
 * Para tipos completos gerados do esquema: `npm run db:types` (src/types/database.ts).
 */
import type { EventKind, EventPriority, EventStatus, NotificationChannel } from "@/domain/events/types";
import type { Role } from "@/domain/identity/permissions";
import type { ClientKind } from "@/domain/clients/types";
import type { CourtSystem, ProcessStatus } from "@/domain/processes/types";

export interface ProfileRow {
  id: string;
  profession?: string | null;
  document?: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  phone: string | null;
  oab_number: string | null;
  oab_state: string | null;
  timezone: string;
  current_organization_id: string | null;
  preferences: { defaultView?: string; weekStartsOn?: number; defaultReminders?: number[] } | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  plan: string;
  settings: { extraHolidays?: string[]; logo?: string | null; address?: string | null; phone?: string | null } | null;
}

export interface MembershipRow {
  organization_id: string;
  user_id: string;
  role: Role;
  profile?: Pick<ProfileRow, "id" | "full_name" | "email" | "avatar_url"> | null;
}

export interface CategoryRow {
  id: string;
  organization_id: string;
  kind: EventKind;
  name: string;
  color: string;
  is_visible: boolean;
  position: number;
}

export interface EventRow {
  id: string;
  organization_id: string;
  title: string;
  kind: EventKind;
  category_id: string | null;
  description: Record<string, unknown> | null;
  description_text: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  recurrence_rule: string | null;
  location: string | null;
  meeting_url: string | null;
  hearing_mode?: "online" | "presencial" | null;
  client_id: string | null;
  process_id: string | null;
  tribunal: string | null;
  court_division: string | null;
  responsible_id: string | null;
  collaborator_id?: string | null;
  partner_id?: string | null;
  related_event_id?: string | null;
  guests_can_modify?: boolean;
  shared_origin?: string | null;
  shared_readonly?: boolean;
  co_responsibles?: { type: "member" | "collaborator" | "partner"; id: string }[];
  completed_at?: string | null;
  priority: EventPriority;
  status: EventStatus;
  color: string | null;
  is_private: boolean;
  source: string;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  attendees?: Attendee[];
  client?: { id: string; name: string } | null;
  process?: { id: string; title?: string | null; number: string | null } | null;
  checklist?: { is_done: boolean }[];
}

export interface Attendee {
  email: string;
  name?: string | null;
  status?: "needsAction" | "accepted" | "declined" | "tentative" | null;
}

export interface ChecklistRow {
  id: string;
  event_id: string;
  title: string;
  is_done: boolean;
  position: number;
  done_at: string | null;
  done_by: string | null;
}

export interface ReminderRow {
  id: string;
  event_id: string;
  user_id: string;
  offset_minutes: number;
  channels: NotificationChannel[];
  remind_at: string;
  sent_at: string | null;
}

export interface AttachmentRow {
  id: string;
  event_id: string | null;
  process_id: string | null;
  client_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  event_id: string;
  author_id: string;
  body: string;
  /** Autor externo: convidado, outra instalação do Lex ou resposta por e-mail */
  author_name?: string | null;
  author_email?: string | null;
  external_ref?: string | null;
  edited_at: string | null;
  created_at: string;
  author?: { full_name: string | null; avatar_url: string | null } | null;
}

export interface ActivityRow {
  id: number;
  entity_type: string;
  entity_id: string;
  parent_type: string | null;
  parent_id: string | null;
  action: string;
  actor_id: string | null;
  changes: Record<string, { from?: unknown; to?: unknown; changed?: boolean }> | null;
  created_at: string;
  actor?: { full_name: string | null } | null;
}

export interface ClientRow {
  id: string;
  organization_id: string;
  kind: ClientKind;
  contract_type?: "trabalho" | "fixo" | null;
  contract_value?: number | null;
  contract_notes?: string | null;
  name: string;
  trade_name: string | null;
  document: string | null;
  rg: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  secondary_phone: string | null;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  notes: string | null;
  tags: string[];
  responsible_id: string | null;
  archived_at: string | null;
  created_at: string;
  processes?: { count: number }[];
}

export interface ProcessRow {
  id: string;
  organization_id: string;
  title: string | null;
  number: string | null;
  procedural_class: string | null;
  subject: string | null;
  tribunal: string | null;
  court_division: string | null;
  court_system: CourtSystem;
  instance: number;
  client_id: string | null;
  client_role: string | null;
  opposing_party: string | null;
  responsible_id: string | null;
  status: ProcessStatus;
  claim_value: number | null;
  distributed_at: string | null;
  last_movement_at: string | null;
  last_movement_summary: string | null;
  next_hearing_at: string | null;
  next_deadline_at: string | null;
  is_monitored: boolean;
  monitoring_checked_at: string | null;
  is_confidential: boolean;
  tags: string[];
  notes: string | null;
  created_at: string;
  partner_id?: string | null;
  partner_fee_percent?: number | null;
  client?: { id: string; name: string } | null;
  responsible?: { full_name: string | null } | null;
}

export interface MovementRow {
  id: string;
  process_id: string;
  occurred_at: string;
  code: number | null;
  title: string;
  description: string | null;
  source: string;
  analyzed_at: string | null;
}

export interface SuggestionRow {
  id: string;
  process_id: string;
  movement_id: string | null;
  kind: "hearing" | "deadline" | "reminder";
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  rationale: string | null;
  confidence: number;
  analyzer: string;
  status: "pending" | "accepted" | "dismissed";
  event_id: string | null;
  created_at: string;
  process?: { id: string; title?: string | null; number: string | null } | null;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
}

export interface ConnectionPublicRow {
  id: string;
  provider: "google" | "microsoft" | "caldav";
  account_email: string | null;
  external_calendar_id: string;
  last_synced_at: string | null;
  last_error: string | null;
  last_push_error?: string | null;
  last_push_error_at?: string | null;
  scopes?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SearchResultRow {
  entity_type: "client" | "process" | "event" | "note";
  id: string;
  title: string;
  subtitle: string | null;
  starts_at: string | null;
  rank: number;
}

export interface OabMonitorRow {
  id: string;
  user_id: string;
  oab_number: string;
  oab_state: string;
  is_active: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface IntimationRow {
  id: string;
  process_id: string | null;
  user_id: string | null;
  source: "djen" | "pje";
  external_id: string;
  process_number: string;
  tribunal: string | null;
  organ: string | null;
  class_name: string | null;
  communication_type: string | null;
  document_type: string | null;
  available_at: string | null;
  published_at: string | null;
  tacit_awareness_at: string | null;
  text: string | null;
  link: string | null;
  parties: { nome: string; polo?: string }[];
  lawyers: { nome: string; numero_oab: string; uf_oab: string }[];
  read_at: string | null;
  created_at: string;
}

export interface CollaboratorRow {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  oab: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PartnerRow {
  id: string;
  organization_id: string;
  kind: "individual" | "company";
  category: string;
  name: string;
  trade_name: string | null;
  document: string | null;
  oab: string | null;
  email: string | null;
  phone: string | null;
  secondary_phone: string | null;
  website: string | null;
  address_city: string | null;
  address_state: string | null;
  specialties: string | null;
  fee_percent: number | null;
  bank_info: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}
