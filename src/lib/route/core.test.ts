import { describe, expect, it } from "vitest";
import { parseLatLng } from "./api";
import { bestFit, legsFromMatrix, MIN, planDay, ptKey, suggestRoute, fmtMinutes, MSG_UNAVAILABLE, type Appt, type LegFn, type Pt } from "./core";

// Todos os dados abaixo são SIMULADOS (nenhum provedor de rotas foi chamado).
const H = 60 * MIN;
const T0 = Date.UTC(2026, 10, 16, 12, 0);               // segunda 16/11/2026 09:00 BRT
const at = (h: number, m = 0) => T0 + (h - 9) * H + m * MIN;
const NOW = Date.UTC(2026, 10, 14, 12, 0);
const P = (lat: number, lng: number, precision: Pt["precision"] = "exact"): Pt => ({ lat, lng, precision });
const CLINIC = P(-23.55, -46.63), A = P(-23.56, -46.65), B = P(-23.6, -46.7), C = P(-23.7, -46.8);
const mk = (id: string, s: number, e: number, pt: Pt | null, over: Partial<Appt> = {}): Appt => ({ id, start: s, end: e, status: "scheduled", mode: "home_visit", fixed: false, pt, label: id, ...over });
/** matriz simulada em minutos entre os pontos */
const matrix = (pairs: [Pt, Pt, number | null][], symmetric = true): LegFn => {
  const m = new Map<string, number | null>();
  for (const [a, b, min] of pairs) { m.set(ptKey(a) + ">" + ptKey(b), min === null ? null : min * 60); if (symmetric) m.set(ptKey(b) + ">" + ptKey(a), min === null ? null : min * 60); }
  return (a, b) => (ptKey(a) === ptKey(b) ? 0 : m.get(ptKey(a) + ">" + ptKey(b)) ?? null);
};

describe("viabilidade", () => {
  it("fim 10:00 + 30 min de deslocamento + 10 min de folga = só pode começar 10:40", () => {
    const legs = matrix([[A, B, 30]]);
    const ok = planDay([mk("a", at(9), at(10), A), mk("b", at(10, 40), at(11, 40), B)], null, legs, 10);
    expect(ok.stops[1].verdict).toBe("tight"); expect(ok.stops[1].slackMs).toBe(0); expect(ok.totals.infeasible).toBe(0);   // exatamente no limite: viável, mas sem margem
    const bad = planDay([mk("a", at(9), at(10), A), mk("b", at(10, 39), at(11, 39), B)], null, legs, 10);
    expect(bad.stops[1].verdict).toBe("infeasible"); expect(bad.stops[1].shortByMs).toBe(MIN); expect(bad.totals.infeasible).toBe(1);
  });
  it("folga mínima não vale entre atendimentos no MESMO lugar (clínica, um atrás do outro)", () => {
    const r = planDay([mk("a", at(9), at(10), CLINIC, { mode: "in_clinic" }), mk("b", at(10), at(11), CLINIC, { mode: "in_clinic" })], null, matrix([]), 10);
    expect(r.stops[1].verdict === "ok" || r.stops[1].verdict === "tight").toBe(true); expect(r.stops[1].legKind).toBe("same"); expect(r.totals.complete).toBe(true);
  });
  it("trecho sem estimativa é DESCONHECIDO (não zero) e o total fica incompleto", () => {
    const r = planDay([mk("a", at(9), at(10), A), mk("b", at(11), at(12), B)], null, matrix([[A, B, null]]), 10);
    expect(r.stops[1].verdict).toBe("unknown"); expect(r.stops[1].legS).toBeNull(); expect(r.totals.unknownLegs).toBe(1); expect(r.totals.complete).toBe(false);
    expect(fmtMinutes(r.stops[1].legS)).toBe(MSG_UNAVAILABLE);
  });
  it("atendimento sem local definido é desconhecido e contamina o trecho seguinte (não inventa)", () => {
    const r = planDay([mk("a", at(9), at(10), null), mk("b", at(11), at(12), B)], null, matrix([[A, B, 20]]), 10);
    expect(r.stops.map((s) => s.verdict)).toEqual(["unknown", "unknown"]);
  });
  it("remoto não gera deslocamento nem exige endereço, e não muda o ponto de origem", () => {
    const legs = matrix([[A, B, 20]]);
    const r = planDay([mk("a", at(9), at(10), A), mk("r", at(10, 10), at(10, 50), null, { mode: "remote" }), mk("b", at(11, 30), at(12, 30), B)], null, legs, 10);
    expect(r.stops[1].verdict).toBe("none"); expect(r.stops[1].legKind).toBe("none"); expect(r.stops[2].verdict).toBe("ok"); expect(r.totals.unknownLegs).toBe(0);
  });
  it("localização por CEP marca o trecho como aproximado", () => {
    const Ac = P(-23.56, -46.65, "cep");
    const r = planDay([mk("a", at(9), at(10), Ac), mk("b", at(12), at(13), B)], null, matrix([[Ac, B, 20]]), 10);
    expect(r.stops[1].approx).toBe(true);
  });
  it("legsFromMatrix: chave ausente é desconhecida; mesmo ponto é zero", () => {
    const l = legsFromMatrix([ptKey(A), ptKey(B)], [[0, 600], [null, 0]]);
    expect(l(A, B)).toBe(600); expect(l(B, A)).toBeNull(); expect(l(A, A)).toBe(0); expect(l(A, C)).toBeNull();
  });
});

