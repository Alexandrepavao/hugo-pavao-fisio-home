import { Fragment, useState, type ReactNode } from "react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { tooltipStyle } from "@/lib/IndicatorCharts";
import { MKT_COLORS, PLATFORM_LABEL } from "./mktApi";
import { InfoTip, Panel, StateLine } from "./MktDashParts";
import { fmtValue } from "./mktMetrics";
import {
  DOW, DOW_FULL, MIN_VOLUME, READING, STAGES, bandGrid, bandLabel, bestSlot, biggestLoss, dropSteps, fmtDays, fmtMinutes, fmtRate, lastCum, median, monthLabel, paybackOf, qualityCalc, rate, regionCalc,
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
const Bar = ({ pct, color = "hsl(var(--primary))" }: { pct: number; color?: string }) => <span className="block h-2 rounded-full bg-muted overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`, background: color }} /></span>;

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
export const DropoffBlock = ({ data }: { data: AnalyticsResp }) => {
  const [by, setBy] = useState(false); const d = data.dropoff; const steps = dropSteps(d.overall); const worst = biggestLoss(steps); const first = Math.max(1, d.overall.leads);
  const maxLost = Math.max(1, ...d.lost_reasons.map((x) => x.n));
  return (
    <Panel title="Onde os leads se perdem" testId="mkt-an-dropoff" hint={<Hint title="Perda etapa a etapa">Mostra quantos leads do grupo chegaram a cada etapa e quantos ficaram pelo caminho em relação à etapa anterior. “Maior perda” só é apontada quando a etapa anterior tem {MIN_VOLUME} leads ou mais.</Hint>}
      right={d.by_campaign.length > 1 ? <Toggle on={by} onClick={() => setBy(!by)} label="por campanha" /> : undefined}>
      {d.overall.leads === 0 ? <StateLine>Nenhum lead captado neste período e escopo.</StateLine> : (
        <div className="grid gap-4">
          <ol className="grid gap-1.5" data-testid="mkt-an-drop-steps">
            {steps.map((s, i) => (
              <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-1" data-testid={`mkt-an-drop-${s.key}`}>
                <div className="min-w-0"><div className="flex items-center gap-2 text-[12.5px] font-medium"><span className="truncate">{s.label}</span>
                  {worst?.step.key === s.key && <span className="text-[10.5px] rounded-full px-2 py-px whitespace-nowrap" style={{ background: "hsl(var(--warning-soft))", border: "1px solid hsl(var(--warning) / .5)" }}>Maior perda</span>}</div>
                  <div className="mt-1"><Bar pct={(s.count / first) * 100} /></div></div>
                <div className="text-right leading-tight"><p className="tabular text-[17px] font-bold">{nfi(s.count)}</p>
                  {i > 0 && <p className="text-[11px] text-muted-foreground tabular">{fmtRate(s.fromPrev)} da anterior{s.lost > 0 ? ` · −${nfi(s.lost)}` : ""}</p>}</div>
              </li>))}
          </ol>
          {worst ? <p className="text-[12.5px]" data-testid="mkt-an-worst">Maior perda: entre <b>{worst.prevLabel}</b> e <b>{worst.step.label}</b> — {fmtRate(worst.step.lostPct, 0)} dos leads ficaram por aqui ({nfi(worst.step.lost)} de {nfi(steps[steps.findIndex((s) => s.key === worst.step.key) - 1].count)}).</p>
            : <p className="text-[12.5px] text-muted-foreground">Volume pequeno (menos de {MIN_VOLUME} leads na etapa anterior): ainda não dá para apontar onde mais se perde.</p>}
          <div>
            <p className="text-[12.5px] font-semibold mb-1.5">Motivos de perda {d.lost_total > 0 ? <span className="font-normal text-muted-foreground">({nfi(d.lost_total)} oportunidades perdidas)</span> : null}</p>
            {d.lost_reasons.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nenhuma oportunidade do grupo foi marcada como perdida.</p> : (
              <ul className="grid gap-1.5" data-testid="mkt-an-lost">{d.lost_reasons.map((x) => (
                <li key={x.reason} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-2 text-[12.5px]"><span className="truncate" title={x.reason}>{x.reason}</span><Bar pct={(x.n / maxLost) * 100} color="hsl(var(--chart-6))" /><span className="tabular font-semibold">{nfi(x.n)}</span></li>))}</ul>)}
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
  const [by, setBy] = useState(false); const t = data.timing; const max = Math.max(0.0001, ...STAGES.map((s) => t.overall[s.key]?.median_days ?? 0));
  const anyData = STAGES.some((s) => (t.overall[s.key]?.n ?? 0) > 0);
  return (
    <Panel title="Tempo até cada etapa" testId="mkt-an-timing" hint={<Hint title="Tempo desde a captação">Mediana, em dias corridos, do momento em que o lead chegou até a primeira vez que atingiu a etapa. Conta só quem chegou à etapa; leads recentes ainda podem avançar, então os números tendem a subir com o tempo.</Hint>}
      right={t.by_campaign.length > 1 && anyData ? <Toggle on={by} onClick={() => setBy(!by)} label="por campanha" /> : undefined}>
      {!anyData ? <StateLine testId="mkt-an-timing-empty">Nenhum lead do grupo chegou a contato, agendamento, comparecimento ou venda ainda — sem base para medir tempo.</StateLine> : (
        <div className="grid gap-4">
          <ul className="grid gap-2.5" data-testid="mkt-an-timing-list">
            {STAGES.map((s) => { const st = t.overall[s.key]; return (
              <li key={s.key} className="grid grid-cols-[7.5rem_1fr_auto] sm:grid-cols-[9rem_1fr_auto] items-center gap-3" data-testid={`mkt-an-time-${s.key}`}>
                <span className="text-[12.5px] font-medium truncate">{s.label}</span>
                {st && st.median_days != null ? <Bar pct={(st.median_days / max) * 100} /> : <span className="text-[12px] text-muted-foreground">Sem base</span>}
                <span className="text-right leading-tight"><span className="block tabular text-[15px] font-bold">{st ? fmtDays(st.median_days) : "—"}</span><span className="block text-[11px] text-muted-foreground tabular">{st ? `${nfi(st.n)} lead${st.n === 1 ? "" : "s"}${st.avg_days != null ? ` · média ${fmtDays(st.avg_days)}` : ""}` : "nenhum lead"}</span></span>
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
  const cur = data.currency; const rows = regionCalc(data.regions); const max = Math.max(1, ...rows.map((r) => r.leads)); const total = rows.reduce((a, r) => a + r.leads, 0); const noLoc = rows.find((r) => r.kind === "none");
  return (
    <Panel title="Retorno por região" testId="mkt-an-regions" hint={<Hint title="Região do lead">Zona de São Paulo capital (preenchida no quiz ou no cadastro) ou cidade informada. Mostra o que cada região entrega — leads, agendamentos, vendas e receita —, não o custo: o investimento em anúncios não é medido por região.</Hint>}>
      {rows.length === 0 ? <StateLine testId="mkt-an-regions-empty">Nenhum lead neste período e escopo.</StateLine> : (
        <div className="grid gap-3">
          <ul className="grid gap-2.5" data-testid="mkt-an-regions-list">
            {rows.map((r) => (
              <li key={r.key} className="grid gap-1" data-testid="mkt-an-region-row" data-leads={r.leads}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><span className="text-[12.5px] font-medium" title={r.label}>{r.label}</span>
                  <span className="text-[12px] tabular text-muted-foreground"><b className="text-foreground">{nfi(r.leads)}</b> leads · {nfi(r.scheduled)} agend. · <b className="text-foreground">{nfi(r.sold)}</b> vendas · {fmtValue("revenue", r.revenue, cur)}</span></div>
                <Bar pct={(r.leads / max) * 100} color={r.kind === "none" ? "hsl(var(--chart-6))" : undefined} />
                <p className="text-[11px] text-muted-foreground tabular">{fmtRate(r.schedRate, 0)} agendaram · {r.conv == null ? "Sem base" : `${fmtRate(r.conv)} compraram`}</p>
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
  return (
    <Panel title="Retorno por mês de captação" testId="mkt-an-monthly" hint={<Hint title="Quanto cada mês já devolveu">Para cada mês, pega os leads captados nele e soma o que esse grupo já pagou (recebimentos líquidos de estorno) até hoje, comparando com o investimento do mesmo mês. “Pago” = recebido ≥ investido. Meses recentes ainda estão em andamento. Mostra os últimos 12 meses do período.</Hint>}
      right={rows.length > 0 && width > 1 ? <Toggle on={tri} onClick={() => setTri(!tri)} label="mês a mês" /> : undefined}>
      {rows.length === 0 ? <StateLine testId="mkt-an-monthly-empty">Nenhum lead captado neste período e escopo.</StateLine> : (
        <div className="grid gap-3">
          <ul className="grid gap-3" data-testid="mkt-an-monthly-list">
            {rows.map((r) => { const rec = lastCum(r); const st = paybackOf(r.spend, rec); const prog = r.spend && r.spend > 0 && rec != null ? (rec / r.spend) * 100 : 0; return (
              <li key={r.month} className="grid gap-1" data-testid="mkt-an-month-row" data-payback={st} data-leads={r.leads}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"><span className="text-[12.5px] font-semibold">{monthLabel(r.month)}</span>
                  <span className="text-[12px] tabular text-muted-foreground">{nfi(r.leads)} leads · {nfi(r.sold)} vendas · investido <b className="text-foreground">{fmtValue("spend", r.spend, cur)}</b> · recebido <b className="text-foreground">{fmtValue("revenue", rec, cur)}</b></span></div>
                {st === "nobase" ? <p className="text-[11.5px] text-muted-foreground">Sem investimento coletado neste mês: não dá para comparar.</p> : (
                  <><Bar pct={Math.min(100, prog)} /><p className="text-[11.5px] text-muted-foreground tabular">{st === "paid" ? <b className="text-foreground">Já pagou o investimento</b> : <>Recebeu <b className="text-foreground">{fmtRate(prog, 0)}</b> do que foi investido</>}{st === "paid" && rec != null && r.spend ? ` · ${(rec / r.spend).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x` : ""}</p></>)}
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

