import { useSyncExternalStore } from "react";
import { buildSeed, isoDay, todayISO, weekdayOf } from "./seed";
import type { Appointment, Demo, ExerciseLog, LogResult, Measure, Patient, Routine, RoutineItem } from "./types";

/** Estado ÚNICO da demonstração (compartilhado pelas duas experiências) + ações + leituras derivadas. Persistido no navegador; "Restaurar demonstração" recria tudo.
 *  No app definitivo, este arquivo é o que muda: as ações viram chamadas à API do Hub e as leituras viram consultas (docs/preview-ios.md). */
const KEY = "hp-ios-preview-demo-v1";
let state: Demo; const subs = new Set<() => void>();
const load = (): Demo => {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw) as Demo; if (d.version === 1 && d.anchor === todayISO()) return d; } } catch { /* sem storage: a demonstração vale só nesta aba */ }
  return buildSeed();
};
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignorar */ } };
const emit = () => { persist(); subs.forEach((f) => f()); };
state = load();
const set = (fn: (d: Demo) => Demo) => { state = fn(state); emit(); };
export const getState = () => state;
export const useDemo = (): Demo => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, getState, getState);
export const resetDemo = () => { state = buildSeed(); emit(); };

// ---------------------------------------------------------------- "agora" da demonstração (pode ser fixado por ?now=AAAA-MM-DDTHH:MM nos testes)
let nowOverride: string | null = null;
export const setNowOverride = (v: string | null) => { nowOverride = v; };
export const demoNow = (): Date => (nowOverride ? new Date(nowOverride) : new Date());
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
export const fmtTime = (at: string) => at.slice(11, 16);
export const parseAt = (at: string) => { const [d, t] = at.split("T"); const [y, m, dd] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number); return new Date(y, m - 1, dd, h, mi); };
export const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/\u00a0/g, " ");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]; const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const fmtDay = (iso: string) => { const [, m, d] = iso.slice(0, 10).split("-").map(Number); return `${String(d).padStart(2, "0")} ${MESES[m - 1]}`; };
export const fmtDayLong = (iso: string) => { const dd = iso.slice(0, 10); return `${DIAS[weekdayOf(dd)]}, ${fmtDay(dd)}`; };
export const weekdayName = (w: number) => DIAS[w];
export const addDays = (day: string, n: number) => { const [y, m, d] = day.split("-").map(Number); return isoDay(new Date(y, m - 1, d + n)); };

