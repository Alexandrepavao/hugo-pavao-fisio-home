import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { PageHead, State, StatCard } from "@/lib/ui";
import { PeriodFilter } from "./PeriodFilter";
import { axisBrl, mfmt, presetRange, toExclusive, useUnits, type Metric, type RangePreset } from "./shared";

const brl0 = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);

const Overview = () => {
  const [preset, setPreset] = useState<RangePreset>("mes");
  const [custom, setCustom] = useState(presetRange("mes"));
  const [unit, setUnit] = useState(""); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();

  const range = { fromIso: `${from}T00:00:00.000Z`, toIso: toExclusive(to) };
  const metrics = useQuery({ queryKey: ["dash-fin", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: range.fromIso, p_to: range.toIso, p_unit: unit || null }); if (error) throw error;
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

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Visão geral" hint="Resumo financeiro do período. Cada cartão mostra a regra de cálculo — passe o mouse ou abra o detalhe para ver a origem exata." />
      <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
        onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
        onUnit={setUnit} onCompare={setCompare} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); setUnit(""); setCompare(false); }} />

      <State loading={metrics.isLoading} error={metrics.error} />
      {metrics.data && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard label="Vendas confirmadas" value={metrics.data.average_ticket_cents?.sales != null ? (metrics.data.average_ticket_cents.sales as number).toLocaleString("pt-BR") : "0"} basis="quantidade de vendas confirmadas no período" />
          <StatCard label="Recebimentos" value={mfmt(metrics.data.receipts_cents)} basis={metrics.data.receipts_cents?.basis} />
          <StatCard label="Contas a receber (30 dias)" value={mfmt(metrics.data.forecast_receivables_30d_cents)} basis={metrics.data.forecast_receivables_30d_cents?.basis} />
          <StatCard label="Vencidos" value={mfmt(metrics.data.overdue_cents)} tone="danger" basis={metrics.data.overdue_cents?.basis} />
          <StatCard label="Contas a pagar (30 dias)" value={mfmt(metrics.data.forecast_payables_30d_cents)} basis={metrics.data.forecast_payables_30d_cents?.basis} />
          <StatCard label="Resultado de caixa" value={mfmt(metrics.data.cash_result_cents)} basis={metrics.data.cash_result_cents?.basis} />
          <StatCard label="Ticket médio" value={mfmt(metrics.data.average_ticket_cents)} basis={metrics.data.average_ticket_cents?.basis} />
          <StatCard label="Projeção de mensalidades (próx. mês)" value={mfmt(metrics.data.forecast_subscriptions_next_month_cents)} basis={metrics.data.forecast_subscriptions_next_month_cents?.basis} />
        </ul>
      )}

      <section className="mb-8">
        <h2 className="text-xl mb-3">Vencidos por faixa de atraso</h2>
        {aging.data && (
          <ul className="grid gap-3 sm:grid-cols-4">
            <StatCard label="1–30 dias" value={brl0(aging.data.d1_30_cents)} tone={aging.data.d1_30_cents > 0 ? "warning" : undefined} />
            <StatCard label="31–60 dias" value={brl0(aging.data.d31_60_cents)} tone={aging.data.d31_60_cents > 0 ? "warning" : undefined} />
            <StatCard label="61–90 dias" value={brl0(aging.data.d61_90_cents)} tone={aging.data.d61_90_cents > 0 ? "danger" : undefined} />
            <StatCard label="Acima de 90 dias" value={brl0(aging.data.d90_plus_cents)} tone={aging.data.d90_plus_cents > 0 ? "danger" : undefined} />
          </ul>
        )}
        {overdueTotal === 0 && aging.data && <p className="text-sm text-muted-foreground mt-2">Nenhuma parcela vencida no momento.</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <section><h2 className="text-xl mb-3">Evolução de entradas e saídas (6 meses)</h2>
          {cash.data && cash.data.length > 0 ? (
            <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={cash.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
                <Line type="monotone" dataKey="Entradas" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Saídas" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              </LineChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem movimentos suficientes para o gráfico.</p>}
        </section>
        <section><h2 className="text-xl mb-3">Recebimentos por forma de pagamento</h2>
          {byMethod.data && byMethod.data.length > 0 ? (
            <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMethod.data} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis type="number" fontSize={12} tickFormatter={axisBrl} /><YAxis type="category" dataKey="forma" fontSize={12} width={90} />
                <Tooltip formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
                <Bar dataKey="Valor" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem recebimentos no período.</p>}
        </section>
        <section className="lg:col-span-2"><h2 className="text-xl mb-3">Recebimentos por produto (top 8 do período)</h2>
          {byProduct.data && byProduct.data.length > 0 ? (
            <div className="hp-card p-4" style={{ height: 280 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={byProduct.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="produto" fontSize={11} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip formatter={(v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)} />
                <Bar dataKey="Recebido" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem recebimentos por produto no período.</p>}
        </section>
      </div>
    </div>
  );
};

export default Overview;
