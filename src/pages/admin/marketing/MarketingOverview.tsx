import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "@/lib/ui";
import { InfoTip, Panel, StateLine, SyncStrip, rangeLabel } from "./MktDashParts";
import { ChannelCompare, TrendChart } from "./MktDashCharts";
import { CampaignCards, FunnelBlock, KpiGrid } from "./MktDashBlocks";
import { useFunnels } from "./MktFunnelVisual";
import { MktAssistantButton, MktFilterBar, SevBadge, useDetail } from "./MktParts";
import { fmtDay, money, rpcArgs, useMktFilters, useMktOptions, useMktRpc, type CampaignRow, type KpisResp, type QualityItem, type Reconciliation, type SeriesResp } from "./mktApi";
import { OBJECTIVE_LABEL, PRESETS, objectiveOf, type MetricKey, type OverviewResp } from "./mktMetrics";

/** Visão geral e gestão de tráfego: cartões compactos por objetivo, evolução com escolha de métrica, Meta × Google, funil por coorte e campanhas em cartões.
 *  Tudo respeita o mesmo período, comparação e filtros; onde um filtro não se aplica (plataforma na comparação de canais), a tela diz. */
const MarketingOverview = () => {
  const f = useMktFilters("event", "hub"); const d = useDetail(f); const compare = f.period.compare;
  const opts = useMktOptions().data;
  const a = rpcArgs(f, { p_view: f.view });
  const kp = useMktRpc<KpisResp>("mkt_kpis", a); const se = useMktRpc<SeriesResp>("mkt_series", a); const ct = useMktRpc<{ rows: CampaignRow[]; currency: string }>("mkt_campaign_table", a); const ov = useMktRpc<OverviewResp>("mkt_overview", a);
  const noPlatform = { ...f.filters }; delete noPlatform.platform;
  const ovCh = useMktRpc<OverviewResp>("mkt_overview", rpcArgs(f, { p_view: f.view, p_filters: noPlatform }));
  const prevR = kp.data?.previous_period; const prevArgs = prevR ? { p_from: prevR.from, p_to: prevR.to, p_filters: f.filters, p_view: f.view } : {};
  const seP = useMktRpc<SeriesResp>("mkt_series", prevArgs, compare && !!prevR); const ovP = useMktRpc<OverviewResp>("mkt_overview", prevArgs, compare && !!prevR);
  const rc = useMktRpc<Reconciliation>("mkt_reconciliation", rpcArgs(f)); const ql = useMktRpc<{ items: QualityItem[] }>("mkt_quality", rpcArgs(f));
  const funnels = useFunnels().data?.funnels ?? [];

  const k = kp.data; const cur = k?.currency ?? "BRL";
  const objective = objectiveOf((ct.data?.rows ?? []).map((r) => r.primary_result)); const metrics = PRESETS[objective];
  const [pick, setPick] = useState<MetricKey>("spend"); const metric = metrics.includes(pick) ? pick : metrics[0];
  const frontLabel = f.get("frente") ? (opts?.fronts.find((x) => x.id === f.get("frente"))?.label ?? null) : null;
  const attention = (ql.data?.items ?? []).filter((i) => i.count > 0 && i.severity !== "info");
  const failed = kp.isError;

  return (
    <div data-testid="mkt-overview">
      <PageHead eyebrow="Marketing" title="Visão geral" hint="Do anúncio ao protocolo vendido: investimento, leads, vendas e retorno, com a origem e a cobertura dos dados à vista." actions={<MktAssistantButton f={f} />} />
      <MktFilterBar f={f} />
      <div className="grid gap-3">
        {failed ? <StateLine tone="danger" role="alert" testId="mkt-load-error" action={<button type="button" className="text-primary font-medium hover:underline" onClick={() => void kp.refetch()}>Tentar de novo</button>}>Falha ao carregar os indicadores. Os valores abaixo podem estar desatualizados.</StateLine> : null}
        <SyncStrip c={k?.coverage} model={k?.model} view={f.view} to={f.range.to} />
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground" data-testid="mkt-objective">
          <span>Cartões para: <b className="text-foreground">{OBJECTIVE_LABEL[objective]}</b></span>
          <InfoTip title="Cartões por objetivo">Os cartões seguem o resultado principal que o administrador definiu nas campanhas do escopo (não o objetivo original da plataforma). Escopo misto ou sem classificação usa captação de leads. Campanhas de “Reconhecimento de marca” priorizam impressões, CPM e cliques; de vendas, vendas, receita e ROAS.</InfoTip>
          {objective === "capture" && (ct.data?.rows ?? []).some((r) => r.class_state === "pending") && <Link to="/admin/marketing/campanhas" className="text-primary hover:underline">Há campanhas aguardando classificação</Link>}
        </div>

        <KpiGrid metrics={metrics} kp={k} ov={ov.data} ovPrev={ovP.data} compare={compare} points={se.data?.points} selected={metric} onSelect={setPick} onOpen={(kind, t) => d.open(kind, t)} currency={cur} loading={kp.isLoading} />

        <TrendChart metric={metric} onMetric={setPick} choices={metrics} points={se.data?.points} prevPoints={seP.data?.points} granularity={se.data?.granularity ?? "day"} currency={cur} compare={compare} prevRange={prevR ? rangeLabel(prevR.from, prevR.to) : undefined} />

        <div className="grid gap-3 lg:grid-cols-2 items-start">
          <ChannelCompare channels={ovCh.data?.channels} currency={cur} ignoresPlatform={!!f.get("plataforma")} />
          <FunnelBlock f={f} funnels={funnels} frontLabel={frontLabel} onOpen={(kind, t, v) => d.open(kind, t, v)} range={rangeLabel(f.range.from, f.range.to)} />
        </div>

        <CampaignCards rows={ct.data?.rows} currency={ct.data?.currency ?? cur} f={f} loading={ct.isLoading} error={ct.isError} onRetry={() => void ct.refetch()} />

        <Panel title="Conferência e qualidade dos dados" testId="mkt-quality-strip" hint={`Período ${fmtDay(f.range.from)} a ${fmtDay(f.range.to)}.`}
          right={<Link to="/admin/marketing/funil" className="text-[12.5px] text-primary font-medium hover:underline">Ver controles e fórmulas</Link>}>
          <div className="grid gap-2 text-[13px]" data-testid="mkt-reconciliation">
            {rc.data ? <p>Investimento total <b className="tabular">{money(rc.data.total, rc.data.currency, 0)}</b> {rc.data.reconciles ? "= soma das partes (confere)." : <b style={{ color: "hsl(var(--destructive))" }}>não confere com a soma das partes — revise.</b>}
              {rc.data.excluded_by_overlap > 0 ? ` ${money(rc.data.excluded_by_overlap, rc.data.currency, 0)} de lançamentos substituídos pela coleta ficaram de fora.` : ""}</p> : <p className="text-muted-foreground">Sem base de conferência no período.</p>}
            {attention.length === 0 ? <p className="text-muted-foreground">Nenhum controle de qualidade precisa de atenção.</p> : (
              <ul className="flex flex-wrap gap-x-4 gap-y-1">{attention.map((i) => <li key={i.key} className="inline-flex items-center gap-1.5"><SevBadge s={i.severity} /><button type="button" className="text-primary hover:underline text-left" onClick={() => d.open(i.detail, i.label)}>{i.label}: <b className="tabular">{i.count}</b></button></li>)}</ul>)}
          </div>
        </Panel>
      </div>
      {d.sheet}
    </div>
  );
};
export default MarketingOverview;
