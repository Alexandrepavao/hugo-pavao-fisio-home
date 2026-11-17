// Núcleo PURO da "Rota de atendimentos" (sem rede, sem banco, sem relógio implícito). Compartilhado entre a tela e a Edge Function `route-planner`
// (a função revalida no servidor com o MESMO código). Tempos em milissegundos desde a época; deslocamentos em segundos.
//
// Regras que este módulo garante (cobertas por src/test/route-core.test.ts):
//  · viabilidade: fim do anterior + deslocamento + folga mínima ≤ início do próximo (a folga só vale entre LOCAIS DIFERENTES);
//  · trecho sem estimativa é DESCONHECIDO, nunca zero, e impede dizer que o dia está "completo";
//  · atendimento remoto não gera deslocamento; confirmado/fixo/passado nunca é movido; nenhum atendimento é encurtado;
//  · a sugestão é uma HEURÍSTICA (vizinho mais próximo + 2-opt) — chamada sempre de "rota sugerida", nunca de "ótima";
//  · nenhuma distância em linha reta é usada como trajeto.

export type Mode = "in_clinic" | "home_visit" | "remote";
export type Precision = "exact" | "street" | "cep";
export interface Pt { lat: number; lng: number; precision?: Precision | null }
export interface Appt { id: string; start: number; end: number; status: string; mode: Mode; fixed: boolean; pt: Pt | null; label?: string }
/** Segundos de deslocamento de a até b; null = sem estimativa (NUNCA 0). */
export type LegFn = (a: Pt, b: Pt) => number | null;

export const MIN = 60_000;
export const TIGHT_MS = 5 * MIN;
/** Chave estável do ponto (3 casas ≈ 110 m): é a mesma usada no cache e no que se envia ao provedor. */
export const ptKey = (p: Pt) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
export const samePlace = (a: Pt, b: Pt) => ptKey(a) === ptKey(b);

