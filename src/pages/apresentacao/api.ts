import { supabase } from "@/lib/supabase";
import type { EvidenceItem } from "@/portal/journey/model";

/** Contrato com as funções do banco (migration 131/132). Nada aqui chama serviços externos; o conteúdo clínico só trafega entre a fisioterapeuta com vínculo e o próprio paciente. */
export const AREAS: { key: string; label: string }[] = [
  ["acupuntura", "Acupuntura"], ["aquatica", "Aquática / Hidroterapia"], ["cardiovascular", "Cardiovascular"], ["dermatofuncional", "Dermatofuncional"], ["esportiva", "Esportiva"], ["gerontologia", "Gerontologia"],
  ["trabalho", "Trabalho"], ["neurofuncional", "Neurofuncional"], ["oncologia", "Oncologia"], ["reumatologia", "Reumatologia"], ["respiratoria", "Respiratória"], ["traumato_ortopedica", "Traumato-Ortopédica"],
  ["osteopatia", "Osteopatia"], ["quiropraxia", "Quiropraxia"], ["saude_mulher", "Saúde da Mulher"], ["terapia_intensiva", "Terapia Intensiva"],
].map(([key, label]) => ({ key, label }));

export interface PatientPayload {
  areas: { key: string; label: string }[];
  reported: { complaint: string | null; symptom_duration: string | null; limitations: string | null; activities: string | null };
  assessed: { condition_kind: "assessed" | "hypothesis" | null; condition_text: string | null; conditions?: PayloadCondition[]; context?: string[] };
  goal: { title: string; target_date: string | null } | null;
  plan: { freq_per_week: number | null; duration_weeks: number | null; routine: string | null; reassessment_on: string | null; reassessment_criteria: string | null; initial_sessions?: number | null; session_minutes?: number | null; approach?: string | null };
  evidence: EvidenceItem[];
}
/** Condição como o paciente a vê (sem ids internos). */
export type ConditionStatus = "documented" | "assessed" | "hypothesis" | "investigating" | "not_informed";
export interface PayloadCondition { condition_key: string | null; label: string | null; role: "principal" | "associated"; status: ConditionStatus; subtype_label: string | null; body_region: string | null; laterality: string | null; onset_text: string | null }
/** Linha editável da avaliação (equipe). */
export interface ConditionRow { condition_key: string | null; free_text: string | null; role: "principal" | "associated"; status: ConditionStatus; subtype_key: string | null; body_region: string | null; laterality: "right" | "left" | "bilateral" | "na" | null; onset_text: string | null }
export interface CaseItem { id: string; title: string; situation: string; objective: string; measure_label: string; measure_unit: string | null; baseline: number; observed: number; interval_text: string; sessions_done: number | null; limitations: string; area_keys: string[]; condition_keys: string[]; condition_labels: string[]; status?: "draft" | "approved" | "revoked"; picked?: boolean; why?: string[]; authorization_ref?: string | null; authorized_on?: string | null; revoke_reason?: string | null; mine?: boolean }
export interface PresentationDraft {
  id: string; enrollment_id: string; person_id: string; rev: number; status: "draft" | "published"; published_version: number; published_at: string | null; updated_at: string;
  area_keys: string[]; complaint: string | null; symptom_duration: string | null; limitations: string | null; activities: string | null;
  condition_kind: "assessed" | "hypothesis" | null; condition_text: string | null; goal_title: string | null; goal_target_date: string | null;
  freq_per_week: number | null; duration_weeks: number | null; routine_text: string | null; reassessment_on: string | null; reassessment_criteria: string | null; internal_notes: string | null;
  initial_sessions: number | null; session_minutes: number | null; approach_text: string | null; context_tags: string[]; conditions: (ConditionRow & { id: string; label: string | null; subtype_label: string | null })[];
  cases_picked: CaseItem[];
  patient_payload: PatientPayload; missing: string[]; can_publish: boolean; unpublished_changes: boolean;
  evidence_picked: { evidence: LibraryItem; rationale: string; differences: string | null; position: number }[];
  person_name: string; enrollment_status: "pending" | "active"; professional: string | null; evaluation_at: string | null;
}
export interface LibraryItem extends Omit<EvidenceItem, "relation" | "differences"> {
  area_keys: string[]; conditions: string[]; condition_keys?: string[]; status: "draft" | "approved" | "retired"; version: number; reviewed_at: string | null; source_verified_at: string | null;
  proposed_by_me?: boolean; review_note?: string | null; why?: string[]; picked?: boolean;
}
export interface MyPresentation { available: boolean; status?: string; version?: number; published_at?: string; enrollment_status?: "pending" | "active"; payment?: "no_contract" | "awaiting" | "confirmed"; content?: PatientPayload; person_name?: string; professional?: string | null }
export interface EnrollmentInfo { status: "none" | "pending" | "active" | "ended"; id?: string; source?: string; professional?: string | null; review_flag?: string | null; review_note?: string | null; payment: "no_contract" | "awaiting" | "confirmed" }

