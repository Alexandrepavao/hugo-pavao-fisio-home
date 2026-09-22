import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { FilterBar, FilterField, PageHead, StatCard, State, Table, Td } from "@/lib/ui";

interface Metric { value: number | null; available: boolean; basis: string; [k: string]: unknown }
type Metrics = Record<string, Metric | { items: { reason: string; count: number }[]; basis: string }>;
interface Alert { kind: string; label: string; link: string; count: number }
type Fmt = "int" | "brl" | "pct" | "min" | "score";

const GROUPS: { title: string; items: [string, string, Fmt][] }[] = [
  { title: "Captação", items: [["visits", "Visitas às páginas", "int"], ["leads", "Leads por formulário", "int"], ["page_conversion", "Conversão das páginas", "pct"], ["referrals", "Indicações", "int"], ["acquisition_cost", "Custo de aquisição / retorno de mídia", "brl"]] },
  { title: "Comercial", items: [["opportunities_created", "Oportunidades criadas", "int"], ["first_response_minutes", "Tempo até o 1º atendimento", "min"], ["win_rate", "Conversão comercial", "pct"], ["average_ticket_cents", "Ticket médio", "brl"]] },
  { title: "Operação", items: [["evaluations_scheduled", "Agendamentos vindos do CRM", "int"], ["attended", "Atendimentos realizados", "int"], ["no_shows", "Faltas", "int"], ["attendance_rate", "Comparecimento", "pct"], ["occupancy", "Ocupação da agenda", "pct"], ["sessions_contracted", "Sessões contratadas", "int"], ["sessions_used", "Sessões utilizadas", "int"]] },
  { title: "Financeiro (caixa)", items: [["receipts_cents", "Recebimentos", "brl"], ["expenses_cents", "Despesas pagas", "brl"], ["cash_result_cents", "Resultado de caixa", "brl"], ["overdue_cents", "Inadimplência (vencido)", "brl"], ["forecast_receivables_30d_cents", "A receber em 30 dias (contratado)", "brl"], ["forecast_payables_30d_cents", "A pagar em 30 dias", "brl"], ["forecast_subscriptions_next_month_cents", "PROJEÇÃO de mensalidades (mês seguinte)", "brl"]] },
  { title: "Educação e relacionamento", items: [["active_students", "Alunos ativos", "int"], ["certificates_issued", "Certificados emitidos", "int"], ["completion_rate", "Taxa de conclusão", "pct"], ["nps", "NPS", "score"], ["satisfaction_avg", "Nota média", "score"]] },
];

