import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { brl } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { EmptyState, KpiGrid, LevelSection, Msg, PageHead, State, StatCard, Table, Tabs, Td, btnGhost, btnPrimary, errText, useMsg } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { BarBlock } from "@/lib/IndicatorCharts";
import { addMonthsYm, monthLabel, monthOf, monthShort, pfRpc, reais, todayYmd } from "./pf";
import { MoneyInput, centsFrom, centsToInput, useInvalidatePf } from "./PfShared";

interface LivingCost {
  mode: string; from: string; to: string; months: { month: string; realized_cents: number; committed_cents: number; variable_cents: number; budget_topup_cents: number; total_cents: number }[];
  realized_cents: number; committed_cents: number; variable_cents: number; budget_topup_cents: number; projected_total_cents: number; months_count: number; monthly_average_cents: number; essential_cents: number;
  destinations_monthly_cents: number; cash_need_total_cents: number; monthly_cash_need_cents: number; income_total_cents: number; income_monthly_average_cents: number;
  incomplete: boolean; incomplete_reasons: string[]; suggestions: { series_id: string; description: string; suggested_cents: number; based_on: number }[]; sources: Record<string, string>;
}
interface BudgetRow { category_id: string; name: string; budget_cents: number | null; realized_cents: number; committed_cents: number; variable_cents: number }
interface Plan { month: string; plan_with_previous_month_income: boolean; reference_income_cents: number; reference_basis: string; existing_commitments_cents: number; variable_estimates_cents: number; planned_contributions_cents: number; budget_total_cents: number; available_to_allocate_cents: number; liquid_balance_now_cents: number; note: string }

