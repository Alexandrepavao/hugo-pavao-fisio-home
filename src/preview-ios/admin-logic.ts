import { addDays, adherenceOf, apptsOf, balanceOf, demoNow, flagsOf, mutate, parseAt, protocolOf, shareOf } from "./store";
import type { Demo, OtherPatient, Patient, RepStatus, TeamMember, Ticket } from "./types";

/** Leituras e ações da GESTÃO (experiência Administrador). Mesmo estado dos outros dois apps: o que o admin libera/paga aparece em "Ganhos" do fisio;
 *  a mensagem do paciente vira chamado; a resposta volta para o paciente. No app definitivo viram chamadas à Hub API (funções de admin com leitura clínica registrada). */
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const nowAt = (d: Demo) => `${d.anchor}T${demoNow().toTimeString().slice(0, 5)}`;
const inWin = (d: Demo, day: string, days = 30) => day >= addDays(d.anchor, -(days - 1)) && day <= d.anchor;
export const PERIOD_ADMIN = "Últimos 30 dias (demonstração)";

// ---------------------------------------------------------------- pacientes da clínica (vivos + de apoio)
export interface ClinicPatient { id: string; name: string; hue: number; code: string; age: number; protocolId: string; phase: Patient["phase"]; goal: string; physioId: string; live: boolean; adherencePct: number; done: number; total: number; flags: OtherPatient["flags"] }
export const clinicPatients = (d: Demo): ClinicPatient[] => [
  ...d.patients.map((p): ClinicPatient => ({ id: p.id, name: p.name, hue: p.hue, code: p.code, age: p.age, protocolId: p.protocolId, phase: p.phase, goal: p.goal, physioId: p.physioId, live: true, adherencePct: adherenceOf(d, p.id, 14).pct, done: balanceOf(d, p.id).done, total: protocolOf(d, p).totalSessions, flags: flagsOf(d, p.id) })),
  ...d.admin.others.map((o): ClinicPatient => ({ id: o.id, name: o.name, hue: o.hue, code: o.code, age: o.age, protocolId: o.protocolId, phase: o.phase, goal: o.goal, physioId: o.physioId, live: false, adherencePct: o.adherencePct, done: o.done, total: d.protocols.find((x) => x.id === o.protocolId)?.totalSessions ?? 10, flags: o.flags })),
];
export const physioName = (d: Demo, id: string) => d.admin.team.find((t) => t.id === id)?.name ?? "—";

// ---------------------------------------------------------------- equipe e repasses
export const teamOf = (d: Demo): TeamMember[] => {
  const all = clinicPatients(d);
  return d.admin.team.map((t) => {
    const mine = all.filter((p) => p.physioId === t.id && p.phase !== "concluido");
    if (!t.live) return { ...t, patients: mine.length };
    const a = d.appts.filter((x) => inWin(d, x.at.slice(0, 10))); const done = a.filter((x) => x.status === "done").length; const lost = a.filter((x) => x.status === "no_show" || x.status === "cancelled_late").length;
    const sum = (s: string) => d.payouts.filter((x) => x.state === s).reduce((acc, x) => acc + x.cents, 0);
    return { ...t, patients: mine.length, sessions30: done, noShowPct: done + lost ? Math.round((100 * lost) / (done + lost)) : 0, adherencePct: mine.length ? Math.round(mine.reduce((s, p) => s + p.adherencePct, 0) / mine.length) : 0, pendingEvo: all.filter((p) => p.physioId === t.id).reduce((s, p) => s + p.flags.evolution, 0), buckets: { apurado: sum("apurado"), liberado: sum("liberado"), pago: sum("pago") } };
  });
};
export const clinicBuckets = (d: Demo) => teamOf(d).reduce((s, t) => ({ apurado: s.apurado + t.buckets.apurado, liberado: s.liberado + t.buckets.liberado, pago: s.pago + t.buckets.pago }), { apurado: 0, liberado: 0, pago: 0 });
export const revenueOf = (d: Demo) => { const rows = d.admin.sales.filter((s) => inWin(d, s.date)); const paid = rows.filter((s) => s.status === "pago"); return { rows, total: rows.reduce((s, x) => s + x.cents, 0), paid: paid.reduce((s, x) => s + x.cents, 0), pending: rows.filter((s) => s.status === "pendente").reduce((s, x) => s + x.cents, 0), ticket: rows.length ? Math.round(rows.reduce((s, x) => s + x.cents, 0) / rows.length) : 0 }; };
export const continuityOf = (d: Demo) => { const done = clinicPatients(d).filter((p) => p.phase === "concluido"); const rec = d.recommendations; return { concluded: done.length, recommended: rec.length, interested: rec.filter((r) => r.interested).length, pct: done.length ? Math.round((100 * rec.length) / done.length) : 0 }; };

