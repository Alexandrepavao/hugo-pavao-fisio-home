import { beforeEach, describe, expect, it } from "vitest";
import { act, addDays, earningsOf, getState, resetDemo, setNowOverride } from "./store";
import { adm, canReopen, clinicBuckets, clinicPatients, continuityOf, slaOf, teamOf, ticketsAttention } from "./admin-logic";

beforeEach(() => { resetDemo(); setNowOverride(`${getState().anchor}T12:00`); });

describe("repasses (gestão x fisio)", () => {
  it("o painel da clínica soma os 4 fisios e o Rafael bate com o app dele", () => {
    const e = earningsOf(getState()); const rafael = teamOf(getState()).find((t) => t.live)!;
    expect(rafael.buckets).toEqual({ apurado: e.apurado, liberado: e.liberado, pago: e.pago });
    const total = clinicBuckets(getState()); expect(total.apurado).toBe(e.apurado + 40000 + 60000 + 30000);
  });
  it("autorizar e pagar movem apurado → liberado → pago, e o fisio vê o mesmo", () => {
    const before = earningsOf(getState()); adm.authorize("fi-1");
    expect(earningsOf(getState()).apurado).toBe(0); expect(earningsOf(getState()).liberado).toBe(before.liberado + before.apurado);
    adm.pay("fi-1"); const after = earningsOf(getState()); expect(after.liberado).toBe(0); expect(after.pago).toBe(before.total); expect(after.total).toBe(before.total);
  });
  it("autorizar um fisio de apoio não mexe nos dados do Rafael", () => {
    const e = earningsOf(getState()); adm.authorize("fi-2"); expect(earningsOf(getState())).toMatchObject({ apurado: e.apurado, liberado: e.liberado });
    expect(teamOf(getState()).find((t) => t.id === "fi-2")!.buckets).toEqual({ apurado: 0, liberado: 90000, pago: 90000 });
  });
  it("repasse por produto vale só daqui para frente (sessões já lançadas ficam congeladas)", () => {
    const e0 = earningsOf(getState()); adm.setShare("pr-lombar", 12000);
    expect(earningsOf(getState()).total).toBe(e0.total);                               // nada retroativo
    const a = getState().appts.find((x) => x.status === "scheduled" && x.patientId === "pa-6" && x.at.startsWith(getState().anchor))!;
    act.confirmAttendance(a.id); expect(earningsOf(getState()).apurado - e0.apurado).toBe(12000);
    expect(earningsOf(getState()).uniform).toBe(false);
  });
  it("estorno de sessão não paga cria lançamento negativo, só uma vez, e nunca em sessão já paga", () => {
    const d = getState(); const ap = d.payouts.find((p) => p.kind === "sessao" && p.state === "apurado")!; const paid = d.payouts.find((p) => p.kind === "sessao" && p.state === "pago")!;
    adm.voidPayout(ap.id, "devolução"); adm.voidPayout(ap.id, "devolução"); adm.voidPayout(paid.id, "não pode");
    expect(getState().payouts.filter((p) => p.kind === "estorno" && p.apptId === ap.apptId)).toHaveLength(1); expect(getState().payouts.filter((p) => p.kind === "estorno" && p.apptId === paid.apptId)).toHaveLength(0);
  });
});

describe("chamados (SLA de 24 h)", () => {
  it("clínico conta horas corridas; escalada com 12 h e vencido com 24 h", () => {
    const t = getState().admin.tickets;
    expect(slaOf(t.find((x) => x.id === "tk-1")!).state).toBe("vencido");     // aberto há 51 h
    expect(slaOf(t.find((x) => x.id === "tk-2")!).state).toBe("escalado");    // aberto há 18 h
    expect(slaOf(t.find((x) => x.id === "tk-3")!).state).toBe("no_prazo");    // aberto há 3 h
    expect(ticketsAttention(getState()).map((x) => x.id).sort()).toEqual(["tk-1", "tk-2"]);
  });
  it("administrativo não conta sábado e domingo", () => {
    setNowOverride("2026-11-09T09:00");                                        // segunda 09:00
    const t = { ...getState().admin.tickets[2], openedAt: "2026-11-06T17:00" };  // sexta 17:00 → só 16 h úteis (sex 17–24 = 7 h, seg 0–9 = 9 h)
    expect(slaOf(t).elapsed).toBe(16);
    expect(slaOf({ ...t, kind: "clinico" as const }).elapsed).toBe(64);        // corridas: 64 h
  });
  it("mensagem do paciente vira chamado; resposta volta ao paciente; nota interna não", () => {
    act.sendMessage("pa-1", "Posso trocar o dia da sessão?"); const tk = getState().admin.tickets[0]; expect(tk).toMatchObject({ patientId: "pa-1", status: "aberto", kind: "administrativo" });
    adm.replyTicket(tk.id, "Anotado, nossa equipe retorna hoje.", true); expect(getState().messages.some((m) => m.text.includes("retorna hoje"))).toBe(false); expect(getState().admin.tickets[0].status).toBe("aberto");
    adm.replyTicket(tk.id, "Claro, já trocamos.", false); expect(getState().messages.some((m) => m.text === "Claro, já trocamos." && m.from === "equipe")).toBe(true); expect(getState().admin.tickets[0].status).toBe("respondido");
    expect(slaOf(getState().admin.tickets[0]).state).toBe("ok");
  });
  it("reabertura só até 7 dias depois do fechamento", () => {
    const d = getState(); const recent = d.admin.tickets.find((x) => x.id === "tk-5")!; expect(canReopen(d, recent)).toBe(true);
    expect(canReopen(d, { ...recent, closedAt: `${addDays(d.anchor, -9)}T10:00` })).toBe(false);
    adm.reopenTicket("tk-5"); expect(getState().admin.tickets.find((x) => x.id === "tk-5")!.status).toBe("aberto");
  });
});

describe("clínica", () => {
  it("pacientes vivos + de apoio e continuidade vindos de dados reais da reavaliação", () => {
    expect(clinicPatients(getState())).toHaveLength(14);
    expect(continuityOf(getState()).recommended).toBe(0);
    act.reassess({ patientId: "pa-2", decision: "recomendar", reason: "Falta fortalecer o ombro.", shared: "Veja a recomendação.", recommendedProtocol: "Manutenção mensal" });
    act.interestedIn(getState().recommendations[0].id);
    expect(continuityOf(getState())).toMatchObject({ recommended: 1, interested: 1 });
  });
});