describe("rota sugerida (heurística)", () => {
  // CLINIC→A 5min, A→B 10, B→C 10, CLINIC→C 40, CLINIC→B 30, A→C 25: ordem boa = A,B,C; ruim = C,A,B
  const legs = matrix([[CLINIC, A, 5], [A, B, 10], [B, C, 10], [CLINIC, C, 40], [CLINIC, B, 30], [A, C, 25]]);
  const day = () => [mk("c", at(9), at(10), C), mk("a", at(11), at(12), A), mk("b", at(13), at(14), B)];
  it("reordena os flexíveis, mantém a duração e chama de heurística", () => {
    const s = suggestRoute(day(), CLINIC, legs, 10, NOW);
    expect(s.heuristic).toBe(true); expect(s.status).toBe("improved"); expect(s.order).toEqual(["a", "b", "c"]);
    for (const a of s.afterAppts) { const o = day().find((x) => x.id === a.id)!; expect(a.end - a.start).toBe(o.end - o.start); }   // nunca encurta
    expect(s.after!.travelS).toBeLessThan(s.before.travelS); expect(s.after!.infeasible).toBe(0); expect(s.after!.complete).toBe(true);
    expect(s.message).toMatch(/rota sugerida/i); expect(s.message).not.toMatch(/ótima|melhor rota/i);
  });
  it("não move confirmados, fixos, remotos nem passados — e simular não altera a entrada", () => {
    const input = [mk("c", at(9), at(10), C, { status: "confirmed" }), mk("a", at(11), at(12), A), mk("b", at(13), at(14), B)];
    const snap = JSON.stringify(input);
    const s = suggestRoute(input, CLINIC, legs, 10, NOW);
    expect(JSON.stringify(input)).toBe(snap);                                           // sem efeito colateral: simulação não modifica nada
    expect(s.moves.find((m) => m.id === "c")).toBeUndefined();
    const fixed = suggestRoute([mk("c", at(9), at(10), C, { fixed: true }), mk("a", at(11), at(12), A)], CLINIC, legs, 10, NOW);
    expect(fixed.status).toBe("nothing_to_move");
    const past = suggestRoute([mk("a", at(9), at(10), A), mk("b", at(11), at(12), B)], CLINIC, legs, 10, at(10, 30));
    expect(past.status).toBe("nothing_to_move");
  });
  it("mantém os MESMOS horários do dia: só troca quem ocupa cada um (nada é comprimido nem esticado)", () => {
    const input = day(); const s = suggestRoute(input, CLINIC, legs, 10, NOW);
    expect(s.afterAppts.map((a) => a.start).sort()).toEqual(input.map((a) => a.start).sort());
    expect(s.moves.length).toBeGreaterThan(0);
  });
  it("um atendimento mais longo que o horário que receberia invalida a ordem (nunca encurta para caber)", () => {
    const input = [mk("c", at(9), at(10, 30), C), mk("a", at(11), at(11, 30), A), mk("b", at(13), at(13, 30), B)];     // c dura 90 min e só cabe no horário das 9h
    const s = suggestRoute(input, CLINIC, legs, 10, NOW);
    for (const a of s.afterAppts) { const o = input.find((x) => x.id === a.id)!; expect(a.end - a.start).toBe(o.end - o.start); }
    expect(s.afterAppts.find((a) => a.id === "c")!.start).toBe(at(9));
  });
  it("sem estimativa para algum trecho: NÃO sugere (indisponível), nada é inventado", () => {
    const s = suggestRoute(day(), CLINIC, matrix([[CLINIC, A, 5], [A, B, null], [B, C, 10], [CLINIC, C, 40], [CLINIC, B, 30], [A, C, 25]]), 10, NOW);
    expect(s.status).toBe("unavailable"); expect(s.moves).toEqual([]);
  });
  it("já na melhor ordem: sem ganho, sem movimentos", () => {
    const s = suggestRoute([mk("a", at(9), at(10), A), mk("b", at(11), at(12), B), mk("c", at(13), at(14), C)], CLINIC, legs, 10, NOW);
    expect(s.status).toBe("no_gain"); expect(s.moves).toEqual([]);
  });
  it("não estende o dia nem cria sobreposição com fixo", () => {
    const input = [mk("c", at(9), at(10), C), mk("a", at(11), at(12), A), mk("f", at(12, 30), at(13, 30), B, { fixed: true })];
    const s = suggestRoute(input, CLINIC, legs, 10, NOW);
    const sorted = [...s.afterAppts].sort((x, y) => x.start - y.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
    expect(Math.max(...s.afterAppts.map((a) => a.end))).toBeLessThanOrEqual(at(13, 30));
  });
});

describe("melhor encaixe", () => {
  const legs = matrix([[CLINIC, A, 5], [A, B, 10], [A, C, 25], [B, C, 10], [CLINIC, B, 30], [CLINIC, C, 40]]);
  const appts = [mk("a", at(9), at(10), A, { label: "Ana" }), mk("c", at(14), at(15), C, { label: "Carlos" })];
  it("ordena pelo menor acréscimo de deslocamento e explica a razão", () => {
    const r = bestFit(appts, CLINIC, legs, 10, B, H, [at(11), at(12), at(10, 20)]);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((o) => o.reasons.length > 0)).toBe(true);
    expect(r[0].extraS).not.toBeNull();
    for (let i = 1; i < r.length; i++) expect(r[i].extraS ?? Infinity).toBeGreaterThanOrEqual(r[i - 1].extraS ?? Infinity);
    expect(r[0].reasons.join(" ")).toMatch(/Ana/);
  });
  it("não oferece horário sobreposto nem inviável por deslocamento", () => {
    const r = bestFit(appts, CLINIC, legs, 10, B, H, [at(9, 30), at(10, 5), at(13, 30)]);     // 9:30 sobrepõe; 10:05 não cabe (10 min de A→B + 10 de folga); 13:30 não cabe antes das 14:00 (B→C)
    expect(r).toEqual([]);
  });
  it("sem estimativa: fica no fim da lista como 'indisponível', nunca como melhor", () => {
    const r = bestFit(appts, CLINIC, matrix([[CLINIC, A, 5], [A, C, 25], [CLINIC, C, 40]]), 10, B, H, [at(11), at(12)]);
    expect(r.every((o) => o.verdict === "unknown" && o.extraS === null)).toBe(true);
  });
  it("paciente sem local: indisponível; remoto: sem deslocamento", () => {
    expect(bestFit(appts, CLINIC, legs, 10, null, H, [at(11)])[0].verdict).toBe("unknown");
    const rem = bestFit(appts, CLINIC, legs, 10, null, H, [at(11)], true)[0]; expect(rem.extraS).toBe(0); expect(rem.verdict).toBe("ok");
  });
});

describe("coordenadas coladas pelo usuário", () => {
  it("aceita 'lat, lng' com ponto ou vírgula decimal e recusa lixo", () => {
    expect(parseLatLng("-23.5614, -46.6559")).toEqual({ lat: -23.5614, lng: -46.6559 });
    expect(parseLatLng("-23,5614 -46,6559")).toEqual({ lat: -23.5614, lng: -46.6559 });
    expect(parseLatLng("Av. Paulista 1000")).toBeNull(); expect(parseLatLng("")).toBeNull(); expect(parseLatLng("-23.5")).toBeNull();
  });
});