// ---------------------------------------------------------------- leituras derivadas
export const patientById = (d: Demo, id: string): Patient => d.patients.find((p) => p.id === id)!;
export const protocolOf = (d: Demo, p: Patient) => d.protocols.find((x) => x.id === p.protocolId)!;
export const apptsOf = (d: Demo, pid: string) => d.appts.filter((a) => a.patientId === pid).sort((x, y) => x.at.localeCompare(y.at));
const ACTIVE: Appointment["status"][] = ["scheduled", "confirmed"];
export const upcomingOf = (d: Demo, pid: string) => apptsOf(d, pid).filter((a) => ACTIVE.includes(a.status) && a.at.slice(0, 10) >= d.anchor);
/** Saldo do pacote: contratado, realizado, descontado (falta ou cancelamento tardio) e disponível. Falta ≠ cancelamento ≠ realizado. */
export const balanceOf = (d: Demo, pid: string) => {
  const p = patientById(d, pid); const a = apptsOf(d, pid); const contracted = protocolOf(d, p).totalSessions;
  const done = a.filter((x) => x.status === "done").length; const noShow = a.filter((x) => x.status === "no_show").length; const late = a.filter((x) => x.status === "cancelled_late").length;
  const freeCancel = a.filter((x) => x.status === "cancelled").length; const scheduled = a.filter((x) => ACTIVE.includes(x.status)).length;
  return { contracted, done, noShow, late, freeCancel, discounted: noShow + late, available: Math.max(0, contracted - done - noShow - late), scheduled };
};
/** Consequência do cancelamento, calculada ANTES de confirmar: menos de 24 h = a sessão é descontada do pacote. */
export const cancelConsequence = (a: Appointment) => {
  const hours = (parseAt(a.at).getTime() - demoNow().getTime()) / 36e5;
  return hours < 24 ? { late: true, hours, text: `Faltam menos de 24 h (${Math.max(0, Math.round(hours))} h): pela regra do seu protocolo, esta sessão SERÁ DESCONTADA do saldo.` } : { late: false, hours, text: "Você está cancelando com mais de 24 h de antecedência: nenhuma sessão será descontada." };
};
export const routinesForDay = (d: Demo, pid: string, day: string) => d.routines.filter((r) => r.patientId === pid && r.active && r.days.includes(weekdayOf(day)));
export const logsOf = (d: Demo, pid: string) => d.logs.filter((l) => l.patientId === pid).sort((x, y) => y.date.localeCompare(x.date));
export const loggedToday = (d: Demo, pid: string, routineId: string, exerciseId: string) => d.logs.find((l) => l.patientId === pid && l.routineId === routineId && l.exerciseId === exerciseId && l.date === d.anchor);
/** Adesão DECLARADA: dias com ao menos um exercício declarado como concluído ou parcial, entre os últimos N dias (não é medida de resultado clínico). */
export const adherenceOf = (d: Demo, pid: string, days = 14) => {
  const from = addDays(d.anchor, -(days - 1)); const set = new Set(d.logs.filter((l) => l.patientId === pid && l.date >= from && l.date <= d.anchor && l.result !== "nao_consegui").map((l) => l.date));
  return { days, declared: set.size, pct: Math.round((100 * set.size) / days) };
};
export const measuresOf = (d: Demo, pid: string) => d.measures.filter((m) => m.patientId === pid);
export const evolutionPending = (d: Demo, pid: string) => apptsOf(d, pid).filter((a) => a.status === "done" && !a.evolutionNoteId && a.at.slice(0, 10) >= addDays(d.anchor, -14) && a.at.slice(0, 10) <= d.anchor);
export const feedbackPending = (d: Demo, pid: string) => d.logs.filter((l) => l.patientId === pid && !l.reviewedAt && (l.doubt || l.difficulty || l.result !== "concluido"));
export const flagsOf = (d: Demo, pid: string) => ({ evolution: evolutionPending(d, pid).length, feedback: feedbackPending(d, pid).length, reassessment: patientById(d, pid).phase === "reavaliacao" ? 1 : 0 });
export const sharedNotes = (d: Demo, pid: string) => d.notes.filter((n) => n.patientId === pid && n.shared).sort((x, y) => y.date.localeCompare(x.date));
export interface TimelineEvent { id: string; kind: "avaliacao" | "plano" | "atendimentos" | "reavaliacao" | "conclusao"; title: string; detail: string; date?: string; state: "feito" | "proximo" | "futuro" }
export const timelineOf = (d: Demo, pid: string): TimelineEvent[] => {
  const p = patientById(d, pid); const pr = protocolOf(d, p); const a = apptsOf(d, pid); const b = balanceOf(d, pid); const re = d.reassessments.filter((r) => r.patientId === pid);
  const first = a.find((x) => x.kind === "avaliacao" && x.status === "done"); const nextRe = upcomingOf(d, pid).find((x) => x.kind === "reavaliacao");
  const concluded = p.phase === "concluido";
  return [
    { id: "t1", kind: "avaliacao", title: "Avaliação inicial", detail: first ? "Metas e medidas iniciais definidas com o fisioterapeuta." : "Será realizada no primeiro encontro.", date: first?.at.slice(0, 10), state: first ? "feito" : "proximo" },
    { id: "t2", kind: "plano", title: `Plano: ${pr.totalSessions} encontros`, detail: `Definido por ${pr.definedBy}. O número de encontros é decisão clínica, revisada na reavaliação.`, date: pr.definedOn, state: first ? "feito" : "futuro" },
    { id: "t3", kind: "atendimentos", title: "Atendimentos", detail: `${b.done} de ${b.contracted} encontros realizados. Isto mede participação, não recuperação.`, state: b.done >= b.contracted || concluded ? "feito" : b.done > 0 ? "proximo" : "futuro" },
    { id: "t4", kind: "reavaliacao", title: "Reavaliação", detail: re[0] ? `Decisão em ${re[0].date.split("-").reverse().join("/")}: ${re[0].decision === "concluir" ? "concluir o acompanhamento" : re[0].decision === "manter" ? "manter o acompanhamento" : "outro protocolo recomendado"}.` : nextRe ? "Agendada. O próximo passo depende dela." : "Será marcada pelo fisioterapeuta.", date: re[0]?.date ?? nextRe?.at.slice(0, 10), state: re[0] ? "feito" : nextRe ? "proximo" : "futuro" },
    { id: "t5", kind: "conclusao", title: "Conclusão", detail: concluded ? "Acompanhamento concluído." : "Só acontece depois da reavaliação — nunca automaticamente por término de sessões.", state: concluded ? "feito" : "futuro" },
  ];
};
// ganhos (regra FICTÍCIA do preview)
export const earningsOf = (d: Demo) => {
  const sum = (f: (x: Demo["payouts"][number]) => boolean) => d.payouts.filter(f).reduce((s, x) => s + x.cents, 0);
  const future = d.appts.filter((a) => ACTIVE.includes(a.status) && a.at.slice(0, 10) >= d.anchor);
  const eligibleDone = d.payouts.filter((x) => x.kind === "sessao");
  return { rate: d.ratePerSessionCents, eligible: eligibleDone.length, eligibleCents: eligibleDone.reduce((s, x) => s + x.cents, 0), estimateCount: future.length, estimateCents: future.length * d.ratePerSessionCents, future,
    apurado: sum((x) => x.state === "apurado"), liberado: sum((x) => x.state === "liberado"), pago: sum((x) => x.state === "pago"), total: sum(() => true) };
};

