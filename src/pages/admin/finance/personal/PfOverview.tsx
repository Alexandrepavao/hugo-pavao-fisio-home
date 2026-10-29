import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BellRing, CalendarClock, CreditCard, PiggyBank, Plus, Scale, Target, TrendingUp, Wallet } from "lucide-react";
import { brl } from "@/lib/format";
import { EmptyState, KpiGrid, LevelSection, PageHead, State, StatCard, btnGhost, btnPrimary } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { AreaTrend, BarBlock, DonutBlock, RankBars } from "@/lib/IndicatorCharts";
import { addMonthsYm, fmtYmd, monthBounds, monthLabel, monthOf, monthShort, pfRpc, reais, todayYmd, type Kpi } from "./pf";
import { EntryFormDialog, ItemSheet, KpiSheet, useInvalidatePf, usePfRefs, type ItemTarget } from "./PfShared";

interface Overview { from: string; to: string; today: string; reference_month: string; [k: string]: unknown }
interface Charts {
  by_month: { month: string; income_cents: number; expense_cents: number }[]; by_category: { category: string; cents: number }[]; fixed_vs_variable: { fixed_cents: number; variable_cents: number };
  budget_vs_actual: { category: string; budget_cents: number; realized_cents: number }[]; reserve_evolution: { month: string; reserve_cents: number }[];
  category_growth: { category: string; current_cents: number; previous_cents: number; delta_cents: number; delta_pct: number }[]; projected_12: { month: string; total_cents: number; realized_cents: number; committed_cents: number; variable_cents: number }[];
}
interface Reminders { days_before: number; reminders: { key: string; description: string; kind: string; due_date: string; amount_cents: number; days_left: number; entry_id: string | null; series_id: string | null; occurrence_date: string | null; invoice_id: string | null }[] }

const money = (k: Kpi | undefined) => (k && k.available && k.value != null ? brl(k.value) : "Sem base para cálculo");
const pct = (k: Kpi | undefined) => (k && k.available && k.value != null ? `${String(k.value).replace(".", ",")}%` : "Sem base para cálculo");
const months = (k: Kpi | undefined) => (k && k.available && k.value != null ? `${String(k.value).replace(".", ",")} meses` : "Sem base para cálculo");

