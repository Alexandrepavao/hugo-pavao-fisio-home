import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { State, StatCard } from "@/lib/ui";
import Greeting from "./Greeting";
import GeoSection from "./GeoSection";
import { PeriodFilter } from "./finance/PeriodFilter";
import { axisBrl, mfmt, presetRange, toExclusive, useUnits, type Metric, type RangePreset } from "./finance/shared";

type Metrics = Record<string, Metric | { items: { reason: string; count: number }[]; basis: string }>;
interface Alert { kind: string; label: string; link: string; count: number }

const Dashboard = () => {
  const [preset, setPreset] = useState<RangePreset>("mes");
  const [custom, setCustom] = useState(presetRange("mes"));
  const [unit, setUnit] = useState(""); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const range = { from: `${from}T00:00:00.000Z`, to: toExclusive(to) };
  const prevRange = (() => {
    const f = new Date(from + "T00:00:00"); const t = new Date(to + "T00:00:00");
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 864e5) + 1);
    const pf = new Date(f.getTime() - days * 864e5); const pt = new Date(f.getTime() - 864e5);
    return { from: pf.toISOString(), to: new Date(pt.getTime() + 864e5).toISOString() };
  })();

  const units = useUnits();
  const metrics = useQuery({ queryKey: ["dash", range.from, range.to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: range.from, p_to: range.to, p_unit: unit || null }); if (error) throw error; return data as Metrics;
  } });
  const prevMetrics = useQuery({ queryKey: ["dash-prev", prevRange.from, prevRange.to, unit], enabled: compare, queryFn: async () => {
    const { data, error } = await supabase.rpc("dashboard_metrics", { p_from: prevRange.from, p_to: prevRange.to, p_unit: unit || null }); if (error) throw error; return data as Metrics;
  } });
  const alerts = useQuery({ queryKey: ["alerts", unit], queryFn: async () => { const { data, error } = await supabase.rpc("dashboard_alerts", { p_unit: unit || null }); if (error) throw error; return data as Alert[]; } });
  const cash = useQuery({ queryKey: ["cash-home", unit], queryFn: async () => {
    const to3 = new Date(); to3.setMonth(to3.getMonth() + 1); const from6 = new Date(); from6.setMonth(from6.getMonth() - 5);
    const { data, error } = await supabase.rpc("cash_flow_monthly", { p_from: from6.toISOString().slice(0, 10), p_to: to3.toISOString().slice(0, 10), p_unit: unit || null }); if (error) throw error;
    return (data as { month: string; realized_in_cents: number; realized_out_cents: number }[]).map((r) => ({ mes: fmtDate(r.month + "T12:00:00Z").slice(0, 5), Entradas: r.realized_in_cents / 100, Saídas: r.realized_out_cents / 100 }));
  } });
  const funnel = useQuery({ queryKey: ["funnel-home", range.from, range.to, unit], queryFn: async () => {
    const m = metrics.data; if (!m) return [];
    return [
      { etapa: "Leads", n: (m.leads as Metric)?.available ? Number((m.leads as Metric).value) : 0 },
      { etapa: "Oportunidades", n: (m.opportunities_created as Metric)?.available ? Number((m.opportunities_created as Metric).value) : 0 },
      { etapa: "Avaliações", n: (m.evaluations_scheduled as Metric)?.available ? Number((m.evaluations_scheduled as Metric).value) : 0 },
      { etapa: "Contratos", n: (m.average_ticket_cents as Metric & { sales?: number })?.sales ?? 0 },
    ];
  }, enabled: !!metrics.data });
  // "Novos pacientes" e "pacientes ativos" ainda não têm RPC dedicada — consulta direta (contagem simples, sem regra complexa de negócio).
  const patients = useQuery({ queryKey: ["patients-home", range.from, range.to, unit], queryFn: async () => {
    let newQ = supabase.from("people").select("id, person_kinds!inner(kind)", { count: "exact", head: true }).eq("person_kinds.kind", "patient").gte("created_at", range.from).lt("created_at", range.to);
    const activeQ = supabase.from("client_packages").select("person_id", { count: "exact", head: true }).eq("status", "active");
    const partnersQ = supabase.from("partner_profiles").select("id", { count: "exact", head: true }).eq("status", "active");
    if (unit) { newQ = newQ.eq("unit_id", unit); }
    const [n, a, p] = await Promise.all([newQ, activeQ, partnersQ]);
    return { newPatients: n.count ?? 0, activePackages: a.count ?? 0, activePartners: p.count ?? 0 };
  } });

  const alertsTotal = (alerts.data ?? []).reduce((a, x) => a + x.count, 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0"><Greeting /><p className="text-muted-foreground max-w-2xl">Resumo da operação. Toque em qualquer cartão para ver o detalhamento.</p></div>
        <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
          onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
          onUnit={setUnit} onCompare={setCompare} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); setUnit(""); setCompare(false); }} />
      </div>

      <State loading={metrics.isLoading} error={metrics.error} />
      {alerts.data && (
        <section aria-label="Alertas" className="mb-8">
          <h2 className="text-xl mb-3">Alertas e ações prioritárias {alertsTotal === 0 && <span className="text-sm font-normal text-muted-foreground">— tudo em dia</span>}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.data.map((a) => (
              <li key={a.kind}><Link to={a.link} className="hp-card flex items-center gap-3 p-3 hover:bg-muted/60 transition-colors">
                <span className={`grid place-items-center rounded-md tabular font-bold ${a.count > 0 ? "hp-badge-warning" : "bg-muted text-muted-foreground"}`} style={{ width: "2.5rem", height: "2.5rem", fontSize: "1.125rem" }}>{a.count}</span>
                <span className="text-sm">{a.label}</span></Link></li>))}
          </ul></section>
      )}

      {metrics.data && patients.data && (
        <section className="mb-8"><h2 className="text-xl mb-3">Visão executiva</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Exec label="Recebimentos" m={metrics.data.receipts_cents as Metric} prev={prevMetrics.data?.receipts_cents as Metric} kind="brl" />
            <Exec label="Contas vencidas" m={metrics.data.overdue_cents as Metric} kind="brl" tone="danger" />
            <Exec label="Novos pacientes" value={patients.data.newPatients.toLocaleString("pt-BR")} />
            <Exec label="Pacientes com pacote ativo" value={patients.data.activePackages.toLocaleString("pt-BR")} basis="pessoas com ao menos um pacote em status ativo (hoje)" />
            <Exec label="Avaliações agendadas" m={metrics.data.evaluations_scheduled as Metric} />
            <Exec label="Atendimentos realizados" m={metrics.data.attended as Metric} prev={prevMetrics.data?.attended as Metric} />
            <Exec label="Conversão comercial" m={metrics.data.win_rate as Metric} prev={prevMetrics.data?.win_rate as Metric} kind="pct" />
            <Exec label="Parceiros ativos" value={patients.data.activePartners.toLocaleString("pt-BR")} />
            <Exec label="Alunos ativos no Academy" m={metrics.data.active_students as Metric} />
            <Exec label="Ticket médio" m={metrics.data.average_ticket_cents as Metric} prev={prevMetrics.data?.average_ticket_cents as Metric} kind="brl" />
            <Exec label="Comparecimento" m={metrics.data.attendance_rate as Metric} kind="pct" />
            <Exec label="NPS" m={metrics.data.nps as Metric} />
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <section><h2 className="text-xl mb-3">Evolução financeira (6 meses)</h2>
          {cash.data && cash.data.length > 0 ? (
            <div className="hp-card p-4" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={cash.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip formatter={(v: number) => brl(Math.round(v * 100))} />
                <Line type="monotone" dataKey="Entradas" stroke="hsl(var(--success))" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="Saídas" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              </LineChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem movimentos suficientes.</p>}
        </section>
        <section><h2 className="text-xl mb-3">Leads, avaliações e contratos (período)</h2>
          {funnel.data && funnel.data.some((f) => f.n > 0) ? (
            <div className="hp-card p-4" style={{ height: 240 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="etapa" fontSize={12} /><YAxis fontSize={12} allowDecimals={false} />
                <Tooltip /><Bar dataKey="n" name="Quantidade" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem dados suficientes no período.</p>}
        </section>
      </div>

      <GeoSection unit={unit} />
    </div>
  );
};

const Exec = ({ label, m, value, basis, kind = "int", prev, tone }: { label: string; m?: Metric; value?: string; basis?: string; kind?: "brl" | "pct" | "int"; prev?: Metric; tone?: "danger" }) => {
  const shown = value ?? mfmt(m, kind);
  const delta = prev && m?.available && prev.available && Number(prev.value) !== 0 ? Math.round(((Number(m.value) - Number(prev.value)) / Number(prev.value)) * 1000) / 10 : null;
  return (
    <StatCard label={label} value={shown} tone={tone ?? (m && !m.available ? undefined : undefined)}
      basis={delta != null ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toString().replace(".", ",")}% vs. período anterior` : prev !== undefined ? "Sem base de comparação" : (basis ?? m?.basis)}
      unavailable={m ? !m.available || m.value == null : false} />
  );
};

export default Dashboard;