export class ApiError extends Error { constructor(public code: string | undefined, message: string) { super(message); } }
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error.code, error.message);
  return data as T;
}
export const isConflict = (e: unknown) => e instanceof ApiError && (e.code === "P0010" || /EDICAO_CONFLITO/.test(e.message));
export const apiText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (isConflict(e)) return "Esta apresentação foi alterada em outra tela. Recarregue para ver a versão mais recente antes de continuar.";
    if (e.code === "42501") return "Sem permissão para esta ação.";
    return e.message.replace(/^ERROR:\s*/, "");
  }
  return "Não foi possível concluir a operação.";
};

export const enrollmentFor = (person: string) => call<EnrollmentInfo>("enrollment_for_person", { p_person: person });
export const enrollmentStart = (person: string, unit?: string) => call<string>("enrollment_start_evaluation", { p_person: person, p_unit: unit ?? null });
export const presentationOpen = (enrollment: string) => call<PresentationDraft>("presentation_open", { p_enrollment: enrollment });
export const presentationSave = (id: string, rev: number, patch: Record<string, unknown>) => call<{ rev: number; saved_at: string }>("presentation_save", { p_id: id, p_rev: rev, p_patch: patch });
export const evidenceSuggest = (id: string) => call<LibraryItem[]>("evidence_suggest", { p_presentation: id });
export const evidencePick = (id: string, evidence: string, rationale: string, differences: string | null) => call<PresentationDraft>("presentation_evidence_pick", { p_id: id, p_evidence: evidence, p_rationale: rationale, p_differences: differences });
export const evidenceUnpick = (id: string, evidence: string) => call<PresentationDraft>("presentation_evidence_unpick", { p_id: id, p_evidence: evidence });
export const presentationPublish = (id: string) => call<{ version: number; created: boolean; goal_created: boolean }>("presentation_publish", { p_id: id });
export const evidenceList = (status?: string) => call<LibraryItem[]>("evidence_list", { p_status: status ?? null });
export const evidenceSave = (id: string | null, p: Record<string, unknown>) => call<string>("evidence_save", { p_id: id, p });
export const evidenceReview = (id: string, decision: "approve" | "retire" | "reject", sourceChecked: boolean, note: string | null) => call<void>("evidence_review", { p_id: id, p_decision: decision, p_source_checked: sourceChecked, p_note: note });
export const myPresentation = () => call<MyPresentation>("my_presentation");

/** Apresentação PDF 16:9 (migration 151): rascunho → revisão → versão aprovada (imutável) → exportação. O paciente só lê versão APROVADA. */
export interface DeckOption { id: string; name: string; kind: string; price_cents: number; sessions_count: number | null; validity_days: number | null }
type DeckModelTypes = typeof import("@/pages/deck/deckModel");
export const deckOptions = (enrollment: string) => call<DeckOption[]>("deck_options", { p_enrollment: enrollment });
export const deckGenerate = (enrollment: string, product: string | null) => call<import("@/pages/deck/deckModel").DeckData>("deck_draft_generate", { p_enrollment: enrollment, p_product: product });
export const deckUpdate = (id: string, selection: Record<string, boolean> | null, product: string | undefined, clear: boolean) => call<import("@/pages/deck/deckModel").DeckData>("deck_draft_update", { p_id: id, p_selection: selection, p_product: product ?? null, p_clear_product: clear });
export const deckApprove = (id: string) => call<import("@/pages/deck/deckModel").DeckData>("deck_approve", { p_id: id });
export const deckGet = (enrollment: string) => call<import("@/pages/deck/deckModel").DeckState>("deck_get", { p_enrollment: enrollment });
export const deckRead = (id: string) => call<import("@/pages/deck/deckModel").DeckData>("deck_read", { p_id: id });
export const deckExportLog = (id: string) => call<void>("deck_export_log", { p_id: id });
export const myDeck = () => call<import("@/pages/deck/deckModel").MyDeck>("my_deck");
export const myDeckRespond = (deck: string, choice: "questions" | "start") => call<{ recorded: boolean; new: boolean }>("my_deck_respond", { p_deck: deck, p_choice: choice });
export type { DeckModelTypes };

