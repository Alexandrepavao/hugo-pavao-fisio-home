export interface JourneyAssessment { id: string; kind: "dor" | "funcionalidade" | "bem_estar"; score: number; note: string | null; assessed_at: string; by_role: "patient" | "professional"; author: string; source: "avaliacao" | "atividade" }
export interface JourneyData {
  goals: { id: string; title: string; details: string | null; target_date: string | null; status: "active" | "achieved" | "dropped"; created_at: string }[];
  plan: { id: string; planned_sessions: number; started_on: string; status: "active" | "completed" | "cancelled"; maintenance: boolean; notes: string | null; attended: number; patient_no_show: number; professional_no_show: number; cancelled: number } | null;
  default_sessions: number; package_balance: number;
  upcoming: { id: string; starts_at: string; status: string; service: string; professional: string }[];
  assessments: JourneyAssessment[];
  reassessments: { id: string; decision: "continuidade" | "manutencao" | "alta"; extra_sessions: number | null; patient_message: string | null; decided_at: string; author: string; clinical_note?: string | null }[];
  videos: { id: string; title: string; description: string | null; assigned_at: string; expires_at: string | null; revoked_at: string | null; views?: number }[];
  renewal: { id: string; kind: "renovacao" | "contato"; created_at: string; status: string } | null;
}
export const KIND_LABEL: Record<JourneyAssessment["kind"], string> = { dor: "Dor", funcionalidade: "Funcionalidade", bem_estar: "Bem-estar" };
export const KIND_HINT: Record<JourneyAssessment["kind"], string> = { dor: "0 = sem dor · 10 = pior dor imaginável", funcionalidade: "0 = muita dificuldade nas atividades · 10 = nenhuma dificuldade", bem_estar: "0 = muito mal · 10 = muito bem" };
export const DECISION_LABEL: Record<string, string> = { continuidade: "Continuidade do acompanhamento", manutencao: "Plano de manutenção", alta: "Alta" };
export const GOAL_STATUS: Record<string, string> = { active: "Em andamento", achieved: "Alcançado", dropped: "Descontinuado" };