const show = (m: Metric, f: Fmt) => {
  if (!m.available || m.value == null) return "Indisponível";
  const v = Number(m.value);
  return f === "brl" ? brl(v) : f === "pct" ? `${v.toString().replace(".", ",")}%` : f === "min" ? `${v} min` : f === "score" ? v.toString().replace(".", ",") : v.toLocaleString("pt-BR");
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

const Dashboard = () => {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [unit, setUnit] = useState("");
  const range = { from: new Date(from + "T00:00:00").toISOString(), to: new Date(new Date(to + "T00:00:00").getTime() + 864e5).toISOString() };

  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });
  const metrics = useQuery({ queryKey: ["dash", range.from, range.to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: range.from, p_to: range.to, p_unit: unit || null }); if (error) throw error; return data as Metrics;
  } });
  const alerts = useQuery({ queryKey: ["alerts", unit], queryFn: async () => { const { data, error } = await supabase.rpc("dashboard_alerts", { p_unit: unit || null }); if (error) throw error; return data as Alert[]; } });
  const cash = useQuery({ queryKey: ["cash", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("cash_flow_monthly", { p_from: from, p_to: iso(new Date(today.getFullYear(), today.getMonth() + 3, 1)), p_unit: unit || null }); if (error) throw error;
    return data as { month: string; realized_in_cents: number; realized_out_cents: number; forecast_in_cents: number; forecast_out_cents: number }[];
  } });
  const prods = useQuery({ queryKey: ["prod-results", range.from, range.to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("results_by_product", { p_from: range.from, p_to: range.to, p_unit: unit || null }); if (error) throw error;
    return data as { product_id: string; product_name: string; contracted_cents: number; received_cents: number; delivered_sessions: number; recognized_cents: number }[];
  } });

  return (
    <div>
      <PageHead eyebrow="Gestor" title="Dashboard" hint="Todos os números vêm de dados persistidos. Onde não há dado de origem, aparece “Indisponível” (nunca zero fictício). Cada cartão mostra a regra de cálculo e a data usada." />
      <FilterBar>
        <FilterField label="De" htmlFor="d1"><input id="d1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FilterField>
        <FilterField label="Até" htmlFor="d2"><input id="d2" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FilterField>
        <FilterField label="Unidade" htmlFor="du"><select id="du" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas</option>{(units.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></FilterField>
        <p className="text-xs text-muted-foreground ml-auto self-center max-w-sm">Período aplicado conforme a data de cada indicador (criação, venda, pagamento ou atendimento — indicada em cada cartão).</p>
      </FilterBar>

      <State loading={metrics.isLoading} error={metrics.error} />
      {alerts.data && (
        <section aria-label="Alertas" className="mb-8"><h2 className="text-xl mb-3">Alertas</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.data.map((a) => (
              <li key={a.kind}><Link to={a.link} className="hp-card flex items-center gap-3 p-3 hover:bg-muted/60 transition-colors">
                <span className={`grid place-items-center rounded-md tabular font-bold ${a.count > 0 ? "hp-badge-warning" : "bg-muted text-muted-foreground"}`} style={{ width: "2.5rem", height: "2.5rem", fontSize: "1.125rem" }}>{a.count}</span>
                <span className="text-sm">{a.label}</span></Link></li>))}
          </ul></section>
      )}
      {metrics.data && GROUPS.map((g) => (
        <section key={g.title} className="mb-8"><h2 className="text-xl mb-3">{g.title}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map(([k, label, f]) => { const m = metrics.data![k] as Metric; return (
              <StatCard key={k} label={label} value={show(m, f)} basis={m.basis} unavailable={!m.available || m.value == null} />); })}
          </ul></section>
      ))}
      {metrics.data && (
        <section className="mb-8"><h2 className="text-xl mb-3">Motivos de perda</h2>
          {(metrics.data.loss_reasons as { items: { reason: string; count: number }[] }).items.length === 0 ? <p className="text-navy-400">Nenhuma perda no período.</p> :
            <ul className="bg-card border border-border divide-y divide-border">{(metrics.data.loss_reasons as { items: { reason: string; count: number }[] }).items.map((i) => <li key={i.reason} className="p-3 flex justify-between"><span>{i.reason}</span><span className="tabular">{i.count}</span></li>)}</ul>}
        </section>
      )}
      <section className="mb-8"><h2 className="text-xl mb-3">Fluxo de caixa mensal</h2>
        <p className="text-sm text-navy-400 mb-2">Realizado = pagamentos e despesas efetivos. Previsto = parcelas contratadas e contas a pagar em aberto (a projeção de mensalidades está separada acima).</p>
        <State loading={cash.isLoading} error={cash.error} empty={cash.data?.length === 0} />
        {cash.data && cash.data.length > 0 && <Table head={["Mês", "Recebido", "Pago", "A receber (contratado)", "A pagar"]} right={[1, 2, 3, 4]}>
          {cash.data.map((r) => <tr key={r.month}><Td>{fmtDate(r.month + "T12:00:00Z").slice(3)}</Td><Td num>{brl(r.realized_in_cents)}</Td><Td num>{brl(r.realized_out_cents)}</Td><Td num>{brl(r.forecast_in_cents)}</Td><Td num>{brl(r.forecast_out_cents)}</Td></tr>)}</Table>}
      </section>
      <section><h2 className="text-xl mb-3">Resultados por produto</h2>
        <p className="text-sm text-navy-400 mb-2">Venda contratada, recebido, serviço realizado e receita reconhecida (regra gerencial <strong>proposta</strong>: pacotes = sessões realizadas × valor por sessão; demais = valor recebido — a validar pelo responsável).</p>
        <State loading={prods.isLoading} error={prods.error} empty={prods.data?.length === 0} />
        {prods.data && prods.data.length > 0 && <Table head={["Produto", "Contratado", "Recebido", "Sessões realizadas", "Reconhecido"]} right={[1, 2, 3, 4]}>
          {prods.data.map((r) => <tr key={r.product_id}><Td>{r.product_name}</Td><Td num>{brl(r.contracted_cents)}</Td><Td num>{brl(r.received_cents)}</Td><Td num>{r.delivered_sessions}</Td><Td num>{brl(r.recognized_cents)}</Td></tr>)}</Table>}
      </section>
    </div>
  );
};

export default Dashboard;
