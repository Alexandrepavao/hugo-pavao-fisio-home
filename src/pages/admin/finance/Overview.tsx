import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { LevelSection, PageHead, State, StatCard } from "@/lib/ui";
import { ChartCard, tooltipStyle } from "@/lib/IndicatorCharts";
import { makeDelta } from "@/lib/kpi";
import { RANGE_LABEL } from "@/lib/period";
import { CardDetailSheet, type CardDetailTrigger } from "@/lib/CardDetailSheet";
import { PeriodFilter } from "./PeriodFilter";
import LineBreakdown, { LineSelector } from "./LineBreakdown";
import { useLineFilter } from "./lineFilter";
import { axisBrl, mfmt, presetRange, toExclusive, usePeriodFilterState, useUnits, type Metric } from "./shared";

const brl0 = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);

const Overview = () => {
  const { preset, custom, unit, compare, onPreset, onFrom, onTo, onUnit, onCompare, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();

  const range = { fromIso: `${from}T00:00:00.000Z`, toIso: toExclusive(to) };
  // período anterior de mesma duração, só consultado quando "Comparar com período anterior" está ligado
  const prevRange = (() => {
    const f = new Date(from + "T00:00:00"); const t = new Date(to + "T00:00:00");
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 864e5) + 1);
    const pf = new Date(f.getTime() - days * 864e5); const pt = new Date(f.getTime() - 864e5);
    return { from: pf.toISOString(), to: new Date(pt.getTime() + 864e5).toISOString() };
  })();
  const per = RANGE_LABEL[preset];
  const metrics = useQuery({ queryKey: ["dash-fin", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: range.fromIso, p_to: range.toIso, p_unit: unit || null }); if (error) throw error;
    return data as Record<string, Metric>;
  } });
  const prevMetrics = useQuery({ queryKey: ["dash-fin-prev", prevRange.from, prevRange.to, unit], enabled: compare, queryFn: async () => {
    const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: prevRange.from, p_to: prevRange.to, p_unit: unit || null }); if (error) throw error;
    return data as Record<string, Metric>;
  } });
  const aging = useQuery({ queryKey: ["aging", unit], queryFn: async () => { const { data, error } = await supabase.rpc("overdue_aging", { p_unit: unit || null }); if (error) throw error; return data as Record<string, number>; } });
  const cash = useQuery({ queryKey: ["cash-ov", unit], queryFn: async () => {
    const to6 = new Date(); to6.setMonth(to6.getMonth() + 1);
    const from6 = new Date(); from6.setMonth(from6.getMonth() - 5);
    const { data, error } = await supabase.rpc("cash_flow_monthly", { p_from: from6.toISOString().slice(0, 10), p_to: to6.toISOString().slice(0, 10), p_unit: unit || null }); if (error) throw error;
    return (data as { month: string; realized_in_cents: number; realized_out_cents: number }[]).map((r) => ({ mes: fmtDate(r.month + "T12:00:00Z").slice(0, 5), Entradas: r.realized_in_cents / 100, Saídas: r.realized_out_cents / 100 }));
  } });
  const byMethod = useQuery({ queryKey: ["pay-method", from, to, unit], queryFn: async () => {
    let q = supabase.from("payments").select("amount_cents, method, kind, unit_id").eq("kind", "payment").gte("paid_at", range.fromIso).lt("paid_at", range.toIso);
    if (unit) q = q.eq("unit_id", unit);
    const { data } = await q; const by: Record<string, number> = {};
    for (const p of data ?? []) { const k = p.method ?? "Não informado"; by[k] = (by[k] ?? 0) + p.amount_cents; }
    return Object.entries(by).map(([forma, valor]) => ({ forma, Valor: valor / 100 })).sort((a, b) => b.Valor - a.Valor);
  } });
  const byProduct = useQuery({ queryKey: ["prod-ov", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("results_by_product", { p_from: range.fromIso, p_to: range.toIso, p_unit: unit || null }); if (error) throw error;
    return (data as { product_name: string; received_cents: number }[]).filter((r) => r.received_cents !== 0).sort((a, b) => b.received_cents - a.received_cents).slice(0, 8).map((r) => ({ produto: r.product_name, Recebido: r.received_cents / 100 }));
  } });

  const overdueTotal = aging.data ? Object.values(aging.data).reduce((a, b) => a + b, 0) : 0;
  const unitLabel = units.data?.find((u2) => u2.id === unit)?.name ?? "Todas as unidades";
  const [detail, setDetail] = useState<CardDetailTrigger | null>(null);
  const [line, setLine] = useLineFilter();

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Visão geral" hint="Resumo financeiro do período. Cada cartão mostra a regra de cálculo — passe o mouse ou abra o detalhe para ver a origem exata."
        actions={
          <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
            onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onCompare={onCompare} onClear={onClear} />
        } />

      <State loading={metrics.isLoading} error={metrics.error} />
      {metrics.data && (
        <LevelSection level="attention" title="Atenção" hint="Situação de hoje: o que está vencido e há quanto tempo.">
          <ul className="hp-kpi-grid hp-kpi-grid-lg">
          <StatCard level="attention" period="Hoje" label="Vencidos" value={mfmt(metrics.data.overdue_cents)} tone="danger" basis={metrics.data.overdue_cents?.basis} onClick={() => setDetail({ kind: "overdue", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          </ul>
      <div className="mt-3">
        <h3 className="text-[0.9375rem] font-semibold mb-2">Vencidos por faixa de atraso</h3>
        {aging.data && (
          <ul className="hp-kpi-grid">
            <StatCard level="compact" period="Hoje" label="1–30 dias" value={brl0(aging.data.d1_30_cents)} tone={aging.data.d1_30_cents > 0 ? "warning" : undefined} />
            <StatCard level="compact" period="Hoje" label="31–60 dias" value={brl0(aging.data.d31_60_cents)} tone={aging.data.d31_60_cents > 0 ? "warning" : undefined} />
            <StatCard level="compact" period="Hoje" label="61–90 dias" value={brl0(aging.data.d61_90_cents)} tone={aging.data.d61_90_cents > 0 ? "danger" : undefined} />
            <StatCard level="compact" period="Hoje" label="Acima de 90 dias" value={brl0(aging.data.d90_plus_cents)} tone={aging.data.d90_plus_cents > 0 ? "danger" : undefined} />
          </ul>
        )}
        {overdueTotal === 0 && aging.data && <p className="text-sm text-muted-foreground mt-2">Nenhuma parcela vencida no momento.</p>}
      </div>

        </LevelSection>
      )}

      {metrics.data && (
        <LevelSection level="summary" title="Resumo do período" hint="Cada cartão mostra a regra de cálculo; clique para abrir a origem exata.">
          <ul className="hp-kpi-grid">
          <StatCard period={per} unit="vendas" delta={makeDelta({ value: metrics.data.average_ticket_cents?.sales as number, available: true }, prevMetrics.data ? { value: prevMetrics.data.average_ticket_cents?.sales as number, available: true } : undefined)} label="Vendas confirmadas" value={metrics.data.average_ticket_cents?.sales != null ? (metrics.data.average_ticket_cents.sales as number).toLocaleString("pt-BR") : "0"} basis="quantidade de vendas confirmadas no período" onClick={() => setDetail({ kind: "sales_confirmed", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          <StatCard period={per} delta={makeDelta(metrics.data.receipts_cents, prevMetrics.data?.receipts_cents)} label="Recebimentos" value={mfmt(metrics.data.receipts_cents)} basis={metrics.data.receipts_cents?.basis} onClick={() => setDetail({ kind: "receipts", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          <StatCard period="Próx. 30 dias" label="Contas a receber (30 dias)" value={mfmt(metrics.data.forecast_receivables_30d_cents)} basis={metrics.data.forecast_receivables_30d_cents?.basis} onClick={() => setDetail({ kind: "forecast_receivables_30d", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          <StatCard period="Próx. 30 dias" label="Contas a pagar (30 dias)" value={mfmt(metrics.data.forecast_payables_30d_cents)} basis={metrics.data.forecast_payables_30d_cents?.basis} onClick={() => setDetail({ kind: "forecast_payables_30d", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          <StatCard period={per} delta={makeDelta(metrics.data.cash_result_cents, prevMetrics.data?.cash_result_cents)} label="Resultado de caixa" value={mfmt(metrics.data.cash_result_cents)} basis={metrics.data.cash_result_cents?.basis} onClick={() => setDetail({ kind: "cash_result", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          <StatCard period={per} delta={makeDelta(metrics.data.average_ticket_cents, prevMetrics.data?.average_ticket_cents)} label="Ticket médio" value={mfmt(metrics.data.average_ticket_cents)} basis={metrics.data.average_ticket_cents?.basis} onClick={() => setDetail({ kind: "average_ticket", from: range.fromIso, to: range.toIso, unit, unitLabel })} />
          <StatCard period="Próx. mês" label="Projeção de mensalidades (próx. mês)" value={mfmt(metrics.data.forecast_subscriptions_next_month_cents)} basis="sem detalhamento por registro ainda — a projeção soma contratos futuros que não têm uma única tabela de origem por parcela; ver docs/project-status.md" />
          </ul>
        </LevelSection>
      )}

      <LevelSection level="summary" title="Por linha de negócio" label="Linhas de negócio" hint="HP Fisioterapia e HP Academy, com compartilhados e não classificados — o “Geral” acima continua sendo o consolidado.">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <span className="sr-only">Seletor de linha de negócio</span>
          <LineSelector value={line} onChange={setLine} />
        </div>
        <LineBreakdown mode="overview" fromIso={range.fromIso} toIso={range.toIso} unit={unit} line={line} />
      </LevelSection>

      <LevelSection level="analysis" title="Evolução e composição" hint="Dados reais do período; sem movimento suficiente, o gráfico mostra o aviso em vez de inventar curva.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Evolução de entradas e saídas (6 meses)" isEmpty={!(cash.data && cash.data.length > 0)} empty="Sem movimentos suficientes para o gráfico.">
            <LineChart data={cash.data ?? []} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
              <Line type="monotone" dataKey="Entradas" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Saídas" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartCard>
          <ChartCard title="Recebimentos por forma de pagamento" isEmpty={!(byMethod.data && byMethod.data.length > 0)} empty="Sem recebimentos no período.">
            <BarChart data={byMethod.data ?? []} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" horizontal={false} /><XAxis type="number" fontSize={12} tickFormatter={axisBrl} /><YAxis type="category" dataKey="forma" fontSize={12} width={90} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
              <Bar dataKey="Valor" fill="hsl(var(--chart-1))" radius={[0, 3, 3, 0]} /></BarChart>
          </ChartCard>
          <div className="lg:col-span-2">
            <ChartCard title="Recebimentos por produto (top 8 do período)" height={280} isEmpty={!(byProduct.data && byProduct.data.length > 0)} empty="Sem recebimentos por produto no período.">
              <BarChart data={byProduct.data ?? []}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} /><XAxis dataKey="produto" fontSize={11} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
                <Bar dataKey="Recebido" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} /></BarChart>
            </ChartCard>
          </div>
        </div>
      </LevelSection>
      <CardDetailSheet trigger={detail} onClose={() => setDetail(null)} />
    </div>
  );
};

export default Overview;
