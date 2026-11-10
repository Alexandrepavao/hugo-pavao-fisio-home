import { describe, expect, it } from "vitest";
import type { Kpi, KpisResp } from "./mktApi";
import { PRESETS, campaignResult, fmtValue, hasRealSeries, metricValue, objectiveOf, pctChange, pointValue, seriesOf, type OverviewResp } from "./mktMetrics";

const pt = (o: Partial<{ spend: number | null; impressions: number | null; clicks: number | null; leads: number; sales: number; sold: number }> = {}) => ({ day: "2026-11-01", spend: 100, impressions: 1000, clicks: 20, leads: 4, qualified: 0, sales: 1, sold: 400, received: 0, ...o });
const kpi = (key: string, value: number | null, available = true, reason?: string): Kpi => ({ key, label: key, value, unit: "BRL", available, reason: reason ?? null, formula: "f", source: "s", granularity: "g" });
const kp = (cur: Kpi[], prev: Kpi[] = []): KpisResp => ({ period: { from: "a", to: "b" }, previous_period: { from: "c", to: "d" }, view: "event", model: { name: "m", window_days: "30", config_version: "1" }, coverage: { accounts: 1, expected_days: 1, ok_days: 1, failed_days: 0, missing_days: 0, stale_accounts: 0, last_ok_at: null, incomplete: false }, currency: "BRL", other_currencies: {}, kpis: cur, previous_kpis: prev, unlinked_paid_leads: 0 });
const ov = (sales: number, sold: number): OverviewResp => ({ currency: "BRL", view: "event", period: { from: "a", to: "b" }, channels: [], sales_total: sales, sold_total: sold, basis: "" });

describe("cartões por objetivo definido pelo administrador", () => {
  it("padrão de captação traz exatamente os seis indicadores pedidos", () => { expect(PRESETS.capture).toEqual(["spend", "leads", "cpl", "sales", "revenue", "roas"]); });
  it("reconhecimento só quando TODAS as campanhas classificadas são de reconhecimento; vendas idem; misto ou vazio → captação", () => {
    expect(objectiveOf(["awareness", "awareness", null])).toBe("awareness");
    expect(objectiveOf(["sale", "enrollment"])).toBe("sales");
    expect(objectiveOf(["awareness", "lead"])).toBe("capture"); expect(objectiveOf([])).toBe("capture"); expect(objectiveOf([null, undefined])).toBe("capture");
  });
  it("reconhecimento prioriza impressões, CPM e cliques — sem alcance nem frequência (não são coletados)", () => { expect(PRESETS.awareness).toEqual(["spend", "impressions", "cpm", "clicks", "ctr", "cpc"]); });
});

describe("resultado principal e custo por resultado da campanha", () => {
  const base = { spend: 500, impressions: 20000, leads: 10, qualified: 4, events: { sale: 2, eval_done: 5, partner_approved: 1 } };
  it("lead → CPL pelo total", () => { const r = campaignResult({ ...base, primary_result: "lead" }); expect(r.count).toBe(10); expect(r.cost).toBe(50); });
  it("venda e avaliação usam o mapa de eventos; custo = gasto ÷ resultado", () => {
    expect(campaignResult({ ...base, primary_result: "sale" })).toMatchObject({ count: 2, cost: 250 });
    expect(campaignResult({ ...base, primary_result: "evaluation_done" })).toMatchObject({ count: 5, cost: 100 });
  });
  it("reconhecimento: resultado = impressões e custo = CPM (por mil)", () => { expect(campaignResult({ ...base, primary_result: "awareness" })).toMatchObject({ count: 20000, cost: 25 }); });
  it("sem gasto ou sem resultado → custo nulo (sem base), nunca zero", () => {
    expect(campaignResult({ ...base, spend: null, primary_result: "lead" }).cost).toBeNull();
    expect(campaignResult({ ...base, primary_result: "qualified_lead", qualified: 0 }).cost).toBeNull();
    expect(campaignResult({ ...base, primary_result: "enrollment" })).toMatchObject({ count: 0, cost: null });
  });
  it("sem resultado configurado usa leads", () => { expect(campaignResult({ ...base, primary_result: null }).def.label).toBe("Leads"); });
});

