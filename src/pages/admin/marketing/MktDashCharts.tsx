import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import { tooltipStyle } from "@/lib/IndicatorCharts";
import { PLATFORM_LABEL, fmtDay, type SeriesResp } from "./mktApi";
import { METRICS, fmtFull, fmtValue, hasRealSeries, pointValue, type MetricKey, type OverviewChannel } from "./mktMetrics";
import { Panel, StateLine } from "./MktDashParts";

type Pt = SeriesResp["points"][number];
const axisProps = { fontSize: 11, tickLine: false, axisLine: false, tickMargin: 8 } as const;
const axisNum = (m: MetricKey) => (v: number) => {
  const u = METRICS[m].unit; const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : a >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: u === "ratio" || u === "pct" ? 1 : 2 });
  return u === "money" ? `R$ ${s}` : u === "ratio" ? `${s}x` : u === "pct" ? `${s}%` : s;
};

/** Evolução da métrica escolhida (cartões ou botões). Uma métrica por vez, na própria unidade — reais, taxas e quantidades nunca dividem a mesma escala.
 *  O período anterior (tracejado, neutro) só aparece com a comparação ligada e quando existe série real nele; dias sem base quebram a linha. */
export const TrendChart = ({ metric, onMetric, choices, points, prevPoints, granularity, currency, compare, prevRange }: {
  metric: MetricKey; onMetric: (m: MetricKey) => void; choices: MetricKey[]; points: Pt[] | undefined; prevPoints?: Pt[] | undefined; granularity: "day" | "week"; currency: string; compare: boolean; prevRange?: string;
}) => {
  const def = METRICS[metric]; const real = hasRealSeries(metric, points);
  const showPrev = compare && !!prevPoints && hasRealSeries(metric, prevPoints);
  const label = (p: Pt) => (granularity === "week" ? `sem. ${fmtDay(p.day)}` : fmtDay(p.day));
  const data = (points ?? []).map((p, i) => ({ x: label(p), cur: pointValue(metric, p), prev: showPrev && prevPoints?.[i] ? pointValue(metric, prevPoints[i]) : null, prevDay: prevPoints?.[i] ? label(prevPoints[i]) : null }));
  return (
    <Panel title={`Evolução · ${def.label}`} testId="mkt-trend" hint={`${granularity === "week" ? "Por semana" : "Por dia"}. Dias sem coleta ou sem base ficam em branco, nunca zero.`}
      right={<div role="group" aria-label="Métrica do gráfico" className="flex flex-wrap gap-1.5">{choices.map((m) => (
        <button key={m} type="button" aria-pressed={m === metric} onClick={() => onMetric(m)} data-testid={`mkt-trend-${m}`}
          className={`h-7 px-2.5 rounded-full border text-[12px] font-medium transition-colors ${m === metric ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{METRICS[m].label}</button>))}</div>}>
      {!real ? <StateLine testId="mkt-trend-empty" icon={BarChart3}>Sem série real de “{def.label}” neste período e escopo. Escolha outra métrica ou amplie o período.</StateLine> : (
        <div style={{ height: 250 }} data-testid="mkt-trend-chart" role="img" aria-label={`Gráfico de ${def.label} ${granularity === "week" ? "por semana" : "por dia"}${showPrev ? ", com o período anterior tracejado" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
              <XAxis dataKey="x" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axisProps} width={64} tickFormatter={axisNum(metric)} allowDecimals />
              <Tooltip {...tooltipStyle} content={({ active, payload }) => {
                if (!active || !payload?.length) return null; const r = payload[0].payload as (typeof data)[number];
                return <div style={tooltipStyle.contentStyle as React.CSSProperties}><p style={{ fontWeight: 600 }}>{r.x}: {fmtFull(metric, r.cur, currency)}</p>{showPrev && <p style={{ opacity: 0.8 }}>{r.prevDay ?? "período anterior"}: {fmtFull(metric, r.prev, currency)}</p>}</div>;
              }} />
              {showPrev && <Line type="monotone" dataKey="prev" stroke="hsl(var(--chart-6))" strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />}
              <Area type="monotone" dataKey="cur" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="hsl(var(--chart-1))" fillOpacity={0.1} dot={data.length <= 31 ? { r: 2.5 } : false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>)}
      {real && showPrev && <p className="text-[11.5px] text-muted-foreground mt-2">Linha tracejada: período anterior{prevRange ? ` (${prevRange})` : ""}, alinhado dia a dia.</p>}
    </Panel>
  );
};

const CHANNEL_METRICS: { key: MetricKey; field: keyof OverviewChannel }[] = [
  { key: "spend", field: "spend" }, { key: "leads", field: "leads" }, { key: "cpl", field: "cpl" }, { key: "sales", field: "sales" }, { key: "roas", field: "roas" },
];
const COLOR = { meta: "hsl(var(--chart-1))", google: "hsl(var(--chart-4))" } as const;
/** Meta × Google por investimento, leads, CPL, vendas e ROAS. Barras horizontais pequenas, uma por métrica, na própria escala. CPL e ROAS são recalculados pelos totais de cada canal.
 *  Canal sem campanha, sem gasto ou sem denominador mostra “Sem base” em vez de barra. */
export const ChannelCompare = ({ channels, currency, ignoresPlatform }: { channels: OverviewChannel[] | undefined; currency: string; ignoresPlatform: boolean }) => (
  <Panel title="Meta × Google" testId="mkt-channels" hint={`Mesmo período e filtros, exceto plataforma${ignoresPlatform ? " (ignorada aqui para comparar os dois canais)" : ""}. CPL e ROAS pelos totais de cada canal.`}>
    {!channels || channels.every((c) => !c.has_campaigns) ? <StateLine>Nenhuma campanha de Meta ou Google neste escopo.</StateLine> : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {CHANNEL_METRICS.map(({ key, field }) => {
          const vals = channels.map((c) => ({ platform: c.platform, v: c[field] as number | null, has: c.has_campaigns })); const max = Math.max(0, ...vals.map((x) => x.v ?? 0));
          return (
            <div key={key} data-testid={`mkt-channel-${key}`}>
              <p className="text-[12.5px] font-medium mb-1.5">{METRICS[key].label}</p>
              <div className="grid gap-1.5" role="img" aria-label={`${METRICS[key].label}: ${vals.map((x) => `${PLATFORM_LABEL[x.platform]} ${x.has ? fmtFull(key, x.v, currency) : "sem campanhas"}`).join("; ")}`}>
                {vals.map((x) => (
                  <div key={x.platform} className="grid grid-cols-[3.4rem_1fr] items-center gap-2 text-[12px]">
                    <span className="text-muted-foreground">{x.platform === "meta" ? "Meta" : "Google"}</span>
                    {x.v != null && max > 0 ? (
                      <span className="flex items-center gap-2 min-w-0"><span className="h-3.5 rounded-sm" style={{ width: `${Math.max(3, (Math.abs(x.v) / max) * 62)}%`, background: COLOR[x.platform] }} /><span className="tabular font-semibold truncate" title={fmtFull(key, x.v, currency)}>{fmtValue(key, x.v, currency)}</span></span>
                    ) : <span className="text-muted-foreground">{x.has ? (x.v === 0 ? "0" : "Sem base") : "Sem campanhas"}</span>}
                  </div>))}
              </div>
            </div>);
        })}
      </div>)}
  </Panel>
);
