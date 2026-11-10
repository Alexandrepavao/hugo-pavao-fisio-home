// Análises do Marketing: tipos da função mkt_analytics e os cálculos de leitura (sem inventar dado: sem base → null).
// Tudo é por GRUPO DE LEADS: pessoas captadas no período, acompanhadas até hoje.

export type StageKey = "contacted" | "scheduled" | "attended" | "sold";
export interface StageStat { n: number; median_days: number | null; avg_days?: number | null }
export interface Counts { leads: number; contacted: number; scheduled: number; attended: number; sold: number }
export interface CampaignRef { campaign_id: string; name: string; platform: string }
export interface QualityRow extends CampaignRef { leads: number; spend: number | null; attended: number; sold: number; revenue: number }
export interface RegionRow { key: string; kind: "zone" | "city" | "none"; label: string; leads: number; scheduled: number; attended: number; sold: number; revenue: number }
export interface MonthRow { month: string; leads: number; spend: number | null; sold: number; cum: number[] }
export interface AnalyticsResp {
  currency: string; period: { from: string; to: string }; leads: number; basis: string;
  timing: { overall: Partial<Record<StageKey, StageStat>>; by_campaign: (CampaignRef & { leads: number; stages: Partial<Record<StageKey, StageStat>> })[] };
  dropoff: { overall: Counts; by_campaign: (CampaignRef & Counts)[]; lost_reasons: { reason: string; n: number }[]; lost_total: number };
  quality: QualityRow[]; regions: RegionRow[];
  hours: { heat: { dow: number; band: number; n: number }[]; first_response: { band: number; n: number; median_min: number | null }[] };
  monthly: { rows: MonthRow[]; first_month: string };
}

export const STAGES: { key: StageKey; label: string; short: string }[] = [
  { key: "contacted", label: "Primeiro contato", short: "Contato" }, { key: "scheduled", label: "Agendamento", short: "Agend." },
  { key: "attended", label: "Comparecimento", short: "Compar." }, { key: "sold", label: "Venda", short: "Venda" },
];
/** Volume mínimo para apontar “maior perda” ou “leitura” de uma campanha: menos que isso é ruído, não conclusão. */
export const MIN_VOLUME = 10;

