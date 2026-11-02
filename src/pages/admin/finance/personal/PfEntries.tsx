import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { brl } from "@/lib/format";
import { Badge, EmptyState, PageHead, State, Table, Tabs, Td, btnGhost, btnPrimary, confirmDialog, errText, Msg, useMsg } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { FREQ_LABEL, fmtYmd, monthBounds, monthLabel, monthOf, pfRpc, refOf, todayYmd, type PfItem } from "./pf";
import { EntryFormDialog, ItemSheet, SettleDialog, StatusBadge, useInvalidatePf, usePfRefs, type ItemTarget } from "./PfShared";

interface Agenda { items: PfItem[]; total: number }
interface SeriesRow { id: string; kind: "income" | "expense"; description: string; frequency: string; start_date: string; due_day: number | null; due_day2: number | null; end_mode: string; end_date: string | null; end_count: number | null; amount_cents: number | null; is_estimate: boolean; status: "active" | "paused" | "ended"; ended_on: string | null; nature: string; monthly_equivalent_cents: number | null; next_dates: string[]; remaining: number | null }

/** Receitas e despesas pessoais: lançamentos do mês (inclui parcelas, compras no cartão e ocorrências calculadas de recorrências) e a gestão das recorrências. */
const PfEntries = () => {
  const [sp, setSp] = useSearchParams(); const tab = sp.get("aba") === "recorrencias" ? "recorrencias" : "lancamentos";
  const [ym, setYm] = useState(monthOf(todayYmd())); const { from, to } = monthBounds(ym);
  const [kind, setKind] = useState(""); const [status, setStatus] = useState(""); const [cat, setCat] = useState(""); const [q, setQ] = useState(""); const [nature, setNature] = useState(""); const [repFilter, setRepFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false); const [item, setItem] = useState<ItemTarget>(null); const [settle, setSettle] = useState<PfItem | null>(null);
  const refs = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const filters: Record<string, unknown> = {};
  if (kind) filters.kind = kind; if (status === "overdue") filters.overdue = true; else if (status) filters.status = status; if (cat) filters.category_id = cat; if (q.trim()) filters.q = q.trim(); if (nature) filters.nature = nature; if (repFilter) filters.repetition = repFilter;
  const list = useQuery({ queryKey: ["pf", "entries", from, to, JSON.stringify(filters)], enabled: tab === "lancamentos", queryFn: () => pfRpc<Agenda>("pf_agenda", { p_from: from, p_to: to, p_filters: filters }) });
  const rows = (list.data?.items ?? []).filter((i) => i.source !== "invoice");
  const series = useQuery({ queryKey: ["pf", "series"], enabled: tab === "recorrencias", queryFn: async () => (await pfRpc<{ series: SeriesRow[] }>("pf_series_list")).series });
  const sum = (k: "income" | "expense") => rows.filter((r) => r.kind === k && r.status !== "cancelled" && !r.is_card).reduce((a, r) => a + r.amount_cents, 0);
  const setTab = (v: string) => { const n = new URLSearchParams(sp); if (v === "recorrencias") n.set("aba", v); else n.delete("aba"); setSp(n, { replace: true }); };

  const action = async (s: SeriesRow, a: "pause" | "resume" | "end") => {
    if (a === "end" && !(await confirmDialog("Encerrar a recorrência?", "As próximas ocorrências deixam de existir; o passado e o que já foi liquidado ficam.", "Encerrar", true))) return;
    try { await pfRpc("pf_series_action", { p_series: s.id, p_action: a }); invalidate(); m.ok(a === "pause" ? "Recorrência pausada a partir de hoje." : a === "resume" ? "Recorrência retomada." : "Recorrência encerrada."); } catch (err) { m.err(errText(err as { message: string })); }
  };

  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Receitas e despesas" hint="Lançamentos do mês. Compras no cartão aparecem na data da compra (sem saída de caixa: a saída é a fatura). Ocorrências futuras de recorrências são calculadas, não gravadas de uma vez."
        actions={<div className="flex flex-wrap items-center gap-2">{tab === "lancamentos" && <PeriodFilter month={ym} onMonth={(v) => v && setYm(v)} onClear={() => setYm(monthOf(todayYmd()))} />}<button type="button" className={btnPrimary} onClick={() => setNewOpen(true)}><Plus size={16} aria-hidden />Novo lançamento</button></div>} />
      <Tabs tabs={[["lancamentos", "Lançamentos"], ["recorrencias", "Recorrências"]]} value={tab} onChange={setTab} />
      <Msg m={msg} />

      {tab === "lancamentos" && (<>
        <div className="flex flex-wrap items-end gap-2 mb-4" role="search" aria-label="Filtros">
          <div><label htmlFor="pl-k" className="sr-only">Tipo</label><select id="pl-k" value={kind} onChange={(e) => setKind(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Receitas e despesas</option><option value="income">Só receitas</option><option value="expense">Só despesas</option></select></div>
          <div><label htmlFor="pl-s" className="sr-only">Situação</label><select id="pl-s" value={status} onChange={(e) => setStatus(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Todas as situações</option><option value="planned">Previsto</option><option value="open">Em aberto</option><option value="partial">Parcialmente liquidado</option><option value="settled">Liquidado</option><option value="overdue">Vencido</option></select></div>
          <div><label htmlFor="pl-c" className="sr-only">Categoria</label><select id="pl-c" value={cat} onChange={(e) => setCat(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Todas as categorias</option>{refs.cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "   " : ""}{c.name}</option>)}</select></div>
          <div><label htmlFor="pl-n" className="sr-only">Comportamento</label><select id="pl-n" value={nature} onChange={(e) => setNature(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Fixo e variável</option><option value="fixed">Fixo</option><option value="variable">Variável</option></select></div>
          <div><label htmlFor="pl-r" className="sr-only">Repetição</label><select id="pl-r" value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Avulso, recorrente e parcelado</option><option value="single">Avulso</option><option value="recurring">Recorrente</option><option value="installment">Parcelado</option></select></div>
          <div><label htmlFor="pl-q" className="sr-only">Buscar</label><input id="pl-q" placeholder="Buscar descrição" value={q} onChange={(e) => setQ(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px] min-w-[12rem]" /></div>
        </div>
        <State loading={list.isLoading} error={list.error} />
        {list.data && (<>
          <p className="text-sm text-muted-foreground mb-2" data-testid="pf-lista-totais">{monthLabel(ym)}: receitas {brl(sum("income"))} · despesas {brl(sum("expense"))} (sem as compras no cartão: elas entram na fatura) · {rows.length} item(ns)</p>
          {rows.length === 0 ? <EmptyState title="Nenhum lançamento neste filtro">Use “Novo lançamento” ou mude o mês.</EmptyState> : (
            <Table head={["Data", "Descrição", "Categoria", "Valor", "Situação", ""]} right={[3]}>
              {rows.map((r) => (
                <tr key={r.key} data-testid="pf-linha" data-kind={r.kind} className={r.status === "cancelled" ? "opacity-60" : undefined}>
                  <Td>{fmtYmd(r.cal_date)}</Td>
                  <Td><button type="button" className="text-accent hover:underline font-medium text-left" onClick={() => setItem({ ref: refOf(r), date: r.cal_date })}>{r.description}</button>
                    <div className="flex gap-1 flex-wrap mt-0.5">{r.installment && <Badge>{`Parcela ${r.installment}`}</Badge>}{r.repetition === "recurring" && <Badge>Recorrente</Badge>}{r.source === "virtual" && <Badge tone="info">Calculada</Badge>}{r.is_card && <Badge tone="gold">Cartão</Badge>}{r.nature === "variable" && <Badge>Variável</Badge>}</div></Td>
                  <Td>{r.category_name ?? "—"}</Td>
                  <Td num><span className={r.kind === "income" ? "text-success" : ""}>{r.kind === "income" ? "+" : "−"} {brl(r.amount_cents)}</span></Td>
                  <Td><StatusBadge i={r} /></Td>
                  <Td>{!r.is_card && r.status !== "settled" && r.status !== "cancelled" ? <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setSettle(r)}>{r.kind === "income" ? "Receber" : "Pagar"}</button> : null}</Td>
                </tr>))}
            </Table>)}
        </>)}
      </>)}

      {tab === "recorrencias" && (<>
        <State loading={series.isLoading} error={series.error} />
        {series.data && series.data.length === 0 && <EmptyState title="Nenhuma recorrência">Crie um lançamento “Recorrente” (aluguel, assinatura, salário…).</EmptyState>}
        {series.data && series.data.length > 0 && (
          <Table head={["Recorrência", "Frequência", "Valor", "Próximas datas", "Situação", ""]} right={[2]}>
            {series.data.map((s) => (
              <tr key={s.id} data-testid="pf-serie">
                <Td><strong>{s.description}</strong><div className="text-xs text-muted-foreground">{s.kind === "income" ? "Receita" : "Despesa"} · {s.nature === "fixed" ? "valor fixo" : "valor variável"}{s.end_mode === "count" ? ` · ${s.remaining ?? 0} restante(s)` : s.end_mode === "date" ? ` · até ${fmtYmd(s.end_date)}` : " · sem prazo"}</div></Td>
                <Td>{FREQ_LABEL[s.frequency]}{s.due_day ? ` (dia ${s.due_day}${s.due_day2 ? ` e ${s.due_day2}` : ""})` : ""}</Td>
                <Td num>{s.amount_cents != null ? `${s.is_estimate ? "≈ " : ""}${brl(s.amount_cents)}` : <span className="text-warning">sem estimativa</span>}{s.monthly_equivalent_cents != null && <div className="text-xs text-muted-foreground">{brl(s.monthly_equivalent_cents)}/mês</div>}</Td>
                <Td>{s.next_dates.length ? s.next_dates.map(fmtYmd).join(" · ") : "—"}</Td>
                <Td><Badge tone={s.status === "active" ? "success" : s.status === "paused" ? "warning" : "neutral"}>{s.status === "active" ? "Ativa" : s.status === "paused" ? "Pausada" : `Encerrada${s.ended_on ? ` em ${fmtYmd(s.ended_on)}` : ""}`}</Badge></Td>
                <Td><span className="flex gap-1 flex-wrap">{s.status === "active" && <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void action(s, "pause")}>Pausar</button>}{s.status === "paused" && <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void action(s, "resume")}>Retomar</button>}
                  {s.status !== "ended" && <><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => { if (s.next_dates[0]) setItem({ ref: { series_id: s.id, occurrence_date: s.next_dates[0] } }); }} disabled={!s.next_dates[0]}>Abrir próxima</button><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void action(s, "end")}>Encerrar</button></>}</span></Td>
              </tr>))}
          </Table>)}
        <p className="text-xs text-muted-foreground mt-3">Para mudar valor, vencimento ou frequência a partir de uma data, abra uma ocorrência e escolha “esta e as próximas”. Variável sem estimativa: informe o valor real ao pagar; com histórico o sistema sugere a média.</p>
      </>)}

      <EntryFormDialog open={newOpen} onOpenChange={setNewOpen} />
      <SettleDialog item={settle} onClose={() => setSettle(null)} />
      <ItemSheet target={item} onClose={() => setItem(null)} />
    </div>
  );
};
export default PfEntries;