describe("séries derivadas: cada ponto recalcula pelos próprios totais", () => {
  it("CPL, ROAS, CPM, CTR e CPC por ponto", () => {
    const p = pt();
    expect(pointValue("cpl", p)).toBe(25); expect(pointValue("roas", p)).toBe(4); expect(pointValue("cpm", p)).toBe(100); expect(pointValue("ctr", p)).toBe(2); expect(pointValue("cpc", p)).toBe(5); expect(pointValue("cps", p)).toBe(100);
  });
  it("denominador zero ou gasto ausente → nulo (a linha quebra, não cai a zero)", () => {
    expect(pointValue("cpl", pt({ leads: 0 }))).toBeNull(); expect(pointValue("roas", pt({ spend: null }))).toBeNull(); expect(pointValue("roas", pt({ spend: 0 }))).toBeNull();
    expect(pointValue("cpm", pt({ impressions: 0 }))).toBeNull(); expect(pointValue("spend", pt({ spend: null }))).toBeNull();
  });
  it("série real: contagens precisam de algum valor > 0; razões, de ao menos 2 pontos com valor", () => {
    expect(hasRealSeries("leads", [pt({ leads: 0 }), pt({ leads: 0 })])).toBe(false); expect(hasRealSeries("leads", [pt({ leads: 0 }), pt({ leads: 3 })])).toBe(true);
    expect(hasRealSeries("cpl", [pt(), pt({ leads: 0 })])).toBe(false); expect(hasRealSeries("cpl", [pt(), pt()])).toBe(true); expect(hasRealSeries("spend", undefined)).toBe(false);
    expect(seriesOf("spend", [pt(), pt({ spend: null })])).toEqual([100, null]);
  });
});

describe("valores totais e variação", () => {
  it("indicadores do banco: indisponível → sem valor e com o motivo", () => {
    const k = kp([kpi("spend", null, false, "Sem coleta"), kpi("cpl", 50)]);
    expect(metricValue("spend", k, undefined)).toMatchObject({ value: null, reason: "Sem coleta" }); expect(metricValue("cpl", k, undefined).value).toBe(50);
  });
  it("vendas e custo por venda vêm da visão por canal e do gasto", () => {
    const k = kp([kpi("spend", 900)], [kpi("spend", 600)]);
    expect(metricValue("sales", k, ov(3, 3000)).value).toBe(3); expect(metricValue("cps", k, ov(3, 3000)).value).toBe(300);
    expect(metricValue("cps", k, ov(0, 0))).toMatchObject({ value: null, reason: "Sem vendas atribuídas no período" });
    expect(metricValue("cps", k, ov(2, 0), true).value).toBe(300);                      // período anterior: gasto anterior ÷ vendas anteriores
    expect(metricValue("cps", kp([kpi("spend", null, false, "Sem coleta")]), ov(3, 0))).toMatchObject({ value: null, reason: "Sem coleta" });
  });
  it("variação só com base real: anterior nulo ou zero não gera percentual", () => {
    expect(pctChange(150, 100)).toBe(50); expect(pctChange(50, 100)).toBe(-50); expect(pctChange(10, 0)).toBeNull(); expect(pctChange(null, 5)).toBeNull(); expect(pctChange(5, null)).toBeNull();
  });
});

describe("formatação compacta dos valores", () => {
  const norm = (s: string) => s.replace(/\u00a0/g, " ");
  it("moeda: centavos só quando pequeno; mil/mi para não estourar o cartão", () => {
    expect(norm(fmtValue("spend", 203.96))).toBe("R$ 203,96"); expect(norm(fmtValue("spend", 4487))).toBe("R$ 4.487"); expect(norm(fmtValue("spend", 123456))).toBe("R$ 123 mil"); expect(norm(fmtValue("spend", 2_500_000))).toBe("R$ 2,5 mi");
  });
  it("razões, percentuais e contagens", () => { expect(fmtValue("roas", 3.5714)).toBe("3,57x"); expect(fmtValue("ctr", 2.1)).toBe("2,1%"); expect(fmtValue("roas", 2)).toBe("2x"); expect(fmtValue("leads", 22)).toBe("22"); expect(fmtValue("impressions", 126000)).toBe("126 mil"); });
  it("sem valor → “Sem base”", () => { expect(fmtValue("cpl", null)).toBe("Sem base"); });
});
