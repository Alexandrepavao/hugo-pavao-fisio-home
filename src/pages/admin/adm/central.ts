import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** Central de pendências administrativas — tipos, rótulos e consultas (RPCs adm_central*, adm_pendency_*, adm_documents_*, adm_contracts_*). Fórmulas em docs/indicadores-administrativo.md. */
export interface Metric { value: number | null; available: boolean; basis: string; [k: string]: unknown }
export interface Central {
  settings: { expiring_days: number; package_low_sessions: number; waiting_alert_days: number };
  cards: { overdue_pendencies: Metric; incomplete: Metric; docs_expiring: Metric; contracts_awaiting: Metric; patients_waiting: Metric; professionals_incomplete: Metric };
  kpis: {
    completeness: Metric & { complete?: number; total?: number };
    completeness_groups: { key: string; label: string; total: number; complete: number; pct: number | null }[];
    duplicates: { groups: number; people: number; basis: string };
    contacts: { total: number; valid_format: number; invalid_format: number; verified: number; valid_pct: number | null; verified_available: boolean; verified_pct: number | null; basis_valid: string; basis_verified: string };
    documents: { registered: number; missing: number; expired: number; expiring: number; no_expiry_date: number; requirements_configured: boolean; basis: string };
    contracts: { by_status: { draft: number; awaiting_signature: number; signed: number; cancelled: number }; signed_current: number; ending: number; expired: number; awaiting_overdue: number; basis: string };
    resolution: Metric & { median_hours?: number; n?: number };
    resolution_by_kind: { kind: string; n: number; avg_hours: number | null; median_hours: number | null }[];
    onboarding: Metric & { median_days?: number; n?: number };
    professionals: { active: number; ready: number; ready_pct: number | null; basis: string };
    waiting: { n: number; available: boolean; avg_days?: number; median_days?: number; max_days?: number; over_alert?: number; alert_days?: number; basis: string };
    packages: { n: number; low_sessions: number; basis: string };
    access: { invitations_pending: number; invitations_expired: number; review: number; basis: string };
    pendencies: { open: number; overdue: number; resolved_period: number; basis: string };
    by_owner: { user_id: string | null; name: string; open: number; overdue: number; resolved: number }[];
    by_unit: { unit_id: string | null; name: string; open: number; overdue: number; resolved: number }[];
  };
  evolution: { week: string; opened: number; resolved: number; open_at_end: number }[];
  evolution_basis: string;
}
export interface Pendency {
  id: string; kind: string; title: string; detail: string | null; subject_type: string | null; subject_id: string | null; subject_name: string | null; unit_id: string | null; unit_name: string | null;
  responsible: string | null; responsible_name: string | null; due_date: string | null; status: "open" | "resolved" | "cancelled"; opened_at: string; reopened_at: string | null; resolved_at: string | null;
  reopened_count: number; origin: "manual" | "auto"; overdue: boolean; overdue_days: number | null; resolution_hours: number | null;
}
export interface Filters { owner: string; type: string; kind: string; status: string }
export const NO_FILTERS: Filters = { owner: "", type: "", kind: "", status: "" };

export const PEND_KIND: Record<string, string> = { cadastro: "Cadastro", documento: "Documento", contrato: "Contrato", integracao_profissional: "Integração de profissional", convite: "Convite", agendamento: "Agendamento", pacote: "Pacote", acesso: "Acesso", outro: "Outro" };
export const PEND_STATUS: Record<string, string> = { open: "Aberta", resolved: "Concluída", cancelled: "Cancelada" };
export const KIND_LABEL: Record<string, string> = { lead: "Lead", patient: "Paciente", partner: "Parceiro", student: "Aluno", staff: "Colaborador", contact: "Contato", supplier: "Fornecedor", professional: "Profissional", pf: "Pessoas físicas", pj: "Pessoas jurídicas" };
export const CONTRACT_KIND: Record<string, string> = { prestacao_servico: "Prestação de serviço", parceria: "Parceria", termo_uso: "Termo de uso", confidencialidade: "Confidencialidade", outro: "Outro" };
export const CONTRACT_STATUS: Record<string, string> = { draft: "Rascunho", awaiting_signature: "Aguardando assinatura", signed: "Assinado", cancelled: "Cancelado", vigente: "Vigente", a_vencer: "A vencer", vencido: "Vencido" };
export const DOC_STATE: Record<string, string> = { vencido: "Vencido", vencendo: "Vencendo", valido: "Vigente", sem_validade: "Sem validade informada", ausente: "Ausente" };
export const HISTORY_LABEL: Record<string, string> = { created: "Criada", assigned: "Responsável definido", due_changed: "Prazo alterado", resolved: "Concluída", reopened: "Reaberta", cancelled: "Cancelada", noted: "Anotação", sent: "Enviado para assinatura", signed: "Assinatura registrada" };

/** Destino "abrir o cadastro" de cada tipo de registro vinculado. */
export const subjectRoute = (type: string | null, name?: string | null) => {
  switch (type) {
    case "person": case "legal_entity": return `/admin/adm/diretorio?q=${encodeURIComponent(name ?? "")}`;
    case "contract": return "/admin/adm/pendencias?aba=contratos";
    case "waitlist": case "package": return "/admin/agenda";
    case "professional": case "invitation": case "access": return "/admin/equipe";
    default: return null;
  }
};
export const fmtHours = (h: number | null | undefined) => (h == null ? "—" : h >= 48 ? `${(h / 24).toFixed(1).replace(".", ",")} dias` : `${h.toFixed(1).replace(".", ",")} h`);

export const useFilters = () => { const [f, setF] = useState<Filters>(NO_FILTERS); return [f, setF, Object.values(f).filter(Boolean).length] as const; };

export const useAdmCentral = (from: string, to: string, unit: string, f: Filters) => useQuery({
  queryKey: ["adm-central", from, to, unit, f.owner, f.type, f.kind, f.status], retry: false,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_central", { p_from: from, p_to: to, p_unit: unit || null, p_owner: f.owner || null, p_type: f.type || null, p_kind: f.kind || null, p_status: f.status || null });
    if (error) throw error; return data as Central;
  },
});
export const usePendencies = (unit: string, f: Filters, status: string, limit = 200) => useQuery({
  queryKey: ["adm-pendencies", unit, f.owner, f.type, f.kind, status, limit], retry: false,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_pendency_list", { p_unit: unit || null, p_owner: f.owner || null, p_type: f.type || null, p_kind: f.kind || null, p_status: status || null, p_limit: limit });
    if (error) throw error; return data as Pendency[];
  },
});
export const useAssignable = (unit?: string) => useQuery({ queryKey: ["assignable", unit ?? ""], queryFn: async () => ((await supabase.rpc("list_assignable_users", { p_unit: unit || null })).data ?? []) as { user_id: string; name: string; roles: string[] }[] });
export interface AdmConfig {
  can_edit: boolean; settings: { expiring_days: number; package_low_sessions: number; waiting_alert_days: number; pendency_due_days: Record<string, number> };
  doc_types: { id: string; code: string; label: string; applies_to: "pf" | "pj"; has_expiry: boolean; active: boolean }[];
  requirements: { id: string; applies_to: string; check_type: "field" | "document" | "contract"; check_ref: string; label: string; required: boolean; active: boolean }[];
  catalog: { field_refs: Record<string, { ref: string; label: string }[]>; contract_kinds: { ref: string; label: string }[] };
}
export const useAdmConfig = () => useQuery({ queryKey: ["adm-config"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("adm_config_get"); if (error) throw error; return data as AdmConfig; } });
