import { beforeEach, describe, expect, it } from "vitest";
import { act, adherenceOf, balanceOf, cancelConsequence, earningsOf, evolutionPending, feedbackPending, flagsOf, getState, resetDemo, setNowOverride, sharedNotes, timelineOf } from "./store";

const today = () => getState().anchor;
beforeEach(() => { resetDemo(); setNowOverride(`${today()}T12:00`); });

describe("saldo de sessões (Marina)", () => {
  it("separa contratadas, realizadas, descontadas e disponíveis", () => {
    const b = balanceOf(getState(), "pa-1");
    expect(b).toMatchObject({ contracted: 10, done: 5, noShow: 1, late: 1, discounted: 2, available: 3, scheduled: 3 });
  });
  it("cancelar com menos de 24 h mostra o desconto ANTES e desconta; com mais de 24 h não desconta", () => {
    const up = getState().appts.filter((a) => a.patientId === "pa-1" && a.status === "scheduled").sort((x, y) => x.at.localeCompare(y.at));
    expect(cancelConsequence(up[0]).late).toBe(true);     // amanhã 09:00, agora 12:00 de hoje = 21 h
    expect(cancelConsequence(up[1]).late).toBe(false);    // daqui a 4 dias
    act.cancelAppt(up[1].id); expect(balanceOf(getState(), "pa-1").discounted).toBe(2);
    act.cancelAppt(up[0].id); expect(balanceOf(getState(), "pa-1").discounted).toBe(3);
  });
});

describe("ganhos do fisio (regra fictícia: R$ 100 por sessão elegível)", () => {
  it("12 sessões elegíveis × R$ 100 = R$ 1.200; agendado não conta como recebido", () => {
    const e = earningsOf(getState());
    expect(e.eligible).toBe(12); expect(e.eligibleCents).toBe(120000);
    expect(e.pago + e.liberado + e.apurado).toBe(e.total);
    expect(e.estimateCents).toBe(e.estimateCount * 10000);
    expect(e.total).not.toBe(e.total + e.estimateCents);
  });
  it("confirmar um atendimento cria um repasse apurado de R$ 100", () => {
    const before = earningsOf(getState()); const a = getState().appts.find((x) => x.status === "confirmed")!;
    act.confirmAttendance(a.id); const after = earningsOf(getState());
    expect(after.apurado - before.apurado).toBe(10000); expect(after.eligible).toBe(before.eligible + 1);
  });
  it("estorno e ajuste aparecem separados dos repasses por sessão", () => {
    const d = getState(); expect(d.payouts.filter((p) => p.kind === "estorno")[0].cents).toBe(-10000); expect(d.payouts.filter((p) => p.kind === "ajuste")[0].cents).toBe(5000);
  });
});

describe("coerência entre as duas experiências", () => {
  it("evolução pendente vira registrada; a parte compartilhada aparece ao paciente e a interna não", () => {
    expect(evolutionPending(getState(), "pa-1")).toHaveLength(1);
    const ap = evolutionPending(getState(), "pa-1")[0];
    act.saveEvolution({ patientId: "pa-1", apptId: ap.id, shared: "Ótimo avanço hoje.", internal: "Nota interna sigilosa.", values: { "me-flex": 112 } });
    expect(evolutionPending(getState(), "pa-1")).toHaveLength(0);
    const shared = sharedNotes(getState(), "pa-1").map((n) => n.text); expect(shared).toContain("Ótimo avanço hoje."); expect(shared.join(" ")).not.toContain("sigilosa");
    const flex = getState().measures.find((m) => m.id === "me-flex")!; expect(flex.points[flex.points.length - 1].value).toBe(112);
  });
  it("rotina concluída pelo paciente fica visível ao fisio; a resposta volta ao paciente", () => {
    const fb = feedbackPending(getState(), "pa-1"); expect(fb.length).toBe(1);
    act.logExercise({ patientId: "pa-1", routineId: "rt-b", exerciseId: "ex-mob", result: "parcial", difficulty: "cansaço", doubt: "Posso reduzir?", demoViewed: true });
    expect(feedbackPending(getState(), "pa-1").length).toBe(2); expect(flagsOf(getState(), "pa-1").feedback).toBe(2);
    const id = feedbackPending(getState(), "pa-1")[0].id; act.reviewFeedback(id, "Pode reduzir para 2 séries.");
    expect(getState().logs.find((l) => l.id === id)).toMatchObject({ reply: "Pode reduzir para 2 séries." });
  });
  it("adesão é declarada (dias com exercício) e a reavaliação define o próximo passo, sem renovação automática", () => {
    expect(adherenceOf(getState(), "pa-1", 14).pct).toBeGreaterThan(0);
    act.reassess({ patientId: "pa-2", decision: "recomendar", reason: "Ganhos de mobilidade; falta fortalecer.", shared: "Veja a recomendação.", recommendedProtocol: "Fortalecimento do ombro" });
    expect(getState().recommendations).toHaveLength(1); expect(getState().patients.find((p) => p.id === "pa-2")!.phase).toBe("concluido");
    const tl = timelineOf(getState(), "pa-1"); expect(tl.find((e) => e.kind === "conclusao")!.state).toBe("futuro"); expect(tl.find((e) => e.kind === "atendimentos")!.detail).toContain("participação");
  });
});