// ---------------------------------------------------------------- ações
export const act = {
  // paciente
  confirmPresence: (id: string) => set((d) => ({ ...d, appts: d.appts.map((a) => (a.id === id ? { ...a, status: "confirmed" as const, confirmedAt: demoNow().toISOString() } : a)) })),
  cancelAppt: (id: string) => set((d) => ({ ...d, appts: d.appts.map((a) => (a.id === id ? { ...a, status: cancelConsequence(a).late ? "cancelled_late" as const : "cancelled" as const } : a)) })),
  logExercise: (l: Omit<ExerciseLog, "id" | "date"> & { date?: string }) => set((d) => ({ ...d, logs: [...d.logs.filter((x) => !(x.patientId === l.patientId && x.routineId === l.routineId && x.exerciseId === l.exerciseId && x.date === d.anchor)), { ...l, id: uid("lg"), date: l.date ?? d.anchor }] })),
  addCheckin: (pid: string, mood: 1 | 2 | 3 | 4 | 5, note: string) => set((d) => ({ ...d, checkins: [...d.checkins.filter((c) => !(c.patientId === pid && c.date === d.anchor)), { id: uid("ck"), patientId: pid, date: d.anchor, mood, note }] })),
  sendMessage: (pid: string, text: string) => set((d) => ({ ...d, messages: [...d.messages, { id: uid("ms"), patientId: pid, from: "paciente" as const, text, at: `${d.anchor}T${demoNow().toTimeString().slice(0, 5)}` }] })),
  setPref: (k: keyof Demo["prefs"], v: boolean) => set((d) => ({ ...d, prefs: { ...d.prefs, [k]: v } })),
  interestedIn: (id: string) => set((d) => ({ ...d, recommendations: d.recommendations.map((r) => (r.id === id ? { ...r, interested: true } : r)) })),
  // fisioterapeuta
  confirmAttendance: (id: string) => set((d) => {
    const a = d.appts.find((x) => x.id === id); if (!a || !ACTIVE.includes(a.status)) return d; const next = d.appts.filter((x) => x.patientId === a.patientId && x.status === "done").length + 1;
    return { ...d, appts: d.appts.map((x) => (x.id === id ? { ...x, status: "done" as const, sessionNo: next } : x)), payouts: [...d.payouts, { id: uid("po"), apptId: id, kind: "sessao" as const, cents: d.ratePerSessionCents, state: "apurado" as const, date: a.at.slice(0, 10), label: "Sessão elegível" }] };
  }),
  markNoShow: (id: string) => set((d) => ({ ...d, appts: d.appts.map((a) => (a.id === id && ACTIVE.includes(a.status) ? { ...a, status: "no_show" as const } : a)) })),
  saveEvolution: (e: { patientId: string; apptId?: string; shared: string; internal: string; values: Record<string, number> }) => set((d) => {
    const notes = [...d.notes]; let noteId: string | undefined;
    if (e.shared.trim()) { noteId = uid("nt"); notes.push({ id: noteId, patientId: e.patientId, apptId: e.apptId, date: d.anchor, shared: true, text: e.shared.trim(), author: d.physio.name }); }
    if (e.internal.trim()) { const id = uid("nt"); noteId = noteId ?? id; notes.push({ id, patientId: e.patientId, apptId: e.apptId, date: d.anchor, shared: false, text: e.internal.trim(), author: d.physio.name }); }
    const measures: Measure[] = d.measures.map((m) => (e.values[m.id] != null ? { ...m, points: [...m.points.filter((p) => p.date !== d.anchor), { date: d.anchor, value: e.values[m.id] }] } : m));
    return { ...d, notes, measures, appts: d.appts.map((a) => (a.id === e.apptId ? { ...a, evolutionNoteId: noteId ?? a.evolutionNoteId } : a)) };
  }),
  reassess: (r: { patientId: string; decision: "concluir" | "manter" | "recomendar"; reason: string; shared: string; recommendedProtocol?: string }) => set((d) => ({
    ...d, reassessments: [...d.reassessments, { id: uid("re"), patientId: r.patientId, date: d.anchor, decision: r.decision, reason: r.reason, sharedMessage: r.shared, recommendedProtocol: r.recommendedProtocol }],
    patients: d.patients.map((p) => (p.id === r.patientId ? { ...p, phase: r.decision === "manter" ? "tratamento" as const : "concluido" as const } : p)),
    recommendations: r.decision === "recomendar" ? [...d.recommendations, { id: uid("rc"), patientId: r.patientId, protocolName: r.recommendedProtocol ?? "Novo protocolo", reason: r.reason, createdAt: d.anchor, interested: false }] : d.recommendations,
  })),
  assignRoutine: (r: { patientId: string; id?: string; name: string; days: number[]; items: RoutineItem[]; note: string }) => set((d) => {
    const prev = d.routines.find((x) => x.id === r.id); const routine: Routine = { id: r.id ?? uid("rt"), patientId: r.patientId, name: r.name, days: r.days, items: r.items, note: r.note, version: (prev?.version ?? 0) + 1, assignedAt: d.anchor, active: true };
    return { ...d, routines: prev ? d.routines.map((x) => (x.id === prev.id ? routine : x)) : [...d.routines, routine] };
  }),
  reviewFeedback: (id: string, reply: string) => set((d) => ({ ...d, logs: d.logs.map((l) => (l.id === id ? { ...l, reviewedAt: d.anchor, reply: reply.trim() || l.reply } : l)) })),
  setAvailability: (weekday: number, patch: Partial<Demo["availability"][number]>) => set((d) => ({ ...d, availability: d.availability.map((a) => (a.weekday === weekday ? { ...a, ...patch } : a)) })),
};
export const resultLabel: Record<LogResult, string> = { concluido: "Concluído", parcial: "Fiz parcialmente", nao_consegui: "Não consegui" };
