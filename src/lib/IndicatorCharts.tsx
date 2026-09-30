import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))", "hsl(var(--chart-6))"];
const COLORS = CHART_COLORS;
export const tooltipStyle = { contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }, cursor: { fill: "hsl(var(--muted) / .6)" } };

export interface Series { key: string; label: string; color?: string }

/** Cartão com um gráfico de barras (empilhável). `onBarClick` recebe a linha clicada — usado para abrir os registros. */
export const BarBlock = ({ title, hint, data, xKey, series, stacked, onBarClick, height = 240, empty }: {
  title: string; hint?: string; data: Record<string, string | number | null>[]; xKey: string; series: Series[]; stacked?: boolean;
  onBarClick?: (row: Record<string, string | number | null>) => void; height?: number; empty?: string;
}) => (
  <section className="hp-card p-4">
    <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
    {hint && <p className="text-xs text-muted-foreground mt-0.5 mb-2">{hint}</p>}
    {data.length === 0 ? <p className="text-sm text-muted-foreground py-6">{empty ?? "Sem dados no período."}</p> : (
      <div style={{ height }} className="mt-2"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
          <XAxis dataKey={xKey} fontSize={11} interval={0} angle={data.length > 4 ? -15 : 0} textAnchor={data.length > 4 ? "end" : "middle"} height={data.length > 4 ? 52 : 28} />
          <YAxis fontSize={12} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? COLORS[i % COLORS.length]} stackId={stacked ? "a" : undefined} radius={stacked ? undefined : [3, 3, 0, 0]}
              cursor={onBarClick ? "pointer" : undefined} onClick={onBarClick ? (d: unknown) => onBarClick((d as { payload: Record<string, string | number | null> }).payload) : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer></div>
    )}
  </section>
);

export const LineBlock = ({ title, hint, data, xKey, series, height = 240, empty }: {
  title: string; hint?: string; data: Record<string, string | number | null>[]; xKey: string; series: Series[]; height?: number; empty?: string;
}) => (
  <section className="hp-card p-4">
    <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
    {hint && <p className="text-xs text-muted-foreground mt-0.5 mb-2">{hint}</p>}
    {data.length === 0 ? <p className="text-sm text-muted-foreground py-6">{empty ?? "Sem dados no período."}</p> : (
      <div style={{ height }} className="mt-2"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
          <XAxis dataKey={xKey} fontSize={11} /><YAxis fontSize={12} allowDecimals={false} /><Tooltip {...tooltipStyle} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? COLORS[i % COLORS.length]} strokeWidth={2} dot={data.length < 20} />)}
        </LineChart>
      </ResponsiveContainer></div>
    )}
  </section>
);

/** Bloco explicativo curto: "como este número é calculado". */
export const Formula = ({ children }: { children: ReactNode }) => <p className="text-[11px] leading-4 text-muted-foreground">{children}</p>;

/** Moldura de um gráfico próprio (recharts) no padrão dos demais: título, dica, altura fixa e mensagem quando não há dado real. */
export const ChartCard = ({ title, hint, height = 240, empty, isEmpty, children }: { title: string; hint?: string; height?: number; empty?: string; isEmpty?: boolean; children: ReactNode }) => (
  <section className="hp-card p-4" aria-label={title}>
    <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
    {hint && <p className="text-xs text-muted-foreground mt-0.5 mb-2">{hint}</p>}
    {isEmpty ? <p className="text-sm text-muted-foreground py-6">{empty ?? "Sem dados no período."}</p> : <div style={{ height }} className="mt-2"><ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer></div>}
  </section>
);