/** Monta a função de trechos a partir de uma matriz de duração (segundos; null = sem estimativa) indexada por `keys`. */
export function legsFromMatrix(keys: string[], dur: (number | null)[][]): LegFn {
  const idx = new Map(keys.map((k, i) => [k, i]));
  return (a, b) => {
    if (samePlace(a, b)) return 0;                       // mesmo lugar (ex.: dois atendimentos na mesma unidade): zero é VERDADE aqui
    const i = idx.get(ptKey(a)), j = idx.get(ptKey(b));
    if (i === undefined || j === undefined) return null;
    const v = dur[i]?.[j];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
}

export type Verdict = "ok" | "tight" | "infeasible" | "unknown" | "none";
export interface Stop {
  appt: Appt;
  legS: number | null;                // deslocamento até este atendimento (null = sem estimativa ou sem deslocamento)
  legKind: "leg" | "same" | "none" | "unknown";
  slackMs: number | null;             // folga sobre o necessário (null quando não há atendimento anterior a respeitar ou não dá para calcular)
  shortByMs: number;                  // quanto falta quando inviável
  verdict: Verdict;
  approx: boolean;                    // algum ponto é localização por CEP (aproximada)
}
export interface Totals {
  stops: number; travelS: number; knownLegs: number; unknownLegs: number; infeasible: number; tight: number; minSlackMs: number | null;
  /** true só se TODO trecho necessário tem estimativa: totais parciais jamais são apresentados como completos. */
  complete: boolean;
  /** Sem ponto de partida (opcional) o trajeto até o 1º atendimento não existe nos totais; a tela avisa. */
  startMissing: boolean;
}

export function planDay(appts: Appt[], start: Pt | null, legs: LegFn, bufferMin: number): { stops: Stop[]; totals: Totals } {
  const list = [...appts].sort((a, b) => a.start - b.start);
  const buf = bufferMin * MIN;
  let loc: Pt | null = start, locKnown = true, prevEnd: number | null = null;
  const stops: Stop[] = [];
  const t: Totals = { stops: list.length, travelS: 0, knownLegs: 0, unknownLegs: 0, infeasible: 0, tight: 0, minSlackMs: null, complete: true, startMissing: false };
  for (const a of list) {
    if (a.mode === "remote") {                              // remoto: sem deslocamento e sem endereço; ocupa tempo, não muda onde a pessoa está
      stops.push({ appt: a, legS: null, legKind: "none", slackMs: null, shortByMs: 0, verdict: "none", approx: false });
      prevEnd = Math.max(prevEnd ?? 0, a.end); continue;
    }
    const approx = a.pt?.precision === "cep" || loc?.precision === "cep";
    let legS: number | null = null, kind: Stop["legKind"] = "unknown", slack: number | null = null, verdict: Verdict = "unknown", short = 0;
    if (prevEnd === null && !start) {                       // sem partida definida e primeiro do dia: não há trajeto de saída a estimar (não é "desconhecido")
      if (a.pt) { t.startMissing = true; kind = "none"; verdict = "ok"; }
    } else if (a.pt && locKnown && loc) {
      const l = legs(loc, a.pt);
      if (l !== null) {
        const same = samePlace(loc, a.pt);
        legS = l; kind = same ? "same" : "leg";
        t.travelS += l; t.knownLegs++;
        if (prevEnd === null) verdict = "ok";                // primeiro do dia: o profissional sai quando precisar
        else {
          slack = a.start - prevEnd - l * 1000 - (same ? 0 : buf);
          verdict = slack < 0 ? "infeasible" : slack < TIGHT_MS ? "tight" : "ok";
          if (slack < 0) short = -slack;
          t.minSlackMs = t.minSlackMs === null ? slack : Math.min(t.minSlackMs, slack);
        }
      }
    }
    if (verdict === "unknown") t.unknownLegs++;
    if (verdict === "infeasible") t.infeasible++;
    if (verdict === "tight") t.tight++;
    stops.push({ appt: a, legS, legKind: kind, slackMs: slack, shortByMs: short, verdict, approx });
    loc = a.pt; locKnown = a.pt !== null; prevEnd = Math.max(prevEnd ?? 0, a.end);
  }
  t.complete = t.unknownLegs === 0;
  return { stops, totals: t };
}

// ---------------------------------------------------------------------------------------------------- rota sugerida (heurística)
export interface Move { id: string; from: number; to: number }
export interface Suggestion {
  heuristic: true;                     // sempre: é "rota sugerida", não "ótima"
  status: "improved" | "no_gain" | "nothing_to_move" | "unavailable" | "too_many";
  message: string;
  order: string[];                     // ids dos atendimentos flexíveis na ordem sugerida
  moves: Move[];                       // só quem muda de horário
  before: Totals; after: Totals | null;
  afterAppts: Appt[];                  // agenda do dia como ficaria (não grava nada)
}

export const isFlexible = (a: Appt, now: number) => a.status === "scheduled" && !a.fixed && a.mode !== "remote" && a.pt !== null && a.start > now;

/** Reatribui os atendimentos flexíveis aos HORÁRIOS (slots) que os flexíveis já ocupam, na ordem sugerida: o desenho do dia não muda, só quem ocupa cada horário.
 *  Nunca encurta (a duração de cada atendimento é a original) e uma ordem em que algum atendimento não caiba no horário recebido é inválida (null). */
function assign(order: Appt[], slots: { start: number; end: number }[], fixed: Appt[]): Appt[] | null {
  const out: Appt[] = [...fixed];
  for (let i = 0; i < order.length; i++) {
    const dur = order[i].end - order[i].start;
    if (dur > slots[i].end - slots[i].start) return null;
    out.push({ ...order[i], start: slots[i].start, end: slots[i].start + dur });
  }
  return out;
}

const score = (totals: Totals) => totals.infeasible * 1e7 + totals.unknownLegs * 1e6 + totals.travelS;

export function suggestRoute(appts: Appt[], start: Pt | null, legs: LegFn, bufferMin: number, now: number): Suggestion {
  const list = [...appts].sort((a, b) => a.start - b.start);
  const before = planDay(list, start, legs, bufferMin).totals;
  const base = { heuristic: true as const, order: [] as string[], moves: [] as Move[], before, after: null as Totals | null, afterAppts: list };
  const flex = list.filter((a) => isFlexible(a, now)), fixed = list.filter((a) => !isFlexible(a, now));
  if (flex.length < 2) return { ...base, status: "nothing_to_move", message: "Há menos de dois atendimentos que podem mudar de horário (os confirmados, fixos, remotos e passados não são movidos)." };
  if (flex.length > 12) return { ...base, status: "too_many", message: "Atendimentos demais para sugerir uma rota (máximo 12 flexíveis). Marque alguns como fixos." };
  // Precisa de estimativa para todos os trechos entre os flexíveis (e a partir da partida). Sem isso NÃO se sugere nada.
  const pts = flex.map((f) => f.pt as Pt);
  const lg = (a: Pt, b: Pt) => legs(a, b);
  for (const a of pts) { if (start && lg(start, a) === null) return { ...base, status: "unavailable", message: "Estimativa indisponível para parte dos trechos: não é possível sugerir uma rota." }; for (const b of pts) if (lg(a, b) === null) return { ...base, status: "unavailable", message: "Estimativa indisponível para parte dos trechos: não é possível sugerir uma rota." }; }
  const slots = flex.map((f) => ({ start: f.start, end: f.end }));
  const evalOrder = (ord: Appt[]) => { const placed = assign(ord, slots, fixed); if (!placed) return { placed: list, totals: before, s: 1e12 }; const p = planDay(placed, start, legs, bufferMin); return { placed, totals: p.totals, s: score(p.totals) }; };
  const current = evalOrder(flex);
  // vizinho mais próximo a partir da partida (ou do primeiro atual, se não há partida)
  const pool = [...flex]; const nn: Appt[] = []; let cur: Pt | null = start ?? flex[0].pt;
  while (pool.length) { let bi = 0, bv = Infinity; pool.forEach((p, i) => { const v = cur ? lg(cur, p.pt as Pt) ?? Infinity : 0; if (v < bv) { bv = v; bi = i; } }); const [pick] = pool.splice(bi, 1); nn.push(pick); cur = pick.pt; }
  let best = { ord: nn, ...evalOrder(nn) };
  // 2-opt: inverte trechos da sequência enquanto melhora
  let improved = true, guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.ord.length - 1; i++) for (let j = i + 1; j < best.ord.length; j++) {
      const cand = [...best.ord.slice(0, i), ...best.ord.slice(i, j + 1).reverse(), ...best.ord.slice(j + 1)];
      const e = evalOrder(cand); if (e.s < best.s - 1) { best = { ord: cand, ...e }; improved = true; }
    }
  }
  const gainS = current.totals.travelS - best.totals.travelS;
  const fixesInfeasible = best.totals.infeasible < current.totals.infeasible;
  const sameOrder = best.ord.every((a, i) => a.id === flex[i].id);
  if (best.s >= current.s - 1 || sameOrder || (gainS < 300 && !fixesInfeasible)) {
    return { ...base, status: "no_gain", message: "A ordem atual já é a melhor que a rota sugerida encontrou: sem ganho relevante de deslocamento.", order: flex.map((f) => f.id), after: current.totals, afterAppts: current.placed };
  }
  const byId = new Map(list.map((a) => [a.id, a]));
  const moves = best.placed.filter((a) => isFlexible(byId.get(a.id)!, now) && a.start !== byId.get(a.id)!.start).map((a) => ({ id: a.id, from: byId.get(a.id)!.start, to: a.start }));
  return { heuristic: true, status: "improved", order: best.ord.map((a) => a.id), moves, before, after: best.totals, afterAppts: best.placed,
    message: fixesInfeasible && gainS < 300 ? "A rota sugerida elimina trechos inviáveis." : `A rota sugerida reduz cerca de ${Math.round(gainS / 60)} min de deslocamento estimado.` };
}

