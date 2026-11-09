import { Link } from "react-router-dom";
import { PageHead, State, Table, Td, Badge, KpiGrid, LevelSection } from "@/lib/ui";
import { AreaTrend } from "@/lib/IndicatorCharts";
import { CoverageBanner, MktFilterBar, MktKpi, SevBadge, useDetail } from "./MktParts";
import { MKT_COLORS, PLATFORM_LABEL, fmtDay, kpiOf, money, num, prevOf, rpcArgs, useMktFilters, useMktRpc, type CampaignRow, type FunnelResp, type KpisResp, type QualityItem, type Reconciliation, type SeriesResp } from "./mktApi";

const FUNNEL_DETAIL: Record<string, string> = { lead: "lead", qualified: "qualified", scheduled: "scheduled", attended: "attended", sold: "sold", received: "received" };

/** Visão geral do Marketing: jornada anúncio → lead → qualificação → agendamento → comparecimento → venda → recebimento, com a cobertura dos dados à vista. */
const MarketingOverview = () => {
  const f = useMktFilters("event", "hub"); const d = useDetail(f);
  const a = rpcArgs(f, { p_view: f.view });
  const kp = useMktRpc<KpisResp>("mkt_kpis", a); const fn = useMktRpc<FunnelResp>("mkt_funnel", a); const se = useMktRpc<SeriesResp>("mkt_series", a);
  const ct = useMktRpc<{ rows: CampaignRow[] }>("mkt_campaign_table", a); const rc = useMktRpc<Reconciliation>("mkt_reconciliation", rpcArgs(f)); const ql = useMktRpc<{ items: QualityItem[] }>("mkt_quality", rpcArgs(f));
  const k = kp.data; const cur = k?.currency ?? "BRL"; const open = (kind: string, title: string) => d.open(kind, title);
  const top = (ct.data?.rows ?? []).slice(0, 8); const maxCount = Math.max(1, ...(fn.data?.steps ?? []).map((s) => s.count ?? 0));
  const attention = (ql.data?.items ?? []).filter((i) => i.count > 0 && i.severity !== "info");
  return (
    <div data-testid="mkt-overview">
      <PageHead eyebrow="Marketing" title="Visão geral" hint="Acompanhe o caminho do anúncio ao recebimento: investimento nas plataformas, leads, qualificação, agenda, vendas e valores recebidos — sempre com a origem e a cobertura dos dados." />
      <MktFilterBar f={f} />
      <State loading={kp.isLoading} error={kp.error} />
      <CoverageBanner c={k?.coverage} model={k?.model} view={f.view} />
      {k && (<>
        <LevelSection level="summary" title="Resultado do período" hint={`Por ${f.view === "cohort" ? "coorte de captação (leads captados no período, com o que aconteceu até hoje)" : "data do evento (cada etapa na sua data)"}. Clique para ver os registros.`}>
          <KpiGrid kind="hero">
            {(["spend", "qualified", "new_buyers", "sold", "received", "roas_sales"] as const).map((key) => <MktKpi key={key} k={key === "roas_sales" ? { ...kpiOf(k, key)!, label: "Retorno (ROAS sobre vendas)" } : kpiOf(k, key)} prev={prevOf(k, key)} currency={cur} onOpen={open} short />)}
          </KpiGrid>
          {Object.keys(k.other_currencies).length > 0 && <p className="text-[12.5px] text-muted-foreground mt-2">Há gasto em outra moeda ({Object.entries(k.other_currencies).map(([c, v]) => money(v.spend, c)).join(", ")}) que <b>não</b> foi somado ao investimento (sem conversão).</p>}
        </LevelSection>

        <LevelSection level="summary" title="Funil: contagem e conversão" hint="Cada etapa conta pessoas/oportunidades atribuídas a campanhas pagas. A conversão é calculada pelos totais (etapa ÷ etapa anterior).">
          <section className="hp-card p-5" aria-label="Funil" data-testid="mkt-funnel">
            {fn.data?.steps.map((s) => (
              <button key={s.key} type="button" disabled={!s.available} onClick={() => open(FUNNEL_DETAIL[s.key], s.label)} className="w-full text-left grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 py-1.5 hover:bg-muted/40 rounded">
                <span className="text-sm font-medium">{s.label}</span>
                <span className="h-5 rounded bg-muted overflow-hidden"><span className="block h-full rounded" style={{ width: `${s.available ? Math.max(2, ((s.count ?? 0) / maxCount) * 100) : 0}%`, background: "hsl(var(--chart-1))" }} /></span>
                <span className="text-sm tabular text-right min-w-[11rem]">{s.available ? <><b>{num(s.count)}</b>{s.rate_from_previous != null && <span className="text-muted-foreground"> · {s.rate_from_previous.toLocaleString("pt-BR")}% da etapa anterior</span>}</> : <span className="text-muted-foreground">Não disponível</span>}</span>
              </button>))}
            <p className="text-xs text-muted-foreground mt-3">{fn.data?.basis}</p>
            {fn.data?.steps.some((s) => !s.available) && <p className="text-xs text-muted-foreground mt-1">{fn.data?.steps.find((s) => !s.available)?.reason} <Link to="/admin/marketing/configuracoes" className="text-accent hover:underline">Configurar</Link></p>}
          </section>
        </LevelSection>

        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          <AreaTrend title={`Evolução ${se.data?.granularity === "week" ? "semanal" : "diária"} do investimento`} hint="Dias sem coleta aparecem sem dado — não como zero." data={(se.data?.points ?? []).map((p) => ({ dia: fmtDay(p.day), Investimento: p.spend }))} xKey="dia"
            series={[{ key: "Investimento", label: "Investimento", color: MKT_COLORS[0] }]} format={(v) => money(v, cur, 0)} isEmpty={!(se.data?.points ?? []).some((p) => p.spend != null)} empty="Sem gasto coletado no período." />
          <AreaTrend title="Leads, qualificados e vendas" hint="Eventos confirmados no Hub (atribuídos a campanhas)." data={(se.data?.points ?? []).map((p) => ({ dia: fmtDay(p.day), Leads: p.leads, Qualificados: p.qualified, Vendas: p.sales }))} xKey="dia"
            series={[{ key: "Leads", label: "Leads", color: MKT_COLORS[0] }, { key: "Qualificados", label: "Qualificados", color: MKT_COLORS[1] }, { key: "Vendas", label: "Vendas", color: MKT_COLORS[2] }]} />
        </div>

        <h3 className="text-[0.9375rem] font-bold mb-2">Comparativo de campanhas</h3>
        <Table head={["Campanha", "Plataforma", "Classificação", "Investimento", "Leads", "CPL", "Vendas", "Vendido", "ROAS"]} right={[3, 4, 5, 6, 7, 8]}>
          {top.length === 0 && <tr><Td className="text-muted-foreground" >Nenhuma campanha no escopo.</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td></tr>}
          {top.map((c) => (
            <tr key={c.campaign_id}>
              <Td><Link to={`/admin/marketing/campanhas?campanha=${c.campaign_id}`} className="font-medium hover:underline">{c.name}</Link></Td><Td>{PLATFORM_LABEL[c.platform]}{c.origin === "manual" ? " (manual)" : ""}</Td>
              <Td>{c.class_state === "pending" ? <Badge tone="warning">Aguardando classificação</Badge> : <span className="text-[13px]">{c.front} · {c.purpose}</span>}</Td>
              <Td num>{money(c.spend, cur, 0)}</Td><Td num>{num(c.leads)}</Td><Td num>{c.cpl == null ? "—" : money(c.cpl, cur)}</Td><Td num>{num(c.sales)}</Td><Td num>{money(c.sold, cur, 0)}</Td><Td num>{c.roas == null ? "—" : `${c.roas.toLocaleString("pt-BR")}x`}</Td>
            </tr>))}
        </Table>
        <p className="text-xs text-muted-foreground mt-2 mb-6">Vendas e valores são atribuídos pela regra interna (último toque pago na janela). Nada é distribuído proporcionalmente entre campanhas; o que não tem vínculo aparece em “Vendas sem atribuição”.</p>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="hp-card p-5" aria-label="Reconciliação do investimento" data-testid="mkt-reconciliation">
            <h3 className="text-[0.9375rem] font-bold">Reconciliação do investimento</h3>
            <p className="text-xs text-muted-foreground mb-3">O total fecha com a soma das partes. “Não classificado” e “Fora do dashboard” ficam visíveis aqui.</p>
            {rc.data && (<>
              <ul className="grid gap-1.5 text-sm">{rc.data.parts.map((p) => <li key={p.key} className="flex justify-between gap-3"><span>{p.label} <span className="text-muted-foreground">({p.campaigns} camp.)</span></span><b className="tabular">{money(p.spend, rc.data!.currency, 0)}</b></li>)}</ul>
              <p className="flex justify-between border-t border-border mt-3 pt-2 text-sm"><span>Total efetivo</span><b className="tabular">{money(rc.data.total, rc.data.currency, 0)}</b></p>
              <p className="text-xs text-muted-foreground mt-1">{rc.data.reconciles ? "Partes = total." : "Atenção: as partes não fecham com o total."}{rc.data.excluded_by_overlap > 0 ? ` ${money(rc.data.excluded_by_overlap, rc.data.currency, 0)} excluídos por sobreposição manual × API.` : ""}</p>
            </>)}
          </section>
          <section className="hp-card p-5" aria-label="Qualidade dos dados" data-testid="mkt-quality">
            <h3 className="text-[0.9375rem] font-bold">Qualidade dos dados</h3>
            <p className="text-xs text-muted-foreground mb-3">O que limita a confiança nos números. Clique para ver os registros.</p>
            {attention.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma pendência de qualidade no período.</p> : (
              <ul className="grid gap-2">{attention.map((i) => <li key={i.key}><button type="button" className="w-full text-left flex items-start justify-between gap-3 hover:bg-muted/40 rounded p-1.5" onClick={() => open(i.detail, i.label)}><span className="text-sm"><b>{i.count}</b> — {i.label.toLowerCase()}<span className="block text-xs text-muted-foreground">{i.hint}</span></span><SevBadge s={i.severity} /></button></li>)}</ul>)}
            <Link to="/admin/marketing/funil" className="text-sm text-accent hover:underline mt-3 inline-block">Ver funil, atribuição e todos os indicadores</Link>
          </section>
        </div>
      </>)}
      {d.sheet}
    </div>
  );
};
export default MarketingOverview;
