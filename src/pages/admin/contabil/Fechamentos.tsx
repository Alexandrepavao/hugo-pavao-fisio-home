import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, Lock, LockOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, errText, Msg, PageHead, State, StatCard, Table, Td, promptText, useMsg } from "@/lib/ui";
import AccScopeBar from "./AccScopeBar";
import { StatusBadge } from "./accShared";
import { fmtMonthLong, signedBrl, useAccInvalidate, useAccQuery, useAccScope, type PeriodStatus } from "./accLib";
import type { Metrics } from "./AccDashboard";

interface Gate { key: string; label: string; ok: boolean; blocking: boolean; count: number }
interface Change { source_type: string; source_id: string; basis: string; change_type: "added" | "removed" | "changed"; snapshot_cents: number | null; current_cents: number | null; description: string; counterparty: string }
interface Detail {
  month: string; status: PeriodStatus; close_seq: number; reviewed_by: string | null; reviewed_at: string | null; closed_by: string | null; closed_at: string | null; close_note: string | null;
  reopened_by: string | null; reopened_at: string | null; reopen_reason: string | null; totals_at_close: Metrics | null; metrics: Metrics; gates: Gate[]; ready_to_close: boolean;
  can_close: boolean; can_reopen: boolean; reopen_min_reason_len: number;
  events: { action: string; actor: string | null; reason: string | null; detail: Record<string, unknown> | null; at: string }[]; changes: Change[];
}
const EVENT_LABEL: Record<string, string> = { review_requested: "Enviada para revisão", review_withdrawn: "Revisão retirada", closed: "Competência fechada", reopened: "Competência reaberta", change_accepted: "Alteração posterior aceita" };
const CHANGE_LABEL = { added: "Incluído após o fechamento", removed: "Removido/cancelado após o fechamento", changed: "Alterado após o fechamento" } as const;
const GATE_LINK: Record<string, [string, Record<string, string>?]> = { unclassified: ["/admin/contabil/lancamentos", { f: "unclassified" }], missing_receipt: ["/admin/contabil/lancamentos", { f: "missing_receipt" }] };

/** Fechamento da competência: revisar → fechar → (se preciso) reabrir. Fechar e reabrir exigem permissão específica além do
 *  papel; reabrir exige justificativa; tudo fica no histórico e na auditoria. Mudanças do Financeiro após o fechamento
 *  aparecem aqui e nas Pendências até serem aceitas ou tratadas com reabertura. */
