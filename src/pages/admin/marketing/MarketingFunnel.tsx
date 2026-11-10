import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge, LevelSection, Msg, PageHead, State, Table, Td, btnGhost, confirmDialog, errText } from "@/lib/ui";
import { FunnelSection } from "./MktFunnelVisual";
import { CoverageBanner, MktFilterBar, MktGrid, MktKpi, SevBadge, useDetail } from "./MktParts";
import { fmtKpi, money, num, rpcArgs, useMktFilters, useMktInvalidate, useMktOptions, useMktRpc, type FunnelResp, type Kpi, type KpisResp, type QualityItem, useNote } from "./mktApi";

const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  { title: "Mídia (plataformas)", hint: "Vêm das plataformas ou do lançamento manual. Resultados reportados NÃO são conversões confirmadas.", keys: ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "reported_results"] },
  { title: "Captação e CRM", hint: "Do Hub: formulários/quizzes → pessoas → oportunidades.", keys: ["leads", "opportunities", "qualified", "cpl", "cpql", "first_response_min", "won", "lost"] },
  { title: "Fisioterapia", hint: "Da Agenda. Falta e cancelamento são separados; pacote vendido não é atendimento realizado.", keys: ["eval_scheduled", "eval_done", "attendance_rate", "no_show", "cancel_patient", "cancel_clinic", "cost_per_eval"] },
  { title: "Parceiros", hint: "Aprovado e ativo seguem critérios explícitos configurados.", keys: ["partner_approved", "partner_active", "cost_per_partner_approved", "cost_per_partner_active"] },
  { title: "Academy / Tech (use o filtro Frente)", hint: "Vendas, matrículas e ticket. Parcelamento não é receita recorrente.", keys: ["enrollments", "buyers", "avg_ticket", "recurring_revenue"] },
  { title: "Financeiro", hint: "Vendido, recebido líquido de estornos, retorno sobre mídia e repasses (apurado ≠ autorizado ≠ pago). Custo de mídia por cliente NÃO é o CAC completo.", keys: ["sold", "received", "new_buyers", "repeat_buyers", "expansion_buyers", "media_cost_per_new_customer", "roas_sales", "return_on_receipts", "payouts_pending", "payouts_authorized", "payouts_paid", "result_after_media_payouts"] },
];