const nf = (v: number, d = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: d });
/** Tempo em dias corridos, legível: minutos e horas quando menor que 1 dia. */
export const fmtDays = (d: number | null | undefined): string => {
  if (d == null) return "Sem base";
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))} min`;
  if (d < 1) return `${nf(d * 24, 0)} h`;
  return `${nf(d, 1)} ${Math.abs(d - 1) < 0.05 ? "dia" : "dias"}`;
};
export const fmtMinutes = (m: number | null | undefined): string => (m == null ? "Sem base" : fmtDays(m / 1440));
export const rate = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
export const fmtRate = (v: number | null, d = 1): string => (v == null ? "Sem base" : `${nf(v, d)}%`);
export const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------------------------------------------------------------- onde os leads se perdem
export interface DropStep { key: "leads" | StageKey; label: string; count: number; fromPrev: number | null; lostPct: number | null; lost: number }
export const dropSteps = (c: Counts): DropStep[] => {
  const seq: { key: DropStep["key"]; label: string; count: number }[] = [{ key: "leads", label: "Leads captados", count: c.leads }, ...STAGES.map((s) => ({ key: s.key, label: s.label, count: c[s.key] }))];
  return seq.map((s, i) => {
    const prev = i > 0 ? seq[i - 1].count : null; const lost = prev != null ? Math.max(0, prev - s.count) : 0;
    return { ...s, fromPrev: prev != null ? rate(s.count, prev) : null, lostPct: prev != null && prev > 0 ? (lost / prev) * 100 : null, lost };
  });
};
/** Etapa com a maior perda percentual, só entre etapas cuja etapa anterior tem volume suficiente; volume pequeno não aponta gargalo. */
export const biggestLoss = (steps: DropStep[]): { step: DropStep; prevLabel: string } | null => {
  let best: { step: DropStep; prevLabel: string } | null = null;
  steps.forEach((s, i) => { if (i === 0 || s.lostPct == null || steps[i - 1].count < MIN_VOLUME) return; if (!best || s.lostPct > (best.step.lostPct ?? -1)) best = { step: s, prevLabel: steps[i - 1].label }; });
  return best;
};

// ---------------------------------------------------------------- qualidade por campanha
export type Reading = "good" | "cheap_weak" | "costly_good" | "costly_weak" | "low_volume" | "none";
export interface QualityCalc extends QualityRow { cpl: number | null; cps: number | null; conv: number | null; roas: number | null; reading: Reading }
export const READING: Record<Reading, { label: string; hint: string }> = {
  good: { label: "Barata e converte", hint: "Custo por lead abaixo da mediana e conversão lead → venda igual ou acima da mediana das campanhas." },
  cheap_weak: { label: "Barata, converte pouco", hint: "Lead barato, mas poucos viram venda: vale revisar a qualidade do lead antes de aumentar verba." },
  costly_good: { label: "Cara, converte bem", hint: "Lead caro, mas a conversão em venda é igual ou acima da mediana." },
  costly_weak: { label: "Cara e converte pouco", hint: "Custo por lead acima da mediana e conversão abaixo da mediana: candidata a revisão." },
  low_volume: { label: "Volume baixo", hint: `Menos de ${MIN_VOLUME} leads no período: pouco volume para concluir.` },
  none: { label: "Sem base", hint: "Falta gasto ou venda para comparar." },
};
export const qualityCalc = (rows: QualityRow[]): QualityCalc[] => {
  const base = rows.map((r) => ({ ...r, cpl: r.spend != null && r.leads > 0 ? r.spend / r.leads : null, cps: r.spend != null && r.sold > 0 ? r.spend / r.sold : null, conv: rate(r.sold, r.leads), roas: r.spend != null && r.spend > 0 ? r.revenue / r.spend : null }));
  const comparable = base.filter((r) => r.leads >= MIN_VOLUME && r.cpl != null && r.conv != null);
  const mCpl = comparable.length >= 2 ? median(comparable.map((r) => r.cpl as number)) : null; const mConv = comparable.length >= 2 ? median(comparable.map((r) => r.conv as number)) : null;
  return base.map((r) => {
    let reading: Reading = "none";
    if (r.leads < MIN_VOLUME) reading = "low_volume";
    else if (mCpl != null && mConv != null && r.cpl != null && r.conv != null) { const cheap = r.cpl <= mCpl; const converts = r.conv >= mConv; reading = cheap ? (converts ? "good" : "cheap_weak") : (converts ? "costly_good" : "costly_weak"); }
    return { ...r, reading };
  });
};

// ---------------------------------------------------------------- dia da semana e horário
export const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DOW_FULL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const bandLabel = (b: number) => `${String(b * 4).padStart(2, "0")}–${String(b * 4 + 4).padStart(2, "0")}h`;
export const bandGrid = (heat: AnalyticsResp["hours"]["heat"]): { grid: number[][]; max: number; total: number } => {
  const grid = Array.from({ length: 7 }, () => Array(6).fill(0) as number[]); let max = 0; let total = 0;
  heat.forEach((h) => { if (h.dow >= 0 && h.dow < 7 && h.band >= 0 && h.band < 6) { grid[h.dow][h.band] += h.n; max = Math.max(max, grid[h.dow][h.band]); total += h.n; } });
  return { grid, max, total };
};
/** Faixa (dia + horário) com mais chegadas. Só aponta com volume suficiente (≥ MIN_VOLUME leads no total). */
export const bestSlot = (heat: AnalyticsResp["hours"]["heat"]): { dow: number; band: number; n: number; share: number } | null => {
  const { grid, max, total } = bandGrid(heat); if (total < MIN_VOLUME || max === 0) return null;
  for (let d = 0; d < 7; d++) for (let b = 0; b < 6; b++) if (grid[d][b] === max) return { dow: d, band: b, n: max, share: (max / total) * 100 };
  return null;
};

// ---------------------------------------------------------------- retorno por mês de captação
export type Payback = "paid" | "open" | "nobase";
/** Estado do mês: já recebeu o que investiu (pago), ainda não (aberto) ou sem gasto para comparar. */
export const paybackOf = (spend: number | null, received: number | null | undefined): Payback => (spend == null || spend <= 0 ? "nobase" : received != null && received >= spend ? "paid" : "open");
export const monthLabel = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const s = new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}/${String(y).slice(2)}`;
};
export const lastCum = (r: MonthRow): number | null => (r.cum.length ? r.cum[r.cum.length - 1] : null);

// ---------------------------------------------------------------- região
export const regionCalc = (rows: RegionRow[]) => rows.map((r) => ({ ...r, conv: rate(r.sold, r.leads), schedRate: rate(r.scheduled, r.leads) }));
