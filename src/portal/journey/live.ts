import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { JourneyData } from "@/lib/journeyTypes";
import { useActing } from "../acting";
import type { PatientHomeData } from "../PatientHome";
import type { EvolutionData } from "../Evolution";
import { mergePain, type JourneyTab, type ApptItem, type EduItem, type ExerciseItem, type FunctionalItem, type JourneyModel, type PainPoint, type TrainingInfo, type WorkLog } from "./model";

export const PATIENT_HREF: Record<JourneyTab, string> = { inicio: "/paciente", evolucao: "/paciente/evolucao", exercicios: "/paciente/treinos", agenda: "/paciente/agenda", mais: "/paciente/mais" };

export interface RawAppt { id: string; starts_at: string; status: string; service_name: string; professional_name: string; patient_confirmed_at: string | null; can_confirm: boolean }
interface RawPackage { no_show: number; late_cancel: number }
interface TrainingPayload {
  summary: { prescription_id: string; title: string; weekly_target: number | null; today: { workout: string; total: number; done: number } | null; streak: number; week_days: number } | null;
  prescriptions: { id: string; title: string; status: string; weekly_target: number | null; items: { id: string; workout: string; title: string; instructions: string | null; sets: number | null; reps: string | null; duration_s: number | null; notes: string | null }[] }[];
  logs: { done_on: string; skipped: boolean }[];
}
interface PlanPayload { plan: { planned_sessions: number; maintenance: boolean; specialty_label: string | null } | null; stages: string[] | null; current: number | null; goal: { title: string; target_date: string | null } | null }

const rpc = async <T,>(fn: string): Promise<T | null> => { const { data, error } = await supabase.rpc(fn); if (error) return null; return data as T; };

/** Monta o modelo da jornada a partir das chamadas JÁ existentes do portal (my_home, my_evolution, my_training, my_journey, my_appointments, my_package_breakdown) e das novas (my_journey_plan, my_education).
 *  Uma chamada que falha (ex.: vínculo sem escopo de evolução) deixa só aquela parte em estado “sem dados” — nunca inventa valor. Nada aqui grava. */
