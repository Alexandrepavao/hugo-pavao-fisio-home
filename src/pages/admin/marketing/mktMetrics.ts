// Lógica pura do dashboard do Marketing: catálogo de métricas (fórmula e fonte), cartões por objetivo, séries derivadas e formatação.
// Nada aqui inventa número: sem base (gasto ausente, denominador zero) devolve null e a tela escreve "Sem base".
import type { Kpi, KpisResp, SeriesResp } from "./mktApi";

export type MetricKey = "spend" | "leads" | "cpl" | "sales" | "revenue" | "roas" | "impressions" | "cpm" | "clicks" | "ctr" | "cpc" | "cps";
export type MetricUnit = "money" | "count" | "ratio" | "pct";
export interface MetricDef { key: MetricKey; label: string; short: string; unit: MetricUnit; info: string; kpi?: string; detail?: string }

export const METRICS: Record<MetricKey, MetricDef> = {
  spend: { key: "spend", label: "Investimento", short: "Investimento", unit: "money", kpi: "spend", detail: "spend", info: "Gasto efetivo das campanhas no período (campanha × dia), vindo das plataformas ou lançado manualmente. Dias sem coleta não entram como zero." },
  leads: { key: "leads", label: "Leads únicos", short: "Leads", unit: "count", kpi: "leads", detail: "lead", info: "Pessoas distintas, registradas no HP (formulários e quizzes), com oportunidade atribuída a campanhas pagas. Não é o “resultado” que a plataforma reporta." },
  cpl: { key: "cpl", label: "Custo por lead", short: "CPL", unit: "money", kpi: "cpl", detail: "lead", info: "Investimento ÷ leads únicos do HP, pelos totais do período. Sem gasto coletado ou sem leads: sem base." },
  sales: { key: "sales", label: "Vendas atribuídas", short: "Vendas", unit: "count", detail: "sale", info: "Vendas confirmadas no Financeiro do HP e atribuídas a campanhas (cada venda uma vez). Não é conversão reportada pela plataforma." },
  revenue: { key: "revenue", label: "Receita atribuída", short: "Receita", unit: "money", kpi: "sold", detail: "sale", info: "Valor das vendas confirmadas atribuídas a campanhas (receita vendida). Não é o valor recebido: o recebido, líquido de estornos, está no detalhamento do Financeiro." },
  roas: { key: "roas", label: "ROAS", short: "ROAS", unit: "ratio", kpi: "roas_sales", detail: "sale", info: "Receita atribuída ÷ investimento (retorno bruto sobre a mídia, antes de custos, repasses e impostos). Sem gasto: sem base." },
  impressions: { key: "impressions", label: "Impressões", short: "Impressões", unit: "count", kpi: "impressions", detail: "impressions", info: "Exibições dos anúncios informadas pela plataforma. Alcance único não é somado entre campanhas (não há deduplicação de audiência)." },
  cpm: { key: "cpm", label: "CPM", short: "CPM", unit: "money", kpi: "cpm", info: "Custo por mil impressões = investimento ÷ impressões × 1.000, pelos totais." },
  clicks: { key: "clicks", label: "Cliques no link", short: "Cliques", unit: "count", kpi: "clicks", detail: "clicks", info: "Cliques no link informados pela plataforma (Meta: cliques no link · Google: cliques)." },
  ctr: { key: "ctr", label: "CTR", short: "CTR", unit: "pct", kpi: "ctr", info: "Cliques no link ÷ impressões, recalculado pelos totais (não é a média das taxas das campanhas)." },
  cpc: { key: "cpc", label: "CPC", short: "CPC", unit: "money", kpi: "cpc", info: "Investimento ÷ cliques no link, pelos totais." },
  cps: { key: "cps", label: "Custo por venda", short: "Custo/venda", unit: "money", info: "Investimento ÷ vendas atribuídas. É custo de mídia por venda, não o CAC completo (sem equipe, repasses ou impostos)." },
};

// ---------------------------------------------------------------- objetivo → cartões
export type Objective = "capture" | "sales" | "awareness";
export const OBJECTIVE_LABEL: Record<Objective, string> = { capture: "Captação de leads", sales: "Vendas", awareness: "Reconhecimento" };
export const PRESETS: Record<Objective, MetricKey[]> = {
  capture: ["spend", "leads", "cpl", "sales", "revenue", "roas"],
  sales: ["spend", "sales", "revenue", "roas", "cps", "leads"],
  awareness: ["spend", "impressions", "cpm", "clicks", "ctr", "cpc"],
};
/** Objetivo dos cartões a partir do resultado principal que o ADMINISTRADOR configurou nas campanhas do escopo (não do objetivo original da plataforma).
 *  Só muda o conjunto quando todas as campanhas classificadas têm o mesmo tipo; escopo misto usa o padrão de captação. */
