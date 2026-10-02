import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, CheckCircle2, Coins, FolderOpen, Layers, Percent, Trophy, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDateTime } from "@/lib/format";
import { EmptyState, KpiGrid, LevelSection, PageHead, State, StatCard, type CardLevel } from "@/lib/ui";
import { AreaTrend, BarBlock, DonutBlock, RankBars } from "@/lib/IndicatorCharts";
import { makeDelta } from "@/lib/kpi";
import { CardDetailSheet, type CardDetailTrigger, type CardKind } from "@/lib/CardDetailSheet";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { axisBrl, mfmt, presetRange, toExclusive, usePeriodFilterState, useUnits, type Metric } from "../finance/shared";
import { RANGE_LABEL } from "@/lib/period";
import type { StaffUser, Task } from "./types";


const CrmDashboard = () => {
  const { preset, custom, unit, compare, onPreset, onFrom, onTo, onUnit, onCompare, onClear } = usePeriodFilterState();
  const [owner, setOwner] = useState(""); const [pipeline, setPipeline] = useState("");
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const range = { from: `${from}T00:00:00.000Z`, to: toExclusive(to) };
  const prevRange = (() => {
    const f = new Date(from + "T00:00:00"); const t = new Date(to + "T00:00:00");
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 864e5) + 1);
    const pf = new Date(f.getTime() - days * 864e5); const pt = new Date(f.getTime() - 864e5);
    return { from: pf.toISOString(), to: new Date(pt.getTime() + 864e5).toISOString() };
  })();

  const units = useUnits();
  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const pipes = useQuery({ queryKey: ["pipelines-crm-dash"], queryFn: async () => (await supabase.from("pipelines").select("id, name").eq("active", true).order("name")).data ?? [] });

  const metrics = useQuery({ queryKey: ["crm-dash", range.from, range.to, unit, owner, pipeline], queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_dashboard_metrics", { p_from: range.from, p_to: range.to, p_unit: unit || null, p_owner: owner || null, p_pipeline: pipeline || null });
    if (error) throw error; return data as Record<string, Metric>;
  } });
  const prevMetrics = useQuery({ queryKey: ["crm-dash-prev", prevRange.from, prevRange.to, unit, owner, pipeline], enabled: compare, queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_dashboard_metrics", { p_from: prevRange.from, p_to: prevRange.to, p_unit: unit || null, p_owner: owner || null, p_pipeline: pipeline || null });
    if (error) throw error; return data as Record<string, Metric>;
  } });

  // Minhas tarefas: só as tarefas comerciais do próprio usuário (widget do dashboard — a lista completa fica em Tarefas).
  const myTasks = useQuery({ queryKey: ["crm-dash-my-tasks"], queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("crm_tasks").select("id, title, due_at, kind").eq("assignee_user_id", u.user?.id).is("done_at", null).order("due_at").limit(6);
    if (error) throw error; return data as Task[];
  } });

  // Tarefas comerciais do usuário já vencidas (contagem exata, não só as 6 exibidas)
  const overdueTasks = useQuery({ queryKey: ["crm-dash-overdue-tasks"], queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    const { count, error } = await supabase.from("crm_tasks").select("id", { count: "exact", head: true }).eq("assignee_user_id", u.user?.id).is("done_at", null).lt("due_at", new Date().toISOString());
    if (error) throw error; return count ?? 0;
  } });

  // Atividades recentes (interactions), escopo da unidade selecionada — não filtra por responsável (é um mural do time).
  const activities = useQuery({ queryKey: ["crm-dash-activities", unit], queryFn: async () => {
    let q = supabase.from("interactions").select("id, channel, summary, created_at, person:people(full_name)").order("created_at", { ascending: false }).limit(8);
    if (unit) q = q.eq("unit_id", unit);
    const { data, error } = await q; if (error) throw error;
    return data as unknown as { id: string; channel: string; summary: string; created_at: string; person: { full_name: string } | null }[];
  } });

  // Negócios por etapa (quantidade e valor) do funil selecionado (ou do primeiro funil, se nenhum escolhido).
  const pid = pipeline || pipes.data?.[0]?.id || "";
  const byStage = useQuery({ queryKey: ["crm-dash-by-stage", pid, unit, owner], enabled: !!pid, queryFn: async () => {
    const { data: stages, error: e1 } = await supabase.from("pipeline_stages").select("id, name, position").eq("pipeline_id", pid).order("position");
    if (e1) throw e1;
    let q = supabase.from("opportunities").select("stage_id, value_cents, status").eq("pipeline_id", pid).eq("status", "open");
    if (unit) q = q.eq("unit_id", unit); if (owner) q = q.eq("owner_user_id", owner);
    const { data: opps, error: e2 } = await q; if (e2) throw e2;
    return (stages ?? []).map((s) => {
      const items = (opps ?? []).filter((o) => o.stage_id === s.id);
      return { etapa: s.name, Quantidade: items.length, Valor: items.reduce((a, o) => a + o.value_cents, 0) / 100 };
    });
  } });

  // Evolução (últimos 6 meses): negócios ganhos por mês, mesmo escopo de unidade/responsável/funil.
  const evolution = useQuery({ queryKey: ["crm-dash-evolution", unit, owner, pipeline], queryFn: async () => {
    const from6 = new Date(); from6.setMonth(from6.getMonth() - 5); from6.setDate(1);
    let q = supabase.from("opportunities").select("closed_at, value_cents, status").eq("status", "won").gte("closed_at", from6.toISOString());
    if (unit) q = q.eq("unit_id", unit); if (owner) q = q.eq("owner_user_id", owner); if (pipeline) q = q.eq("pipeline_id", pipeline);
    const { data, error } = await q; if (error) throw error;
    const buckets = new Map<string, { n: number; v: number }>();
    for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { n: 0, v: 0 }); }
    for (const o of data ?? []) { const k = (o.closed_at as string).slice(0, 7); const b = buckets.get(k); if (b) { b.n++; b.v += o.value_cents / 100; } }
    return [...buckets.entries()].map(([k, v]) => ({ mes: k.slice(5) + "/" + k.slice(2, 4), Negócios: v.n, Valor: v.v }));
  } });

  // Origem dos leads: oportunidades criadas no período, agrupadas por origem.
  const bySource = useQuery({ queryKey: ["crm-dash-source", range.from, range.to, unit, owner, pipeline], queryFn: async () => {
    let q = supabase.from("opportunities").select("source").gte("created_at", range.from).lt("created_at", range.to);
    if (unit) q = q.eq("unit_id", unit); if (owner) q = q.eq("owner_user_id", owner); if (pipeline) q = q.eq("pipeline_id", pipeline);
    const { data, error } = await q; if (error) throw error;
    const by = new Map<string, number>();
    for (const o of data ?? []) { const k = o.source || "Não informada"; by.set(k, (by.get(k) ?? 0) + 1); }
    return [...by.entries()].map(([origem, n]) => ({ name: origem, value: n })).sort((a, b) => b.value - a.value).slice(0, 6);
  } });

  // Desempenho por responsável — só quem gerencia enxerga (o backend já reforça isso; se um comercial comum
  // chamar com p_owner de outra pessoa, crm_effective_owner ignora e devolve só os próprios dados mesmo assim).
  const isManagerLike = !owner; // heurística de UI: sempre tenta buscar; se vier vazio/1 linha é porque o backend já limitou
  const byRep = useQuery({ queryKey: ["crm-dash-by-rep", range.from, range.to, unit, pipeline], enabled: isManagerLike, queryFn: async () => {
    let q = supabase.from("opportunities").select("owner_user_id, status, value_cents, closed_at, created_at").gte("created_at", range.from);
    if (unit) q = q.eq("unit_id", unit); if (pipeline) q = q.eq("pipeline_id", pipeline);
    const { data, error } = await q; if (error) throw error;
    const by = new Map<string, { won: number; lost: number; wonValue: number }>();
    for (const o of data ?? []) {
      const key = o.owner_user_id ?? "none"; if (!by.has(key)) by.set(key, { won: 0, lost: 0, wonValue: 0 });
      const b = by.get(key)!;
      if (o.status === "won" && o.closed_at && o.closed_at >= range.from && o.closed_at < range.to) { b.won++; b.wonValue += o.value_cents / 100; }
      if (o.status === "lost" && o.closed_at && o.closed_at >= range.from && o.closed_at < range.to) b.lost++;
    }
    return [...by.entries()].map(([id, v]) => ({ nome: users.data?.find((u) => u.user_id === id)?.name ?? "Sem responsável", Ganhos: v.won, "Valor ganho": v.wonValue }))
      .filter((r) => r.Ganhos > 0 || r["Valor ganho"] > 0).sort((a, b) => b["Valor ganho"] - a["Valor ganho"]).slice(0, 8);
  } });

  const unitLabel = units.data?.find((u) => u.id === unit)?.name ?? "Todas as unidades";
  const [detail, setDetail] = useState<CardDetailTrigger | null>(null);
  const openDetail = (kind: CardKind) => setDetail({ kind, from: range.from, to: range.to, unit, unitLabel, prevFrom: prevRange.from, prevTo: prevRange.to, owner, pipeline });

  const per = RANGE_LABEL[preset];
  const m = metrics.data; const pm = prevMetrics.data;
  const sparkWon = evolution.data && evolution.data.length > 1 && evolution.data.some((e) => e.Negócios > 0) ? evolution.data.map((e) => e.Negócios) : undefined;
  const late = overdueTasks.data ?? 0;

  return (
    <div>
      <PageHead eyebrow="CRM" title="Painel comercial" hint="Resumo comercial. Toque em qualquer cartão para ver o detalhamento."
        actions={
          <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
            onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onCompare={onCompare}
            onClear={() => { onClear(); setOwner(""); setPipeline(""); }}
            extraCount={(owner ? 1 : 0) + (pipeline ? 1 : 0)} extraSummary={[owner && (users.data?.find((u) => u.user_id === owner)?.name ?? "Responsável"), pipeline && (pipes.data?.find((p) => p.id === pipeline)?.name ?? "Funil")].filter(Boolean).join(" · ") || undefined}
            extra={
              <div className="grid gap-3">
                <div><label htmlFor="crm-owner" className="block text-xs mb-1">Responsável</label>
                  <select id="crm-owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos (conforme sua permissão)</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
                <div><label htmlFor="crm-pipe" className="block text-xs mb-1">Funil</label>
                  <select id="crm-pipe" value={pipeline} onChange={(e) => setPipeline(e.target.value)}><option value="">Todos</option>{(pipes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              </div>
            } />
        } />

      <State loading={metrics.isLoading} error={metrics.error} />
      {m && (
        <LevelSection level="summary" title="Indicadores prioritários" label="Resumo do período" hint="O essencial do funil no período e no recorte selecionados.">
          <KpiGrid kind="hero">
            <Kpi level="hero" icon={UserPlus} label="Novos leads no período" m={m.new_leads} prev={pm?.new_leads} unit="leads" period={per} onOpen={() => openDetail("crm_new_leads")} />
            <Kpi level="hero" icon={Trophy} label="Negócios ganhos" m={m.won_deals} prev={pm?.won_deals} unit="negócios" period={per} spark={sparkWon} onOpen={() => openDetail("crm_won_deals")} />
            <Kpi level="hero" icon={Percent} label="Conversão comercial" m={m.win_rate} kind="pct" prev={pm?.win_rate} period={per} onOpen={() => openDetail("crm_win_rate")} />
            <Kpi level="hero" icon={Wallet} label="Valor em negociação" m={m.open_value} kind="brl" period="Hoje" onOpen={() => openDetail("crm_open_value")} />
          </KpiGrid>
        </LevelSection>
      )}

      {m && (
        <LevelSection level="attention" title="Atenção" hint="O que precisa de ação comercial agora.">
          <KpiGrid kind="lg">
            <Kpi level={(Number(m.stale_deals?.value) || 0) > 0 ? "attention" : "compact"} icon={AlertTriangle} label="Oportunidades sem retorno" m={m.stale_deals} unit="oportunidades" period="Hoje"
              tone={(Number(m.stale_deals?.value) || 0) > 0 ? "danger" : undefined} status={(Number(m.stale_deals?.value) || 0) > 0 ? "Crítico" : undefined} onOpen={() => openDetail("crm_stale_deals")} />
            {overdueTasks.data !== undefined && (
              <StatCard level={late > 0 ? "attention" : "compact"} icon={CalendarClock} label="Minhas tarefas atrasadas" value={late.toLocaleString("pt-BR")} unit={late === 1 ? "tarefa" : "tarefas"} period="Hoje"
                basis="tarefas comerciais atribuídas a você, não concluídas e com prazo vencido" tone={late > 0 ? "warning" : undefined} status={late > 0 ? "Atenção" : undefined} onClick={() => { window.location.assign("/admin/crm/tarefas"); }} />
            )}
          </KpiGrid>
        </LevelSection>
      )}

      {m && (
        <LevelSection level="summary" title="Mais indicadores" hint="Apoio à leitura do funil.">
          <KpiGrid kind="compact">
            <Kpi level="compact" icon={FolderOpen} label="Negócios em aberto" m={m.open_deals} unit="negócios" period="Hoje" onOpen={() => openDetail("crm_open_deals")} />
            <Kpi level="compact" icon={Layers} label="Total de negócios no recorte" m={m.total_deals} unit="negócios" period={per} />
            <Kpi level="compact" icon={Coins} label="Comissão potencial" m={m.commission_potential} kind="brl" period="Hoje" onOpen={() => openDetail("crm_commission_potential")} />
          </KpiGrid>
        </LevelSection>
      )}

      <LevelSection level="analysis" title="Evolução, funil e origem" hint="Gráficos com dados reais; sem dado, o espaço explica o motivo.">
        <div className="grid gap-4 lg:grid-cols-2">
          <AreaTrend title="Evolução de negócios ganhos (6 meses)" hint="Valor ganho por mês (data do fechamento)." data={(evolution.data ?? []) as never} xKey="mes" isEmpty={!(evolution.data && evolution.data.some((e) => e.Negócios > 0))} empty="Nenhum negócio ganho nos últimos 6 meses."
            series={[{ key: "Valor", label: "Valor ganho", color: "hsl(var(--success))" }]} format={(v) => brl(Math.round(v * 100))} yFormat={axisBrl} />
          <BarBlock title="Negócios por etapa (em aberto)" hint="Quantidade de negócios abertos em cada etapa do funil." data={(byStage.data ?? []).filter(() => byStage.data?.some((e) => e.Quantidade > 0)) as never} xKey="etapa"
            series={[{ key: "Quantidade", label: "Quantidade" }]} empty="Sem oportunidades em aberto neste funil." />
          <DonutBlock title="Origem dos leads (período)" hint="De onde vieram as oportunidades criadas no período." data={bySource.data ?? []} noun="leads" empty="Nenhum lead criado no período selecionado." />
          {isManagerLike && (
            <RankBars title="Desempenho por responsável (período)" hint="Valor ganho no período." empty="Sem negócios ganhos no período (ou você só vê os próprios números)." color="hsl(var(--chart-2))"
              items={(byRep.data ?? []).map((r) => ({ label: r.nome, value: r["Valor ganho"], display: brl(Math.round(r["Valor ganho"] * 100)) }))} />
          )}
        </div>
      </LevelSection>

      <LevelSection level="summary" title="Tarefas e atividades" label="Atividades" hint="O que está na sua fila e o que aconteceu por último.">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="hp-card p-5" aria-label="Tarefas"><div className="flex items-center justify-between"><h3 className="text-[0.9375rem] font-bold">Tarefas</h3><Link to="/admin/crm/tarefas" className="text-xs font-semibold text-primary hover:underline">Ver todas</Link></div>
            <div className="mt-3">
              <State loading={myTasks.isLoading} error={myTasks.error} />
              {myTasks.data?.length === 0 && <EmptyState icon={CheckCircle2} title="Nenhuma tarefa pendente">Você está em dia com as tarefas comerciais.</EmptyState>}
              {myTasks.data && myTasks.data.length > 0 && (
                <ul className="grid gap-1">
                  {myTasks.data.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-border last:border-0">
                      <span className={`min-w-0 truncate ${new Date(t.due_at) < new Date() ? "text-destructive font-medium" : ""}`}>{t.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(t.due_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <section className="hp-card p-5" aria-label="Atividades recentes"><h3 className="text-[0.9375rem] font-bold">Atividades recentes</h3>
            <div className="mt-3">
              <State loading={activities.isLoading} error={activities.error} />
              {activities.data?.length === 0 && <EmptyState title="Nenhuma atividade registrada">As interações com leads e pacientes aparecem aqui.</EmptyState>}
              {activities.data && activities.data.length > 0 && (
                <ul className="grid gap-1">
                  {activities.data.map((a) => (
                    <li key={a.id} className="text-sm py-2 border-b border-border last:border-0">
                      <p className="truncate"><strong>{a.person?.full_name ?? "—"}</strong> — {a.summary}</p>
                      <p className="text-xs text-muted-foreground">{a.channel} · {fmtDateTime(a.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </LevelSection>

      <CardDetailSheet trigger={detail} onClose={() => setDetail(null)} />
    </div>
  );
};

const Kpi = ({ label, m, kind = "int", tone, prev, unit, period, level, icon, spark, status, onOpen }: { label: string; m?: Metric; kind?: "brl" | "pct" | "int"; tone?: "danger"; prev?: Metric; unit?: string; period?: string; level?: CardLevel; icon?: LucideIcon; spark?: number[]; status?: string; onOpen?: () => void }) => (
  <StatCard level={level} icon={icon} spark={spark} status={status} label={label} value={mfmt(m, kind)} unit={kind === "int" ? unit : undefined} period={period} tone={tone} delta={makeDelta(m, prev)}
    basis={m?.basis} unavailable={m ? !m.available || m.value == null : false} onClick={onOpen} />
);

export default CrmDashboard;
