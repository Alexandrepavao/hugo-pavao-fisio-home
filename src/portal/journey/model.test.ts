import { describe, expect, it } from "vitest";
import { apptKind, mergePain, nextAction, painSummary, sessionsSummary, stageStates, weekDays, type JourneyModel } from "./model";
import { buildDemoModel, SCENARIOS, TOUR } from "./demo/scenarios";

const base = (over: Partial<JourneyModel> = {}): JourneyModel => ({
  mode: "live", firstName: "Ana", goal: null, specialtyLabel: null, stages: null, currentStage: null, nextAppointment: null, appointments: [], pain: [], functional: [], training: null, workLogs: [], videos: [], offers: [],
  sessions: { planned: null, attended: null, noShow: 0, lateCancel: 0, balance: null, maintenance: false, planStatus: null }, education: [], decision: null, decisionMessage: null, checkinDue: false, needsBirthDate: false, hasData: false, ...over,
});
const NOW = new Date("2026-11-14T15:00:00Z");   // sábado, 12h em São Paulo

describe("dor: um registro não gera tendência", () => {
  it("sem registro: sem número; um registro: sem variação; dois ou mais: variação", () => {
    expect(painSummary([])).toMatchObject({ count: 0, first: null, last: null, delta: null, trend: false });
    expect(painSummary([{ at: "2026-11-01T10:00:00Z", value: 8, by: "professional" }])).toMatchObject({ count: 1, first: 8, last: 8, delta: null, trend: false });
    expect(painSummary([{ at: "2026-11-10T10:00:00Z", value: 4, by: "patient" }, { at: "2026-11-01T10:00:00Z", value: 8, by: "professional" }])).toMatchObject({ count: 2, first: 8, last: 4, delta: -4, trend: true });
  });
  it("junta fontes sem contar o mesmo registro duas vezes (mesmo valor com menos de 2 minutos)", () => {
    const a = [{ at: "2026-11-01T10:00:00Z", value: 7, by: "patient" as const }]; const b = [{ at: "2026-11-01T10:01:00Z", value: 7, by: "patient" as const }, { at: "2026-11-01T10:01:00Z", value: 5, by: "patient" as const }];
    expect(mergePain(a, b)).toHaveLength(2);
  });
});

describe("próxima ação: só a partir do que o profissional registrou", () => {
  it("prioridade: check-in > treino de hoje > confirmar > reavaliação > consulta > início (o cadastro tem o próprio passo, fora daqui)", () => {
    expect(nextAction(base({ needsBirthDate: true, checkinDue: true }), NOW).kind).toBe("checkin");
    expect(nextAction(base({ checkinDue: true }), NOW).kind).toBe("checkin");
    const tr = { title: "R", weeklyTarget: 3, workoutToday: "A", items: [], todayDone: 1, todayTotal: 3, streak: 0, weekDays: 0 };
    expect(nextAction(base({ training: tr }), NOW)).toMatchObject({ kind: "treino", tab: "exercicios" });
    const soon = { id: "a", starts_at: "2026-11-15T15:00:00Z", status: "scheduled", service: "Fisio", professional: "Dr. Hugo", canConfirm: true, confirmed: false };
    expect(nextAction(base({ nextAppointment: soon }), NOW).kind).toBe("confirmar");
    expect(nextAction(base({ nextAppointment: { ...soon, canConfirm: false }, decision: "continuidade" }), NOW).kind).toBe("reavaliacao");
    expect(nextAction(base({ nextAppointment: { ...soon, canConfirm: false, starts_at: "2026-12-30T15:00:00Z" } }), NOW).kind).toBe("consulta");
    expect(nextAction(base(), NOW).kind).toBe("inicio");
    expect(nextAction(base({ hasData: true }), NOW).kind).toBe("seguir");
  });
  it("treino já concluído hoje não volta a ser a próxima ação", () => {
    const tr = { title: "R", weeklyTarget: 3, workoutToday: "A", items: [], todayDone: 3, todayTotal: 3, streak: 1, weekDays: 1 };
    expect(nextAction(base({ training: tr, hasData: true }), NOW).kind).toBe("seguir");
  });
});

