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
  assessed: { condition_kind: "assessed" | "hypothesis" | null; condition_text: string | null };
  goal: { title: string; target_date: string | null } | null;
  plan: { freq_per_week: number | null; duration_weeks: number | null; routine: string | null; reassessment_on: string | null; reassessment_criteria: string | null };
  evidence: EvidenceItem[];
}
export interface PresentationDraft {
  id: string; enrollment_id: string; person_id: string; rev: number; status: "draft" | "published"; published_version: number; published_at: string | null; updated_at: string;
  area_keys: string[]; complaint: string | null; symptom_duration: string | null; limitations: string | null; activities: string | null;
  condition_kind: "assessed" | "hypothesis" | null; condition_text: string | null; goal_title: string | null; goal_target_date: string | null;
  freq_per_week: number | null; duration_weeks: number | null; routine_text: string | null; reassessment_on: string | null; reassessment_criteria: string | null; internal_notes: string | null;
  patient_payload: PatientPayload; missing: string[]; can_publish: boolean; unpublished_changes: boolean;
  evidence_picked: { evidence: LibraryItem; rationale: string; differences: string | null; position: number }[];
  person_name: string; enrollment_status: "pending" | "active"; professional: string | null; evaluation_at: string | null;
}
export interface LibraryItem extends Omit<EvidenceItem, "relation" | "differences"> {
  area_keys: string[]; conditions: string[]; status: "draft" | "approved" | "retired"; version: number; reviewed_at: string | null; source_verified_at: string | null;
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

/** E-book da apresentação (migration 150): instantâneo versionado com a oferta (produto da própria organização), a regra de pagamento e o acesso ao aplicativo. */
export interface EbookOption { id: string; name: string; kind: string; price_cents: number; sessions_count: number | null; validity_days: number | null }
export const ebookOptions = (enrollment: string) => call<EbookOption[]>("presentation_ebook_options", { p_enrollment: enrollment });
export const ebookGenerate = (enrollment: string, product: string) => call<{ id: string; version: number; created: boolean }>("presentation_ebook_generate", { p_enrollment: enrollment, p_product: product });
export const ebookGet = (enrollment: string) => call<import("./Ebook").EbookData>("presentation_ebook_get", { p_enrollment: enrollment });
export const myEbook = () => call<import("./Ebook").EbookData>("my_ebook");

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