/** Orçamento e custo de vida: quanto custa manter o padrão de vida (realizado + compromissos + variáveis), por mês e no ano; orçamento por categoria; e o planejamento do mês seguinte. */
const PfBudget = () => {
  const [sp, setSp] = useSearchParams(); const tab = ["custo", "orcamento", "planejar"].includes(sp.get("aba") ?? "") ? sp.get("aba")! : "custo";
  const setTab = (v: string) => { const n = new URLSearchParams(sp); n.set("aba", v); setSp(n, { replace: true }); };
  const [mode, setMode] = useState<"next12" | "calendar">("next12"); const [ym, setYm] = useState(monthOf(todayYmd()));
  const lc = useQuery({ queryKey: ["pf", "living-cost", mode, mode === "calendar" ? ym.slice(0, 4) : ""], enabled: tab === "custo", queryFn: () => pfRpc<LivingCost>("pf_living_cost", { p_mode: mode, p_ref: `${ym.slice(0, 4)}-06-15` }) });
  const d = lc.data;
  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Orçamento e custo de vida" hint="Custo de vida = o que já foi gasto + compromissos em aberto + projeção de gastos variáveis. Transferências, investimentos e aportes em metas ficam de fora (aparecem só na necessidade de caixa)."
        actions={tab !== "custo" ? <PeriodFilter month={ym} onMonth={(v) => v && setYm(v)} onClear={() => setYm(monthOf(todayYmd()))} /> : undefined} />
      <Tabs tabs={[["custo", "Custo de vida"], ["orcamento", "Orçamento por categoria"], ["planejar", "Planejar o mês"]]} value={tab} onChange={setTab} />

      {tab === "custo" && (<>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div role="radiogroup" aria-label="Período da projeção" className="flex gap-2">{([["next12", "Próximos 12 meses"], ["calendar", "Ano-calendário"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`hp-btn hp-btn-sm ${mode === k ? "hp-btn-primary" : "hp-btn-outline"}`}>{l}</button>)}</div>
          {mode === "calendar" && <div className="flex items-center gap-2"><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setYm(addMonthsYm(ym, -12))}>‹</button><strong className="text-sm tabular">{ym.slice(0, 4)}</strong><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setYm(addMonthsYm(ym, 12))}>›</button></div>}
        </div>
        <State loading={lc.isLoading} error={lc.error} />
        {d && (<>
          {d.incomplete && <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm" role="status" data-testid="pf-projecao-incompleta"><p className="font-medium flex items-center gap-2"><AlertTriangle size={15} aria-hidden />Projeção incompleta</p><ul className="list-disc pl-5 mt-1">{d.incomplete_reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>}
          <LevelSection level="summary" title="As cinco perguntas" label="Custo de vida" hint="Cada resposta usa as datas efetivas: respeita início, término, pausas, periodicidade e parcelas restantes (não é “gasto mensal × 12”).">
            <KpiGrid kind="hero">
              <StatCard level="hero" label="Quanto custa manter meu padrão de vida por mês?" value={d.projected_total_cents > 0 ? brl(d.monthly_average_cents) : "Sem base para cálculo"} unavailable={d.projected_total_cents <= 0} basis={`média mensal equivalente: ${brl(d.projected_total_cents)} ÷ ${d.months_count} meses`} />
              <StatCard level="hero" label="Quanto está comprometido nos próximos meses?" value={brl(d.committed_cents)} basis="saldo a pagar de lançamentos, parcelas futuras e recorrências fixas calculadas" />
              <StatCard level="hero" label={mode === "calendar" ? `Qual é meu custo previsto em ${ym.slice(0, 4)}?` : "Qual é meu custo previsto nos próximos 12 meses?"} value={d.projected_total_cents > 0 ? brl(d.projected_total_cents) : "Sem base para cálculo"} unavailable={d.projected_total_cents <= 0} basis="realizado + compromissos + variáveis projetados" />
              <StatCard level="hero" label="Quanto já gastei e quanto ainda está previsto?" value={`${brl(d.realized_cents)} / ${brl(d.committed_cents + d.variable_cents)}`} basis="gasto até hoje / ainda previsto (compromissos + variáveis)" />
            </KpiGrid>
            <KpiGrid>
              <StatCard label="Quanto preciso receber por mês para cobrir meu orçamento?" value={d.projected_total_cents > 0 ? brl(d.monthly_average_cents) : "Sem base para cálculo"} unavailable={d.projected_total_cents <= 0} basis={`custo médio mensal · renda média prevista/recebida no período: ${brl(d.income_monthly_average_cents)}`} />
              <StatCard label="Necessidade de caixa por mês (com aportes)" value={d.projected_total_cents > 0 ? brl(d.monthly_cash_need_cents) : "Sem base para cálculo"} unavailable={d.projected_total_cents <= 0} basis={`custo médio + aportes mensais em metas (${brl(d.destinations_monthly_cents)})`} />
              <StatCard label="Parte essencial do custo" value={brl(d.essential_cents)} basis="soma dos lançamentos marcados como essenciais" />
              <StatCard label="Sobra do orçamento incluída" value={brl(d.budget_topup_cents)} basis="orçado − (realizado + compromissos + estimativas já projetados), por categoria" />
            </KpiGrid>
          </LevelSection>

          <section className="mt-6"><h3 className="text-base font-medium mb-2">Mês a mês</h3>
            <BarBlock title="Custo projetado por mês" hint="realizado · compromissos · variável" stacked data={d.months.map((r) => ({ mes: monthShort(r.month.slice(0, 7)), Realizado: reais(r.realized_cents), Compromissos: reais(r.committed_cents), Variável: reais(r.variable_cents) }))} xKey="mes" series={[{ key: "Realizado", label: "Realizado", color: "hsl(var(--chart-2))" }, { key: "Compromissos", label: "Compromissos", color: "hsl(var(--chart-1))" }, { key: "Variável", label: "Variável", color: "hsl(var(--chart-4))" }]} />
            <div className="mt-3"><Table head={["Mês", "Realizado", "Compromissos em aberto", "Variáveis (projeção)", "Custo total"]} right={[1, 2, 3, 4]}>
              {d.months.map((r) => <tr key={r.month} data-testid="pf-custo-mes"><Td className="capitalize">{monthLabel(r.month.slice(0, 7))}</Td><Td num>{brl(r.realized_cents)}</Td><Td num>{brl(r.committed_cents)}</Td><Td num>{brl(r.variable_cents)}{r.budget_topup_cents > 0 && <div className="text-[11px] text-muted-foreground">inclui sobra do orçamento {brl(r.budget_topup_cents)}</div>}</Td><Td num><strong>{brl(r.total_cents)}</strong></Td></tr>)}
              <tr className="font-semibold"><Td>Total</Td><Td num>{brl(d.realized_cents)}</Td><Td num>{brl(d.committed_cents)}</Td><Td num>{brl(d.variable_cents)}</Td><Td num>{brl(d.projected_total_cents)}</Td></tr>
            </Table></div>
          </section>
          <section className="mt-6 text-sm"><h3 className="text-base font-medium mb-2">De onde vêm os números</h3>
            <ul className="grid gap-1 text-muted-foreground"><li><strong className="text-foreground">Realizado:</strong> {d.sources.realized}.</li><li><strong className="text-foreground">Compromissos:</strong> {d.sources.committed}.</li><li><strong className="text-foreground">Variável:</strong> {d.sources.variable}.</li></ul>
            {d.suggestions.length > 0 && <div className="mt-3 rounded-md border border-border p-3"><p className="font-medium">Estimativas sugeridas pelo histórico</p><ul className="mt-1 grid gap-1">{d.suggestions.map((s) => <li key={s.series_id}>{s.description}: {brl(s.suggested_cents)} <span className="text-muted-foreground">(média dos últimos {s.based_on} valor(es) real(is); janela de até 6 ocorrências)</span></li>)}</ul><p className="text-xs text-muted-foreground mt-1">Para fixar uma estimativa, edite a recorrência em <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/lancamentos?aba=recorrencias">Receitas e despesas › Recorrências</Link>.</p></div>}
          </section>
        </>)}
        {!d && !lc.isLoading && !lc.error && <EmptyState title="Sem dados">Cadastre recorrências, parcelas ou orçamento.</EmptyState>}
      </>)}

      {tab === "orcamento" && <BudgetTab ym={ym} />}
      {tab === "planejar" && <PlanTab ym={ym} />}
    </div>
  );
};