// ---------------------------------------------------------------- chamados (SLA 24 h: clínico = horas corridas · administrativo = horas úteis, sem sábado/domingo; escalada com 12 h)
const countHours = (from: Date, to: Date, businessOnly: boolean) => { let h = 0; const t = new Date(from); while (t < to && h < 24 * 30) { t.setHours(t.getHours() + 1); if (t <= to && (!businessOnly || (t.getDay() !== 0 && t.getDay() !== 6))) h++; } return h; };
export type SlaState = "no_prazo" | "escalado" | "vencido" | "ok" | "fora";
export const slaOf = (t: Ticket): { state: SlaState; elapsed: number; left: number; label: string } => {
  const biz = t.kind === "administrativo"; const open = parseAt(t.openedAt); const first = t.thread.find((m) => m.from === "equipe" && !m.internal);
  if (first) { const e = countHours(open, parseAt(first.at), biz); return { state: e <= 24 ? "ok" : "fora", elapsed: e, left: 0, label: e <= 24 ? `Respondido em ${e} h` : `Respondido fora do prazo (${e} h)` }; }
  const e = countHours(open, demoNow(), biz); const left = 24 - e;
  return e >= 24 ? { state: "vencido", elapsed: e, left, label: `Vencido há ${e - 24} h` } : e >= 12 ? { state: "escalado", elapsed: e, left, label: `Escalado · faltam ${left} h` } : { state: "no_prazo", elapsed: e, left, label: `No prazo · faltam ${left} h` };
};
export const ticketsOpen = (d: Demo) => d.admin.tickets.filter((t) => t.status === "aberto");
export const ticketsAttention = (d: Demo) => ticketsOpen(d).filter((t) => { const s = slaOf(t).state; return s === "vencido" || s === "escalado"; });

