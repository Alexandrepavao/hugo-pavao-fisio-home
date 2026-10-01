import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CalendarClock, ClipboardCheck, Copy, GraduationCap, Handshake, Package, Receipt, Smile, Stethoscope, Target, UserPlus, UserX, Wallet, ZapOff, CheckCircle2, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { EmptyState, KpiGrid, LevelSection, State, StatCard, type CardLevel } from "@/lib/ui";
import { AreaTrend, BarBlock } from "@/lib/IndicatorCharts";
import { useAttention } from "@/components/hp/attention";
import { makeDelta } from "@/lib/kpi";
import { RANGE_LABEL } from "@/lib/period";
import { CardDetailSheet, type CardDetailTrigger, type CardKind } from "@/lib/CardDetailSheet";
import Greeting from "./Greeting";
import GeoSection from "./GeoSection";
import { PeriodFilter } from "./finance/PeriodFilter";
import { axisBrl, mfmt, presetRange, toExclusive, usePeriodFilterState, useUnits, type Metric } from "./finance/shared";

type Metrics = Record<string, Metric | { items: { reason: string; count: number }[]; basis: string }>;
interface Alert { kind: string; label: string; link: string; count: number }

const ALERT_ICON: Record<string, LucideIcon> = { cobrancas_vencidas: Receipt, tarefas_atrasadas: CalendarClock, leads_sem_retorno: UserX, pacotes_fim: Package, duplicidades: Copy, eventos_falhos: ZapOff };

