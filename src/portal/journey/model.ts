/** Modelo de dados da jornada visual do paciente. É o MESMO modelo que alimenta o portal real (dados do banco) e a demonstração do fisioterapeuta (dados ilustrativos):
 *  os componentes só recebem este modelo e nunca consultam o banco por conta própria. Todas as derivações abaixo são puras e testáveis — e honestas: sem registro não há número,
 *  um único registro não vira tendência, sessões realizadas nunca viram “% de recuperação” e nenhuma etapa avança por quantidade de sessões. */

export type JourneyTab = "inicio" | "evolucao" | "exercicios" | "agenda" | "mais";
export type EduTopic = "objetivos" | "rotina" | "reavaliacao" | "autonomia";
export const EDU_TOPIC_LABEL: Record<EduTopic, string> = { objetivos: "Objetivos do acompanhamento", rotina: "O papel da rotina prescrita", reavaliacao: "Preparação para reavaliações", autonomia: "Autonomia e alta" };
/** Etapas sugeridas ao fisioterapeuta quando ele define a jornada (ele pode renomear, acrescentar ou tirar). Nunca são mostradas ao paciente sem o profissional ter definido. */
export const DEFAULT_STAGES = ["Avaliação", "Cuidado inicial", "Movimento", "Atividades", "Reavaliação"];

export interface PainPoint { at: string; value: number; by: "patient" | "professional"; author?: string }
export interface FunctionalItem { name: string; first: number; last: number; count: number; firstAt: string; lastAt: string }
export interface ExerciseItem { id: string; title: string; workout: string; instructions: string | null; sets: number | null; reps: number | string | null; duration_s: number | null; notes: string | null; videoAvailable: boolean; done?: boolean }
export interface TrainingInfo { title: string | null; weeklyTarget: number | null; workoutToday: string | null; items: ExerciseItem[]; todayDone: number; todayTotal: number; streak: number; weekDays: number }
export interface WorkLog { date: string; skipped: boolean }
export interface ApptItem { id: string; starts_at: string; status: string; service: string; professional: string; canConfirm?: boolean; confirmed?: boolean; cancelNote?: string | null }
export interface SessionsInfo { planned: number | null; attended: number | null; noShow: number | null; lateCancel: number | null; balance: number | null; maintenance: boolean; planStatus: string | null }
export interface EduItem { id: string; topic: EduTopic; title: string; body: string }
export interface VideoItem { id: string; title: string; description: string | null }

export interface JourneyModel {
  mode: "live" | "demo";
  firstName: string;
  goal: { title: string; target_date: string | null } | null;
  specialtyLabel: string | null;
  stages: string[] | null; currentStage: number | null;
  nextAppointment: ApptItem | null; appointments: ApptItem[];
  pain: PainPoint[]; functional: FunctionalItem[];
  training: TrainingInfo | null; workLogs: WorkLog[]; videos: VideoItem[];
  sessions: SessionsInfo;
  education: EduItem[];
  /** Programas/ofertas decididos pelo administrador (com consentimento comercial). Nunca criados por quantidade de sessões. */
  offers: { id: string; title: string; summary: string | null }[];
  decision: "continuidade" | "manutencao" | "alta" | null; decisionMessage: string | null;
  checkinDue: boolean; needsBirthDate: boolean;
  /** true quando já existe alguma avaliação/registro clínico (dor, atividade, etapa, plano, treino): define se mostramos o acompanhamento ou o início de acompanhamento. */
  hasData: boolean;
}

// ---------------------------------------------------------------- derivações honestas
export const num = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");

/** Dor: número de registros, primeiro e último. A variação só existe com 2 ou mais registros (um único registro não gera tendência). */
export const painSummary = (pts: PainPoint[]) => {
  const s = [...pts].sort((a, b) => a.at.localeCompare(b.at)); const count = s.length;
  if (count === 0) return { count, first: null as number | null, last: null as number | null, delta: null as number | null, trend: false };
  const first = s[0].value; const last = s[count - 1].value;
  return { count, first, last, delta: count >= 2 ? Math.round((last - first) * 10) / 10 : null, trend: count >= 2 };
};

/** Junta registros da série de medidas e das avaliações antigas sem contar o mesmo registro duas vezes (mesmo valor com menos de 2 minutos de diferença). */
export const mergePain = (...lists: PainPoint[][]): PainPoint[] => {
  const all = lists.flat().sort((a, b) => a.at.localeCompare(b.at)); const out: PainPoint[] = [];
  for (const p of all) { const dup = out.some((o) => o.value === p.value && Math.abs(new Date(o.at).getTime() - new Date(p.at).getTime()) < 120_000); if (!dup) out.push(p); }
  return out;
};

