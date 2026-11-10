import { Fragment, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { tooltipStyle } from "@/lib/IndicatorCharts";
import { MKT_COLORS, PLATFORM_LABEL } from "./mktApi";
import { InfoTip, Panel, StateLine } from "./MktDashParts";
import { fmtValue } from "./mktMetrics";
import {
  CURVE_COLORS, DOW, DOW_FULL, MIN_VOLUME, READING, STAGES, bandGrid, bandLabel, bestSlot, biggestLoss, curveRows, dropSteps, fmtDays, fmtMinutes, fmtRate, hasCurve, lastCum, median, monthLabel, paybackOf, qualityCalc, rate, regionCalc,
  type AnalyticsResp, type QualityCalc, type StageKey,
} from "./mktAnalytics";

const nfi = (v: number) => v.toLocaleString("pt-BR");
const platColor = (p: string) => (p === "google" ? MKT_COLORS[1] : MKT_COLORS[0]);
const PlatformTag = ({ p }: { p: string }) => <span className="text-[10.5px] rounded bg-muted px-1.5 py-px text-muted-foreground shrink-0">{PLATFORM_LABEL[p] ?? p}</span>;
const Hint = ({ title, children }: { title: string; children: ReactNode }) => <span className="inline-flex items-center gap-1">{title}<InfoTip title={title}>{children}</InfoTip></span>;
/** Botão de alternar “por campanha”: mantém a tela curta e deixa o detalhe a um clique. */
const Toggle = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} aria-expanded={on} className="h-7 px-2.5 rounded-full border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground">{on ? "Ocultar" : "Ver"} {label}</button>
);

// ================================================================= 1) qualidade por campanha
const ReadingTag = ({ r }: { r: QualityCalc["reading"] }) => (r === "none" ? null : (
  <span title={READING[r].hint} className="text-[11px] rounded-full border px-2 py-px whitespace-nowrap" style={r === "costly_weak" ? { borderColor: "hsl(var(--warning) / .6)", background: "hsl(var(--warning-soft))" } : r === "good" ? { borderColor: "hsl(var(--primary) / .5)" } : undefined}>{READING[r].label}</span>));
