import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Paperclip, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge, errText, Msg, PageHead, State, StatCard, promptText, useMsg } from "@/lib/ui";
import AccScopeBar from "./AccScopeBar";
import AttachDialog, { type AttachTarget } from "./AttachDialog";
import { BASIS_HINT, BASIS_LABEL, fmtDay, fmtMonth, signedBrl, useAccInvalidate, useAccQuery, useAccScope, type Basis, type PeriodStatus } from "./accLib";

interface Row {
  source_type: "receivable" | "payable" | "payment"; source_id: string; basis: Basis; entry_date: string; competence_month: string; kind: "income" | "expense";
  description: string; counterparty: string; signed_cents: number; status: string; target_type: "receivable" | "payable"; target_id: string; category_name: string | null;
  account_id: string | null; account_name: string | null; suggested_account_id: string | null; suggested_account_name: string | null;
  classified: boolean; waived_class: boolean; doc_count: number; waived_receipt: boolean; missing_receipt: boolean; changed: boolean;
}
interface Page { rows: Row[]; total: number; page: number; page_size: number; summary: { count: number; income_cents: number; expense_cents: number }; basis: Basis; period_status: PeriodStatus; names_visible: boolean }
export interface AccCfg { accounts: { id: string; code: string; name: string; kind: "income" | "expense" | "other"; active: boolean; uses: number }[] }
const FILTERS: Record<string, string> = { all: "Todos", unclassified: "Sem classificação", missing_receipt: "Sem comprovante", changed: "Alterados após o fechamento" };
const PAY_STATUS: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Pago", refunded: "Estornado", payment: "Recebimento", refund: "Estorno", cancelled: "Cancelado" };

/** Lançamentos e classificações: o livro de recebíveis, contas a pagar e recebimentos do Financeiro (somente leitura) com a
 *  camada contábil por cima — classificação, comprovantes e dispensas. Caixa e competência nunca se misturam: escolha a base. */
