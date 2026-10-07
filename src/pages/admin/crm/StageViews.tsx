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

/** Funil: uma linha por etapa com a quantidade que chegou, uma barra proporcional à 1ª etapa e as duas conversões (da etapa anterior e sobre a 1ª). */
export const StageFunnel = ({ chain, won }: { chain: ChainStep[]; won: { won: number; conv_prev_pct: number | null } }) => {
  const first = chain[0]?.reached ?? 0;
  const wonFirst = first ? Math.round((1000 * won.won) / first) / 10 : null;
  const rows = [
    ...chain.map((c, i) => ({ key: c.stage_id, name: c.name, n: c.reached, prev: i === 0 ? null : c.conv_prev_pct, first: c.conv_first_pct, entry: i === 0, final: false })),
    { key: "ganho", name: "Ganho", n: won.won, prev: won.conv_prev_pct, first: wonFirst, entry: false, final: true },
  ];
  return (
    <ol className="hp-card divide-y divide-border overflow-hidden" data-testid="funil-etapas">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-2 px-4 py-3" data-testid="funil-etapa">
          <div className="flex items-baseline justify-between gap-3">
            <span className={r.final ? "font-bold" : "font-medium"}>{r.name}</span>
            <span className="tabular text-lg font-bold">{r.n.toLocaleString("pt-BR")}</span>
          </div>
          <Bar value={r.first ?? 0} tone={r.final ? "accent" : "primary"} />
          <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {r.entry ? <span>Etapa de entrada</span> : <span>↓ <b className="text-foreground tabular">{pct(r.prev)}</b> da etapa anterior</span>}
            <span><b className="text-foreground tabular">{pct(r.first)}</b> sobre a 1ª etapa</span>
          </p>
        </li>
      ))}
    </ol>
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
