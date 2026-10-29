import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, AlertTriangle, Plus } from "lucide-react";
import { brl } from "@/lib/format";
import { PageHead, State, Tabs, btnGhost, btnPrimary } from "@/lib/ui";
import { addDaysYmd, addMonthsYm, fmtYmd, monthBounds, monthLabel, monthOf, pfRpc, refOf, todayYmd, weekdayOf, type PfItem } from "./pf";
import { EntryFormDialog, ItemSheet, type ItemTarget } from "./PfShared";

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
type View = "mes" | "semana" | "lista";
const dayCash = (i: PfItem) => i.cash_date ?? i.cal_date;

/** Calendário financeiro privado: vencimentos, faturas, parcelas, receitas previstas e ocorrências calculadas. Entradas e saídas são diferenciadas por ícone e texto (não só por cor).
 *  Totais por dia/mês = efeito de CAIXA (a compra no cartão aparece, mas a saída é a fatura). */
const PfCalendar = () => {
  const nav = useNavigate(); const today = todayYmd();
  const [view, setView] = useState<View>("mes"); const [ym, setYm] = useState(monthOf(today)); const [weekStart, setWeekStart] = useState(() => addDaysYmd(today, -weekdayOf(today)));
  const [sel, setSel] = useState<string>(today); const [item, setItem] = useState<ItemTarget>(null); const [newDate, setNewDate] = useState<string | null>(null);
  const month = monthBounds(ym);
  const gridFrom = addDaysYmd(month.from, -weekdayOf(month.from)); const gridTo = addDaysYmd(month.to, 6 - weekdayOf(month.to));
  const range = view === "semana" ? { from: weekStart, to: addDaysYmd(weekStart, 6) } : view === "mes" ? { from: gridFrom, to: gridTo } : month;
  const ag = useQuery({ queryKey: ["pf", "calendar", range.from, range.to], queryFn: () => pfRpc<{ items: PfItem[] }>("pf_agenda", { p_from: range.from, p_to: range.to, p_filters: {} }) });
  const items = useMemo(() => ag.data?.items ?? [], [ag.data]);
  const byDay = useMemo(() => { const mp = new Map<string, PfItem[]>(); for (const i of items) { const a = mp.get(i.cal_date) ?? []; a.push(i); mp.set(i.cal_date, a); } return mp; }, [items]);
  const cashByDay = useMemo(() => { const mp = new Map<string, { in: number; out: number }>(); for (const i of items) { if (!(i.cash_in || i.cash_out)) continue; const d = dayCash(i); const c = mp.get(d) ?? { in: 0, out: 0 }; c.in += i.cash_in; c.out += i.cash_out; mp.set(d, c); } return mp; }, [items]);
  const monthTotals = useMemo(() => { let i = 0, o = 0; for (const [d, c] of cashByDay) if (d >= month.from && d <= month.to) { i += c.in; o += c.out; } return { in: i, out: o }; }, [cashByDay, month.from, month.to]);
  const open = (i: PfItem) => { if (i.source === "invoice") nav("/admin/financeiro/pessoal/contas?aba=cartoes"); else setItem({ ref: refOf(i), date: i.cal_date }); };

  const Chip = ({ i }: { i: PfItem }) => {
    const settled = i.status === "settled"; const Icon = settled ? CheckCircle2 : i.source === "invoice" ? CreditCard : i.overdue ? AlertTriangle : i.kind === "income" ? ArrowUp : ArrowDown;
    const label = `${i.kind === "income" ? "Entrada" : "Saída"}${settled ? " liquidada" : i.overdue ? " vencida" : ""}: ${i.description}`;
    const tone = settled ? "text-muted-foreground line-through" : i.overdue ? "text-destructive" : i.kind === "income" ? "text-success" : "text-foreground";
    return <button type="button" onClick={(e) => { e.stopPropagation(); open(i); }} title={`${label} · ${brl(i.amount_cents)}`} aria-label={`${label}, ${brl(i.amount_cents)}`} data-testid="pf-cal-item" data-kind={i.kind} data-source={i.source}
      className={`flex w-full items-center gap-1 text-left text-[11px] leading-4 rounded px-1 py-0.5 hover:bg-muted ${tone}`}><Icon size={11} aria-hidden className="shrink-0" /><span className="truncate">{i.description}</span><span className="tabular ml-auto shrink-0">{brl(i.amount_cents).replace("R$ ", "")}</span></button>;
  };
  const Totals = ({ d }: { d: string }) => { const c = cashByDay.get(d); if (!c) return null; return <p className="text-[10px] tabular text-muted-foreground mt-0.5" data-testid="pf-cal-totais">{c.in > 0 && <span className="text-success">+{brl(c.in).replace("R$ ", "")} </span>}{c.out > 0 && <span>−{brl(c.out).replace("R$ ", "")}</span>}</p>; };

  const days: string[] = []; if (view === "mes") for (let d = gridFrom; d <= gridTo; d = addDaysYmd(d, 1)) days.push(d);
  const week: string[] = view === "semana" ? Array.from({ length: 7 }, (_, k) => addDaysYmd(weekStart, k)) : [];
  const listDays = [...byDay.keys()].sort();
  const selItems = byDay.get(sel) ?? [];

  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Calendário financeiro" hint="Vencimentos, faturas, parcelas, receitas previstas e recorrências futuras. Os totais do dia e do mês são de caixa: a compra no cartão aparece, mas a saída é a fatura. Fica dentro do app, sem misturar com a agenda clínica."
        actions={<div className="flex items-center gap-2"><button type="button" className={btnGhost} onClick={() => view === "semana" ? setWeekStart(addDaysYmd(weekStart, -7)) : setYm(addMonthsYm(ym, -1))} aria-label="Anterior"><ChevronLeft size={16} aria-hidden /></button>
          <strong className="text-sm min-w-[9rem] text-center capitalize" data-testid="pf-cal-titulo">{view === "semana" ? `${fmtYmd(weekStart)} – ${fmtYmd(addDaysYmd(weekStart, 6))}` : monthLabel(ym)}</strong>
          <button type="button" className={btnGhost} onClick={() => view === "semana" ? setWeekStart(addDaysYmd(weekStart, 7)) : setYm(addMonthsYm(ym, 1))} aria-label="Próximo"><ChevronRight size={16} aria-hidden /></button>
          <button type="button" className={btnGhost} onClick={() => { setYm(monthOf(today)); setWeekStart(addDaysYmd(today, -weekdayOf(today))); setSel(today); }}>Hoje</button>
          <button type="button" className={btnPrimary} onClick={() => setNewDate(sel)}><Plus size={16} aria-hidden />Lançamento</button></div>} />
      <Tabs tabs={[["mes", "Mês"], ["semana", "Semana"], ["lista", "Lista"]]} value={view} onChange={(v) => setView(v as View)} />
      <p className="text-sm mb-3" data-testid="pf-cal-mes">Previsto no mês — entradas: <strong className="tabular text-success">{brl(monthTotals.in)}</strong> · saídas: <strong className="tabular">{brl(monthTotals.out)}</strong></p>
      <State loading={ag.isLoading} error={ag.error} />
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-3" aria-label="Legenda"><li className="inline-flex items-center gap-1"><ArrowUp size={12} className="text-success" aria-hidden />Entrada</li><li className="inline-flex items-center gap-1"><ArrowDown size={12} aria-hidden />Saída</li><li className="inline-flex items-center gap-1"><CreditCard size={12} aria-hidden />Fatura</li><li className="inline-flex items-center gap-1"><AlertTriangle size={12} className="text-destructive" aria-hidden />Vencido</li><li className="inline-flex items-center gap-1"><CheckCircle2 size={12} aria-hidden />Liquidado</li></ul>

      {view === "mes" && ag.data && (
        <div role="grid" aria-label="Calendário do mês" data-testid="pf-cal-grade" className="border border-border rounded-lg overflow-hidden">
          <div role="row" className="grid grid-cols-7 bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">{DOW.map((d) => <div key={d} role="columnheader" className="px-2 py-1.5">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.map((d) => { const its = byDay.get(d) ?? []; const out = d < month.from || d > month.to;
              return (
                <div key={d} role="gridcell" tabIndex={0} aria-label={`${fmtYmd(d)}, ${its.length} item(ns)`} aria-selected={sel === d} onClick={() => setSel(d)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(d); } }} data-day={d}
                  className={`min-h-[5.5rem] border-t border-l border-border p-1 cursor-pointer text-left ${out ? "bg-muted/30" : ""} ${sel === d ? "ring-2 ring-inset ring-primary" : ""}`}>
                  <p className={`text-xs ${d === today ? "font-bold text-primary" : "text-muted-foreground"}`}>{Number(d.slice(8))}</p>
                  <div className="grid gap-0.5">{its.slice(0, 3).map((i) => <Chip key={i.key} i={i} />)}{its.length > 3 && <span className="text-[10px] text-muted-foreground px-1">+{its.length - 3} mais</span>}</div>
                  <Totals d={d} />
                </div>); })}
          </div>
        </div>
      )}

      {view === "semana" && ag.data && (
        <div className="grid gap-2 sm:grid-cols-7" data-testid="pf-cal-semana">
          {week.map((d) => <div key={d} className={`hp-card p-2 min-h-[8rem] ${d === today ? "ring-2 ring-primary" : ""}`}><p className="text-xs font-medium">{DOW[weekdayOf(d)]} {fmtYmd(d).slice(0, 5)}</p><div className="grid gap-0.5 mt-1">{(byDay.get(d) ?? []).map((i) => <Chip key={i.key} i={i} />)}</div><Totals d={d} /></div>)}
        </div>
      )}

      {view === "lista" && ag.data && (
        <div className="grid gap-3" data-testid="pf-cal-lista">
          {listDays.length === 0 && <p className="text-sm text-muted-foreground">Nada previsto neste mês.</p>}
          {listDays.map((d) => <section key={d} className="hp-card p-3"><h3 className="text-sm font-medium">{DOW[weekdayOf(d)]}, {fmtYmd(d)}</h3><div className="mt-1 grid gap-0.5">{(byDay.get(d) ?? []).map((i) => <Chip key={i.key} i={i} />)}</div><Totals d={d} /></section>)}
        </div>
      )}

      {view !== "lista" && (
        <section className="hp-card p-4 mt-4" aria-label={`Dia ${fmtYmd(sel)}`} data-testid="pf-cal-dia">
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{fmtYmd(sel)}</h3><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setNewDate(sel)}>Novo lançamento neste dia</button></div>
          {selItems.length === 0 ? <p className="text-sm text-muted-foreground mt-2">Nada neste dia.</p> : <ul className="mt-2 grid gap-1">{selItems.map((i) => <li key={i.key} className="flex items-center justify-between gap-2 text-sm"><Chip i={i} /></li>)}</ul>}
          {cashByDay.get(sel) && <p className="text-xs text-muted-foreground mt-2">Entradas previstas {brl(cashByDay.get(sel)!.in)} · saídas previstas {brl(cashByDay.get(sel)!.out)}</p>}
        </section>
      )}
      <ItemSheet target={item} onClose={() => setItem(null)} />
      <EntryFormDialog key={newDate ?? "x"} open={!!newDate} onOpenChange={(o) => { if (!o) setNewDate(null); }} defaults={{ date: newDate ?? undefined }} />
    </div>
  );
};
export default PfCalendar;
