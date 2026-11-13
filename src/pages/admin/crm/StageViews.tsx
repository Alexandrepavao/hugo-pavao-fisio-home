import { Bar as RBar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Visões por etapa do CRM (Relatórios › Análises) sem tabela e sem rolagem lateral: funil em barras e duração por etapa.
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toString().replace(".", ",")}%`);
const days = (v: number | null | undefined) => (v == null ? "—" : `${v.toString().replace(".", ",")} d`);

export interface ChainStep { stage_id: string; name: string; reached: number; conv_prev_pct: number | null; conv_first_pct: number | null }
export interface HistoryStep { stage_id: string; name: string; n: number; avg_days: number | null; median_days: number | null }

const Bar = ({ value, tone = "primary" }: { value: number; tone?: "primary" | "accent" }) => (
  <div className="h-2.5 rounded-full bg-muted overflow-hidden" aria-hidden>
    <div className={`h-full rounded-full ${tone === "accent" ? "bg-accent" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%`, minWidth: value > 0 ? "0.375rem" : 0 }} />
  </div>
);

/** Funil: gráfico de barras por etapa (azul = chegaram; faixa clara = ficaram pelo caminho, em relação à etapa anterior), com o total e a conversão ao lado de cada barra,
 *  a maior perda destacada e, logo abaixo, a lista com os números exatos (da etapa anterior e sobre a 1ª etapa). */
export const StageFunnel = ({ chain, won }: { chain: ChainStep[]; won: { won: number; conv_prev_pct: number | null } }) => {
  const first = chain[0]?.reached ?? 0;
  const wonFirst = first ? Math.round((1000 * won.won) / first) / 10 : null;
  const rows = [
    ...chain.map((c, i) => ({ key: c.stage_id, name: c.name, n: c.reached, prev: i === 0 ? null : c.conv_prev_pct, first: c.conv_first_pct, entry: i === 0, final: false })),
    { key: "ganho", name: "Ganho", n: won.won, prev: won.conv_prev_pct, first: wonFirst, entry: false, final: true },
  ];
  const data = rows.map((r, i) => { const before = i > 0 ? rows[i - 1].n : r.n; return { name: r.name, reached: r.n, lost: i > 0 ? Math.max(0, before - r.n) : 0, tail: 0.0001, prev: r.prev, first: r.first, final: r.final }; });
  // maior perda = menor conversão da etapa anterior, só com volume suficiente na etapa de origem (volume pequeno não aponta gargalo)
  type Worst = { name: string; from: string; lostPct: number; lost: number };
  const worst = rows.reduce<Worst | null>((acc, r, i) => {
    if (i === 0 || rows[i - 1].n < 10 || r.prev == null) return acc; const lostPct = 100 - r.prev;
    return !acc || lostPct > acc.lostPct ? { name: r.name, from: rows[i - 1].name, lostPct, lost: Math.max(0, rows[i - 1].n - r.n) } : acc;
  }, null);
  const max = Math.max(1, first, ...rows.map((r) => r.n));
  return (
    <div data-testid="funil-grafico-bloco" className="grid gap-3">
      <div className="hp-card p-4">
        <div style={{ height: Math.max(180, rows.length * 44 + 20) }} data-testid="funil-grafico" role="img" aria-label={`Funil: ${rows.map((r) => `${r.name} ${r.n}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" horizontal={false} />
              <XAxis type="number" hide domain={[0, Math.ceil(max * 1.4)]} />
              <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
              <Tooltip cursor={{ fill: "hsl(var(--muted) / .4)" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null; const r = payload[0].payload as (typeof data)[number];
                return <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow"><p className="font-semibold">{r.name}: {r.reached.toLocaleString("pt-BR")}</p>{r.prev != null && <p>{pct(r.prev)} da etapa anterior</p>}<p>{pct(r.first)} sobre a 1ª etapa</p>{r.lost > 0 && <p>Ficaram pelo caminho: {r.lost.toLocaleString("pt-BR")}</p>}</div>;
              }} />
              <RBar dataKey="reached" stackId="f" isAnimationActive={false}>{data.map((r) => <Cell key={r.name} fill={r.final ? "hsl(var(--accent))" : "hsl(var(--chart-1))"} />)}</RBar>
              <RBar dataKey="lost" stackId="f" fill="hsl(var(--chart-6) / .30)" stroke="hsl(var(--chart-6))" strokeDasharray="3 3" isAnimationActive={false} />
              <RBar dataKey="tail" stackId="f" fill="transparent" isAnimationActive={false}>
                <LabelList dataKey="reached" content={(p) => {
                  const r = data[Number(p.index)]; if (!r) return null; const x = Number(p.x ?? 0); const y = Number(p.y ?? 0); const h = Number(p.height ?? 0);
                  return <text x={x + 6} y={y + h / 2} dominantBaseline="central" fontSize={12.5}><tspan fontWeight={700} fill="hsl(var(--foreground))">{r.reached.toLocaleString("pt-BR")}</tspan>{r.prev != null && <tspan dx={6} fontSize={11} fill="hsl(var(--muted-foreground))">{pct(r.prev)}</tspan>}</text>;
                }} />
              </RBar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11.5px] text-muted-foreground">Barra azul = chegaram à etapa · faixa clara = ficaram pelo caminho · % ao lado = conversão da etapa anterior.</p>
        {worst ? <p className="mt-2 text-sm" data-testid="funil-maior-perda">Maior perda: entre <b>{worst.from}</b> e <b>{worst.name}</b> — {pct(Math.round(worst.lostPct * 10) / 10)} não avançaram ({worst.lost.toLocaleString("pt-BR")} oportunidades).</p>
          : <p className="mt-2 text-sm text-muted-foreground">Volume pequeno (menos de 10 oportunidades na etapa de origem): ainda não dá para apontar onde mais se perde.</p>}
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="funil-etapas">
        {rows.map((r) => (
          <li key={r.key} className="hp-card grid gap-1 px-3.5 py-2.5" data-testid="funil-etapa">
            <div className="flex items-baseline justify-between gap-3">
              <span className={r.final ? "font-bold" : "font-medium"}>{r.name}</span>
              <span className="tabular text-lg font-bold">{r.n.toLocaleString("pt-BR")}</span>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {r.entry ? <span>Etapa de entrada</span> : <span>↓ <b className="text-foreground tabular">{pct(r.prev)}</b> da etapa anterior</span>}
              <span><b className="text-foreground tabular">{pct(r.first)}</b> sobre a 1ª etapa</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
};

/** Duração por etapa: uma linha por etapa com passagens, média e mediana; a barra compara a média entre as etapas. */
export const StageDurations = ({ history }: { history: HistoryStep[] }) => {
  const max = Math.max(0, ...history.map((h) => h.avg_days ?? 0));
  return (
    <ul className="hp-card divide-y divide-border overflow-hidden" data-testid="duracao-etapas">
      {history.map((h) => (
        <li key={h.stage_id} className="grid gap-2 px-4 py-3" data-testid="duracao-etapa">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{h.name}</span>
            <span className="text-xs text-muted-foreground tabular">{h.n === 0 ? "Sem passagens" : `${h.n.toLocaleString("pt-BR")} ${h.n === 1 ? "passagem" : "passagens"}`}</span>
          </div>
          {h.n > 0 && <Bar value={max > 0 ? ((h.avg_days ?? 0) / max) * 100 : 0} tone="accent" />}
          {h.n > 0 && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Média</dt><dd className="tabular font-semibold">{days(h.avg_days)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Mediana</dt><dd className="tabular font-semibold">{days(h.median_days)}</dd></div>
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
};