/** Funil e atribuição: modelo e janela à vista, conversões reportadas × confirmadas (separadas), catálogo completo de indicadores com fórmula/fonte/denominador e qualidade dos dados. */
const MarketingFunnel = () => {
  const f = useMktFilters("event", "reports"); const d = useDetail(f); const inv = useMktInvalidate(); const { msg, setMsg } = useNote();
  const a = rpcArgs(f, { p_view: f.view }); const kp = useMktRpc<KpisResp>("mkt_kpis", a); const fn = useMktRpc<FunnelResp>("mkt_funnel", a); const ql = useMktRpc<{ items: QualityItem[] }>("mkt_quality", rpcArgs(f));
  const isAdmin = !!useMktOptions().data?.is_admin; const k = kp.data; const cur = k?.currency ?? "BRL"; const [busy, setBusy] = useState(false);
  const run = async (name: string, args: Record<string, unknown>, ask?: [string, string]) => {
    if (ask && !(await confirmDialog(ask[0], ask[1], "Executar"))) return; setBusy(true); const { data, error } = await supabase.rpc(name, args); setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) }); inv(); setMsg({ kind: "ok", text: `Concluído: ${JSON.stringify(data)}` });
  };
  const byKey = (key: string) => k?.kpis.find((x) => x.key === key) as Kpi | undefined;
  return (
    <div data-testid="mkt-funnel-page">
      <PageHead eyebrow="Marketing" title="Funil e atribuição" hint="Como o Hub liga cada lead e cada venda a uma campanha: uma regra única, determinística e visível. Reportado pelas plataformas e confirmado no Hub nunca se misturam." />
      <MktFilterBar f={f} />
      <State loading={kp.isLoading} error={kp.error} />
      <CoverageBanner c={k?.coverage} model={k?.model} view={f.view} />
      <FunnelSection f={f} isAdmin={isAdmin} />
      {fn.data && k && (<>
        <section className="hp-card p-5 mb-6" aria-label="Modelo de atribuição" data-testid="mkt-model">
          <h3 className="text-[0.9375rem] font-bold">Modelo de atribuição</h3>
          <p className="text-sm mt-1"><b>{k.model.name}</b> — janela de <b>{k.model.window_days} dias</b> (versão de configuração {k.model.config_version}). O primeiro toque e os toques seguintes ficam guardados; cada oportunidade e cada venda é ligada <b>uma única vez</b>; o que não tem vínculo aparece como “sem atribuição”.</p>
          <p className="text-[13px] text-muted-foreground mt-1">{fn.data.basis} Alterar a janela ou as regras <b>não recalcula o histórico sozinho</b>: use “Recalcular atribuição” de forma explícita.</p>
          {isAdmin && <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className={btnGhost} disabled={busy} onClick={() => run("mkt_attribution_recompute", { p_from: f.range.from, p_to: f.range.to }, ["Recalcular a atribuição?", `Aplica a regra ATUAL às oportunidades e vendas de ${f.range.from} a ${f.range.to}. Fica registrado no histórico de atribuição.`])}>Recalcular atribuição do período</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => run("mkt_touches_relink", {}, ["Religar toques a campanhas?", "Liga toques pagos ainda sem campanha às campanhas importadas (por id; por nome só se exato e único). Não muda atribuições já calculadas."])}>Religar toques às campanhas</button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => run("mkt_history_backfill", {}, ["Preencher o histórico?", "Cria toques e atribuições a partir do que JÁ está gravado em formulários e quizzes (sem inventar dado). Ação idempotente."])}>Preencher histórico gravado</button></div>}
          <Msg m={msg} />
        </section>

        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          <section className="hp-card p-5" aria-label="Reportado pelas plataformas" data-testid="mkt-reported">
            <h3 className="text-[0.9375rem] font-bold">A) Reportado pelas plataformas</h3>
            <p className="text-3xl font-extrabold tabular mt-1">{Object.entries(fn.data.provider_reported.by_currency).map(([c, v]) => `${num(v.reported_results)}`)[0] ?? "—"}</p>
            <p className="text-[13px] text-muted-foreground mt-1">{fn.data.provider_reported.note}</p>
          </section>
          <section className="hp-card p-5" aria-label="Confirmado no Hub" data-testid="mkt-confirmed">
            <h3 className="text-[0.9375rem] font-bold">B) Confirmado no Hub</h3>
            <p className="text-sm mt-1"><b>{num(fn.data.hub_confirmed.leads)}</b> leads únicos · <b>{num(fn.data.hub_confirmed.sales)}</b> vendas · <b>{num(fn.data.hub_confirmed.new_buyers)}</b> novos compradores · <b>{money(fn.data.hub_confirmed.sold, cur, 0)}</b> vendidos</p>
            <p className="text-[13px] text-muted-foreground mt-1">Pessoas e vendas reais do Hub, cada uma contada uma vez. Duas plataformas podem reivindicar a mesma venda; aqui ela é atribuída a um único toque.</p>
          </section>
        </div>

        {GROUPS.map((g) => (
          <LevelSection key={g.title} level="summary" title={g.title} hint={g.hint}>
            <MktGrid>{g.keys.map((key) => <MktKpi key={key} k={byKey(key)} prev={k.previous_kpis.find((x) => x.key === key)} currency={cur} onOpen={(kind, t) => d.open(kind, t)} short />)}</MktGrid>
          </LevelSection>))}

        <h3 className="text-[0.9375rem] font-bold mb-2 mt-2">Catálogo de indicadores</h3>
        <p className="text-xs text-muted-foreground mb-2">Fórmula, fonte, granularidade e denominador de cada número. Sem fonte ou denominador, o indicador mostra “Não disponível” com o motivo — nunca zero.</p>
        <Table head={["Indicador", "Valor", "Fórmula", "Fonte", "Granularidade", "Denominador", "Situação"]} right={[1]}>
          {k.kpis.map((x) => <tr key={x.key}><Td><b>{x.label}</b></Td><Td num>{fmtKpi(x, cur)}</Td><Td className="text-[12.5px] min-w-[16rem]">{x.formula}</Td><Td className="text-[12.5px]">{x.source}</Td><Td className="text-[12.5px]">{x.granularity}</Td><Td className="text-[12.5px]">{x.denominator ?? "—"}</Td>
            <Td>{x.available ? (x.warning ? <Badge tone="warning">Cobertura parcial</Badge> : <Badge tone="info">Disponível</Badge>) : <span className="text-[12.5px] text-muted-foreground">{x.reason}</span>}</Td></tr>)}
        </Table>

        <h3 className="text-[0.9375rem] font-bold mb-2 mt-8">Qualidade dos dados</h3>
        <Table head={["Controle", "Registros", "Situação", "O que significa"]} right={[1]}>
          {(ql.data?.items ?? []).map((i) => <tr key={i.key}><Td><button type="button" className="text-accent hover:underline text-left" onClick={() => d.open(i.detail, i.label)}>{i.label}</button></Td><Td num>{i.count}{i.amount ? <span className="block text-xs text-muted-foreground">{money(i.amount, cur, 0)}</span> : null}</Td><Td><SevBadge s={i.severity} /></Td><Td className="text-[12.5px]">{i.hint}</Td></tr>)}
        </Table>
      </>)}
      {d.sheet}
    </div>
  );
};
export default MarketingFunnel;
