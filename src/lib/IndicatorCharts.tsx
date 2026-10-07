import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";

export const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))"];
const COLORS = CHART_COLORS;
export const tooltipStyle = {
  contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12, color: "hsl(var(--popover-foreground))", boxShadow: "var(--shadow-pop)", padding: "8px 10px" },
  cursor: { fill: "hsl(var(--muted) / .6)" }, labelStyle: { fontWeight: 600, marginBottom: 2 },
};
const axisProps = { fontSize: 11, tickLine: false, axisLine: false, tickMargin: 8 } as const;

export interface Series { key: string; label: string; color?: string }

/** Legenda HTML (mais limpa que a do recharts). */
export const Legenda = ({ items }: { items: { label: string; color: string }[] }) => (
  <div className="hp-legend" aria-label="Legenda">{items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}</div>
);

/** Estado vazio de um gráfico: explica o motivo em vez de deixar um quadro em branco. */
const ChartEmpty = ({ text }: { text: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 text-center py-8 px-4 rounded-lg border border-dashed border-border bg-muted/30 mt-3" style={{ minHeight: 150 }}>
    <span aria-hidden className="grid place-items-center w-9 h-9 rounded-full bg-card border border-border text-muted-foreground"><BarChart3 size={16} /></span>
    <p className="text-[13px] text-muted-foreground max-w-xs">{text}</p>
  </div>
);

/** Moldura de um gráfico (recharts) no padrão dos demais: título, dica, legenda, altura fixa e mensagem quando não há dado real. */
export const ChartCard = ({ title, hint, height = 240, empty, isEmpty, legend, children }: { title: string; hint?: string; height?: number; empty?: string; isEmpty?: boolean; legend?: { label: string; color: string }[]; children: ReactNode }) => (
  <section className="hp-card p-5" aria-label={title}>
    <div className="hp-chart-head"><div className="min-w-0"><h3 className="text-[0.9375rem] font-bold">{title}</h3>{hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}</div>{legend && !isEmpty && <Legenda items={legend} />}</div>
    {isEmpty ? <ChartEmpty text={empty ?? "Sem dados no período."} /> : <div style={{ height }} className="mt-4"><ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer></div>}
  </section>
);

/** Cartão com um gráfico de barras (empilhável). `onBarClick` recebe a linha clicada — usado para abrir os registros. */
export const BarBlock = ({ title, hint, data, xKey, series, stacked, onBarClick, height = 240, empty }: {
  title: string; hint?: string; data: Record<string, string | number | null>[]; xKey: string; series: Series[]; stacked?: boolean;
  onBarClick?: (row: Record<string, string | number | null>) => void; height?: number; empty?: string;
}) => (
  <ChartCard title={title} hint={hint} height={height} isEmpty={data.length === 0} empty={empty} legend={series.length > 1 ? series.map((s, i) => ({ label: s.label, color: s.color ?? COLORS[i % COLORS.length] })) : undefined}>
    <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barCategoryGap="22%">
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
      <XAxis dataKey={xKey} {...axisProps} interval={0} angle={data.length > 4 ? -15 : 0} textAnchor={data.length > 4 ? "end" : "middle"} height={data.length > 4 ? 52 : 28} />
      <YAxis {...axisProps} allowDecimals={false} />
      <Tooltip {...tooltipStyle} />
      {series.map((s, i) => (
        <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? COLORS[i % COLORS.length]} stackId={stacked ? "a" : undefined} radius={stacked ? undefined : [6, 6, 0, 0]} maxBarSize={44}
          cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick ? (d: unknown) => onBarClick((d as { payload: Record<string, string | number | null> }).payload) : undefined} />
      ))}
    </BarChart>
  </ChartCard>
);

/** Evolução no tempo em áreas com gradiente (séries reais; uma ou mais). */
export const LineBlock = ({ title, hint, data, xKey, series, height = 240, empty, format }: {
  title: string; hint?: string; data: Record<string, string | number | null>[]; xKey: string; series: Series[]; height?: number; empty?: string; format?: (v: number) => string;
}) => <AreaTrend title={title} hint={hint} data={data} xKey={xKey} series={series} height={height} empty={empty} format={format} />;