describe("jornada: etapas definidas pelo profissional, nada avança por sessões", () => {
  it("sem etapas definidas não há etapa; com etapas, a atual é a registrada", () => {
    expect(stageStates({ stages: null, currentStage: null })).toEqual([]);
    expect(stageStates({ stages: ["A1", "B2", "C3"], currentStage: 1 }).map((s) => s.state)).toEqual(["concluida", "atual", "pendente"]);
    expect(stageStates({ stages: ["A1", "B2", "C3"], currentStage: null }).every((s) => s.state === "pendente")).toBe(true);
  });
  it("mudar o número de sessões realizadas não muda a etapa (a função só lê a etapa registrada)", () => {
    const m1 = base({ stages: ["A1", "B2", "C3"], currentStage: 0, sessions: { planned: 10, attended: 1, noShow: 0, lateCancel: 0, balance: 9, maintenance: false, planStatus: "active" } });
    const m2 = { ...m1, sessions: { ...m1.sessions, attended: 10 } };
    expect(stageStates(m1)).toEqual(stageStates(m2));
  });
});

describe("sessões e pacote são quatro coisas separadas, sem percentual de recuperação", () => {
  it("plano, realizadas, consumidas sem atendimento e saldo", () => {
    const s = sessionsSummary({ planned: 10, attended: 4, noShow: 1, lateCancel: 2, balance: 5, maintenance: false, planStatus: "active" });
    expect(s).toMatchObject({ done: 4, consumed: 3, balance: 5 }); expect(JSON.stringify(s)).not.toMatch(/%|recuper/i);
    expect(sessionsSummary({ planned: null, attended: null, noShow: 0, lateCancel: 0, balance: null, maintenance: false, planStatus: null })).toMatchObject({ plan: "Plano de sessões ainda não definido", done: null, balance: null });
  });
});

describe("semana: agendado, realizado, cancelado e treino informado são distintos", () => {
  it("monta segunda a domingo no fuso de São Paulo e separa consulta de treino informado", () => {
    const w = weekDays({
      appointments: [{ id: "1", starts_at: "2026-11-10T17:00:00Z", status: "attended", service: "F", professional: "P" }, { id: "2", starts_at: "2026-11-12T17:00:00Z", status: "scheduled", service: "F", professional: "P" }, { id: "3", starts_at: "2026-11-13T17:00:00Z", status: "cancelled_by_patient", service: "F", professional: "P" }],
      workLogs: [{ date: "2026-11-11", skipped: false }, { date: "2026-11-13", skipped: true }],
    }, NOW);
    expect(w.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w[5].isToday).toBe(true); expect(w[1].appts.map((a) => apptKind(a.status))).toEqual(["realizado"]); expect(w[3].appts.map((a) => apptKind(a.status))).toEqual(["agendado"]); expect(w[4].appts.map((a) => apptKind(a.status))).toEqual(["cancelado"]);
    expect(w[2].trained).toBe(true); expect(w[4].trained).toBe(false); expect(w[4].skipped).toBe(true);
  });
});

describe("demonstração: exemplos ilustrativos e coerentes", () => {
  it("cada exemplo é do modo demo, com escalas 0 a 10, sem repetir registro e sem percentual de recuperação", () => {
    for (const sc of SCENARIOS) {
      const m = buildDemoModel(sc.key, {}, NOW); expect(m.mode).toBe("demo");
      expect(m.pain.every((p) => p.value >= 0 && p.value <= 10)).toBe(true); expect(m.functional.every((f) => f.first >= 0 && f.last <= 10)).toBe(true);
      expect(new Set(m.pain.map((p) => p.at)).size).toBe(m.pain.length); expect(m.stages?.length).toBe(5); expect(JSON.stringify(m)).not.toMatch(/recuperado|% de recupera/i);
      expect((m.sessions.attended ?? 0) <= (m.sessions.planned ?? 0)).toBe(true);
    }
  });
  it("personaliza só nome e objetivo; o início tem um único registro de dor (sem tendência) e o acompanhamento tem vários", () => {
    expect(buildDemoModel("inicio", { firstName: "Marta", goal: "Subir escadas sem dor" }, NOW)).toMatchObject({ firstName: "Marta", goal: { title: "Subir escadas sem dor" } });
    expect(painSummary(buildDemoModel("inicio", {}, NOW).pain).trend).toBe(false); expect(painSummary(buildDemoModel("acompanhamento", {}, NOW).pain).trend).toBe(true);
  });
  it("o tour tem passos com aba e alvo, e cada aba existe", () => {
    expect(TOUR.length).toBeGreaterThanOrEqual(6); for (const s of TOUR) { expect(["inicio", "evolucao", "exercicios", "agenda", "mais"]).toContain(s.tab); expect(s.target).toMatch(/^jr-/); expect(s.title.length).toBeGreaterThan(3); }
  });
});
