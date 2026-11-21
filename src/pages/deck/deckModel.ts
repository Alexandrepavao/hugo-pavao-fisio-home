import { buildJourneyModel, type RawJourney } from "@/portal/journey/live";
import type { JourneyModel } from "@/portal/journey/model";
import type { Series } from "@/portal/Evolution";
import type { PatientPayload } from "@/pages/apresentacao/api";

/** Retrato aprovado (migration 151). Tudo vem do servidor; o PDF e a demonstração são desenhados SÓ a partir dele. */
export interface DeckSnapshot {
  clinic: { name: string; logo_path?: string | null; color_primary?: string | null; support_email?: string | null; website_url?: string | null; is_default_brand?: boolean };
  patient: { name: string; first_name: string };
  professional: string | null; evaluation_at: string | null; enrollment_status: "pending" | "active";
  presentation: { version: number; content: PatientPayload };
  measures: Series[]; planned_sessions: number | null; raw: Record<string, unknown>; generated_at: string;
}
export interface DeckOffer { product_id: string; name: string; price_cents: number; sessions_count: number | null; validity_days: number | null; per_session_cents: number | null; consume_on_no_show: boolean | null; late_cancel_hours: number | null; quoted_at: string }
export type DeckSelection = Record<"goals" | "start" | "path" | "evolution" | "app" | "videos" | "continuity" | "evidence" | "plan" | "commercial" | "next", boolean>;
export interface DeckData { id: string; status: "draft" | "approved" | "superseded"; version: number | null; presentation_version: number; snapshot: DeckSnapshot; offer: DeckOffer | null; selection: DeckSelection; is_demo: boolean; content_hash: string | null; created_at: string; updated_at: string; approved_at: string | null }
export interface DeckVersionRow { id: string; version: number; status: "approved" | "superseded"; approved_at: string; content_hash: string; is_demo: boolean }
export interface DeckState { draft: DeckData | null; versions: DeckVersionRow[] }
export interface MyDeck { exists: boolean; deck?: DeckData; enrollment_status?: "pending" | "active"; payment?: "no_contract" | "awaiting" | "confirmed"; installments?: { no: number; due_date: string; amount_cents: number; status: string }[]; responded?: string[] }

export const SELECTION_LABEL: Record<keyof DeckSelection, string> = {
  goals: "Objetivos do paciente", start: "Ponto de partida (medidas registradas)", path: "Caminho do acompanhamento", evolution: "Evolução: celular e gráfico ampliado", app: "Aplicativo: tela inicial no celular",
  videos: "Aplicativo: exercícios, vídeos e cuidado em casa", continuity: "Continuidade com propósito", evidence: "Evidências aprovadas", plan: "Plano proposto", commercial: "Valores e condições comerciais (dentro do plano proposto)", next: "Próximo passo",
};

/** Modelo do portal a partir do retrato: os MESMOS componentes do aplicativo real, alimentados por dados congelados. Parte ausente = “sem dados” (nunca inventada). */
export const deckModel = (s: DeckSnapshot): JourneyModel | null => {
  const r = s.raw as Partial<RawJourney> & { home?: RawJourney["home"] & { enrollment?: { status: "pending" | "active" | "none"; payment?: "no_contract" | "awaiting" | "confirmed" } } };
  if (!r.home) return null;
  return buildJourneyModel({ home: r.home, evo: r.evo ?? null, trn: r.trn ?? null, jny: r.jny ?? null, appts: r.appts ?? null, pkgs: [], plan: r.plan ?? null, edu: r.edu ?? null,
    enrollment: r.home.enrollment ? { status: r.home.enrollment.status, payment: r.home.enrollment.payment ?? "no_contract" } : null, evidence: s.presentation.content.evidence, preview: null });
};

export const SCALE_TEXT: Record<string, string> = { nprs: "Escala de dor de 0 a 10 · 0 = sem dor · 10 = a pior dor imaginável", psfs: "Atividade que você quer retomar, de 0 a 10 · 0 = não consigo · 10 = consigo como antes" };
export const isScale10 = (s: Series) => s.instrument === "nprs" || s.instrument === "psfs";

/**
 * Nomes de DEMONSTRAÇÃO sem identificadores técnicos. Só vale quando o documento é um exemplo (paciente fictício) e só na EXIBIÇÃO:
 * o retrato aprovado e os registros originais não são alterados. Remove o sufixo de execução dos testes (ex.: " N42 ab12cd34"), a marca
 * "(exemplo)" do nome e troca o nome técnico da fisioterapeuta de teste por um rótulo neutro (não se atribui o atendimento a outra pessoa).
 */
const TECH = /\s+N\d{2}\s+[a-z0-9]{5,12}\b/gi;
const TEST_PRO = /Fisio E2E [a-z0-9]+/gi;
export const presentable = (d: DeckData): DeckData => {
  if (!d.is_demo) return d;
  const clean = (v: unknown): unknown => typeof v === "string" ? v.replace(TECH, "").replace(TEST_PRO, "Fisioterapeuta de exemplo")
    : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clean(x)])) : v;
  const snapshot = clean(d.snapshot) as DeckSnapshot; const offer = clean(d.offer) as DeckOffer | null;
  snapshot.patient = { ...snapshot.patient, name: snapshot.patient.name.replace(/\s*\(exemplo\)\s*/i, " ").trim() };
  return { ...d, snapshot, offer };
};