const Fechamentos = () => {
  const { unit, month, link } = useAccScope(); const invalidate = useAccInvalidate(); const [msg, m] = useMsg();
  const q = useAccQuery<Detail>("acc_period_detail", { p_unit: unit.id, p_month: month }, ["detail", unit.id, month]);
  const d = q.data;
  const act = async (fn: PromiseLike<{ error: { message: string; code?: string } | null }>, ok: string) => { const { error } = await fn; if (error) return m.err(errText(error)); m.ok(ok); await invalidate(); };

  const review = () => act(supabase.rpc("acc_period_request_review", { p_unit: unit.id, p_month: month }), "Competência enviada para revisão.");
  const unreview = async () => { const r = await promptText("Voltar para aberta", "Motivo (opcional)", { required: false, confirmLabel: "Voltar para aberta" }); if (r !== null) await act(supabase.rpc("acc_period_withdraw_review", { p_unit: unit.id, p_month: month, p_reason: r || null }), "Competência voltou para aberta."); };
  const close = async () => {
    const note = await promptText("Fechar competência", `Fechar ${fmtMonthLong(month)} para ${unit.name}? Depois disso, mudanças no Financeiro serão sinalizadas para revisão. Observação (opcional):`, { required: false, confirmLabel: "Fechar competência" });
    if (note !== null) await act(supabase.rpc("acc_period_close", { p_unit: unit.id, p_month: month, p_note: note || null }), "Competência fechada.");
  };
  const reopen = async () => {
    const min = d?.reopen_min_reason_len ?? 10;
    const reason = await promptText("Reabrir competência", `A reabertura é auditada. Justifique (mínimo de ${min} caracteres):`, { multiline: true, confirmLabel: "Reabrir", danger: true });
    if (reason) await act(supabase.rpc("acc_period_reopen", { p_unit: unit.id, p_month: month, p_reason: reason }), "Competência reaberta.");
  };
  const accept = async (c: Change) => {
    const note = await promptText("Aceitar alteração", `Confirme que a alteração em “${c.description}” foi revisada. Justificativa:`, { multiline: true, confirmLabel: "Aceitar" });
    if (note) await act(supabase.rpc("acc_change_accept", { p_unit: unit.id, p_month: month, p_source_type: c.source_type, p_source_id: c.source_id, p_basis: c.basis, p_note: note }), "Alteração revisada e aceita.");
  };

  return (
    <div>
      <PageHead eyebrow="Contábil" title="Fechamentos" hint="Revisão e fechamento da competência. Fechar e reabrir exigem permissão específica; reabrir exige justificativa." />
      <AccScopeBar />
      <Msg m={msg} />
      <State loading={q.isLoading} error={q.error} />
      {d && (<>
        <section className="hp-card p-4 mb-5" aria-labelledby="sit">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 id="sit" className="text-base font-semibold flex items-center gap-2">{d.status === "closed" ? <Lock size={16} aria-hidden /> : <LockOpen size={16} aria-hidden />}{fmtMonthLong(month)} — {unit.name} <StatusBadge status={d.status} /></h3>
              {d.status === "closed" && <p className="text-sm text-muted-foreground mt-1">Fechada por {d.closed_by ?? "—"} em {fmtDateTime(d.closed_at)} (versão {d.close_seq}){d.close_note ? ` · “${d.close_note}”` : ""}</p>}
              {d.status === "in_review" && <p className="text-sm text-muted-foreground mt-1">Em revisão desde {fmtDateTime(d.reviewed_at)}{d.reviewed_by ? ` (por ${d.reviewed_by})` : ""}.</p>}
              {d.status === "open" && d.reopened_at && <p className="text-sm text-muted-foreground mt-1">Reaberta por {d.reopened_by} em {fmtDateTime(d.reopened_at)}: “{d.reopen_reason}”</p>}</div>
            <div className="flex flex-wrap gap-2">
              {d.status === "open" && <button className="hp-btn hp-btn-primary" onClick={() => void review()}>Enviar para revisão</button>}
              {d.status === "in_review" && <>
                <button className="hp-btn hp-btn-outline" onClick={() => void unreview()}>Voltar para aberta</button>
                <button className="hp-btn hp-btn-primary" disabled={!d.ready_to_close || !d.can_close} onClick={() => void close()}>Fechar competência</button></>}
              {d.status === "closed" && <button className="hp-btn hp-btn-danger" disabled={!d.can_reopen} onClick={() => void reopen()}>Reabrir competência</button>}
            </div>
          </div>
          {d.status === "in_review" && !d.can_close && <p className="text-xs text-muted-foreground mt-3">Você pode revisar, mas não tem a permissão específica de fechar competências. Peça a um gestor em Configurações contábeis › Permissões.</p>}
          {d.status === "in_review" && d.can_close && !d.ready_to_close && <p className="text-xs text-muted-foreground mt-3">Resolva os itens abaixo para liberar o fechamento.</p>}
          {d.status === "closed" && !d.can_reopen && <p className="text-xs text-muted-foreground mt-3">Reabrir exige uma permissão específica que você não possui.</p>}
        </section>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6" aria-label="Totais da competência">
          <StatCard label="Receitas — competência" value={signedBrl(d.metrics.income_comp_cents)} />
          <StatCard label="Despesas — competência" value={signedBrl(d.metrics.expense_comp_cents)} />
          <StatCard label="Recebido no mês — caixa" value={signedBrl(d.metrics.cash_in_cents)} />
          <StatCard label="Pago no mês — caixa" value={signedBrl(d.metrics.cash_out_cents)} />
        </ul>

        <section className="mb-6" aria-labelledby="gates">
          <h3 id="gates" className="text-base font-semibold mb-2">Condições para fechar</h3>
          <ul className="hp-card divide-y divide-border">
            {d.gates.map((g) => (
              <li key={g.key} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-gate={g.key} data-ok={g.ok}>
                {g.ok ? <CheckCircle2 size={16} className="text-success shrink-0" aria-label="atendida" /> : <CircleAlert size={16} className={g.blocking ? "text-destructive shrink-0" : "text-warning shrink-0"} aria-label="pendente" />}
                <span className="flex-1">{g.label}{!g.blocking && <span className="text-xs text-muted-foreground"> (não bloqueia — regra desativada nas configurações)</span>}</span>
                {!g.ok && g.count > 0 && <Badge tone={g.blocking ? "danger" : "warning"}>{g.count}</Badge>}
                {!g.ok && GATE_LINK[g.key] && <Link className="text-sm underline" to={link(GATE_LINK[g.key][0], GATE_LINK[g.key][1])}>Resolver</Link>}
              </li>))}
          </ul>
        </section>

        {d.changes.length > 0 && (
          <section className="mb-6" aria-labelledby="chg">
            <h3 id="chg" className="text-base font-semibold mb-1 text-destructive">Alterações do Financeiro após o fechamento ({d.changes.length})</h3>
            <p className="text-xs text-muted-foreground mb-2">O Financeiro não é bloqueado pelo fechamento — estas mudanças foram detectadas comparando com o que estava fechado. Aceite (com justificativa) ou reabra a competência para incorporá-las.</p>
            <Table head={["Situação", "Lançamento", "Fechado", "Atual", ""]} right={[2, 3]}>
              {d.changes.map((c) => (
                <tr key={c.source_id + c.basis} data-change={c.change_type}>
                  <Td><Badge tone="warning">{CHANGE_LABEL[c.change_type]}</Badge></Td>
                  <Td><span className="font-medium">{c.description}</span><span className="block text-xs text-muted-foreground">{c.counterparty} · {c.basis === "caixa" ? "Caixa" : "Competência"}</span></Td>
                  <Td num>{c.snapshot_cents == null ? "—" : signedBrl(c.snapshot_cents)}</Td>
                  <Td num>{c.current_cents == null ? "—" : signedBrl(c.current_cents)}</Td>
                  <Td>{d.can_close && <div className="flex justify-end"><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => void accept(c)}>Aceitar</button></div>}</Td>
                </tr>))}
            </Table>
          </section>)}

        {d.totals_at_close && (
          <p className="text-xs text-muted-foreground mb-6">No fechamento (v{d.close_seq}): {d.totals_at_close.entries_comp} lançamento(s) por competência, receitas {signedBrl(d.totals_at_close.income_comp_cents)}, despesas {signedBrl(d.totals_at_close.expense_comp_cents)}; caixa: entradas {signedBrl(d.totals_at_close.cash_in_cents)}, saídas {signedBrl(d.totals_at_close.cash_out_cents)}.</p>)}

        <section aria-labelledby="hist">
          <h3 id="hist" className="text-base font-semibold mb-2">Histórico</h3>
          {d.events.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum evento registrado para esta competência.</p> : (
            <ol className="hp-card divide-y divide-border">
              {d.events.map((e, i) => (
                <li key={i} className="px-4 py-2.5 text-sm"><span className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</span> · {e.actor ?? "—"} · <span className="text-muted-foreground">{fmtDateTime(e.at)}</span>{e.reason && <span className="block text-muted-foreground">“{e.reason}”</span>}</li>))}
            </ol>)}
        </section>
      </>)}
    </div>
  );
};
export default Fechamentos;
