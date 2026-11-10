import { Link } from "react-router-dom";
import { Percent, Timer, TrendingDown, Users } from "lucide-react";
import { PageHead } from "@/lib/ui";
import { InfoTip, MetricCard, StateLine } from "./MktDashParts";
import { DropoffBlock, HoursBlock, MonthlyBlock, QualityBlock, RegionBlock, TimingBlock } from "./MktAnalyticsBlocks";
import { MktAssistantButton, MktFilterBar } from "./MktParts";
import { fmtDay, rpcArgs, useMktFilters, useMktRpc } from "./mktApi";
import { STAGES, biggestLoss, dropSteps, fmtDays, fmtRate, rate, type AnalyticsResp } from "./mktAnalytics";

const nfi = (v: number) => v.toLocaleString("pt-BR");
const shortOf = (label: string) => (label === "Leads captados" ? "Leads" : STAGES.find((s) => s.label === label)?.short ?? label);

/** Análises: o porquê dos números. Sempre por grupo de leads (captados no período, acompanhados até hoje); os filtros e o período são os mesmos das outras telas do Marketing. */
const MarketingAnalytics = () => {
  const f = useMktFilters("cohort", "hub");
  const q = useMktRpc<AnalyticsResp>("mkt_analytics", rpcArgs(f)); const d = q.data;
  const steps = d ? dropSteps(d.dropoff.overall) : []; const worst = d ? biggestLoss(steps) : null;
  const sold = d?.timing.overall.sold; const conv = d ? rate(d.dropoff.overall.sold, d.leads) : null;
  const empty = d && d.leads === 0;
  return (
    <div data-testid="mkt-analytics">
      <PageHead eyebrow="Marketing" title="Análises" hint="Por que os números são o que são: tempo, perdas, qualidade das campanhas, região, horário e retorno por mês, sempre sobre os leads captados no período." actions={<MktAssistantButton f={f} />} />
      <MktFilterBar f={f} showView={false} />
      <div className="grid gap-3">
        {q.isError ? <StateLine tone="danger" role="alert" testId="mkt-an-error" action={<button type="button" className="text-primary font-medium hover:underline" onClick={() => void q.refetch()}>Tentar de novo</button>}>Falha ao carregar as análises.</StateLine> : null}
        <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground" data-testid="mkt-an-basis">
          <span>Leads captados de <b className="text-foreground">{fmtDay(f.range.from)}</b> a <b className="text-foreground">{fmtDay(f.range.to)}</b>, acompanhados até hoje.</span>
          <InfoTip title="Como as análises contam">Um lead é uma pessoa captada no período (uma por pessoa, na primeira oportunidade ligada a uma campanha). Cada etapa conta quem a atingiu e as vendas e recebimentos são do mesmo grupo — por isso os números respondem “o que aconteceu com quem chegou no período”. Leads recentes ainda podem avançar. Sem base aparece como “Sem base”, nunca como zero.</InfoTip>
          <Link to="/admin/marketing" className="text-primary hover:underline">Voltar à visão geral</Link>
        </p>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="mkt-an-cards">
          {q.isLoading && !d ? [0, 1, 2, 3].map((i) => <div key={i} className="rounded-xl border border-border bg-card min-h-[110px] animate-pulse" aria-hidden />) : (<>
            <MetricCard testId="mkt-an-card-leads" label="Leads do período" shortLabel="Leads" icon={Users} value={d ? nfi(d.leads) : "—"} noBase={!d || d.leads === 0} reason="Nenhum lead no período" info={<p>Pessoas captadas no período e ligadas a uma campanha do escopo (uma por pessoa).</p>} />
            <MetricCard testId="mkt-an-card-sale-time" label="Tempo até a primeira venda" shortLabel="Até a venda" icon={Timer} value={fmtDays(sold?.median_days)} noBase={sold?.median_days == null} reason="Nenhuma venda no grupo" note={sold ? `${nfi(sold.n)} venda${sold.n === 1 ? "" : "s"} no grupo` : null}
              info={<p>Mediana de dias corridos entre a captação do lead e a primeira venda confirmada. Só conta leads que já compraram.</p>} />
            <MetricCard testId="mkt-an-card-conv" label="Lead → venda" icon={Percent} value={fmtRate(conv)} noBase={conv == null} reason="Sem leads no período" note={d ? `${nfi(d.dropoff.overall.sold)} de ${nfi(d.leads)} leads` : null}
              info={<p>Leads do grupo com venda confirmada ÷ leads do grupo. Leads recentes ainda podem comprar.</p>} />
            <MetricCard testId="mkt-an-card-worst" label="Maior perda do funil" shortLabel="Maior perda" icon={TrendingDown} value={worst ? fmtRate(worst.step.lostPct, 0) : "Sem base"} noBase={!worst} reason={d && d.leads > 0 ? `Menos de 10 leads por etapa` : "Sem leads no período"}
              note={worst ? `${shortOf(worst.prevLabel)} → ${shortOf(worst.step.label)}` : null} info={<p>A etapa em que a maior parte dos leads fica pelo caminho em relação à etapa anterior. Só é apontada com 10 leads ou mais na etapa anterior.</p>} />
          </>)}
        </div>

        {empty ? <StateLine testId="mkt-an-empty" action={<Link to="/admin/marketing/integracoes" className="text-primary font-medium hover:underline">Ver integrações</Link>}>Nenhum lead captado neste período e escopo. Amplie o período ou ajuste os filtros; as análises aparecem quando houver leads ligados a campanhas.</StateLine> : null}

        {d && !empty && (<>
          <QualityBlock data={d} />
          <div className="grid gap-3 xl:grid-cols-2 items-start"><DropoffBlock data={d} /><TimingBlock data={d} /></div>
          <div className="grid gap-3 xl:grid-cols-2 items-start"><RegionBlock data={d} /><HoursBlock data={d} /></div>
          <MonthlyBlock data={d} />
        </>)}
      </div>
    </div>
  );
};
export default MarketingAnalytics;