const BudgetTab = ({ ym }: { ym: string }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const month = `${ym}-01`;
  const q = useQuery({ queryKey: ["pf", "budget", month], queryFn: () => pfRpc<{ rows: BudgetRow[] }>("pf_budget_list", { p_month: month }) });
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setVals(Object.fromEntries(q.data.rows.map((r) => [r.category_id, r.budget_cents != null ? centsToInput(r.budget_cents) : ""]))); }, [q.data]);
  const save = async (id: string) => {
    const raw = (vals[id] ?? "").trim(); const cents = raw === "" ? null : centsFrom(raw);
    if (raw !== "" && cents == null) return m.err("Valor inválido (ex.: 1.500,00).");
    try { await pfRpc("pf_budget_set", { p_month: month, p_category: id, p_amount_cents: cents }); invalidate(); m.ok("Orçamento salvo."); } catch (err) { m.err(errText(err as { message: string })); }
  };
  const copyPrev = async () => {
    try { const prev = await pfRpc<{ rows: BudgetRow[] }>("pf_budget_list", { p_month: `${addMonthsYm(ym, -1)}-01` }); let n = 0;
      for (const r of prev.rows) if (r.budget_cents != null) { await pfRpc("pf_budget_set", { p_month: month, p_category: r.category_id, p_amount_cents: r.budget_cents }); n++; }
      invalidate(); m.ok(n ? `${n} orçamento(s) copiado(s) do mês anterior.` : "O mês anterior não tem orçamento."); } catch (err) { m.err(errText(err as { message: string })); }
  };
  const totalBud = (q.data?.rows ?? []).reduce((a, r) => a + (r.budget_cents ?? 0), 0); const totalUsed = (q.data?.rows ?? []).filter((r) => r.budget_cents != null).reduce((a, r) => a + r.realized_cents + r.committed_cents, 0);
  return (<>
    <Msg m={msg} />
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><p className="text-sm">Orçamento de <strong className="capitalize">{monthLabel(ym)}</strong>: {brl(totalBud)} orçado · {brl(totalUsed)} usado (realizado + compromissos){totalBud > 0 ? ` · ${Math.round(totalUsed * 100 / totalBud)}%` : ""}</p><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void copyPrev()}>Copiar do mês anterior</button></div>
    <State loading={q.isLoading} error={q.error} />
    {q.data && (
      <Table head={["Categoria", "Orçado", "Realizado", "Compromissos", "Variável previsto", "Resta", ""]} right={[1, 2, 3, 4, 5]}>
        {q.data.rows.map((r) => { const used = r.realized_cents + r.committed_cents + r.variable_cents; const left = (r.budget_cents ?? 0) - used;
          return (<tr key={r.category_id} data-testid="pf-orc-linha"><Td>{r.name}</Td>
            <Td num><label className="sr-only" htmlFor={`orc-${r.category_id}`}>Orçamento de {r.name}</label><input id={`orc-${r.category_id}`} className="!h-8 !w-28 text-right" inputMode="decimal" placeholder="—" value={vals[r.category_id] ?? ""} onChange={(e) => setVals({ ...vals, [r.category_id]: e.target.value })} onBlur={() => { const cur = r.budget_cents != null ? centsToInput(r.budget_cents) : ""; if ((vals[r.category_id] ?? "") !== cur) void save(r.category_id); }} /></Td>
            <Td num>{brl(r.realized_cents)}</Td><Td num>{brl(r.committed_cents)}</Td><Td num>{brl(r.variable_cents)}</Td><Td num className={r.budget_cents != null && left < 0 ? "text-destructive" : ""}>{r.budget_cents != null ? brl(left) : "—"}</Td>
            <Td>{r.budget_cents ? <span className="hp-rank-bar block w-20" role="img" aria-label={`${Math.min(999, Math.round(used * 100 / r.budget_cents))}% do orçamento`}><i style={{ width: `${Math.max(2, Math.min(100, used * 100 / r.budget_cents))}%`, ["--rc" as string]: used > r.budget_cents ? "var(--destructive)" : "var(--chart-2)" }} /></span> : null}</Td></tr>); })}
      </Table>)}
    <p className="text-xs text-muted-foreground mt-3">O orçamento de uma categoria inclui as subcategorias dela. A “sobra” (orçado − já projetado) entra no custo de vida como gasto variável previsto.</p>
  </>);
};

