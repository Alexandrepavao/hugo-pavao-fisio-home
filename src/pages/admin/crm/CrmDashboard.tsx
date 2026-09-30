import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl, fmtDateTime } from "@/lib/format";
import { PageHead, State, StatCard } from "@/lib/ui";
import { CardDetailSheet, type CardDetailTrigger, type CardKind } from "@/lib/CardDetailSheet";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { axisBrl, mfmt, presetRange, toExclusive, usePeriodFilterState, useUnits, type Metric } from "../finance/shared";
import Greeting from "../Greeting";
import type { StaffUser, Task } from "./types";

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--success))", "hsl(38 65% 58%)", "hsl(var(--muted-foreground))"];

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

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0"><Greeting /><p className="text-muted-foreground max-w-2xl">Resumo comercial. Toque em qualquer cartão para ver o detalhamento.</p></div>
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
      </div>

      <State loading={metrics.isLoading} error={metrics.error} />
      {metrics.data && (
        <section className="mb-8">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Novos leads no período" m={metrics.data.new_leads} prev={prevMetrics.data?.new_leads} onOpen={() => openDetail("crm_new_leads")} />
            <Kpi label="Total de negócios no recorte" m={metrics.data.total_deals} />
            <Kpi label="Negócios em aberto" m={metrics.data.open_deals} onOpen={() => openDetail("crm_open_deals")} />
            <Kpi label="Valor em negociação" m={metrics.data.open_value} kind="brl" onOpen={() => openDetail("crm_open_value")} />
            <Kpi label="Negócios ganhos" m={metrics.data.won_deals} prev={prevMetrics.data?.won_deals} onOpen={() => openDetail("crm_won_deals")} />
            <Kpi label="Conversão comercial" m={metrics.data.win_rate} kind="pct" prev={prevMetrics.data?.win_rate} onOpen={() => openDetail("crm_win_rate")} />
            <Kpi label="Oportunidades sem retorno" m={metrics.data.stale_deals} tone="danger" onOpen={() => openDetail("crm_stale_deals")} />
            <Kpi label="Comissão potencial" m={metrics.data.commission_potential} kind="brl" onOpen={() => openDetail("crm_commission_potential")} />
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <section><h2 className="text-xl mb-3">Tarefas</h2>
          <div className="hp-card p-4">
            <State loading={myTasks.isLoading} error={myTasks.error} empty={myTasks.data?.length === 0} emptyText="Nenhuma tarefa pendente." />
            {myTasks.data && myTasks.data.length > 0 && (
              <ul className="grid gap-2">
                {myTasks.data.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border last:border-0">
                    <span className={new Date(t.due_at) < new Date() ? "text-destructive" : ""}>{t.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section><h2 className="text-xl mb-3">Atividades recentes</h2>
          <div className="hp-card p-4">
            <State loading={activities.isLoading} error={activities.error} empty={activities.data?.length === 0} emptyText="Nenhuma atividade registrada." />
            {activities.data && activities.data.length > 0 && (
              <ul className="grid gap-2">
                {activities.data.map((a) => (
                  <li key={a.id} className="text-sm py-1.5 border-b border-border last:border-0">
                    <p className="truncate"><strong>{a.person?.full_name ?? "—"}</strong> — {a.summary}</p>
                    <p className="text-xs text-muted-foreground">{a.channel} · {fmtDateTime(a.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <section><h2 className="text-xl mb-3">Negócios por etapa (em aberto)</h2>
          {byStage.data && byStage.data.length > 0 ? (
            <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStage.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="etapa" fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} /><YAxis fontSize={12} allowDecimals={false} />
                <Tooltip /><Bar dataKey="Quantidade" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem oportunidades em aberto neste funil.</p>}
        </section>
        <section><h2 className="text-xl mb-3">Evolução de negócios ganhos (6 meses)</h2>
          {evolution.data && evolution.data.some((e) => e.Negócios > 0) ? (
            <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolution.data}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
                <Tooltip formatter={(v: number, n: string) => n === "Valor" ? brl(Math.round(v * 100)) : v} /><Line type="monotone" dataKey="Valor" stroke="hsl(var(--success))" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem negócios ganhos nos últimos 6 meses.</p>}
        </section>
        <section><h2 className="text-xl mb-3">Origem dos leads (período)</h2>
          {bySource.data && bySource.data.length > 0 ? (
            <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={bySource.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: { name: string; value: number }) => `${e.name} (${e.value})`}>
                {bySource.data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
          ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem leads no período.</p>}
        </section>
        {isManagerLike && (
          <section><h2 className="text-xl mb-3">Desempenho por responsável (período)</h2>
            {byRep.data && byRep.data.length > 0 ? (
              <div className="hp-card p-4" style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">
                <BarChart data={byRep.data} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis type="number" fontSize={12} tickFormatter={axisBrl} /><YAxis type="category" dataKey="nome" fontSize={11} width={110} />
                  <Tooltip formatter={(v: number) => brl(Math.round(v * 100))} /><Bar dataKey="Valor ganho" fill="hsl(var(--accent))" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
            ) : <p className="text-sm text-muted-foreground hp-card p-4">Sem negócios ganhos no período (ou você só vê os próprios números).</p>}
          </section>
        )}
      </div>

      <CardDetailSheet trigger={detail} onClose={() => setDetail(null)} />
    </div>
  );
};

const Kpi = ({ label, m, kind = "int", tone, prev, onOpen }: { label: string; m?: Metric; kind?: "brl" | "pct" | "int"; tone?: "danger"; prev?: Metric; onOpen?: () => void }) => {
  const shown = mfmt(m, kind);
  const delta = prev && m?.available && prev.available && Number(prev.value) !== 0 ? Math.round(((Number(m.value) - Number(prev.value)) / Number(prev.value)) * 1000) / 10 : null;
  return (
    <StatCard label={label} value={shown} tone={tone}
      basis={delta != null ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toString().replace(".", ",")}% vs. período anterior` : (prev !== undefined ? "Sem base de comparação" : m?.basis)}
      unavailable={m ? !m.available || m.value == null : false} onClick={onOpen} />
  );
};

export default CrmDashboard;
