import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { FilterBar, FilterField, PageHead, State, StatCard, Table, Td } from "@/lib/ui";
import { axisBrl, mfmt, useUnits, type Metric } from "./shared";

interface Bridge { mrr_inicial_cents: number; novo_cents: number; expansao_cents: number; reativacao_cents: number; contracao_cents: number; cancelamento_cents: number; mrr_final_cents: number; fecha: boolean }
interface MrrReport { month: string; mrr_cents: Metric; arr_cents: Metric; bridge: Bridge; churn_clientes_pct: Metric; churn_receita_pct: Metric; retencao_bruta_pct: Metric; retencao_liquida_pct: Metric; receita_media_cliente_cents: Metric; clientes_recorrentes: number }
interface ForecastRow { person_id: string; person_name: string; product_name: string; projected_amount_cents: number; origin_paid_at: string; origin_competence: string }

const BridgeRow = ({ label, cents, tone }: { label: string; cents: number; tone?: "success" | "danger" }) => (
  <li className="flex items-center justify-between py-2 border-b border-border last:border-0 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className={`tabular font-medium ${tone === "success" ? "text-[hsl(var(--success))]" : tone === "danger" ? "text-destructive" : ""}`}>{tone === "success" && cents > 0 ? "+" : ""}{brl(cents)}</span>
  </li>
);