export const objectiveOf = (primaryResults: (string | null | undefined)[]): Objective => {
  const kinds = [...new Set(primaryResults.filter((x): x is string => !!x))];
  if (kinds.length === 1 && kinds[0] === "awareness") return "awareness";
  if (kinds.length > 0 && kinds.every((k) => k === "sale" || k === "enrollment")) return "sales";
  return "capture";
};

// ---------------------------------------------------------------- resultado principal de uma campanha
export interface ResultDef { label: string; short: string; unitLabel: string; field: "leads" | "qualified" | "impressions" | "event"; kind?: string; cost: "cpl" | "cpm" | "cost" }
const RESULTS: Record<string, ResultDef> = {
  lead: { label: "Leads", short: "Leads", unitLabel: "lead", field: "leads", cost: "cpl" },
  qualified_lead: { label: "Leads qualificados", short: "Qualificados", unitLabel: "lead qualificado", field: "qualified", cost: "cost" },
  opportunity: { label: "Oportunidades", short: "Oportunidades", unitLabel: "oportunidade", field: "event", kind: "opportunity", cost: "cost" },
  scheduled: { label: "Agendamentos", short: "Agendamentos", unitLabel: "agendamento", field: "event", kind: "scheduled", cost: "cost" },
  evaluation_done: { label: "Avaliações realizadas", short: "Avaliações", unitLabel: "avaliação", field: "event", kind: "eval_done", cost: "cost" },
  attended: { label: "Comparecimentos", short: "Compareceram", unitLabel: "comparecimento", field: "event", kind: "attended", cost: "cost" },
  partner_approved: { label: "Parceiros aprovados", short: "Parceiros", unitLabel: "parceiro aprovado", field: "event", kind: "partner_approved", cost: "cost" },
  partner_active: { label: "Parceiros ativos", short: "Parceiros ativos", unitLabel: "parceiro ativo", field: "event", kind: "partner_active", cost: "cost" },
  enrollment: { label: "Matrículas", short: "Matrículas", unitLabel: "matrícula", field: "event", kind: "enrollment", cost: "cost" },
  sale: { label: "Vendas", short: "Vendas", unitLabel: "venda", field: "event", kind: "sale", cost: "cost" },
  awareness: { label: "Impressões", short: "Impressões", unitLabel: "mil impressões", field: "impressions", cost: "cpm" },
};
export const resultDef = (primary: string | null | undefined): ResultDef => RESULTS[primary ?? ""] ?? RESULTS.lead;

export interface CampaignLike { primary_result: string | null; spend: number | null; impressions: number | null; leads: number; qualified: number; events?: Record<string, number> }
/** Resultado principal e custo por resultado de uma campanha. count/cost nulos = sem base (nunca zero inventado). */
export const campaignResult = (c: CampaignLike): { def: ResultDef; count: number | null; cost: number | null } => {
  const def = resultDef(c.primary_result);
  const count = def.field === "leads" ? c.leads : def.field === "qualified" ? c.qualified : def.field === "impressions" ? c.impressions : (c.events?.[def.kind ?? ""] ?? 0);
  let cost: number | null = null;
  if (c.spend != null && c.spend > 0 && count != null && count > 0) cost = def.cost === "cpm" ? (c.spend / count) * 1000 : c.spend / count;
  return { def, count, cost };
};

// ---------------------------------------------------------------- séries derivadas (cada ponto recalcula pelos próprios totais)
type Pt = SeriesResp["points"][number];
const div = (a: number | null | undefined, b: number | null | undefined, k = 1): number | null => (a == null || b == null || b <= 0 ? null : (a / b) * k);
export const pointValue = (m: MetricKey, p: Pt): number | null => {
  switch (m) {
    case "spend": return p.spend ?? null;
    case "leads": return p.leads;
    case "sales": return p.sales;
    case "revenue": return p.sold ?? null;
    case "impressions": return p.impressions ?? null;
    case "clicks": return p.clicks ?? null;
    case "cpl": return div(p.spend, p.leads);
    case "cps": return div(p.spend, p.sales);
    case "roas": return p.spend != null && p.spend > 0 ? (p.sold ?? 0) / p.spend : null;
    case "cpm": return div(p.spend, p.impressions, 1000);
    case "ctr": return div(p.clicks, p.impressions, 100);
    case "cpc": return div(p.spend, p.clicks);
  }
};
/** Série para o gráfico: null = sem base naquele dia (a linha quebra, não cai a zero). */
export const seriesOf = (m: MetricKey, pts: Pt[] | undefined): (number | null)[] => (pts ?? []).map((p) => pointValue(m, p));
/** Há base real? Pelo menos 2 pontos com valor (contagens: ao menos um valor > 0). */
export const hasRealSeries = (m: MetricKey, pts: Pt[] | undefined): boolean => {
  const v = seriesOf(m, pts).filter((x): x is number => x != null);
  const isCount = METRICS[m].unit === "count";
  return isCount ? v.some((x) => x > 0) : v.length >= 2;
};