const Dashboard = () => {
  const navigate = useNavigate();
  const attention = useAttention();
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

  const sparkIn = cash.data && cash.data.length > 1 ? cash.data.map((r) => r.Entradas) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-7">
        <div className="min-w-0"><Greeting /><p className="text-muted-foreground text-[13.5px] max-w-2xl">Resumo da operação. Toque em qualquer cartão para ver o detalhamento.</p></div>
        <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
          onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onCompare={onCompare} onClear={onClear} />
      </div>

      <State loading={metrics.isLoading} error={metrics.error} />
      {metrics.data && patients.data && (
        <LevelSection level="summary" title="Indicadores prioritários" label="Visão executiva" hint="O essencial do período selecionado; o que é situação de hoje está marcado no cartão.">
          <KpiGrid kind="hero">
            <Exec level="hero" icon={Wallet} label="Recebimentos" m={metrics.data.receipts_cents as Metric} prev={prevMetrics.data?.receipts_cents as Metric} kind="brl" period={per} spark={sparkIn} onOpen={() => openDetail("receipts")} />
            <Exec level="hero" icon={Stethoscope} label="Atendimentos realizados" m={metrics.data.attended as Metric} prev={prevMetrics.data?.attended as Metric} unit="atendimentos" period={per} onOpen={() => openDetail("attended")} />
            <Exec level="hero" icon={Target} label="Conversão comercial" m={metrics.data.win_rate as Metric} prev={prevMetrics.data?.win_rate as Metric} kind="pct" period={per} onOpen={() => openDetail("win_rate")} />
            <Exec level="hero" icon={UserPlus} label="Novos pacientes" value={patients.data.newPatients.toLocaleString("pt-BR")} unit="pacientes" period={per} onOpen={() => openDetail("new_patients")} />
          </KpiGrid>
        </LevelSection>
      )}

      {alerts.data && (
        <LevelSection level="attention" title="Alertas e ações prioritárias" label="Alertas" hint={alertsTotal === 0 ? "Tudo em dia." : "Situação de hoje. Clique para ver os itens."}>
          <KpiGrid kind="lg">
            {alerts.data.map((a) => {
              const dKind = ALERT_DETAIL[a.kind]; const danger = ALERT_DANGER.has(a.kind);
              return <StatCard key={a.kind} level={a.count > 0 ? "attention" : "compact"} icon={a.count > 0 ? (ALERT_ICON[a.kind] ?? AlertTriangle) : CheckCircle2} label={a.label} value={a.count.toLocaleString("pt-BR")} unit={a.count === 1 ? "item" : "itens"} period="Hoje"
                status={a.count > 0 ? (danger ? "Crítico" : "Atenção") : undefined} tone={a.count > 0 ? (danger ? "danger" : "warning") : "success"} onClick={() => (dKind ? openDetail(dKind) : navigate(a.link))} />;
            })}
          </KpiGrid>
        </LevelSection>
      )}

      {metrics.data && patients.data && (
        <LevelSection level="summary" title="Mais indicadores" hint="Apoio à leitura: situação atual e números do período.">
          <KpiGrid kind="compact">
            <Exec level="compact" icon={AlertTriangle} label="Contas vencidas" m={metrics.data.overdue_cents as Metric} kind="brl" tone="danger" period="Hoje" onOpen={() => openDetail("overdue")} />
            <Exec level="compact" icon={Package} label="Pacientes com pacote ativo" value={patients.data.activePackages.toLocaleString("pt-BR")} unit="pacientes" period="Hoje" onOpen={() => openDetail("active_packages")} />
            <Exec level="compact" icon={ClipboardCheck} label="Avaliações agendadas" m={metrics.data.evaluations_scheduled as Metric} unit="avaliações" period={per} onOpen={() => openDetail("evaluations_scheduled")} />
            <Exec level="compact" icon={Handshake} label="Parceiros ativos" value={patients.data.activePartners.toLocaleString("pt-BR")} unit="parceiros" period="Hoje" onOpen={() => openDetail("active_partners")} />
            <Exec level="compact" icon={GraduationCap} label="Alunos ativos no Academy" m={metrics.data.active_students as Metric} unit="alunos" period="Hoje" onOpen={() => openDetail("active_students")} />
            <Exec level="compact" icon={Receipt} label="Ticket médio" m={metrics.data.average_ticket_cents as Metric} prev={prevMetrics.data?.average_ticket_cents as Metric} kind="brl" period={per} onOpen={() => openDetail("average_ticket")} />
            <Exec level="compact" icon={CalendarCheck} label="Comparecimento" m={metrics.data.attendance_rate as Metric} kind="pct" period={per} onOpen={() => openDetail("attendance_rate")} />
            <Exec level="compact" icon={Smile} label="NPS" m={metrics.data.nps as Metric} basis="pesquisas de satisfação (NPS) têm detalhamento próprio em Pesquisas — não incluído neste cartão para preservar o k-anonimato já aplicado lá" />
          </KpiGrid>
        </LevelSection>
      )}

      <LevelSection level="analysis" title="Evolução e funil" hint="Gráficos com dados reais; sem movimento suficiente, o espaço explica o motivo em vez de inventar curva.">
        <div className="grid gap-4 lg:grid-cols-2">
          <AreaTrend title="Evolução financeira (6 meses)" hint="Entradas e saídas realizadas por mês." data={(cash.data ?? []) as never} xKey="mes" isEmpty={!(cash.data && cash.data.length > 0)} empty="Ainda não há movimentos financeiros suficientes para traçar a evolução."
            series={[{ key: "Entradas", label: "Entradas", color: "hsl(var(--success))" }, { key: "Saídas", label: "Saídas", color: "hsl(var(--destructive))" }]} format={(v) => brl(Math.round(v * 100))} yFormat={axisBrl} />
          <BarBlock title="Leads, avaliações e contratos (período)" hint="Do primeiro contato ao contrato, no período selecionado." data={(funnel.data ?? []).filter(() => funnel.data?.some((f) => f.n > 0)).map((f) => ({ etapa: f.etapa, Quantidade: f.n }))} xKey="etapa"
            series={[{ key: "Quantidade", label: "Quantidade" }]} empty="Sem leads, avaliações ou contratos no período selecionado." />
        </div>
      </LevelSection>

      <GeoSection unit={unit} />

      <LevelSection level="summary" title="Minhas pendências" label="Pendências e atividades" hint="Tarefas comerciais e pendências administrativas atrasadas sob a sua responsabilidade.">
        {attention.loading && <State loading />}
        {!attention.loading && attention.items.length === 0 && <EmptyState icon={CheckCircle2} title="Nada atrasado sob a sua responsabilidade">Quando uma tarefa ou pendência sua vencer, ela aparece aqui e no sino do cabeçalho.</EmptyState>}
        {attention.items.length > 0 && (
          <ul className="hp-card divide-y divide-border">
            {attention.items.map((i) => (
              <li key={i.id}><Link to={i.to} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors">
                <span aria-hidden className="grid place-items-center w-8 h-8 rounded-lg bg-destructive/10 text-destructive"><CalendarClock size={16} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium truncate">{i.label}</span><span className="block text-xs text-destructive">{i.detail}</span></span>
                <span className="text-xs font-semibold text-primary">Abrir</span>
              </Link></li>
            ))}
          </ul>
        )}
      </LevelSection>

      <CardDetailSheet trigger={detail} onClose={() => setDetail(null)} />
    </div>
  );
};

const Exec = ({ label, m, value, basis, kind = "int", unit, period, level, icon, spark, prev, tone, onOpen }: { label: string; m?: Metric; value?: string; basis?: string; kind?: "brl" | "pct" | "int"; unit?: string; period?: string; level?: CardLevel; icon?: LucideIcon; spark?: number[]; prev?: Metric; tone?: "danger"; onOpen?: () => void }) => (
  <StatCard level={level} icon={icon} spark={spark} label={label} value={value ?? mfmt(m, kind)} unit={kind === "int" ? unit : undefined} period={period} tone={tone} delta={makeDelta(m, prev, { lowerIsBetter: tone === "danger" })}
    basis={basis ?? m?.basis} unavailable={m ? !m.available || m.value == null : false} onClick={onOpen} />
);

export default Dashboard;
