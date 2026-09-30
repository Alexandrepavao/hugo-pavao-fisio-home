import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, Info } from "lucide-react";
import { PageHead, State, StatCard } from "@/lib/ui";
import Greeting from "../Greeting";
import AccScopeBar from "./AccScopeBar";
import { fmtMonth, fmtMonthLong, NOT_OFFICIAL, signedBrl, STATUS_LABEL, useAccQuery, useAccScope, type PeriodStatus } from "./accLib";

export interface Metrics {
  entries_comp: number; income_comp_cents: number; expense_comp_cents: number; entries_cash: number; cash_in_cents: number; cash_out_cents: number;
  unclassified: number; missing_receipt: number; documents: number; changes_after_close: number;
}
interface Dash { month: string; month_ended: boolean; period: { status: PeriodStatus; closed_at: string | null; closed_by: string | null }; metrics: Metrics; overdue_months: string[] }

/** Visão geral: indicadores reais da competência selecionada (todos clicáveis, levam à tela já filtrada) e a jornada
 *  completa — selecionar → consultar → classificar → anexar → revisar → fechar → exportar — com o estado de cada passo. */
const AccDashboard = () => {
  const navigate = useNavigate();
  const { unit, month, link, setMonth } = useAccScope();
  const q = useAccQuery<Dash>("acc_dashboard", { p_unit: unit.id, p_month: month }, ["dashboard", unit.id, month]);
  const d = q.data; const m = d?.metrics;
  const go = (path: string, extra?: Record<string, string>) => () => navigate(link(path, extra));

  const steps = d && m ? [
    { n: 1, label: "Empresa/unidade e competência", done: true, note: `${unit.name} · ${fmtMonth(month)}`, to: link("/admin/contabil") },
    { n: 2, label: "Consultar lançamentos do Financeiro", done: m.entries_comp + m.entries_cash > 0, note: `${m.entries_comp} por competência · ${m.entries_cash} em caixa`, to: link("/admin/contabil/lancamentos") },
    { n: 3, label: "Classificar pendências", done: m.entries_comp > 0 && m.unclassified === 0, note: m.unclassified ? `${m.unclassified} sem classificação` : "tudo classificado", to: link("/admin/contabil/lancamentos", { f: "unclassified" }) },
    { n: 4, label: "Anexar comprovantes", done: m.missing_receipt === 0, note: m.missing_receipt ? `${m.missing_receipt} despesa(s) sem comprovante` : `${m.documents} documento(s)`, to: link("/admin/contabil/documentos") },
    { n: 5, label: "Revisar", done: d.period.status !== "open", note: STATUS_LABEL[d.period.status], to: link("/admin/contabil/fechamentos") },
    { n: 6, label: "Fechar a competência", done: d.period.status === "closed", note: d.period.status === "closed" ? `fechada por ${d.period.closed_by ?? "—"}` : d.month_ended ? "pendente" : "mês em andamento", to: link("/admin/contabil/fechamentos") },
    { n: 7, label: "Exportar para o contador", done: false, note: d.period.status === "closed" ? "pronto para exportar" : "exportação provisória", to: link("/admin/contabil/exportacoes") },
  ] : [];

  return (
    <div>
      <div className="mb-5"><Greeting /><p className="text-muted-foreground max-w-2xl">Preparação da competência {fmtMonthLong(month)} para o contador — dados vindos do Financeiro, sem duplicar lançamentos.</p></div>
      <PageHead eyebrow="Contábil" title="Visão geral" />
      <AccScopeBar />
      <State loading={q.isLoading} error={q.error} />
      {d && m && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-6" aria-label="Indicadores da competência">
          <StatCard label="Situação da competência" value={STATUS_LABEL[d.period.status]} basis={d.month_ended ? "Clique para revisar, fechar ou reabrir" : "Mês em andamento: ainda não pode ser fechado"} onClick={go("/admin/contabil/fechamentos")} />
          <StatCard label="Receitas — competência" value={signedBrl(m.income_comp_cents)} basis={`Por competência. Em caixa no mês: ${signedBrl(m.cash_in_cents)} (recebimentos − estornos)`} onClick={go("/admin/contabil/lancamentos", { basis: "competencia", kind: "income" })} />
          <StatCard label="Despesas — competência" value={signedBrl(m.expense_comp_cents)} basis={`Por competência. Pagas no mês (caixa): ${signedBrl(m.cash_out_cents)}`} onClick={go("/admin/contabil/lancamentos", { basis: "competencia", kind: "expense" })} />
          <StatCard label="Lançamentos da competência" value={m.entries_comp.toLocaleString("pt-BR")} basis={`${m.entries_cash} movimento(s) de caixa no mês`} onClick={go("/admin/contabil/lancamentos")} />
          <StatCard label="Sem classificação" value={m.unclassified.toLocaleString("pt-BR")} tone={m.unclassified > 0 ? "danger" : undefined} basis="Lançamentos da competência sem classificação contábil (nem dispensa)" onClick={go("/admin/contabil/lancamentos", { f: "unclassified" })} />
          <StatCard label="Despesas pagas sem comprovante" value={m.missing_receipt.toLocaleString("pt-BR")} tone={m.missing_receipt > 0 ? "danger" : undefined} basis="Conforme a regra de comprovante das Configurações contábeis" onClick={go("/admin/contabil/lancamentos", { f: "missing_receipt" })} />
          <StatCard label="Alterações após o fechamento" value={m.changes_after_close.toLocaleString("pt-BR")} tone={m.changes_after_close > 0 ? "danger" : undefined} basis="Mudanças do Financeiro em competência já fechada, aguardando revisão" onClick={go("/admin/contabil/pendencias", { tipo: "changed_after_close" })} />
          <StatCard label="Documentos da competência" value={m.documents.toLocaleString("pt-BR")} basis="Comprovantes e arquivos anexados" onClick={go("/admin/contabil/documentos")} />
          <StatCard label="Competências encerradas em aberto" value={d.overdue_months.length.toLocaleString("pt-BR")} tone={d.overdue_months.length > 0 ? "danger" : undefined} basis="Meses passados com lançamentos e sem fechamento (últimos 12)" onClick={go("/admin/contabil/competencias")} />
        </ul>

        {d.overdue_months.length > 0 && (
          <p className="text-sm mb-6 flex flex-wrap items-center gap-2">Abrir competência:
            {d.overdue_months.map((o) => <button key={o} className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setMonth(o)}>{fmtMonth(o)}</button>)}</p>)}

        <section aria-labelledby="jornada" className="mb-6">
          <h3 id="jornada" className="text-base font-semibold mb-3">Jornada da competência</h3>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n}>
                <Link to={s.to} className="hp-card p-3 flex gap-3 items-start hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-full" aria-label={`Passo ${s.n}: ${s.label}. ${s.note}`}>
                  {s.done ? <CheckCircle2 size={18} className="text-success mt-0.5 shrink-0" aria-hidden /> : <Circle size={18} className="text-muted-foreground mt-0.5 shrink-0" aria-hidden />}
                  <span><span className="block text-sm font-medium">{s.n}. {s.label}</span><span className="block text-xs text-muted-foreground">{s.note}</span></span>
                </Link>
              </li>))}
          </ol>
        </section>
        <p className="text-xs text-muted-foreground flex items-start gap-2 max-w-3xl"><Info size={14} className="mt-0.5 shrink-0" aria-hidden />{NOT_OFFICIAL}</p>
      </>)}
    </div>
  );
};
export default AccDashboard;