const PlanTab = ({ ym }: { ym: string }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const target = `${addMonthsYm(ym, 1)}-01`;
  const q = useQuery({ queryKey: ["pf", "plan", target], queryFn: () => pfRpc<Plan>("pf_plan_month", { p_month: target }) });
  const st = useQuery({ queryKey: ["pf", "settings"], queryFn: async () => ((await supabase.from("pf_settings").select("reminder_days_before, plan_next_month_with_income, reserve_target_months").maybeSingle()).data ?? { reminder_days_before: 3, plan_next_month_with_income: false, reserve_target_months: 6 }) as { reminder_days_before: number; plan_next_month_with_income: boolean; reserve_target_months: number } });
  const toggle = async (v: boolean) => { if (!st.data) return; try { await pfRpc("pf_settings_save", { p_reminder_days: st.data.reminder_days_before, p_plan_next_month: v, p_reserve_months: st.data.reserve_target_months }); invalidate(); m.ok(v ? "O planejamento usa a renda recebida no mês anterior." : "O planejamento usa a renda do próprio mês."); } catch (err) { m.err(errText(err as { message: string })); } };
  const p = q.data;
  return (<>
    <Msg m={msg} />
    <label className="flex items-start gap-2 text-sm mb-4"><input type="checkbox" checked={st.data?.plan_next_month_with_income ?? false} onChange={(e) => void toggle(e.target.checked)} className="!w-4 !h-4 mt-0.5" /><span><strong>Planejar o próximo mês com a renda recebida neste mês</strong> — a renda de {monthLabel(ym)} orienta o orçamento de {monthLabel(addMonthsYm(ym, 1))}.</span></label>
    <State loading={q.isLoading} error={q.error} />
    {p && (
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="hp-card p-4" data-testid="pf-plano"><h3 className="text-base font-medium capitalize">Planejamento de {monthLabel(addMonthsYm(ym, 1))}</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-3"><dt>Renda de referência<span className="block text-xs text-muted-foreground">{p.reference_basis}</span></dt><dd className="tabular font-semibold">{brl(p.reference_income_cents)}</dd></div>
            <div className="flex justify-between"><dt>(−) Compromissos já existentes</dt><dd className="tabular">{brl(p.existing_commitments_cents)}</dd></div>
            <div className="flex justify-between"><dt>(−) Estimativas de variáveis</dt><dd className="tabular">{brl(p.variable_estimates_cents)}</dd></div>
            <div className="flex justify-between"><dt>(−) Aportes planejados (metas)</dt><dd className="tabular">{brl(p.planned_contributions_cents)}</dd></div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold"><dt>Disponível para distribuir no orçamento</dt><dd className={`tabular ${p.available_to_allocate_cents < 0 ? "text-destructive" : ""}`}>{brl(p.available_to_allocate_cents)}</dd></div>
          </dl>
          {p.reference_income_cents === 0 && <p className="text-sm text-warning mt-3">Sem renda de referência: não há base para dizer quanto distribuir.</p>}
        </section>
        <section className="hp-card p-4"><h3 className="text-base font-medium">Dinheiro que já está nas contas</h3>
          <p className="text-2xl font-bold tabular mt-2">{brl(p.liquid_balance_now_cents)}</p><p className="text-xs text-muted-foreground mt-1">saldo das contas que não são reserva nem investimento, hoje.</p>
          <p className="text-sm mt-3">Orçamento já definido para o mês: <strong className="tabular">{brl(p.budget_total_cents)}</strong></p>
          <p className="text-xs text-muted-foreground mt-3">{p.note}</p>
          <div className="mt-3"><Link className={btnPrimary} to={`/admin/financeiro/pessoal/orcamento?aba=orcamento`}>Definir orçamento do mês</Link></div></section>
      </div>)}
  </>);
};
export default PfBudget;