export interface AccessState { has_email: boolean; email_masked: string | null; account: "none" | "invite_open" | "linked"; invite_expires_at: string | null; last_send: { at: string; outcome: "pending" | "accepted" | "failed" | "throttled"; error_code: string | null } | null; first_access_at: string | null; delivery_tracked: boolean }
export const portalAccessState = (person: string) => call<AccessState>("portal_access_state", { p_person: person });
export interface InviteResult { status: "sent" | "linked" | "no_email" | "no_enrollment" | "throttled" | "failed"; masked?: string | null; code?: string; message?: string }
/** Convite de primeiro acesso: a função autoriza no banco, usa só o e-mail já cadastrado e o Auth envia pelo Resend. Nunca recebe nem devolve o e-mail completo. */
export async function sendPortalInvite(person: string): Promise<InviteResult> {
  const { data, error } = await supabase.functions.invoke("patient-invite", { body: { person_id: person } });
  if (error) {
    let payload: InviteResult | null = null; try { payload = await (error as { context?: Response }).context?.json(); } catch { /* sem corpo */ }
    if (payload?.status) return payload;
    throw new ApiError(undefined, "Não foi possível enviar o convite agora.");
  }
  return data as InviteResult;
}

/** Condições por área, plano inicial, orçamento, evidências por condição e casos educativos (migration 152). */
export interface CatalogCondition { key: string; label: string; synonyms: string[]; subtypes: { key: string; label: string }[]; uses_region: boolean; uses_laterality: boolean; review_status: "pending_review" | "reviewed"; areas: string[] }
export const conditionsCatalog = () => call<CatalogCondition[]>("physio_conditions_list");
export interface LeadInfo { found: boolean; answered_at?: string; answers?: { key: string; value: string; label: string }[] }
export const leadInfo = (enrollment: string) => call<LeadInfo>("presentation_lead_info", { p_enrollment: enrollment });
export const CONTEXT_TAGS: [string, string][] = [["idoso", "Pessoa idosa"], ["acamado", "Acamado(a)"], ["pos_operatorio", "Pós-operatório"], ["pos_alta_hospitalar", "Pós-alta hospitalar"], ["cuidador_presente", "Cuidador(a) presente"], ["dispositivo_auxiliar", "Usa dispositivo auxiliar (muleta, andador…)"], ["gestante", "Gestante"]];
export const BODY_REGIONS = ["Cabeça", "Face / ATM", "Cervical", "Ombro", "Braço", "Cotovelo", "Antebraço", "Punho / mão", "Torácica", "Lombar", "Pelve / quadril", "Coxa", "Joelho", "Perna", "Tornozelo / pé", "Corpo todo"];
export interface PlanTemplate { id: string; name: string; area_key: string | null; condition_key: string | null; freq_per_week: number | null; duration_weeks: number | null; initial_sessions: number | null; session_minutes: number | null; routine_text: string | null; approach_text: string | null; reassessment_criteria: string | null; mine: boolean }
export const planTemplates = () => call<PlanTemplate[]>("plan_template_list");
export const planTemplateSave = (id: string | null, p: Record<string, unknown>) => call<string>("plan_template_save", { p_id: id, p });
export const planTemplateArchive = (id: string) => call<void>("plan_template_archive", { p_id: id });
export const caseList = (status?: string) => call<CaseItem[]>("case_list", { p_status: status ?? null });
export const caseSave = (id: string | null, p: Record<string, unknown>) => call<string>("case_save", { p_id: id, p });
export const caseReview = (id: string, decision: "approve" | "revoke" | "reject", o: { ref?: string; on?: string; identifiersRemoved?: boolean; note?: string } = {}) =>
  call<void>("case_review", { p_id: id, p_decision: decision, p_authorization_ref: o.ref || null, p_authorized_on: o.on || null, p_identifiers_removed: o.identifiersRemoved ?? false, p_note: o.note || null });
export const caseSuggest = (presentation: string) => call<CaseItem[]>("case_suggest", { p_presentation: presentation });
export const casePick = (id: string, c: string) => call<PresentationDraft>("presentation_case_pick", { p_id: id, p_case: c });
export const caseUnpick = (id: string, c: string) => call<PresentationDraft>("presentation_case_unpick", { p_id: id, p_case: c });
export interface QuoteInput { quantity?: number; quantity_source?: "auto" | "manual"; discount_cents?: number; installments_count?: number; first_due?: string | null; payment_methods?: string[]; valid_until?: string | null }
export const deckQuoteUpdate = (id: string, q: QuoteInput) => call<import("@/pages/deck/deckModel").DeckData>("deck_quote_update", { p_id: id, p_quote: q });