const M = ({ label, value, title }: { label: string; value: string; title?: string }) => (
  <div className="min-w-0"><p className="text-[10.5px] uppercase tracking-wide text-muted-foreground truncate">{label}</p><p className={`tabular text-[13px] font-semibold truncate ${value === "Sem base" ? "text-muted-foreground font-normal" : ""}`} title={title ?? value}>{value}</p></div>
);
export const QualityBlock = ({ data }: { data: AnalyticsResp }) => {
  const [all, setAll] = useState(false); const LIMIT = 8;
  const cur = data.currency; const rows = qualityCalc(data.quality);
  const pts = rows.filter((r) => r.cpl != null && r.conv != null && r.leads > 0);
  const comparable = rows.filter((r) => r.leads >= MIN_VOLUME && r.cpl != null && r.conv != null); const mCpl = comparable.length >= 2 ? median(comparable.map((r) => r.cpl as number)) : null; const mConv = comparable.length >= 2 ? median(comparable.map((r) => r.conv as number)) : null;
  return (
    <Panel title="Qualidade por campanha" testId="mkt-an-quality" hint={<Hint title="Custo × conversão">Cada ponto é uma campanha: quanto custa cada lead (esquerda → direita) e que parte dos leads virou venda (baixo → cima). A leitura compara com a mediana das campanhas com {MIN_VOLUME} leads ou mais. Custo por lead = investimento ÷ leads do grupo; conversão = leads com venda ÷ leads.</Hint>}>
      {rows.length === 0 ? <StateLine testId="mkt-an-quality-empty">Nenhuma campanha com leads neste período e escopo.</StateLine> : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
          <div data-testid="mkt-an-scatter" className="xl:sticky xl:top-20">
            {pts.length < 2 ? <StateLine>Preciso de ao menos duas campanhas com investimento e leads para comparar custo e conversão.</StateLine> : (
              <div style={{ height: 260 }} role="img" aria-label={`Custo por lead (eixo horizontal) e conversão em venda (eixo vertical) de ${pts.length} campanhas`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis type="number" dataKey="cpl" name="Custo por lead" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtValue("cpl", v, cur)} label={{ value: "Custo por lead", position: "insideBottom", offset: -10, fontSize: 11 }} />
                    <YAxis type="number" dataKey="conv" name="Conversão" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`} />
                    <ZAxis type="number" dataKey="leads" range={[60, 260]} />
                    {mCpl != null && <ReferenceLine x={mCpl} stroke="hsl(var(--chart-6))" strokeDasharray="4 4" />}
                    {mConv != null && <ReferenceLine y={mConv} stroke="hsl(var(--chart-6))" strokeDasharray="4 4" />}
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} {...tooltipStyle} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null; const r = payload[0].payload as QualityCalc;
                      return <div style={tooltipStyle.contentStyle as React.CSSProperties}><p style={{ fontWeight: 600 }}>{r.name}</p><p>Custo por lead: {fmtValue("cpl", r.cpl, cur)}</p><p>Conversão em venda: {fmtRate(r.conv)}</p><p>{nfi(r.leads)} leads · {nfi(r.sold)} vendas</p></div>;
                    }} />
                    {(["meta", "google"] as const).map((p) => <Scatter key={p} name={PLATFORM_LABEL[p]} data={pts.filter((r) => r.platform === p)} fill={platColor(p)} fillOpacity={0.8} isAnimationActive={false} />)}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>)}
            <p className="text-[11.5px] text-muted-foreground mt-1">Tamanho do ponto = número de leads. {mCpl != null ? "Linhas tracejadas = mediana das campanhas." : "Sem mediana: poucas campanhas comparáveis."} <span style={{ color: MKT_COLORS[0] }}>●</span> Meta <span style={{ color: MKT_COLORS[1] }}>●</span> Google</p>
          </div>
          <div className="grid gap-2">
          <ul className="grid gap-2" data-testid="mkt-an-quality-list">
            {(all ? rows : rows.slice(0, LIMIT)).map((r) => (
              <li key={r.campaign_id} className="rounded-lg border border-border p-3" data-testid="mkt-an-quality-row" data-leads={r.leads}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2"><span className="font-semibold text-[13px] min-w-0 truncate max-w-full" title={r.name}>{r.name}</span><PlatformTag p={r.platform} /><span className="ml-auto"><ReadingTag r={r.reading} /></span></div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-2">
                  <M label="Investido" value={fmtValue("spend", r.spend, cur)} /><M label="Leads" value={nfi(r.leads)} /><M label="Custo/lead" value={fmtValue("cpl", r.cpl, cur)} />
                  <M label="Vendas" value={nfi(r.sold)} /><M label="Custo/venda" value={fmtValue("cps", r.cps, cur)} /><M label="Lead → venda" value={fmtRate(r.conv)} title={`${r.sold} de ${r.leads} leads`} />
                </div>
              </li>))}
          </ul>
          {rows.length > LIMIT && <button type="button" data-testid="mkt-an-quality-more" onClick={() => setAll(!all)} className="h-8 rounded-lg border border-border bg-card text-[12.5px] font-medium text-primary hover:bg-muted/50">{all ? "Mostrar só as 8 com mais leads" : `Mostrar todas as ${rows.length} campanhas`}</button>}
          </div>
        </div>)}
    </Panel>
  );
};

// ================================================================= 2) onde os leads se perdem
const chartTick = { fontSize: 11.5 } as const;
const LOST_FILL = "hsl(var(--chart-6) / .30)";
export const DropoffBlock = ({ data }: { data: AnalyticsResp }) => {
  const [by, setBy] = useState(false); const d = data.dropoff; const steps = dropSteps(d.overall); const worst = biggestLoss(steps); const first = Math.max(1, d.overall.leads);
  const chart = steps.map((s) => ({ name: s.label, reached: s.count, lost: s.lost, tail: 0.0001, pct: s.fromPrev, lostN: s.lost, key: s.key }));
  const maxLost = Math.max(1, ...d.lost_reasons.map((x) => x.n)); const reasons = d.lost_reasons.map((x) => ({ reason: x.reason, n: x.n }));
  return (
    <Panel title="Onde os leads se perdem" testId="mkt-an-dropoff" hint={<Hint title="Perda etapa a etapa">Cada barra azul é quantos leads do grupo chegaram à etapa; a parte clara é quantos ficaram pelo caminho em relação à etapa anterior. “Maior perda” só é apontada quando a etapa anterior tem {MIN_VOLUME} leads ou mais.</Hint>}
      right={d.by_campaign.length > 1 ? <Toggle on={by} onClick={() => setBy(!by)} label="por campanha" /> : undefined}>
      {d.overall.leads === 0 ? <StateLine>Nenhum lead captado neste período e escopo.</StateLine> : (
        <div className="grid gap-4">
          <div style={{ height: 232 }} data-testid="mkt-an-drop-chart" data-counts={JSON.stringify(d.overall)} role="img"
            aria-label={`Funil dos leads: ${steps.map((s) => `${s.label} ${s.count}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" horizontal={false} />
                <XAxis type="number" hide domain={[0, Math.ceil(first * 1.32)]} />
                <YAxis type="category" dataKey="name" width={112} tick={chartTick} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted) / .4)" }} {...tooltipStyle} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null; const r = payload[0].payload as (typeof chart)[number];
                  return <div style={tooltipStyle.contentStyle as React.CSSProperties}><p style={{ fontWeight: 600 }}>{r.name}: {nfi(r.reached)} leads</p>{r.pct != null && <p>{fmtRate(r.pct)} da etapa anterior</p>}{r.lostN > 0 && <p>Ficaram pelo caminho: {nfi(r.lostN)}</p>}</div>;
                }} />
                <Bar dataKey="reached" stackId="f" fill="hsl(var(--chart-1))" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="lost" stackId="f" fill={LOST_FILL} stroke="hsl(var(--chart-6))" strokeDasharray="3 3" isAnimationActive={false} />
                <Bar dataKey="tail" stackId="f" fill="transparent" isAnimationActive={false}>
                  <LabelList dataKey="reached" content={(p) => {
                    const i = Number(p.index); const r = chart[i]; if (!r) return null; const x = Number(p.x ?? 0); const y = Number(p.y ?? 0); const h = Number(p.height ?? 0);
                    return <text x={x + 6} y={y + h / 2} dominantBaseline="central" fontSize={12.5}><tspan fontWeight={700} fill="hsl(var(--foreground))">{nfi(r.reached)}</tspan>{r.pct != null && <tspan dx={6} fill="hsl(var(--muted-foreground))" fontSize={11}>{fmtRate(r.pct, 0)}</tspan>}</text>;
                  }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11.5px] text-muted-foreground -mt-2">Barra azul = chegaram · faixa clara = ficaram pelo caminho · % = sobre a etapa anterior.</p>
          {worst ? <p className="text-[12.5px]" data-testid="mkt-an-worst">Maior perda: entre <b>{worst.prevLabel}</b> e <b>{worst.step.label}</b> — {fmtRate(worst.step.lostPct, 0)} dos leads ficaram por aqui ({nfi(worst.step.lost)} de {nfi(steps[steps.findIndex((s) => s.key === worst.step.key) - 1].count)}).</p>
            : <p className="text-[12.5px] text-muted-foreground" data-testid="mkt-an-worst">Volume pequeno (menos de {MIN_VOLUME} leads na etapa anterior): ainda não dá para apontar onde mais se perde.</p>}
          <div>
            <p className="text-[12.5px] font-semibold mb-1">Motivos de perda {d.lost_total > 0 ? <span className="font-normal text-muted-foreground">({nfi(d.lost_total)} oportunidades perdidas)</span> : null}</p>
            {reasons.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nenhuma oportunidade do grupo foi marcada como perdida.</p> : (
              <div style={{ height: Math.max(90, reasons.length * 34 + 14) }} data-testid="mkt-an-lost" role="img" aria-label={`Motivos de perda: ${reasons.map((x) => `${x.reason} ${x.n}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reasons} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }} barCategoryGap={8}>
                    <XAxis type="number" hide domain={[0, maxLost]} />
                    <YAxis type="category" dataKey="reason" width={132} tick={chartTick} tickLine={false} axisLine={false} tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
                    <Tooltip cursor={{ fill: "hsl(var(--muted) / .4)" }} {...tooltipStyle} formatter={(v: number) => [`${nfi(v)} oportunidades`, "Perdidas"]} />
                    <Bar dataKey="n" fill="hsl(var(--chart-6))" radius={[0, 4, 4, 0]} isAnimationActive={false}><LabelList dataKey="n" position="right" fontSize={12} fontWeight={700} /></Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>)}
          </div>
          {by && (
            <div className="overflow-x-auto" data-testid="mkt-an-drop-campaigns"><table className="w-full text-[12.5px] min-w-[520px]"><thead><tr className="text-left text-muted-foreground text-[11px] uppercase tracking-wide"><th className="py-1 pr-2 font-medium">Campanha</th><th className="px-2 font-medium text-right">Leads</th>
              {STAGES.map((s) => <th key={s.key} className="px-2 font-medium text-right">{s.short}</th>)}</tr></thead>
              <tbody>{d.by_campaign.map((c) => (
                <tr key={c.campaign_id} className="border-t border-border"><td className="py-1.5 pr-2 max-w-[14rem]"><span className="block truncate" title={c.name}>{c.name}</span></td><td className="px-2 text-right tabular">{nfi(c.leads)}</td>
                  {STAGES.map((s) => <td key={s.key} className="px-2 text-right tabular" title={`${c[s.key]} de ${c.leads} leads`}>{fmtRate(rate(c[s.key], c.leads), 0)}</td>)}</tr>))}</tbody></table>
              <p className="text-[11px] text-muted-foreground mt-1">Percentual sobre os leads da própria campanha.</p></div>)}
        </div>)}
    </Panel>
  );
};

// ================================================================= 3) tempo até cada etapa
export const TimingBlock = ({ data }: { data: AnalyticsResp }) => {
  const [by, setBy] = useState(false); const t = data.timing; const anyData = STAGES.some((s) => (t.overall[s.key]?.n ?? 0) > 0);
  const rows = curveRows(t.curve); const drawable = hasCurve(rows);
  return (
    <Panel title="Tempo até cada etapa" testId="mkt-an-timing" hint={<Hint title="Quanto tempo os leads levam">A curva mostra, para cada etapa, que parte dos leads já chegou nela em até X dias depois de captada. Cada ponto usa só leads com pelo menos X dias de vida (leads recentes ainda não tiveram tempo) e só aparece com {MIN_VOLUME} leads ou mais. Os números abaixo são a mediana em dias corridos de quem chegou à etapa.</Hint>}
      right={t.by_campaign.length > 1 && anyData ? <Toggle on={by} onClick={() => setBy(!by)} label="por campanha" /> : undefined}>
      {!anyData ? <StateLine testId="mkt-an-timing-empty">Nenhum lead do grupo chegou a contato, agendamento, comparecimento ou venda ainda — sem base para medir tempo.</StateLine> : (
        <div className="grid gap-4">
          {drawable ? (
            <div data-testid="mkt-an-curve">
              <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1 text-[12px]" aria-hidden>{STAGES.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: CURVE_COLORS[s.key] }} />{s.label}</span>)}</div>
              <div style={{ height: 232 }} role="img" aria-label="Curva do tempo: percentual dos leads que chegaram a cada etapa em até X dias">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
                    <XAxis dataKey="label" tick={chartTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
                    <YAxis domain={[0, 100]} tick={chartTick} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip {...tooltipStyle} content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null; const r = payload[0].payload as (typeof rows)[number];
                      return <div style={tooltipStyle.contentStyle as React.CSSProperties}><p style={{ fontWeight: 600 }}>Em até {label}</p>{STAGES.map((s) => <p key={s.key}>{s.label}: {r[s.key] == null ? "Sem base" : `${fmtRate(r[s.key] as number, 0)} (${r.n?.[s.key]})`}</p>)}</div>;
                    }} />
                    {STAGES.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} stroke={CURVE_COLORS[s.key]} strokeWidth={s.key === "sold" ? 2.6 : 2} strokeDasharray={s.key === "attended" ? "5 3" : undefined} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11.5px] text-muted-foreground">% dos leads (com tempo de vida suficiente) que chegaram à etapa em até X depois da captação.</p>
            </div>) : <StateLine testId="mkt-an-curve-empty">Poucos leads com tempo de vida suficiente para desenhar a curva (mínimo de {MIN_VOLUME} por ponto). Veja as medianas abaixo.</StateLine>}
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="mkt-an-timing-list">
            {STAGES.map((s) => { const st = t.overall[s.key]; return (
              <li key={s.key} className="rounded-lg border border-border px-3 py-2" data-testid={`mkt-an-time-${s.key}`}>
                <p className="text-[11.5px] text-muted-foreground flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CURVE_COLORS[s.key] }} />{s.label}</p>
                <p className="tabular text-[18px] font-bold leading-tight">{st ? fmtDays(st.median_days) : "Sem base"}</p>
                <p className="text-[11px] text-muted-foreground tabular">{st ? `${nfi(st.n)} lead${st.n === 1 ? "" : "s"}${st.avg_days != null ? ` · média ${fmtDays(st.avg_days)}` : ""}` : "nenhum lead"}</p>
              </li>); })}
          </ul>
          {by && (
            <div className="overflow-x-auto" data-testid="mkt-an-time-campaigns"><table className="w-full text-[12.5px] min-w-[480px]"><thead><tr className="text-left text-muted-foreground text-[11px] uppercase tracking-wide"><th className="py-1 pr-2 font-medium">Campanha</th>
              {STAGES.map((s) => <th key={s.key} className="px-2 font-medium text-right">{s.short}</th>)}</tr></thead>
              <tbody>{t.by_campaign.map((c) => (
                <tr key={c.campaign_id} className="border-t border-border"><td className="py-1.5 pr-2 max-w-[14rem]"><span className="block truncate" title={c.name}>{c.name}</span></td>
                  {STAGES.map((s) => { const st = c.stages[s.key as StageKey]; return <td key={s.key} className="px-2 text-right tabular" title={st ? `${st.n} lead(s)` : "nenhum lead chegou"}>{st ? fmtDays(st.median_days) : "—"}</td>; })}</tr>))}</tbody></table>
              <p className="text-[11px] text-muted-foreground mt-1">Mediana por campanha. “—” = nenhum lead da campanha chegou à etapa.</p></div>)}
        </div>)}
    </Panel>
  );
};

// ================================================================= 4) região
export const RegionBlock = ({ data }: { data: AnalyticsResp }) => {
  const cur = data.currency; const rows = regionCalc(data.regions); const total = rows.reduce((a, r) => a + r.leads, 0); const noLoc = rows.find((r) => r.kind === "none");
  const chart = rows.map((r) => ({ name: r.label, leads: r.leads, sold: r.sold }));
  return (
    <Panel title="Retorno por região" testId="mkt-an-regions" hint={<Hint title="Região do lead">Zona de São Paulo capital (preenchida no quiz ou no cadastro) ou cidade informada. Mostra o que cada região entrega — leads, agendamentos, vendas e receita —, não o custo: o investimento em anúncios não é medido por região.</Hint>}>
      {rows.length === 0 ? <StateLine testId="mkt-an-regions-empty">Nenhum lead neste período e escopo.</StateLine> : (
        <div className="grid gap-3">
          <div style={{ height: Math.max(150, rows.length * 40 + 30) }} data-testid="mkt-an-region-chart" role="img" aria-label={`Leads e vendas por região: ${rows.map((r) => `${r.label} ${r.leads} leads ${r.sold} vendas`).join("; ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }} barCategoryGap={8} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={104} tick={chartTick} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted) / .4)" }} {...tooltipStyle} />
                <Bar dataKey="leads" name="Leads" fill="hsl(var(--chart-1))" radius={[0, 3, 3, 0]} isAnimationActive={false}><LabelList dataKey="leads" position="right" fontSize={11.5} fontWeight={700} /></Bar>
                <Bar dataKey="sold" name="Vendas" fill="hsl(var(--chart-2))" radius={[0, 3, 3, 0]} isAnimationActive={false}><LabelList dataKey="sold" position="right" fontSize={11.5} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 text-[11.5px] text-muted-foreground -mt-1" aria-hidden><span><span style={{ color: "hsl(var(--chart-1))" }}>■</span> Leads</span><span><span style={{ color: "hsl(var(--chart-2))" }}>■</span> Vendas</span></div>
          <ul className="grid gap-1.5" data-testid="mkt-an-regions-list">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t border-border pt-1.5 text-[12px]" data-testid="mkt-an-region-row" data-leads={r.leads}>
                <span className="font-medium" title={r.label}>{r.label}</span>
                <span className="tabular text-muted-foreground"><b className="text-foreground">{nfi(r.leads)}</b> leads · {nfi(r.scheduled)} agend. ({fmtRate(r.schedRate, 0)}) · <b className="text-foreground">{nfi(r.sold)}</b> vendas ({r.conv == null ? "Sem base" : fmtRate(r.conv)}) · {fmtValue("revenue", r.revenue, cur)}</span>
              </li>))}
          </ul>
          {noLoc && total > 0 && noLoc.leads / total >= 0.3 && <p className="text-[12px] text-muted-foreground" data-testid="mkt-an-region-warn">{fmtRate(rate(noLoc.leads, total), 0)} dos leads estão sem localização: peça cidade (e zona em São Paulo) no formulário para este quadro ficar completo.</p>}
        </div>)}
    </Panel>
  );
};

// ================================================================= 5) dia da semana e horário
export const HoursBlock = ({ data }: { data: AnalyticsResp }) => {
  const { grid, max, total } = bandGrid(data.hours.heat); const slot = bestSlot(data.hours.heat); const fr = new Map(data.hours.first_response.map((x) => [x.band, x]));
  return (
    <Panel title="Dia da semana e horário" testId="mkt-an-hours" hint={<Hint title="Quando os leads chegam">Quantidade de leads do grupo por dia da semana e faixa de 4 horas (horário de Brasília), a partir da data de captação. A linha de baixo mostra a mediana do tempo até o primeiro contato, por faixa de chegada.</Hint>}>
      {total === 0 ? <StateLine testId="mkt-an-hours-empty">Nenhum lead neste período e escopo.</StateLine> : (
        <div className="grid gap-3">
          <div className="overflow-x-auto"><div className="grid gap-1 min-w-[300px]" style={{ gridTemplateColumns: "2.6rem repeat(6, minmax(0, 1fr))" }} role="table" aria-label="Leads por dia da semana e faixa de horário" data-testid="mkt-an-heat">
            <span />{[0, 1, 2, 3, 4, 5].map((b) => <span key={b} className="text-[10.5px] text-muted-foreground text-center whitespace-nowrap">{bandLabel(b)}</span>)}
            {grid.map((row, d) => (
              <Fragment key={d}><span className="text-[11.5px] text-muted-foreground self-center" title={DOW_FULL[d]}>{DOW[d]}</span>
                {row.map((n, b) => { const a = n > 0 ? 0.12 + 0.78 * (n / max) : 0; return (
                  <span key={b} role="cell" data-n={n} className="h-8 rounded flex items-center justify-center text-[11.5px] tabular font-medium" title={`${DOW_FULL[d]}, ${bandLabel(b)}: ${n} lead${n === 1 ? "" : "s"}`}
                    style={n > 0 ? { background: `hsl(var(--primary) / ${a.toFixed(2)})`, color: a > 0.5 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))" } : { background: "hsl(var(--muted) / .5)" }}>{n > 0 ? n : ""}</span>); })}</Fragment>))}
            <span className="text-[10.5px] text-muted-foreground self-center leading-tight" title="Mediana do tempo até o primeiro contato">1º contato</span>
            {[0, 1, 2, 3, 4, 5].map((b) => { const x = fr.get(b); return <span key={b} className="text-[11px] text-center tabular text-muted-foreground" title={x ? `${x.n} lead(s) com contato` : "nenhum contato registrado"}>{x ? fmtMinutes(x.median_min) : "—"}</span>; })}
          </div></div>
          {slot ? <p className="text-[12.5px]" data-testid="mkt-an-slot">Mais chegadas: <b>{DOW_FULL[slot.dow]}, {bandLabel(slot.band)}</b> — {nfi(slot.n)} leads ({fmtRate(slot.share, 0)} do grupo).</p>
            : <p className="text-[12.5px] text-muted-foreground">Menos de {MIN_VOLUME} leads: ainda é pouco para apontar o melhor dia e horário.</p>}
        </div>)}
    </Panel>
  );
};

// ================================================================= 6) retorno por mês de captação
export const MonthlyBlock = ({ data }: { data: AnalyticsResp }) => {
  const [tri, setTri] = useState(false); const cur = data.currency; const rows = data.monthly.rows.filter((r) => r.leads > 0 || (r.spend ?? 0) > 0); const width = Math.max(0, ...rows.map((r) => r.cum.length));
  const chart = rows.map((r) => ({ name: monthLabel(r.month), invested: r.spend, received: lastCum(r) }));
  const drawable = chart.some((c) => c.invested != null || (c.received ?? 0) > 0);
  const axis = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`);
  return (
    <Panel title="Retorno por mês de captação" testId="mkt-an-monthly" hint={<Hint title="Quanto cada mês já devolveu">Para cada mês, pega os leads captados nele e soma o que esse grupo já pagou (recebimentos líquidos de estorno) até hoje, comparando com o investimento do mesmo mês. “Pago” = recebido ≥ investido. Meses recentes ainda estão em andamento. Mostra os últimos 12 meses do período.</Hint>}
      right={rows.length > 0 && width > 1 ? <Toggle on={tri} onClick={() => setTri(!tri)} label="mês a mês" /> : undefined}>
      {rows.length === 0 ? <StateLine testId="mkt-an-monthly-empty">Nenhum lead captado neste período e escopo.</StateLine> : (
        <div className="grid gap-3">
          {drawable && (
            <div data-testid="mkt-an-monthly-chart">
              <div className="flex gap-4 text-[12px] mb-1" aria-hidden><span><span style={{ color: "hsl(var(--chart-6))" }}>■</span> Investido</span><span><span style={{ color: "hsl(var(--chart-1))" }}>■</span> Recebido até hoje</span></div>
              <div style={{ height: 220 }} role="img" aria-label={`Investido e recebido por mês de captação: ${chart.map((c) => `${c.name} investido ${c.invested ?? "sem base"} recebido ${c.received ?? "sem base"}`).join("; ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 14, right: 8, left: 0, bottom: 0 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
                    <XAxis dataKey="name" tick={chartTick} tickLine={false} axisLine={false} />
                    <YAxis tick={chartTick} tickLine={false} axisLine={false} width={66} tickFormatter={axis} />
                    <Tooltip cursor={{ fill: "hsl(var(--muted) / .4)" }} {...tooltipStyle} formatter={(v: number | null, n: string) => [fmtValue("revenue", v, cur), n]} />
                    <Bar dataKey="invested" name="Investido" fill="hsl(var(--chart-6))" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                    <Bar dataKey="received" name="Recebido" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>)}
          <ul className="grid gap-2" data-testid="mkt-an-monthly-list">
            {rows.map((r) => { const rec = lastCum(r); const st = paybackOf(r.spend, rec); const prog = r.spend && r.spend > 0 && rec != null ? (rec / r.spend) * 100 : 0; return (
              <li key={r.month} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-border pt-1.5 text-[12px]" data-testid="mkt-an-month-row" data-payback={st} data-leads={r.leads}>
                <span className="font-semibold">{monthLabel(r.month)}</span>
                <span className="tabular text-muted-foreground">{nfi(r.leads)} leads · {nfi(r.sold)} vendas · {st === "nobase" ? "sem investimento coletado" : st === "paid" ? <b className="text-foreground">já pagou o investimento{rec != null && r.spend ? ` (${(rec / r.spend).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x)` : ""}</b> : <>recebeu <b className="text-foreground">{fmtRate(prog, 0)}</b> do investido</>}</span>
              </li>); })}
          </ul>
          {tri && (
            <div className="overflow-x-auto" data-testid="mkt-an-triangle"><table className="w-full text-[12px] min-w-[420px]"><thead><tr className="text-muted-foreground text-[11px]"><th className="text-left py-1 pr-2 font-medium">Mês</th>{Array.from({ length: width }, (_, k) => <th key={k} className="px-1.5 text-right font-medium">+{k}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.month} className="border-t border-border"><td className="py-1.5 pr-2">{monthLabel(r.month)}</td>
                  {Array.from({ length: width }, (_, k) => { const v = r.cum[k]; const st = v == null ? "nobase" : paybackOf(r.spend, v); return <td key={k} className="px-1.5 text-right tabular" style={st === "paid" ? { fontWeight: 700, boxShadow: "inset 0 -2px 0 hsl(var(--primary))" } : undefined} title={v == null ? "mês ainda não chegou" : undefined}>{v == null ? "" : fmtValue("revenue", v, cur)}</td>; })}</tr>))}</tbody></table>
              <p className="text-[11px] text-muted-foreground mt-1">Recebido acumulado do grupo no mês da captação (+0) e nos meses seguintes. Sublinhado = já cobriu o investimento do mês.</p></div>)}
        </div>)}
    </Panel>
  );
};