export const AreaTrend = ({ title, hint, data, xKey, series, height = 240, empty, format, yFormat, isEmpty }: {
  title: string; hint?: string; data: Record<string, string | number | null>[]; xKey: string; series: Series[]; height?: number; empty?: string; format?: (v: number) => string; yFormat?: (v: number) => string; isEmpty?: boolean;
}) => {
  const uid = title.replace(/\W+/g, "");
  return (
    <ChartCard title={title} hint={hint} height={height} isEmpty={isEmpty ?? data.length === 0} empty={empty} legend={series.length > 1 ? series.map((s, i) => ({ label: s.label, color: s.color ?? COLORS[i % COLORS.length] })) : undefined}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
        <defs>{series.map((s, i) => { const c = s.color ?? COLORS[i % COLORS.length]; return <linearGradient key={s.key} id={`g-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.28} /><stop offset="100%" stopColor={c} stopOpacity={0.02} /></linearGradient>; })}</defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} tickFormatter={yFormat} />
        <Tooltip {...tooltipStyle} formatter={format ? ((v: number) => format(v)) as never : undefined} />
        {series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? COLORS[i % COLORS.length]} strokeWidth={2.25} fill={`url(#g-${uid}-${i})`} dot={data.length < 14 ? { r: 3, strokeWidth: 0, fill: s.color ?? COLORS[i % COLORS.length] } : false} activeDot={{ r: 5 }} />)}
      </AreaChart>
    </ChartCard>
  );
};

/** Rosca com o total no centro e legenda em lista (valores reais). */
export const DonutBlock = ({ title, hint, data, empty, noun = "no total" }: { title: string; hint?: string; data: { name: string; value: number }[]; empty?: string; noun?: string }) => {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <section className="hp-card p-5" aria-label={title}>
      <h3 className="text-[0.9375rem] font-bold">{title}</h3>{hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      {data.length === 0 ? <ChartEmpty text={empty ?? "Sem dados no período."} /> : (
        <div className="mt-3 grid gap-4 sm:grid-cols-[11rem_1fr] items-center">
          <div className="relative mx-auto w-44 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>{data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip {...tooltipStyle} /></PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 grid place-items-center pointer-events-none text-center"><div><p className="font-extrabold text-xl tabular leading-6" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{total.toLocaleString("pt-BR")}</p><p className="text-[11px] text-muted-foreground">{noun}</p></div></div>
          </div>
          <ul className="grid gap-1.5 text-[13px]">
            {data.map((d, i) => <li key={d.name} className="flex items-center gap-2 min-w-0"><i className="shrink-0 w-2.5 h-2.5 rounded-[3px]" style={{ background: COLORS[i % COLORS.length] }} /><span className="truncate flex-1">{d.name}</span><span className="tabular font-semibold">{d.value.toLocaleString("pt-BR")}</span><span className="tabular text-muted-foreground w-10 text-right">{total ? Math.round((d.value / total) * 100) : 0}%</span></li>)}
          </ul>
        </div>
      )}
    </section>
  );
};

/** Ranking em barras horizontais (valores reais); `display` é o texto mostrado à direita. */
export const RankBars = ({ title, hint, items, empty, color }: { title: string; hint?: string; items: { label: string; value: number; display: string }[]; empty?: string; color?: string }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="hp-card p-5" aria-label={title}>
      <h3 className="text-[0.9375rem] font-bold">{title}</h3>{hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      {items.length === 0 ? <ChartEmpty text={empty ?? "Sem dados no período."} /> : (
        <div className="hp-rank mt-4" style={color ? ({ ["--rc" as string]: color }) : undefined}>
          {items.map((i) => <div key={i.label} className="hp-rank-row"><div className="hp-rank-top"><span title={i.label}>{i.label}</span><span className="tabular font-semibold">{i.display}</span></div><div className="hp-rank-bar" role="presentation"><i style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} /></div></div>)}
        </div>
      )}
    </section>
  );
};

/** Bloco explicativo curto: "como este número é calculado". */
export const Formula = ({ children }: { children: ReactNode }) => <p className="text-[11px] leading-4 text-muted-foreground">{children}</p>;

export { Legend };