/** Visão geral das finanças pessoais: indicadores com fórmula e detalhamento (os registros somam o mesmo valor do cartão), gráficos e lembretes. Privado ao proprietário. */
const PfOverview = () => {
  const nav = useNavigate(); const qc = useQueryClient(); const invalidate = useInvalidatePf();
  const [ym, setYm] = useState(monthOf(todayYmd())); const { from, to } = monthBounds(ym);
  const [detail, setDetail] = useState<{ kind: string; from: string; to: string; title: string; formula?: string } | null>(null); const [item, setItem] = useState<ItemTarget>(null); const [newOpen, setNewOpen] = useState(false);
  const refs = usePfRefs();
  const ov = useQuery({ queryKey: ["pf", "overview", from, to], queryFn: () => pfRpc<Overview>("pf_overview", { p_from: from, p_to: to }) });
  const ch = useQuery({ queryKey: ["pf", "charts", from, to], queryFn: () => pfRpc<Charts>("pf_charts", { p_from: from, p_to: to }) });
  const rem = useQuery({ queryKey: ["pf", "reminders"], queryFn: () => pfRpc<Reminders>("pf_reminders_due") });
  const links = useQuery({ queryKey: ["pf", "links-pending"], queryFn: async () => (await pfRpc<{ links: { status: string }[] }>("pf_business_links_list")).links.filter((l) => l.status === "pending").length });
  const o = ov.data; const k = (key: string) => o?.[key] as Kpi | undefined;
  const open = (kind: string, title: string, formula?: string) => setDetail({ kind, from, to, title, formula });
  const ack = async (key: string) => { await pfRpc("pf_reminder_ack", { p_key: key }); void qc.invalidateQueries({ queryKey: ["pf", "reminders"] }); };
  const empty = !refs.loading && refs.accounts.length === 0;
  const goals = (o?.goals as { items: { id: string; name: string; target_cents: number; progress_cents: number }[]; available: boolean } | undefined);

  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Visão geral" hint="Privado: só você vê estes dados. Nada daqui entra na DRE, no caixa ou nos relatórios da HP. Cada cartão mostra a fórmula e abre os registros que o compõem."
        actions={<div className="flex items-center gap-2"><PeriodFilter month={ym} onMonth={(v) => v && setYm(v)} onClear={() => setYm(monthOf(todayYmd()))} /><button type="button" className={btnPrimary} onClick={() => setNewOpen(true)}><Plus size={16} aria-hidden />Novo lançamento</button></div>} />

      {empty && (
        <section className="hp-card p-5 mb-6" data-testid="pf-comece">
          <h2 className="text-lg font-semibold">Comece por aqui</h2>
          <ol className="mt-2 grid gap-1.5 text-sm list-decimal pl-5">
            <li>Cadastre suas <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/contas">contas e cartões</Link> (saldo inicial e limite).</li>
            <li>Lance suas receitas e despesas — as fixas e as recorrentes só uma vez (<Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/lancamentos">Receitas e despesas</Link>).</li>
            <li>Defina o <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/orcamento">orçamento</Link> e a <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/reserva">reserva e metas</Link>.</li>
          </ol>
        </section>
      )}

      {rem.data && rem.data.reminders.length > 0 && (
        <section className="hp-card p-4 mb-6" aria-label="Lembretes" data-testid="pf-lembretes">
          <h2 className="text-sm font-semibold flex items-center gap-2"><BellRing size={16} aria-hidden />Vencendo nos próximos {rem.data.days_before} dia(s)</h2>
          <ul className="mt-2 grid gap-1.5">
            {rem.data.reminders.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-2 text-sm"><span>{fmtYmd(r.due_date)} · {r.description} · <span className="tabular">{brl(r.amount_cents)}</span></span>
                <span className="flex gap-3">{(r.entry_id || r.series_id) && <button type="button" className="text-accent hover:underline" onClick={() => setItem({ ref: r.entry_id ? { entry_id: r.entry_id } : { series_id: r.series_id!, occurrence_date: r.occurrence_date! } })}>Abrir</button>}
                  <button type="button" className="text-muted-foreground hover:underline" onClick={() => void ack(r.key)}>Marcar como visto</button></span></li>))}
          </ul>
        </section>
      )}
      {links.data ? <p className="mb-4 text-sm rounded-md border border-warning/40 bg-warning/10 px-3 py-2" role="status" data-testid="pf-pendencia-retirada">Há {links.data} retirada(s) da empresa sem entrada pessoal vinculada. <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/importacao?aba=retiradas">Resolver</Link></p> : null}

      <State loading={ov.isLoading} error={ov.error} />
      {o && (<>
        <LevelSection level="summary" title={`Resumo de ${monthLabel(ym)}`} label="Resumo do mês" hint="Recebido e pago no mês; previsto = o que ainda falta (inclui ocorrências futuras calculadas). Compra no cartão conta na data da compra; o pagamento da fatura não é despesa.">
          <KpiGrid kind="hero">
            <StatCard level="hero" icon={ArrowDownToLine} label="Receitas recebidas" value={money(k("income_received"))} basis={k("income_received")?.formula} onClick={() => open("income_received", "Receitas recebidas", k("income_received")?.formula)} />
            <StatCard level="hero" icon={ArrowUpFromLine} label="Despesas realizadas" value={money(k("expense_realized"))} basis={k("expense_realized")?.formula} onClick={() => open("expense_realized", "Despesas realizadas", k("expense_realized")?.formula)} />
            <StatCard level="hero" icon={Scale} label="Resultado realizado" value={money(k("result_realized"))} basis={k("result_realized")?.formula} />
            <StatCard level="hero" icon={Wallet} label="Saldo das contas" value={money(k("account_balance"))} unavailable={!k("account_balance")?.available} basis={k("account_balance")?.available ? k("account_balance")?.formula : k("account_balance")?.basis} onClick={() => nav("/admin/financeiro/pessoal/contas")} />
          </KpiGrid>
          <KpiGrid>
            <StatCard icon={ArrowDownToLine} label="Receitas previstas" value={money(k("income_expected"))} basis={k("income_expected")?.formula} onClick={() => open("income_expected", "Receitas previstas", k("income_expected")?.formula)} />
            <StatCard icon={ArrowUpFromLine} label="Despesas previstas" value={money(k("expense_expected"))} basis={k("expense_expected")?.formula} onClick={() => open("expense_expected", "Despesas previstas", k("expense_expected")?.formula)} />
            <StatCard icon={TrendingUp} label="Saldo projetado após compromissos" value={money(k("projected_balance"))} basis={k("projected_balance")?.formula} onClick={() => nav("/admin/financeiro/pessoal/calendario")} />
          </KpiGrid>
        </LevelSection>

        <LevelSection level="attention" title="Contas e vencimentos" label="Atenção" hint="Saídas de caixa que exigem acompanhamento (contas e faturas).">
          <KpiGrid kind="lg">
            <StatCard level="attention" icon={AlertTriangle} tone={(k("overdue")?.value ?? 0) > 0 ? "danger" : undefined} label="Contas vencidas" value={money(k("overdue"))} basis={k("overdue")?.formula} onClick={() => open("overdue", "Contas vencidas", k("overdue")?.formula)} />
            <StatCard level="attention" icon={CalendarClock} label="A vencer em 7 dias" value={money(k("due7"))} basis={k("due7")?.formula} onClick={() => open("due7", "A vencer em 7 dias", k("due7")?.formula)} />
            <StatCard level="attention" icon={CalendarClock} label="A vencer em 30 dias" value={money(k("due30"))} basis={k("due30")?.formula} onClick={() => open("due30", "A vencer em 30 dias", k("due30")?.formula)} />
            <StatCard level="attention" icon={CreditCard} label="Próximas faturas (em aberto)" value={money(k("invoices_next"))} basis={k("invoices_next")?.formula} onClick={() => open("invoices_next", "Faturas em aberto", k("invoices_next")?.formula)} />
          </KpiGrid>
        </LevelSection>

        <LevelSection level="summary" title="Estrutura de gastos e custo de vida" label="Padrão de vida" hint="Fixo × variável é o comportamento do valor; recorrência é a repetição. O custo de vida respeita início, término, pausas e parcelas restantes.">
          <KpiGrid>
            <StatCard label="Despesas fixas (mês)" value={money(k("fixed_expense"))} basis={k("fixed_expense")?.formula} onClick={() => open("fixed", "Despesas fixas do mês", k("fixed_expense")?.formula)} />
            <StatCard label="Despesas variáveis (mês)" value={money(k("variable_expense"))} basis={k("variable_expense")?.formula} onClick={() => open("variable", "Despesas variáveis do mês", k("variable_expense")?.formula)} />
            <StatCard label="Compromissos recorrentes (por mês)" value={money(k("recurring_commitments"))} unavailable={!k("recurring_commitments")?.available} basis={k("recurring_commitments")?.available ? k("recurring_commitments")?.formula : k("recurring_commitments")?.basis} onClick={() => nav("/admin/financeiro/pessoal/lancamentos?aba=recorrencias")} />
            <StatCard icon={Wallet} label="Custo de vida mensal projetado" value={money(k("living_cost_monthly"))} unavailable={!k("living_cost_monthly")?.available} status={k("living_cost_monthly")?.incomplete ? "Projeção incompleta" : undefined} basis={k("living_cost_monthly")?.formula} onClick={() => nav("/admin/financeiro/pessoal/orcamento")} />
            <StatCard label="Custo de vida projetado no ano" value={money(k("living_cost_year"))} unavailable={!k("living_cost_year")?.available} status={k("living_cost_year")?.incomplete ? "Projeção incompleta" : undefined} basis={k("living_cost_year")?.formula} onClick={() => nav("/admin/financeiro/pessoal/orcamento")} />
            <StatCard label="Orçamento utilizado (mês)" value={pct(k("budget_used_pct"))} unavailable={!k("budget_used_pct")?.available} basis={k("budget_used_pct")?.available ? k("budget_used_pct")?.formula : k("budget_used_pct")?.basis} onClick={() => nav("/admin/financeiro/pessoal/orcamento?aba=orcamento")} />
            <StatCard label="Comprometimento da renda" value={pct(k("income_commitment_pct"))} unavailable={!k("income_commitment_pct")?.available} basis={k("income_commitment_pct")?.available ? k("income_commitment_pct")?.formula : k("income_commitment_pct")?.basis} />
            <StatCard icon={PiggyBank} label="Reserva disponível" value={money(k("reserve"))} unavailable={!k("reserve")?.available} basis={k("reserve")?.available ? k("reserve")?.formula : k("reserve")?.basis} onClick={() => nav("/admin/financeiro/pessoal/reserva")} />
            <StatCard label="Meses de cobertura da reserva" value={months(k("reserve_coverage_months"))} unavailable={!k("reserve_coverage_months")?.available} basis={k("reserve_coverage_months")?.available ? k("reserve_coverage_months")?.formula : k("reserve_coverage_months")?.basis} onClick={() => nav("/admin/financeiro/pessoal/reserva")} />
            <StatCard icon={Target} label="Metas" value={goals?.available ? `${goals.items.filter((g) => g.progress_cents >= g.target_cents).length} de ${goals.items.length} concluída(s)` : "Sem metas"} unavailable={!goals?.available} basis="progresso = saldo da conta da meta ou soma dos aportes; % = progresso ÷ valor-alvo" onClick={() => nav("/admin/financeiro/pessoal/reserva")} />
          </KpiGrid>
          {goals?.available && <ul className="grid gap-2 mt-3 sm:grid-cols-2">{goals.items.map((g) => <li key={g.id} className="hp-card p-3 text-sm"><div className="flex justify-between"><span className="font-medium">{g.name}</span><span className="tabular">{Math.min(100, Math.round(g.progress_cents * 100 / g.target_cents))}%</span></div><div className="hp-rank-bar mt-1.5" role="img" aria-label={`Progresso de ${g.name}`}><i style={{ width: `${Math.max(2, Math.min(100, g.progress_cents * 100 / g.target_cents))}%` }} /></div><p className="text-xs text-muted-foreground mt-1">{brl(g.progress_cents)} de {brl(g.target_cents)}</p></li>)}</ul>}
        </LevelSection>
      </>)}

      {ch.data && (
        <LevelSection level="analysis" title="Gráficos" hint="Os valores vêm dos mesmos lançamentos dos cartões acima.">
          <div className="grid gap-4 lg:grid-cols-2">
            <BarBlock title="Receitas × despesas realizadas (12 meses)" data={ch.data.by_month.map((r) => ({ mes: monthShort(r.month.slice(0, 7)), Receitas: reais(r.income_cents), Despesas: reais(r.expense_cents) }))} xKey="mes" series={[{ key: "Receitas", label: "Receitas", color: "hsl(var(--chart-2))" }, { key: "Despesas", label: "Despesas", color: "hsl(var(--chart-5))" }]} empty="Sem movimento realizado ainda." />
            <AreaTrend title="Custo projetado dos próximos 12 meses" hint="realizado + compromissos + variáveis" data={ch.data.projected_12.map((r) => ({ mes: monthShort(r.month.slice(0, 7)), Custo: reais(r.total_cents) }))} xKey="mes" series={[{ key: "Custo", label: "Custo projetado" }]} format={(v) => brl(Math.round(v * 100))} isEmpty={ch.data.projected_12.every((r) => r.total_cents === 0)} empty="Sem base para projetar (cadastre recorrências, parcelas ou orçamento)." />
            <DonutBlock title="Gastos por categoria (realizados no período)" data={ch.data.by_category.map((r) => ({ name: r.category, value: reais(r.cents) }))} empty="Sem despesas realizadas no período." noun="no total" />
            <DonutBlock title="Fixo × variável (realizado + previsto)" data={[{ name: "Fixo", value: reais(ch.data.fixed_vs_variable.fixed_cents) }, { name: "Variável", value: reais(ch.data.fixed_vs_variable.variable_cents) }].filter((d) => d.value > 0)} empty="Sem despesas no período." noun="no total" />
            <BarBlock title="Orçado × realizado (mês)" data={ch.data.budget_vs_actual.map((r) => ({ cat: r.category, Orçado: reais(r.budget_cents), Realizado: reais(r.realized_cents) }))} xKey="cat" series={[{ key: "Orçado", label: "Orçado" }, { key: "Realizado", label: "Realizado", color: "hsl(var(--chart-5))" }]} empty="Defina o orçamento do mês para comparar." />
            <AreaTrend title="Evolução da reserva" data={ch.data.reserve_evolution.map((r) => ({ mes: monthShort(r.month.slice(0, 7)), Reserva: reais(r.reserve_cents) }))} xKey="mes" series={[{ key: "Reserva", label: "Reserva", color: "hsl(var(--chart-2))" }]} format={(v) => brl(Math.round(v * 100))} isEmpty={ch.data.reserve_evolution.every((r) => r.reserve_cents === 0)} empty="Marque contas de reserva para acompanhar." />
          </div>
          <div className="mt-4"><RankBars title="Categorias que mais aumentaram" hint={`Comparação com o período anterior de mesmo tamanho (só categorias que já tinham gasto).`} items={ch.data.category_growth.slice(0, 6).map((r) => ({ label: r.category, value: reais(r.delta_cents), display: `+${brl(r.delta_cents)} (${String(r.delta_pct).replace(".", ",")}%)` }))} empty="Sem comparação válida (o período anterior não tem gastos nas mesmas categorias)." /></div>
        </LevelSection>
      )}
      {!o && !ov.isLoading && !ov.error && <EmptyState title="Sem dados">Cadastre contas e lançamentos para ver os indicadores.</EmptyState>}

      <p className="text-xs text-muted-foreground mt-6">Período: {fmtYmd(from)} a {fmtYmd(to)} · <button type="button" className="underline" onClick={() => setYm(addMonthsYm(ym, -1))}>mês anterior</button> · <button type="button" className="underline" onClick={() => setYm(addMonthsYm(ym, 1))}>próximo mês</button> · <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => { invalidate(); }}>Atualizar</button></p>
      <KpiSheet trigger={detail} onClose={() => setDetail(null)} />
      <ItemSheet target={item} onClose={() => setItem(null)} />
      <EntryFormDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
};
export default PfOverview;