const Lancamentos = () => {
  const { unit, month, link } = useAccScope(); const invalidate = useAccInvalidate();
  const [sp, setSp] = useSearchParams();
  const basis: Basis = sp.get("basis") === "caixa" ? "caixa" : "competencia";
  const kind = sp.get("kind") ?? ""; const filter = sp.get("f") ?? "all"; const search = sp.get("q") ?? ""; const page = Number(sp.get("p") ?? 0) || 0;
  const setParam = (patch: Record<string, string | null>) => setSp((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") n.delete(k); else n.set(k, v); }
    if (!("p" in patch)) n.delete("p");
    return n;
  }, { replace: true });
  const [sel, setSel] = useState<Record<string, Row>>({});
  const [attach, setAttach] = useState<AttachTarget | null>(null);
  const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);

  const q = useAccQuery<Page>("acc_ledger_list", { p_unit: unit.id, p_month: month, p_basis: basis, p_kind: kind || null, p_filter: filter, p_search: search || null, p_page: page, p_page_size: 25 }, ["ledger", unit.id, month, basis, kind, filter, search, page]);
  const cfg = useAccQuery<AccCfg>("acc_config", {}, ["config"]);
  const closed = q.data?.period_status === "closed";
  const selRows = Object.values(sel);

  const accountOptions = (rows: Row[]) => {
    const kinds = new Set(rows.map((r) => r.kind));
    const opts = (cfg.data?.accounts ?? []).filter((a) => a.active && (a.kind === "other" || kinds.size !== 1 || kinds.has(a.kind as "income" | "expense"))).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
    return [...opts, { value: "__none", label: "Remover classificação" }];
  };
  const run = async (fn: () => PromiseLike<{ error: { message: string; code?: string } | null }>, ok: string) => {
    setBusy(true); const { error } = await fn(); setBusy(false);
    if (error) return m.err(errText(error));
    m.ok(ok); setSel({}); await invalidate();
  };
  const classify = async (rows: Row[]) => {
    const opts = accountOptions(rows);
    if (opts.length <= 1) return m.err("Não há classificações ativas. Um gestor deve cadastrá-las em Configurações contábeis.");
    const v = await promptText("Classificar lançamentos", `Classificação para ${rows.length} lançamento(s)`, { kind: "select", options: opts, confirmLabel: "Classificar" });
    if (!v) return;
    const items = [...new Map(rows.map((r) => [r.target_id, { source_type: r.target_type, source_id: r.target_id }])).values()];
    await run(() => supabase.rpc("acc_classify", { p_unit: unit.id, p_items: items, p_account: v === "__none" ? null : v, p_note: null }), "Classificação registrada.");
  };
  const applySuggestion = (r: Row) => run(() => supabase.rpc("acc_classify", { p_unit: unit.id, p_items: [{ source_type: r.target_type, source_id: r.target_id }], p_account: r.suggested_account_id, p_note: "Sugestão pela categoria do Financeiro" }), "Sugestão aplicada.");
  const applyAll = () => run(() => supabase.rpc("acc_apply_suggestions", { p_unit: unit.id, p_month: month }), "Sugestões aplicadas aos lançamentos com categoria mapeada.");
  const waive = async (r: Row) => {
    const options = [
      ...(!r.classified && !r.waived_class ? [{ value: "classification", label: "Dispensar classificação" }] : []),
      ...(r.missing_receipt ? [{ value: "receipt", label: "Dispensar comprovante" }] : []),
    ];
    if (!options.length) return m.err("Este lançamento não tem pendência para dispensar.");
    const what = options.length === 1 ? options[0].value : await promptText("Dispensar pendência", "O que dispensar?", { kind: "select", options });
    if (!what) return;
    const reason = await promptText("Justificativa da dispensa", "Por que esta pendência não se aplica? (fica registrada e auditada)", { multiline: true, confirmLabel: "Dispensar" });
    if (!reason) return;
    await run(() => supabase.rpc("acc_waive", {
      p_unit: unit.id, p_source_type: what === "receipt" ? r.source_type : r.target_type, p_source_id: what === "receipt" ? r.source_id : r.target_id, p_kind: what, p_reason: reason,
    }), "Pendência dispensada com justificativa.");
  };

  const toggle = (r: Row, on: boolean) => setSel((s) => { const n = { ...s }; if (on) n[r.target_id] = r; else delete n[r.target_id]; return n; });
  const sum = q.data?.summary; const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.page_size)) : 1;
  const allSelected = useMemo(() => !!q.data?.rows.length && q.data.rows.every((r) => sel[r.target_id]), [q.data, sel]);

  return (
    <div>
      <PageHead eyebrow="Contábil" title="Lançamentos e classificações" hint="Vêm do Financeiro (recebíveis, contas a pagar e recebimentos) — aqui nada é duplicado: você só classifica, anexa comprovantes e dispensa pendências." />
      <AccScopeBar />
      <Msg m={msg} />
      {closed && (
        <p role="status" className="hp-card p-3 mb-4 text-sm flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>Competência {fmtMonth(month)} fechada: leitura somente. Para alterar classificações ou documentos, reabra em <Link className="underline" to={link("/admin/contabil/fechamentos")}>Fechamentos</Link> (exige permissão e justificativa).</span></p>)}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div role="group" aria-label="Base do relatório">
          <p className="text-xs text-muted-foreground mb-1">Base</p>
          <div className="inline-flex rounded-full border border-border overflow-hidden h-9">
            {(["competencia", "caixa"] as const).map((b) => (
              <button key={b} type="button" aria-pressed={basis === b} title={BASIS_HINT[b]} onClick={() => setParam({ basis: b })}
                className={`px-3 text-[13px] ${basis === b ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted"}`}>{BASIS_LABEL[b]}</button>))}
          </div>
        </div>
        <div><label htmlFor="l-kind" className="block text-xs text-muted-foreground mb-1">Natureza</label>
          <select id="l-kind" value={kind} onChange={(e) => setParam({ kind: e.target.value })} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Receitas e despesas</option><option value="income">Receitas</option><option value="expense">Despesas</option></select></div>
        <div><label htmlFor="l-f" className="block text-xs text-muted-foreground mb-1">Situação</label>
          <select id="l-f" value={filter} onChange={(e) => setParam({ f: e.target.value === "all" ? null : e.target.value })} className="!h-9 rounded-full !py-0 text-[13px]">{Object.entries(FILTERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="relative"><label htmlFor="l-q" className="sr-only">Buscar</label><Search size={14} aria-hidden className="absolute left-2.5 bottom-2.5 text-muted-foreground" />
          <input id="l-q" placeholder="Descrição, contraparte ou classificação" defaultValue={search}
            onKeyDown={(e) => { if (e.key === "Enter") setParam({ q: (e.target as HTMLInputElement).value }); }}
            onBlur={(e) => { if (e.target.value !== search) setParam({ q: e.target.value }); }}
            style={{ paddingLeft: "2rem" }} className="!h-9 rounded-full !py-0 text-[13px] min-w-[16rem]" /></div>
        {(kind || filter !== "all" || search) && <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setParam({ kind: null, f: null, q: null })}>Limpar</button>}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{BASIS_LABEL[basis]}: {BASIS_HINT[basis]}</p>

      {sum && (
        <ul className="grid gap-3 sm:grid-cols-3 mb-4" aria-label={`Totais da base ${BASIS_LABEL[basis]}`}>
          <StatCard label={`Receitas — ${BASIS_LABEL[basis].toLowerCase()}`} value={signedBrl(sum.income_cents)} />
          <StatCard label={`Despesas — ${BASIS_LABEL[basis].toLowerCase()}`} value={signedBrl(sum.expense_cents)} />
          <StatCard label="Diferença (receitas − despesas)" value={signedBrl(sum.income_cents - sum.expense_cents)} basis="Apoio à conferência; não é DRE nem apuração de resultado" />
        </ul>)}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="hp-btn hp-btn-primary hp-btn-sm" disabled={!selRows.length || closed || busy} onClick={() => void classify(selRows)}>Classificar selecionados{selRows.length ? ` (${selRows.length})` : ""}</button>
        {basis === "competencia" && <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed || busy} onClick={() => void applyAll()} title="Classifica automaticamente as contas a pagar cuja categoria do Financeiro tem classificação mapeada">Aplicar sugestões por categoria</button>}
        {selRows.length > 0 && <button className="hp-btn hp-btn-ghost hp-btn-sm" onClick={() => setSel({})}>Limpar seleção</button>}
      </div>

      <State loading={q.isLoading} error={q.error} empty={q.data?.rows.length === 0} emptyText="Nenhum lançamento nesta base, competência e filtro." />
      {q.data && q.data.rows.length > 0 && (<>
        <div className="hp-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="acc-ledger">
            <thead><tr className="text-left text-xs font-semibold text-muted-foreground bg-muted/60 border-b border-border">
              <th className="px-3 py-2.5 w-8"><input type="checkbox" aria-label="Selecionar todos da página" checked={allSelected} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(q.data!.rows.map((r) => [r.target_id, r])) : {})} /></th>
              <th className="px-3 py-2.5">Data</th><th className="px-3 py-2.5">Descrição</th><th className="px-3 py-2.5">Contraparte</th><th className="px-3 py-2.5 text-right">Valor</th>
              <th className="px-3 py-2.5">Classificação</th><th className="px-3 py-2.5">Comprovante</th><th className="px-3 py-2.5"></th></tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.source_type + r.source_id + r.basis} className="border-b border-border last:border-0 align-top" data-source={r.source_id}>
                  <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Selecionar ${r.description}`} checked={!!sel[r.target_id]} onChange={(e) => toggle(r, e.target.checked)} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular">{fmtDay(r.entry_date)}</td>
                  <td className="px-3 py-2.5"><span className="font-medium">{r.description}</span>
                    <span className="block text-xs text-muted-foreground">{PAY_STATUS[r.status] ?? r.status}{r.category_name ? ` · ${r.category_name}` : ""}{basis === "caixa" && r.competence_month ? ` · competência ${fmtMonth(r.competence_month)}` : ""}</span>
                    {r.changed && <Badge tone="warning">Alterado após o fechamento</Badge>}</td>
                  <td className="px-3 py-2.5">{r.counterparty}</td>
                  <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">{signedBrl(r.signed_cents)}</td>
                  <td className="px-3 py-2.5">
                    {r.account_name ? <Badge tone="success">{r.account_name}</Badge>
                      : r.waived_class ? <Badge>Dispensada</Badge>
                      : r.suggested_account_name ? <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed || busy} onClick={() => void applySuggestion(r)} title="Aplicar a classificação sugerida pela categoria do Financeiro">Sugerida: {r.suggested_account_name}</button>
                      : <Badge tone="danger">Sem classificação</Badge>}</td>
                  <td className="px-3 py-2.5">
                    {r.doc_count > 0 ? <Badge tone="success"><Paperclip size={11} aria-hidden /> {r.doc_count}</Badge>
                      : r.missing_receipt ? <Badge tone="danger">Sem comprovante</Badge>
                      : r.waived_receipt ? <Badge>Dispensado</Badge> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2.5"><div className="flex gap-1.5 justify-end whitespace-nowrap">
                    <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed || busy} onClick={() => void classify([r])}>Classificar</button>
                    <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed} onClick={() => setAttach({ type: r.source_type, id: r.source_id, label: r.description })}>Anexar</button>
                    {(r.missing_receipt || (!r.classified && !r.waived_class)) && <button className="hp-btn hp-btn-ghost hp-btn-sm" disabled={closed || busy} onClick={() => void waive(r)}>Dispensar</button>}
                  </div></td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
          <span>{q.data.total} lançamento(s) — página {page + 1} de {totalPages}{!q.data.names_visible && " · nomes de pacientes pseudonimizados para o seu perfil"}</span>
          <div className="flex gap-2">
            <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={page === 0} onClick={() => setParam({ p: String(page - 1) })}>Anterior</button>
            <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={page + 1 >= totalPages} onClick={() => setParam({ p: String(page + 1) })}>Próxima</button>
          </div>
        </div>
      </>)}
      <AttachDialog target={attach} onClose={() => setAttach(null)} />
    </div>
  );
};
export default Lancamentos;