// ---------------------------------------------------------------------------------------------------- melhor encaixe
export interface FitOption {
  start: number; end: number;
  verdict: "ok" | "tight" | "unknown";            // inviáveis não são oferecidas
  extraS: number | null;                          // acréscimo de deslocamento para o profissional (null = sem estimativa)
  prevLabel?: string; nextLabel?: string;
  reasons: string[];
}

export function bestFit(appts: Appt[], start: Pt | null, legs: LegFn, bufferMin: number, newPt: Pt | null, durMs: number, candidates: number[], remote = false): FitOption[] {
  const buf = bufferMin * MIN; const list = [...appts].filter((a) => !["cancelled_by_patient", "cancelled_by_clinic", "rescheduled"].includes(a.status)).sort((a, b) => a.start - b.start);
  const out: FitOption[] = [];
  const fmt = (ms: number) => `${Math.round(ms / MIN)} min`;
  for (const s of [...new Set(candidates)].sort((a, b) => a - b)) {
    const e = s + durMs;
    if (list.some((a) => a.start < e && a.end > s)) continue;                                   // sobreposição: o horário nem é livre
    const prevAny = [...list].reverse().find((a) => a.end <= s), nextAny = list.find((a) => a.start >= e);
    const reasons: string[] = [];
    if (remote || !newPt) { out.push({ start: s, end: e, verdict: remote ? "ok" : "unknown", extraS: remote ? 0 : null, prevLabel: prevAny?.label, nextLabel: nextAny?.label, reasons: [remote ? "Atendimento remoto: sem deslocamento." : "Local do paciente não definido: estimativa indisponível."] }); continue; }
    const prevLoc = [...list].reverse().find((a) => a.end <= s && a.mode !== "remote" && a.pt)?.pt ?? start;
    const nextLoc = list.find((a) => a.start >= e && a.mode !== "remote" && a.pt);
    const nextTimed = nextAny && nextAny.mode !== "remote" ? nextAny : undefined;
    const a = prevLoc ? legs(prevLoc, newPt) : null;
    const b = nextLoc?.pt ? legs(newPt, nextLoc.pt) : 0;
    const base = prevLoc && nextLoc?.pt ? legs(prevLoc, nextLoc.pt) : 0;
    if (a === null || b === null || base === null || (!prevLoc)) { out.push({ start: s, end: e, verdict: "unknown", extraS: null, prevLabel: prevAny?.label, nextLabel: nextAny?.label, reasons: ["Estimativa indisponível para este horário."] }); continue; }
    const needA = prevAny && prevLoc ? a * 1000 + (samePlace(prevLoc, newPt) ? 0 : buf) : 0;
    const slackBefore = prevAny && prevAny.mode !== "remote" ? s - prevAny.end - needA : prevAny ? s - prevAny.end : null;
    const slackAfter = nextTimed && nextTimed.pt ? nextTimed.start - e - (b * 1000 + (samePlace(newPt, nextTimed.pt) ? 0 : buf)) : null;
    if ((slackBefore !== null && slackBefore < 0) || (slackAfter !== null && slackAfter < 0)) continue;   // inviável: não é oferecida
    const extra = a + b - base;
    reasons.push(extra <= 0 ? "Não acrescenta deslocamento ao dia." : `Acrescenta ${fmt(extra * 1000)} de deslocamento estimado.`);
    if (prevAny) reasons.push(`Depois de ${prevAny.label ?? "atendimento anterior"}${slackBefore !== null ? `, com folga de ${fmt(slackBefore)}` : ""}.`);
    if (nextAny) reasons.push(`Antes de ${nextAny.label ?? "próximo atendimento"}${slackAfter !== null ? `, com folga de ${fmt(slackAfter)}` : ""}.`);
    const tight = (slackBefore !== null && slackBefore < TIGHT_MS) || (slackAfter !== null && slackAfter < TIGHT_MS);
    out.push({ start: s, end: e, verdict: tight ? "tight" : "ok", extraS: extra, prevLabel: prevAny?.label, nextLabel: nextAny?.label, reasons });
  }
  const rank = (o: FitOption) => (o.verdict === "unknown" ? 2 : o.verdict === "tight" ? 1 : 0);
  return out.sort((x, y) => rank(x) - rank(y) || (x.extraS ?? Infinity) - (y.extraS ?? Infinity) || x.start - y.start);
}

// ---------------------------------------------------------------------------------------------------- texto
export const MSG_NO_TRAFFIC = "Tempo estimado sem trânsito em tempo real.";
export const MSG_UNAVAILABLE = "Estimativa indisponível";
export const fmtMinutes = (s: number | null) => (s === null ? MSG_UNAVAILABLE : s < 30 ? "0 min" : `${Math.max(1, Math.round(s / 60))} min`);