// ---------------------------------------------------------------- valores totais
export interface OverviewChannel { platform: "meta" | "google"; has_campaigns: boolean; spend: number | null; impressions: number | null; clicks: number | null; reported_results: number | null; leads: number; sales: number; sold: number; cpl: number | null; cpa: number | null; roas: number | null }
export interface OverviewResp { currency: string; view: string; period: { from: string; to: string }; channels: OverviewChannel[]; sales_total: number; sold_total: number; basis: string }
export interface MetricValue { value: number | null; reason: string | null; kpi?: Kpi }
const kpi = (k: KpisResp | undefined, key: string) => k?.kpis.find((x) => x.key === key);
const prevKpi = (k: KpisResp | undefined, key: string) => k?.previous_kpis.find((x) => x.key === key);
const fromKpi = (x: Kpi | undefined): MetricValue => (x ? { value: x.available ? x.value : null, reason: x.available ? null : (x.reason ?? "Sem fonte"), kpi: x } : { value: null, reason: null });

/** Valor total de uma métrica no período (cur) ou no período anterior (prev). */
export const metricValue = (m: MetricKey, k: KpisResp | undefined, ov: OverviewResp | undefined, prev = false): MetricValue => {
  const get = prev ? prevKpi : kpi;
  const def = METRICS[m];
  if (def.kpi) return fromKpi(get(k, def.kpi));
  const spend = get(k, "spend"); const sp = spend?.available ? spend.value : null;
  if (m === "sales") return ov ? { value: ov.sales_total, reason: null } : { value: null, reason: null };
  // custo por venda = investimento ÷ vendas atribuídas
  const sales = ov?.sales_total ?? null;
  if (sp == null) return { value: null, reason: spend && !spend.available ? (spend.reason ?? "Sem gasto coletado") : null };
  return { value: sales != null && sales > 0 ? sp / sales : null, reason: sales === 0 ? "Sem vendas atribuídas no período" : null };
};
/** Variação percentual contra o período anterior (null quando não há base real: anterior nulo ou zero). */
export const pctChange = (cur: number | null, prev: number | null): number | null => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);

// ---------------------------------------------------------------- formatação
const nf = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Razão e percentual: até 2 casas, sem zeros à direita (mesmo formato dos indicadores do banco: 2x, 3,57x, 0,89%). */
const nr = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const cur = (v: number, c: string, d: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: c, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
/** Valores em destaque nos cartões: moeda sem centavos quando grande e forma curta (mil/mi) para não estourar o cartão. */
export const fmtValue = (m: MetricKey, v: number | null, currency = "BRL"): string => {
  if (v == null) return "Sem base";
  const u = METRICS[m].unit;
  if (u === "money") {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `${cur(v / 1_000_000, currency, 1)} mi`;
    if (a >= 100_000) return `${cur(v / 1000, currency, 0)} mil`;
    if (a >= 1000) return cur(v, currency, 0);
    return cur(v, currency, 2);
  }
  if (u === "ratio") return `${nr(v)}x`;
  if (u === "pct") return `${nr(v)}%`;
  if (Math.abs(v) >= 1_000_000) return `${nf(v / 1_000_000, 1)} mi`;
  if (Math.abs(v) >= 100_000) return `${nf(v / 1000, 0)} mil`;
  return nf(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0);
};
/** Valor completo (tooltip do gráfico, tabelas). */
export const fmtFull = (m: MetricKey, v: number | null, currency = "BRL"): string => {
  if (v == null) return "Sem base";
  const u = METRICS[m].unit;
  return u === "money" ? cur(v, currency, 2) : u === "ratio" ? `${nr(v)}x` : u === "pct" ? `${nr(v)}%` : nf(v, 0);
};
export const fmtMoneyShort = (v: number | null, currency = "BRL") => fmtValue("spend", v, currency);
export const fmtPct = (v: number | null, d = 1) => (v == null ? "Sem base" : `${nf(v, d)}%`);
