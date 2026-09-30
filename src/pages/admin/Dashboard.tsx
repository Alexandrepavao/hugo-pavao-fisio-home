import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { LevelSection, State, StatCard } from "@/lib/ui";
import { ChartCard, tooltipStyle } from "@/lib/IndicatorCharts";
import { makeDelta } from "@/lib/kpi";
import { RANGE_LABEL } from "@/lib/period";
import { CardDetailSheet, type CardDetailTrigger, type CardKind } from "@/lib/CardDetailSheet";
import Greeting from "./Greeting";
import GeoSection from "./GeoSection";
import { PeriodFilter } from "./finance/PeriodFilter";
import { axisBrl, mfmt, presetRange, toExclusive, usePeriodFilterState, useUnits, type Metric } from "./finance/shared";

type Metrics = Record<string, Metric | { items: { reason: string; count: number }[]; basis: string }>;
interface Alert { kind: string; label: string; link: string; count: number }

const Dashboard = () => {
  const navigate = useNavigate();
  const { preset, custom, unit, compare, onPreset, onFrom, onTo, onUnit, onCompare, onClear } = usePeriodFilterState();
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

  const per = RANGE_LABEL[preset];
  const alertsTotal = (alerts.data ?? []).reduce((a, x) => a + x.count, 0);
  const unitLabel = units.data?.find((u) => u.id === unit)?.name ?? "Todas as unidades";
  const [detail, setDetail] = useState<CardDetailTrigger | null>(null);
  const openDetail = (kind: CardKind) => setDetail({ kind, from: range.from, to: range.to, unit, unitLabel, prevFrom: prevRange.from, prevTo: prevRange.to });
  const ALERT_DANGER = new Set(["cobrancas_vencidas", "tarefas_atrasadas", "eventos_falhos"]);
  const ALERT_DETAIL: Record<string, CardKind> = {
    cobrancas_vencidas: "overdue", tarefas_atrasadas: "overdue_tasks",
    leads_sem_retorno: "leads_sem_retorno", pacotes_fim: "pacotes_fim",
    duplicidades: "duplicidades", eventos_falhos: "eventos_falhos",
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0"><Greeting /><p className="text-muted-foreground max-w-2xl">Resumo da operação. Toque em qualquer cartão para ver o detalhamento.</p></div>
        <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
          onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onCompare={onCompare} onClear={onClear} />
      </div>

      <State loading={metrics.isLoading} error={metrics.error} />
      {alerts.data && (
        <LevelSection level="attention" title="Alertas e ações prioritárias" label="Alertas" hint={alertsTotal === 0 ? "Tudo em dia." : "Situação de hoje. Clique para ver os itens."}>
          <ul className="hp-kpi-grid hp-kpi-grid-lg">
            {alerts.data.map((a) => {
              const dKind = ALERT_DETAIL[a.kind];
              return <StatCard key={a.kind} level={a.count > 0 ? "attention" : "compact"} label={a.label} value={a.count.toLocaleString("pt-BR")} unit={a.count === 1 ? "item" : "itens"} period="Hoje"
                tone={a.count > 0 ? (ALERT_DANGER.has(a.kind) ? "danger" : "warning") : undefined} onClick={() => (dKind ? openDetail(dKind) : navigate(a.link))} />;
            })}
          </ul>
        </LevelSection>
      )}

      {metrics.data && patients.data && (
        <LevelSection level="summary" title="Visão executiva" hint="Números principais do período selecionado; o que é situação de hoje está marcado.">
          <ul className="hp-kpi-grid">
            <Exec label="Recebimentos" m={metrics.data.receipts_cents as Metric} prev={prevMetrics.data?.receipts_cents as Metric} kind="brl" period={per} onOpen={() => openDetail("receipts")} />
            <Exec label="Atendimentos realizados" m={metrics.data.attended as Metric} prev={prevMetrics.data?.attended as Metric} unit="atendimentos" period={per} onOpen={() => openDetail("attended")} />
            <Exec label="Conversão comercial" m={metrics.data.win_rate as Metric} prev={prevMetrics.data?.win_rate as Metric} kind="pct" period={per} onOpen={() => openDetail("win_rate")} />
            <Exec label="Contas vencidas" m={metrics.data.overdue_cents as Metric} kind="brl" tone="danger" period="Hoje" onOpen={() => openDetail("overdue")} />
            <Exec level="compact" label="Novos pacientes" value={patients.data.newPatients.toLocaleString("pt-BR")} unit="pacientes" period={per} onOpen={() => openDetail("new_patients")} />
            <Exec level="compact" label="Pacientes com pacote ativo" value={patients.data.activePackages.toLocaleString("pt-BR")} unit="pacientes" period="Hoje" onOpen={() => openDetail("active_packages")} />
            <Exec level="compact" label="Avaliações agendadas" m={metrics.data.evaluations_scheduled as Metric} unit="avaliações" period={per} onOpen={() => openDetail("evaluations_scheduled")} />
            <Exec level="compact" label="Parceiros ativos" value={patients.data.activePartners.toLocaleString("pt-BR")} unit="parceiros" period="Hoje" onOpen={() => openDetail("active_partners")} />
            <Exec level="compact" label="Alunos ativos no Academy" m={metrics.data.active_students as Metric} unit="alunos" period="Hoje" onOpen={() => openDetail("active_students")} />
            <Exec level="compact" label="Ticket médio" m={metrics.data.average_ticket_cents as Metric} prev={prevMetrics.data?.average_ticket_cents as Metric} kind="brl" period={per} onOpen={() => openDetail("average_ticket")} />
            <Exec level="compact" label="Comparecimento" m={metrics.data.attendance_rate as Metric} kind="pct" period={per} onOpen={() => openDetail("attendance_rate")} />
            <Exec level="compact" label="NPS" m={metrics.data.nps as Metric} basis="pesquisas de satisfação (NPS) têm detalhamento próprio em Pesquisas — não incluído neste cartão para preservar o k-anonimato já aplicado lá" />
          </ul>
        </LevelSection>
      )}

      <LevelSection level="analysis" title="Evolução e funil" hint="Gráficos com dados reais; sem movimento suficiente, o espaço mostra o aviso em vez de inventar curva.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Evolução financeira (6 meses)" isEmpty={!(cash.data && cash.data.length > 0)} empty="Sem movimentos suficientes.">
            <LineChart data={cash.data ?? []} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => brl(Math.round(v * 100))} />
              <Line type="monotone" dataKey="Entradas" stroke="hsl(var(--success))" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="Saídas" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartCard>
          <ChartCard title="Leads, avaliações e contratos (período)" isEmpty={!(funnel.data && funnel.data.some((f) => f.n > 0))} empty="Sem dados suficientes no período.">
            <BarChart data={funnel.data ?? []} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} /><XAxis dataKey="etapa" fontSize={12} /><YAxis fontSize={12} allowDecimals={false} />
              <Tooltip {...tooltipStyle} /><Bar dataKey="n" name="Quantidade" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} /></BarChart>
          </ChartCard>
        </div>
      </LevelSection>

      <GeoSection unit={unit} />
      <CardDetailSheet trigger={detail} onClose={() => setDetail(null)} />
    </div>
  );
};

const Exec = ({ label, m, value, basis, kind = "int", unit, period, level, prev, tone, onOpen }: { label: string; m?: Metric; value?: string; basis?: string; kind?: "brl" | "pct" | "int"; unit?: string; period?: string; level?: "summary" | "compact"; prev?: Metric; tone?: "danger"; onOpen?: () => void }) => (
  <StatCard level={level} label={label} value={value ?? mfmt(m, kind)} unit={kind === "int" ? unit : undefined} period={period} tone={tone} delta={makeDelta(m, prev, { lowerIsBetter: tone === "danger" })}
    basis={basis ?? m?.basis} unavailable={m ? !m.available || m.value == null : false} onClick={onOpen} />
);

export default Dashboard;
