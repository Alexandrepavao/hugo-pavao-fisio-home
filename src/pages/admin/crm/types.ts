export interface Stage { id: string; name: string; position: number; kind: "open" | "won" | "lost"; pipeline_id: string }
export interface Opp {
  id: string; title: string; value_cents: number; status: string; stage_id: string; owner_user_id: string | null; unit_id: string; person_id: string;
  next_contact_at: string | null; last_contact_at: string | null; created_at: string; source: string | null; campaign: string | null;
  person: { id: string; full_name: string } | null;
  pipeline_id?: string; legal_entity_id?: string | null; legal_entity?: { id: string; legal_name: string; trade_name: string | null } | null;
}
export interface PipelineInfo { id: string; name: string; kind: string }
export interface PipelineOverview { pipeline_id: string; name: string; kind: string; open_count: number; open_value_cents: number; stale_count: number; people_count: number; won_count: number; lost_count: number }
export interface StaffUser { user_id: string; name: string }
export interface Task { id: string; title: string; due_at: string; kind: string; assignee_user_id: string | null; opportunity_id: string | null; person_id: string | null }

export const STALE_H = 48;
export const isStale = (o: Opp) => o.status === "open" && new Date(o.last_contact_at ?? o.created_at).getTime() < Date.now() - STALE_H * 36e5;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
/** Nome mostrado no card: B2B mostra a empresa; os demais, a pessoa. */
export const cardName = (o: Opp) => o.legal_entity ? (o.legal_entity.trade_name || o.legal_entity.legal_name) : (o.person?.full_name ?? "—");