export const DAY_FMT = (d: Date, tz = "America/Sao_Paulo") => new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export interface WeekDay { date: string; label: string; isToday: boolean; appts: ApptItem[]; trained: boolean; skipped: boolean }
const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
/** Semana de segunda a domingo que contém `now` (fuso de São Paulo): consultas (agendadas, realizadas, canceladas) e dias em que o paciente INFORMOU treino. */
export const weekDays = (m: Pick<JourneyModel, "appointments" | "workLogs">, now: Date = new Date()): WeekDay[] => {
  const today = DAY_FMT(now); const [y, mo, d] = today.split("-").map(Number); const base = new Date(Date.UTC(y, mo - 1, d, 12));
  const dow = (base.getUTCDay() + 6) % 7;   // 0 = segunda
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(base.getTime() + (i - dow) * 864e5); const date = day.toISOString().slice(0, 10);
    const logs = m.workLogs.filter((l) => l.date === date);
    return { date, label: WD[i], isToday: date === today, appts: m.appointments.filter((a) => DAY_FMT(new Date(a.starts_at)) === date), trained: logs.some((l) => !l.skipped), skipped: logs.length > 0 && logs.every((l) => l.skipped) };
  });
};

export type ApptKind = "agendado" | "confirmado" | "realizado" | "cancelado" | "falta";
export const apptKind = (status: string): ApptKind => status === "attended" ? "realizado" : status === "confirmed" ? "confirmado" : status === "no_show" || status === "professional_no_show" ? "falta" : status === "scheduled" || status === "rescheduled" ? "agendado" : "cancelado";
export const APPT_KIND_LABEL: Record<ApptKind, string> = { agendado: "Agendado", confirmado: "Confirmado", realizado: "Realizado", cancelado: "Cancelado", falta: "Falta" };

export interface NextAction { kind: "checkin" | "treino" | "confirmar" | "reavaliacao" | "consulta" | "inicio" | "seguir"; title: string; detail: string; tab: JourneyTab }
/** Próxima ação recomendada: só a partir do que o profissional registrou (plano, rotina liberada, consulta, decisão da reavaliação). Nunca prescreve, nunca cobra, nunca culpa. */
export const nextAction = (m: JourneyModel, now: Date = new Date()): NextAction => {
  if (m.checkinDue) return { kind: "checkin", title: "Check-in da semana", detail: "Leva 20 segundos e ajuda seu fisioterapeuta a ajustar o acompanhamento.", tab: "evolucao" };
  const t = m.training;
  if (t && t.todayTotal > 0 && t.todayDone < t.todayTotal) return { kind: "treino", title: `Treino de hoje${t.workoutToday ? ` (${t.workoutToday})` : ""}`, detail: `${t.todayTotal - t.todayDone} exercício(s) da rotina liberada pelo seu fisioterapeuta.`, tab: "exercicios" };
  const n = m.nextAppointment;
  if (n && n.canConfirm && !n.confirmed && new Date(n.starts_at).getTime() - now.getTime() < 48 * 36e5) return { kind: "confirmar", title: "Confirme sua presença", detail: "A consulta está próxima. Confirmar ajuda a organizar a agenda.", tab: "agenda" };
  if ((m.decision === "continuidade" || m.decision === "manutencao")) return { kind: "reavaliacao", title: m.decision === "manutencao" ? "Veja o plano de manutenção" : "Veja a orientação da reavaliação", detail: m.decisionMessage ?? "Seu fisioterapeuta registrou a decisão da última reavaliação.", tab: "mais" };
  if (n) return { kind: "consulta", title: "Sua próxima consulta", detail: `${n.service} com ${n.professional}.`, tab: "agenda" };
  if (!m.hasData) return { kind: "inicio", title: "Sua avaliação define o plano", detail: "Na avaliação, seu fisioterapeuta registra seu objetivo, sua dor e as atividades que você quer retomar.", tab: "inicio" };
  return { kind: "seguir", title: "Siga o plano combinado", detail: "Sem pendências por agora. Seu fisioterapeuta ajusta o plano a cada reavaliação.", tab: "inicio" };
};

/** Plano clínico, realizadas, consumidas por falta/cancelamento tardio e saldo do pacote: quatro coisas separadas. Nunca vira percentual de recuperação. */
export const sessionsSummary = (s: SessionsInfo) => ({
  plan: s.planned == null ? "Plano de sessões ainda não definido" : `${s.planned} sessão(ões) previstas no plano`,
  done: s.attended == null ? null : s.attended, consumed: s.noShow == null && s.lateCancel == null ? null : (s.noShow ?? 0) + (s.lateCancel ?? 0), balance: s.balance,
});

/** Ordem em que o profissional definiu as etapas; a etapa atual é a registrada por ele (nunca derivada de contagem de sessões). */
export const stageStates = (m: Pick<JourneyModel, "stages" | "currentStage">) => (m.stages ?? []).map((name, i) => ({ name, state: m.currentStage == null ? "pendente" as const : i < m.currentStage ? "concluida" as const : i === m.currentStage ? "atual" as const : "pendente" as const }));