// ---------------------------------------------------------------- ações
const patchAdmin = (d: Demo, p: Partial<Demo["admin"]>): Demo => ({ ...d, admin: { ...d.admin, ...p } });
export const adm = {
  /** Leitura clínica do gestor: só leitura e SEMPRE registrada (o paciente vê no app dele quem acessou). */
  logAccess: (patientId: string, patientName: string) => mutate((d) => d.admin.accessLog.some((e) => e.patientId === patientId && e.who.startsWith("Administração") && e.at.slice(0, 10) === d.anchor) ? d : patchAdmin(d, { accessLog: [{ id: uid("ac"), at: nowAt(d), who: "Administração (gestor)", patientId, patientName, what: "Leitura somente da ficha clínica (jornada, evolução e treino)" }, ...d.admin.accessLog] })),
  authorize: (physioId: string) => mutate((d) => {
    const t = d.admin.team.find((x) => x.id === physioId); if (!t) return d;
    return t.live ? { ...d, payouts: d.payouts.map((p) => (p.state === "apurado" ? { ...p, state: "liberado" as const } : p)) } : patchAdmin(d, { team: d.admin.team.map((x) => (x.id === physioId ? { ...x, buckets: { ...x.buckets, apurado: 0, liberado: x.buckets.liberado + x.buckets.apurado } } : x)) });
  }),
  pay: (physioId: string) => mutate((d) => {
    const t = d.admin.team.find((x) => x.id === physioId); if (!t) return d;
    return t.live ? { ...d, payouts: d.payouts.map((p) => (p.state === "liberado" ? { ...p, state: "pago" as const } : p)) } : patchAdmin(d, { team: d.admin.team.map((x) => (x.id === physioId ? { ...x, buckets: { ...x.buckets, liberado: 0, pago: x.buckets.pago + x.buckets.liberado } } : x)) });
  }),
  adjust: (physioId: string, cents: number, reason: string) => mutate((d) => {
    const t = d.admin.team.find((x) => x.id === physioId); if (!t) return d; const label = `${cents < 0 ? "Estorno" : "Ajuste"}: ${reason.trim()} (lançado pela administração)`;
    return t.live ? { ...d, payouts: [...d.payouts, { id: uid("po"), apptId: null, kind: cents < 0 ? "estorno" as const : "ajuste" as const, cents, state: "apurado" as const, date: d.anchor, label }] } : patchAdmin(d, { team: d.admin.team.map((x) => (x.id === physioId ? { ...x, buckets: { ...x.buckets, apurado: x.buckets.apurado + cents } } : x)) });
  }),
  /** Devolve uma sessão (estorno) ainda não paga: cria o lançamento negativo, sem apagar o original. */
  voidPayout: (payoutId: string, reason: string) => mutate((d) => {
    const p = d.payouts.find((x) => x.id === payoutId); if (!p || p.kind !== "sessao" || p.state === "pago" || d.payouts.some((x) => x.kind === "estorno" && x.apptId === p.apptId && p.apptId)) return d;
    return { ...d, payouts: [...d.payouts, { id: uid("po"), apptId: p.apptId, kind: "estorno" as const, cents: -p.cents, state: p.state, date: d.anchor, label: `Estorno: ${reason.trim()} (administração)` }] };
  }),
  /** Repasse por sessão do produto: vale para as sessões DAQUI PARA FRENTE (as já lançadas ficam congeladas). */
  setShare: (protocolId: string, shareCents: number) => mutate((d) => patchAdmin(d, { rules: d.admin.rules.map((r) => (r.protocolId === protocolId ? { ...r, shareCents } : r)) })),
  setPrice: (protocolId: string, cents: number) => mutate((d) => ({ ...d, protocols: d.protocols.map((p) => (p.id === protocolId ? { ...p, priceCents: cents } : p)) })),
  setProgram: (id: string, patch: Partial<Demo["admin"]["programs"][number]>) => mutate((d) => patchAdmin(d, { programs: d.admin.programs.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  replyTicket: (id: string, text: string, internal: boolean) => mutate((d) => {
    const t = d.admin.tickets.find((x) => x.id === id); if (!t || !text.trim()) return d; const at = nowAt(d);
    const msgs = !internal && t.patientId ? [...d.messages, { id: uid("ms"), patientId: t.patientId, from: "equipe" as const, text: text.trim(), at }] : d.messages;
    return { ...patchAdmin(d, { tickets: d.admin.tickets.map((x) => (x.id === id ? { ...x, status: internal ? x.status : "respondido" as const, thread: [...x.thread, { from: "equipe" as const, text: text.trim(), at, internal }] } : x)) }), messages: msgs };
  }),
  closeTicket: (id: string) => mutate((d) => patchAdmin(d, { tickets: d.admin.tickets.map((x) => (x.id === id ? { ...x, status: "fechado" as const, closedAt: nowAt(d) } : x)) })),
  /** Reabertura só até 7 dias depois de fechado. */
  reopenTicket: (id: string) => mutate((d) => patchAdmin(d, { tickets: d.admin.tickets.map((x) => (x.id === id && x.closedAt && x.closedAt.slice(0, 10) >= addDays(d.anchor, -7) ? { ...x, status: "aberto" as const, closedAt: undefined } : x)) })),
  setRep: (id: string, status: RepStatus) => mutate((d) => patchAdmin(d, { representations: d.admin.representations.map((r) => (r.id === id ? { ...r, status } : r)) })),
};
export const canReopen = (d: Demo, t: Ticket) => t.status === "fechado" && !!t.closedAt && t.closedAt.slice(0, 10) >= addDays(d.anchor, -7);
export { shareOf, apptsOf };