const FinanceRecurrence = () => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [unit, setUnit] = useState("");
  const units = useUnits();
  const report = useQuery({ queryKey: ["mrr", month, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("mrr_report", { p_month: `${month}-01`, p_unit: unit || null }); if (error) throw error; return data as MrrReport;
  } });
  const history = useQuery({ queryKey: ["mrr-hist", unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("mrr_history", { p_months: 12, p_unit: unit || null }); if (error) throw error;
    // mrr_history() devolve generate_series(..., interval) → timestamp completo (não uma data pura); nada de concatenar hora de novo.
    return (data as { month: string; mrr_cents: number }[]).map((r) => ({ mes: fmtDate(r.month).slice(0, 5), MRR: r.mrr_cents / 100 }));
  } });
  const forecast = useQuery({ queryKey: ["forecast-rec"], queryFn: async () => {
    const next = new Date(); next.setMonth(next.getMonth() + 1);
    const { data, error } = await supabase.rpc("subscription_forecast", { p_month: next.toISOString().slice(0, 10) }); if (error) throw error; return data as ForecastRow[];
  } });
  const forecastTotal = (forecast.data ?? []).reduce((a, r) => a + r.projected_amount_cents, 0);

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Recorrência e forecast" hint="MRR = soma dos recebíveis de competência do mês para produtos com recorrência mensal, venda confirmada — é o compromisso contratado do mês, não o caixa recebido. ARR = MRR × 12." />
      <FilterBar>
        <FilterField label="Mês" htmlFor="rm"><input id="rm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FilterField>
        <FilterField label="Unidade" htmlFor="ru"><select id="ru" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></FilterField>
      </FilterBar>
      <State loading={report.isLoading} error={report.error} />
      {report.data && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard label="MRR do mês" value={mfmt(report.data.mrr_cents)} basis={report.data.mrr_cents.basis} />
          <StatCard label="ARR" value={mfmt(report.data.arr_cents)} basis={report.data.arr_cents.basis} />
          <StatCard label="Clientes recorrentes" value={report.data.clientes_recorrentes.toLocaleString("pt-BR")} />
          <StatCard label="Receita média por cliente" value={mfmt(report.data.receita_media_cliente_cents)} basis={report.data.receita_media_cliente_cents.basis} />
          <StatCard label="Retenção bruta de receita" value={mfmt(report.data.retencao_bruta_pct, "pct")} basis={report.data.retencao_bruta_pct.basis} />
          <StatCard label="Retenção líquida de receita" value={mfmt(report.data.retencao_liquida_pct, "pct")} basis={report.data.retencao_liquida_pct.basis} />
          <StatCard label="Churn de clientes" value={mfmt(report.data.churn_clientes_pct, "pct")} basis={report.data.churn_clientes_pct.basis} tone={report.data.churn_clientes_pct.available && Number(report.data.churn_clientes_pct.value) > 0 ? "danger" : undefined} />
          <StatCard label="Churn de receita" value={mfmt(report.data.churn_receita_pct, "pct")} basis={report.data.churn_receita_pct.basis} tone={report.data.churn_receita_pct.available && Number(report.data.churn_receita_pct.value) > 0 ? "danger" : undefined} />
        </ul>

        <section className="mb-8"><h2 className="text-xl mb-3">MRR — últimos 12 meses</h2>
          {history.data && history.data.length > 0 && (
            <div className="hp-card p-4" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip formatter={(v: number) => brl(Math.round(v * 100))} /><Area type="monotone" dataKey="MRR" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / .15)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div>
          )}
        </section>

        <section className="mb-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div><h2 className="text-xl mb-3">Ponte de movimentação do MRR</h2>
            <div className="hp-card p-4">
              <ul>
                <BridgeRow label="MRR inicial (mês anterior)" cents={report.data.bridge.mrr_inicial_cents} />
                <BridgeRow label="+ Novo" cents={report.data.bridge.novo_cents} tone="success" />
                <BridgeRow label="+ Expansão" cents={report.data.bridge.expansao_cents} tone="success" />
                <BridgeRow label="+ Reativação" cents={report.data.bridge.reativacao_cents} tone="success" />
                <BridgeRow label="− Contração" cents={report.data.bridge.contracao_cents} tone="danger" />
                <BridgeRow label="− Cancelamento" cents={report.data.bridge.cancelamento_cents} tone="danger" />
              </ul>
              <div className="flex items-center justify-between pt-3 mt-1 border-t-2 border-border">
                <span className="font-semibold">MRR final</span>
                <span className="tabular font-bold text-lg">{brl(report.data.bridge.mrr_final_cents)}</span>
              </div>
              {!report.data.bridge.fecha && <p role="alert" className="text-xs text-destructive mt-2">A ponte não fechou matematicamente — reporte este caso (não deveria acontecer).</p>}
            </div>
          </div>
          <div className="hp-card p-4 self-start"><p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Novo</strong>: nunca teve recebível recorrente antes.<br /><strong>Reativação</strong>: voltou depois de um mês sem recebível.<br />
            <strong>Expansão/Contração</strong>: mesmo par pessoa+produto, valor mudou.<br /><strong>Cancelamento</strong>: tinha recebível no mês anterior e não tem mais neste mês.</p></div>
        </section>
      </>)}

      <section><h2 className="text-xl mb-1">Projeção de mensalidades (mês seguinte)</h2>
        <p className="bg-accent/10 border border-accent/40 p-3 text-sm mb-4"><strong>Projeção — não é MRR contratado nem conta a receber.</strong> Mensalidade paga na competência anterior contribui para a projeção do próximo mês; quem pagou só antes disso não entra; estornos e cancelamentos saem; já contratado no mês não é duplicado.</p>
        <State loading={forecast.isLoading} error={forecast.error} empty={forecast.data?.length === 0} emptyText="Sem mensalidades pagas no mês anterior para projetar." />
        {forecast.data && forecast.data.length > 0 && <><p className="mb-3">Total projetado: <strong className="tabular">{brl(forecastTotal)}</strong></p>
          <Table head={["Pessoa", "Produto", "Valor projetado", "Origem (pagamento em)", "Competência de origem"]} right={[2]}>{forecast.data.map((r) => <tr key={r.person_id + r.product_name}><Td>{r.person_name}</Td><Td>{r.product_name}</Td><Td num>{brl(r.projected_amount_cents)}</Td><Td>{fmtDate(r.origin_paid_at)}</Td><Td>{fmtDate(r.origin_competence + "T12:00:00Z").slice(3)}</Td></tr>)}</Table></>}
      </section>
    </div>
  );
};

export default FinanceRecurrence;