export const useLiveJourney = () => {
  const { acting } = useActing(); const opt = { retry: false as const, staleTime: 15_000 };
  const home = useQuery({ queryKey: ["my-home"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_home"); if (error) throw error; return data as PatientHomeData; } });
  const evo = useQuery({ queryKey: ["my-evolution", acting], ...opt, queryFn: () => rpc<EvolutionData>("my_evolution") });
  const trn = useQuery({ queryKey: ["my-training", acting], ...opt, queryFn: () => rpc<TrainingPayload>("my_training") });
  const jny = useQuery({ queryKey: ["my-journey"], ...opt, queryFn: () => rpc<JourneyData>("my_journey") });
  const appts = useQuery({ queryKey: ["my-appts"], ...opt, queryFn: () => rpc<RawAppt[]>("my_appointments") });
  const pkgs = useQuery({ queryKey: ["my-pkg-breakdown"], ...opt, queryFn: () => rpc<RawPackage[]>("my_package_breakdown") });
  const plan = useQuery({ queryKey: ["my-journey-plan", acting], ...opt, queryFn: () => rpc<PlanPayload>("my_journey_plan") });
  const edu = useQuery({ queryKey: ["my-education", acting], ...opt, queryFn: () => rpc<{ id: string; topic: EduItem["topic"]; title: string; body: string }[]>("my_education") });
  const loading = home.isLoading || evo.isLoading || trn.isLoading || jny.isLoading || appts.isLoading || plan.isLoading;
  const h = home.data; if (!h) return { model: null as JourneyModel | null, loading, error: home.error };

  const pointsOf = (inst: string) => (evo.data?.series ?? []).filter((s) => s.instrument === inst);
  const pain: PainPoint[] = mergePain(
    pointsOf("nprs").flatMap((s) => s.points.map((p) => ({ at: p.at, value: p.value, by: (p.by === "professional" ? "professional" : "patient") as PainPoint["by"], author: p.author }))),
    (jny.data?.assessments ?? []).filter((a) => a.kind === "dor").map((a) => ({ at: a.assessed_at, value: Number(a.score), by: a.by_role, author: a.author })),
  );
  const functional: FunctionalItem[] = pointsOf("psfs").filter((s) => s.points.length > 0).map((s) => ({ name: s.label ?? s.name, first: s.first, last: s.last, count: s.count, firstAt: s.points[0].at, lastAt: s.points[s.points.length - 1].at }));

  const pres = trn.data?.prescriptions.find((p) => p.status === "active") ?? null; const sm = trn.data?.summary ?? null;
  const items: ExerciseItem[] = (pres?.items ?? []).map((i) => ({ id: i.id, title: i.title, workout: i.workout, instructions: i.instructions, sets: i.sets, reps: i.reps, duration_s: i.duration_s, notes: i.notes, videoAvailable: false }));
  const training: TrainingInfo | null = pres ? { title: pres.title, weeklyTarget: pres.weekly_target, workoutToday: sm?.today?.workout ?? null, items, todayDone: sm?.today?.done ?? 0, todayTotal: sm?.today?.total ?? 0, streak: sm?.streak ?? 0, weekDays: sm?.week_days ?? 0 } : null;
  const workLogs: WorkLog[] = (trn.data?.logs ?? []).map((l) => ({ date: l.done_on, skipped: l.skipped }));

  const appointments: ApptItem[] = (appts.data ?? []).map((a) => ({ id: a.id, starts_at: a.starts_at, status: a.status, service: a.service_name, professional: a.professional_name, canConfirm: a.can_confirm, confirmed: !!a.patient_confirmed_at }));
  const now = Date.now(); const upcoming = appointments.filter((a) => (a.status === "scheduled" || a.status === "confirmed") && new Date(a.starts_at).getTime() >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextAppointment = upcoming[0] ?? (h.next_appointment ? { id: h.next_appointment.id, starts_at: h.next_appointment.starts_at, status: h.next_appointment.status, service: h.next_appointment.service, professional: h.next_appointment.professional } : null);

  const lastRe = jny.data?.reassessments?.[0] ?? null; const hasPkg = (pkgs.data?.length ?? 0) > 0;   // sem pacote contratado não há saldo nem consumo: “—”, nunca zero
  const sessions = { planned: plan.data?.plan?.planned_sessions ?? h.plan?.planned_sessions ?? null, attended: h.plan?.attended ?? null, noShow: hasPkg ? (pkgs.data ?? []).reduce((s, p) => s + (p.no_show ?? 0), 0) : null, lateCancel: hasPkg ? (pkgs.data ?? []).reduce((s, p) => s + (p.late_cancel ?? 0), 0) : null,
    balance: hasPkg ? (h.package_balance ?? 0) : null, maintenance: !!(plan.data?.plan?.maintenance ?? h.plan?.maintenance), planStatus: h.plan?.status ?? null };
  const goal = plan.data?.goal ?? (h.goal ? { title: h.goal.title, target_date: h.goal.target_date } : null);
  const stages = plan.data?.stages ?? null; const education: EduItem[] = edu.data ?? [];
  const videos = (jny.data?.videos ?? []).filter((v) => !v.revoked_at && (!v.expires_at || new Date(v.expires_at) > new Date())).map((v) => ({ id: v.id, title: v.title, description: v.description }));

  const model: JourneyModel = {
    mode: "live", firstName: h.person.name.split(" ")[0], goal, specialtyLabel: plan.data?.plan?.specialty_label ?? null, stages, currentStage: plan.data?.current ?? null,
    nextAppointment, appointments, pain, functional, training, workLogs, videos, sessions, education, offers: h.offers ?? [],
    decision: lastRe?.decision ?? h.last_decision ?? null, decisionMessage: lastRe?.patient_message ?? null, checkinDue: !!h.checkin_due, needsBirthDate: !!h.needs_birth_date && !h.acting,
    hasData: !!(goal || (stages && stages.length) || pain.length || functional.length || (training && training.items.length) || sessions.planned != null || (jny.data?.reassessments?.length ?? 0) > 0),
  };
  return { model, loading, error: null as unknown };
};
