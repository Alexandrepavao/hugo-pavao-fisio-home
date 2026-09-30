import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--success))", "hsl(38 65% 58%)", "hsl(var(--muted-foreground))"];

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
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} fontSize={11} interval={0} angle={data.length > 4 ? -15 : 0} textAnchor={data.length > 4 ? "end" : "middle"} height={data.length > 4 ? 52 : 28} />
          <YAxis fontSize={12} allowDecimals={false} />
          <Tooltip />
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
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} fontSize={11} /><YAxis fontSize={12} allowDecimals={false} /><Tooltip />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? COLORS[i % COLORS.length]} strokeWidth={2} dot={data.length < 20} />)}
        </LineChart>
      </ResponsiveContainer></div>
    )}
  </section>
);

/** Bloco explicativo curto: "como este número é calculado". */
export const Formula = ({ children }: { children: ReactNode }) => <p className="text-[11px] leading-4 text-muted-foreground">{children}</p>;
