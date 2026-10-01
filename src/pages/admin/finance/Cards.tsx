import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, Lock, LockOpen, Plus, ShoppingBag, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, parseCents } from "@/lib/format";
import { Badge, EmptyState, KpiGrid, LevelSection, Msg, PageHead, State, StatCard, Table, Td, btnGhost, btnPrimary, confirmDialog, errText, promptText, useMsg } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnits } from "./shared";
import { BUCKET_LABEL, useLineFilter } from "./lineFilter";

interface CardRow {
  id: string; unit_id: string; unit_name: string; nickname: string; issuer: string; brand: string; last4: string | null; holder_name: string | null; status: "active" | "blocked"; block_reason: string | null;
  credit_limit_cents: number; closing_day: number; due_day: number; financial_account_id: string | null; cycle_start: string; closing_date: string; due_date: string;
  spent_cycle_cents: number; unpaid_cents: number; available_cents: number; closed_unpaid_invoices: number;
}
interface Invoice { id: string; cycle_start: string; closing_date: string; due_date: string; status: "open" | "paid"; state: "aberta" | "fechada" | "paga"; total_cents: number; purchases: number; paid_at: string | null; paid_total_cents: number | null; bank_line: { id: string; txn_date: string; description: string } | null }
interface Purchase { id: string; purchase_date: string; merchant: string | null; description: string; amount_cents: number; category: string | null; business_line: string; unit_name: string; invoice_id: string; closing_date: string; cancelled: boolean; cancel_reason: string | null; payable_status: string; note: string | null }
interface Opt { id: string; name: string }

const BRANDS: [string, string][] = [["visa", "Visa"], ["mastercard", "Mastercard"], ["elo", "Elo"], ["amex", "American Express"], ["hipercard", "Hipercard"], ["outra", "Outra"]];
const BRAND_LABEL = Object.fromEntries(BRANDS) as Record<string, string>;
const LINES: [string, string][] = [["unclassified", "Não classificado"], ["physio", "HP Fisioterapia"], ["academy", "HP Academy"], ["shared", "Compartilhado (rateio opcional)"]];
const d = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR");
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Representação visual SEGURA do cartão: nada de número completo, CVV ou foto — só apelido, emissor, bandeira (texto), 4 últimos dígitos e datas do ciclo. */
const CardVisual = ({ c, selected, onSelect }: { c: CardRow; selected: boolean; onSelect: () => void }) => {
  const used = Math.min(100, Math.round((c.unpaid_cents / c.credit_limit_cents) * 100));
  return (
    <li className="list-none">
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Cartão ${c.nickname}${c.status === "blocked" ? " (bloqueado)" : ""}`}
        className={`hp-ccard-wrap w-full text-left ${selected ? "is-selected" : ""}`}>
        <span className={`hp-ccard hp-ccard-${c.brand}${c.status === "blocked" ? " is-blocked" : ""}`}>
          <span className="flex items-start justify-between gap-2"><span className="font-bold text-[13px] leading-4">{c.issuer}</span><span className="text-[11px] font-semibold tracking-wider uppercase opacity-90">{BRAND_LABEL[c.brand] ?? c.brand}</span></span>
          <span aria-hidden className="hp-ccard-chip" />
          <span className="tabular tracking-[.18em] text-[15px] font-semibold">•••• •••• •••• {c.last4 ?? "••••"}</span>
          <span className="flex items-end justify-between gap-2">
            <span className="min-w-0"><span className="block font-bold text-[14px] leading-5 truncate">{c.nickname}</span><span className="block text-[11px] opacity-85 truncate">{c.holder_name ?? c.unit_name}</span></span>
            <span className="text-[11px] opacity-90 text-right leading-4 shrink-0">Fecha dia {c.closing_day}<br />Vence dia {c.due_day}</span>
          </span>
          {c.status === "blocked" && <span className="hp-ccard-lock"><Lock size={14} aria-hidden />Bloqueado</span>}
        </span>
        <span className="block px-1 pt-3">
          <span className="flex items-baseline justify-between text-xs text-muted-foreground"><span>Disponível</span><span className="tabular font-bold text-foreground text-sm">{brl(Math.max(0, c.available_cents))}</span></span>
          <span className="hp-rank-bar block mt-1.5" role="img" aria-label={`${used}% do limite em uso`}><i style={{ width: `${Math.max(used, 2)}%`, ["--rc" as string]: used >= 85 ? "var(--destructive)" : used >= 60 ? "var(--warning)" : "var(--chart-3)" }} /></span>
          <span className="flex justify-between text-[11px] text-muted-foreground mt-1.5"><span>Limite {brl(c.credit_limit_cents)}</span><span>Gasto no ciclo {brl(c.spent_cycle_cents)}</span></span>
        </span>
      </button>
    </li>
  );
};

const FinanceCards = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [sp, setSp] = useSearchParams(); const unit = sp.get("unidade") ?? "";
  const setUnit = (v: string) => { const n = new URLSearchParams(sp); if (v) n.set("unidade", v); else n.delete("unidade"); setSp(n, { replace: true }); };
  const [line, setLine] = useLineFilter();
  const units = useUnits();
  const accounts = useQuery({ queryKey: ["cards-accounts"], queryFn: async () => ((await supabase.from("financial_accounts").select("id, name, unit_id").eq("active", true)).data ?? []) as (Opt & { unit_id: string | null })[] });
  const cats = useQuery({ queryKey: ["cards-cats"], queryFn: async () => ((await supabase.from("finance_categories").select("id, name").eq("kind", "expense").eq("active", true).order("name")).data ?? []) as Opt[] });
  const cards = useQuery({ queryKey: ["cards", unit], queryFn: async () => { const { data, error } = await supabase.rpc("card_summary", { p_unit: unit || null }); if (error) throw error; return data as CardRow[]; } });
  const [selId, setSelId] = useState<string>("");
  const list = cards.data ?? [];
  useEffect(() => { if (list.length && !list.some((c) => c.id === selId)) setSelId(list[0].id); }, [list, selId]);
  const sel = list.find((c) => c.id === selId);
  const [tab, setTab] = useState<"compras" | "faturas">("compras"); const [invFilter, setInvFilter] = useState<string>("");
  const purchases = useQuery({ queryKey: ["card-purchases", selId], enabled: !!selId, queryFn: async () => { const { data, error } = await supabase.rpc("card_purchases_list", { p_card: selId, p_invoice: null, p_limit: 300 }); if (error) throw error; return data as Purchase[]; } });
  const invoices = useQuery({ queryKey: ["card-invoices", selId], enabled: !!selId, queryFn: async () => { const { data, error } = await supabase.rpc("card_invoices_list", { p_card: selId }); if (error) throw error; return data as Invoice[]; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["cards"] }); void qc.invalidateQueries({ queryKey: ["card-purchases"] }); void qc.invalidateQueries({ queryKey: ["card-invoices"] }); void qc.invalidateQueries({ queryKey: ["payables"] }); };

  // ---- resumo (dados reais dos cartões visíveis)
  const sum = (f: (c: CardRow) => number) => list.reduce((a, c) => a + f(c), 0);
  const blocked = list.filter((c) => c.status === "blocked"); const closedUnpaid = sum((c) => c.closed_unpaid_invoices); const nearLimit = list.filter((c) => c.status === "active" && c.unpaid_cents / c.credit_limit_cents >= 0.85);
  const attentionCount = blocked.length + (closedUnpaid > 0 ? 1 : 0) + nearLimit.length;

  // ---- novo cartão
  const [newOpen, setNewOpen] = useState(false);
  const [f, setF] = useState({ unit: "", nickname: "", issuer: "", brand: "visa", last4: "", holder: "", limit: "", closing: "10", due: "20", account: "" });
  const openNew = () => { setF({ unit: unit || units.data?.[0]?.id || "", nickname: "", issuer: "", brand: "visa", last4: "", holder: "", limit: "", closing: "10", due: "20", account: "" }); setNewOpen(true); };
  const createCard = async (e: FormEvent) => {
    e.preventDefault(); const cents = parseCents(f.limit);
    if (!f.unit || cents == null || cents <= 0) return m.err("Informe a unidade e um limite válido.");
    const { error } = await supabase.rpc("card_create", { p_unit: f.unit, p_nickname: f.nickname, p_issuer: f.issuer, p_brand: f.brand, p_limit_cents: cents, p_closing_day: Number(f.closing), p_due_day: Number(f.due), p_last4: f.last4 || null, p_holder: f.holder || null, p_account: f.account || null });
    if (error) return m.err(errText(error));
    m.ok("Cartão cadastrado."); setNewOpen(false); refresh();
  };
  // ---- bloquear / desbloquear
  const toggleBlock = async (c: CardRow) => {
    if (c.status === "active") {
      const reason = await promptText("Bloquear cartão", "Motivo do bloqueio", { required: true, confirmLabel: "Bloquear", danger: true }); if (!reason) return;
      const { error } = await supabase.rpc("card_set_status", { p_card: c.id, p_status: "blocked", p_reason: reason }); if (error) return m.err(errText(error)); m.ok("Cartão bloqueado: não aceita novas compras.");
    } else {
      if (!(await confirmDialog("Desbloquear cartão?", "O cartão volta a aceitar compras.", "Desbloquear"))) return;
      const { error } = await supabase.rpc("card_set_status", { p_card: c.id, p_status: "active", p_reason: null }); if (error) return m.err(errText(error)); m.ok("Cartão desbloqueado.");
    }
    refresh();
  };
  // ---- nova compra
  const [buyOpen, setBuyOpen] = useState(false);
  const [p, setP] = useState({ date: todayIso(), amount: "", description: "", merchant: "", category: "", line: "unclassified", split: false, physio: "50", note: "" });
  const openBuy = () => { setP({ date: todayIso(), amount: "", description: "", merchant: "", category: "", line: "unclassified", split: false, physio: "50", note: "" }); setBuyOpen(true); };
  const addPurchase = async (e: FormEvent) => {
    e.preventDefault(); if (!sel) return; const cents = parseCents(p.amount);
    if (cents == null || cents <= 0 || !p.description.trim()) return m.err("Informe valor e descrição da compra.");
    let allocations: unknown = null;
    if (p.line === "shared" && p.split) {
      const phy = Math.round(Number(p.physio.replace(",", ".")) * 100);
      if (!Number.isFinite(phy) || phy < 1 || phy > 9999) return m.err("Informe o percentual da Fisioterapia entre 0,01% e 99,99% (o restante vai para a Academy).");
      allocations = [{ line: "physio", basis_points: phy }, { line: "academy", basis_points: 10000 - phy }];
    }
    const { error } = await supabase.rpc("card_purchase_create", { p_card: sel.id, p_date: p.date, p_amount_cents: cents, p_description: p.description, p_merchant: p.merchant || null, p_category: p.category || null, p_line: p.line, p_allocations: allocations, p_note: p.note || null });
    if (error) return m.err(errText(error));
    m.ok("Compra registrada."); setBuyOpen(false); refresh();
  };
  const cancelPurchase = async (x: Purchase) => {
    const reason = await promptText("Cancelar compra", `Motivo do cancelamento de “${x.description}”`, { required: true, confirmLabel: "Cancelar compra", danger: true }); if (!reason) return;
    const { error } = await supabase.rpc("card_purchase_cancel", { p_purchase: x.id, p_reason: reason }); if (error) return m.err(errText(error)); m.ok("Compra cancelada."); refresh();
  };
  // ---- pagar fatura
  const [pay, setPay] = useState<Invoice | null>(null); const [payAcc, setPayAcc] = useState(""); const [payDate, setPayDate] = useState(todayIso());
  const accOptions = (accounts.data ?? []).filter((a) => !sel || a.unit_id === null || a.unit_id === sel.unit_id);
  const doPay = async () => {
    if (!pay || !payAcc) return m.err("Escolha a conta que pagou a fatura.");
    const { error } = await supabase.rpc("card_invoice_pay", { p_invoice: pay.id, p_account: payAcc, p_paid_at: `${payDate}T12:00:00-03:00` });
    if (error) return m.err(errText(error)); m.ok("Fatura paga: as despesas do ciclo foram baixadas."); setPay(null); refresh();
  };

  const shown = useMemo(() => (purchases.data ?? []).filter((x) => (line === "geral" || x.business_line === line) && (!invFilter || x.invoice_id === invFilter)), [purchases.data, line, invFilter]);
  const shownTotal = shown.filter((x) => !x.cancelled).reduce((a, x) => a + x.amount_cents, 0);

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Cartões" hint="Cartões corporativos: limite, gasto do ciclo e faturas. Número completo, CVV e dados de autenticação nunca são pedidos nem guardados."
        actions={<>
          <PeriodFilter unit={unit} units={units.data} onUnit={setUnit} line={line} onLine={setLine} onClear={() => { setUnit(""); setLine("geral"); }} />
          <button type="button" className={btnPrimary} onClick={openNew}><Plus size={15} aria-hidden />Novo cartão</button>
        </>} />
      <Msg m={msg} />
      <State loading={cards.isLoading} error={cards.error} />
      {cards.data && list.length === 0 && (
        <EmptyState icon={CreditCard} title="Nenhum cartão cadastrado" action={<button type="button" className={btnPrimary} onClick={openNew}><Plus size={15} aria-hidden />Cadastrar o primeiro cartão</button>}>
          Cadastre o cartão corporativo (apelido, emissor, limite e datas) para registrar compras e acompanhar as faturas.
        </EmptyState>
      )}

      {list.length > 0 && (<>
        <LevelSection level="summary" title="Indicadores prioritários" label="Resumo dos cartões" hint="Somados dos cartões exibidos no recorte de unidade. Gasto do ciclo = compras da fatura que ainda vai fechar; disponível = limite menos o que ainda não foi pago.">
          <KpiGrid kind="hero">
            <StatCard level="hero" icon={CreditCard} label="Limite total" value={brl(sum((c) => c.credit_limit_cents))} unit={`${list.length} cartão(ões)`} period="Hoje" />
            <StatCard level="hero" icon={ShoppingBag} label="Gasto no ciclo atual" value={brl(sum((c) => c.spent_cycle_cents))} period="Ciclo" basis="compras lançadas na fatura que ainda não fechou" />
            <StatCard level="hero" icon={Wallet} label="Disponível" value={brl(Math.max(0, sum((c) => c.available_cents)))} period="Hoje" basis="limite − compras em faturas ainda não pagas" />
            <StatCard level="hero" icon={CalendarClock} label="A pagar nas faturas" value={brl(sum((c) => c.unpaid_cents))} period="Hoje" basis="compras de faturas abertas e fechadas ainda não pagas" />
          </KpiGrid>
        </LevelSection>

        <LevelSection level="attention" title="Atenção" hint={attentionCount === 0 ? "Tudo em dia: nenhum cartão bloqueado, fatura fechada sem pagamento ou limite quase esgotado." : "Cartões bloqueados, faturas fechadas sem pagamento e limite acima de 85%."}>
          {attentionCount === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 size={16} className="text-success" aria-hidden />Nada exige ação agora.</p> : (
            <KpiGrid kind="lg">
              {blocked.length > 0 && <StatCard level="attention" icon={Lock} tone="warning" status="Atenção" label="Cartões bloqueados" value={String(blocked.length)} unit={blocked.length === 1 ? "cartão" : "cartões"} basis={blocked.map((c) => c.nickname).join(", ")} />}
              {closedUnpaid > 0 && <StatCard level="attention" icon={AlertTriangle} tone="danger" status="Crítico" label="Faturas fechadas sem pagamento" value={String(closedUnpaid)} unit={closedUnpaid === 1 ? "fatura" : "faturas"} basis="o ciclo fechou e a fatura ainda não foi paga — veja a aba Faturas do cartão" />}
              {nearLimit.length > 0 && <StatCard level="attention" icon={Wallet} tone="warning" status="Atenção" label="Limite quase esgotado" value={String(nearLimit.length)} unit={nearLimit.length === 1 ? "cartão" : "cartões"} basis={nearLimit.map((c) => c.nickname).join(", ")} />}
            </KpiGrid>
          )}
        </LevelSection>

        <section aria-label="Cartões cadastrados" className="mb-8">
          <h2 className="mb-3">Cartões cadastrados</h2>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => <CardVisual key={c.id} c={c} selected={c.id === selId} onSelect={() => { setSelId(c.id); setInvFilter(""); }} />)}
          </ul>
        </section>

        {sel && (
          <section className="hp-card p-5" aria-label={`Detalhe do cartão ${sel.nickname}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 flex-wrap">{sel.nickname}{sel.status === "blocked" ? <Badge tone="warning">Bloqueado</Badge> : <Badge tone="success">Ativo</Badge>}</h2>
                <p className="text-[13px] text-muted-foreground">{sel.unit_name} · fatura atual fecha em {d(sel.closing_date)} e vence em {d(sel.due_date)}{sel.status === "blocked" && sel.block_reason ? ` · bloqueado: ${sel.block_reason}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={openBuy} disabled={sel.status === "blocked"} title={sel.status === "blocked" ? "Cartão bloqueado" : undefined}><ShoppingBag size={15} aria-hidden />Registrar compra</button>
                <button type="button" className={btnGhost} onClick={() => void toggleBlock(sel)}>{sel.status === "active" ? <><Lock size={15} aria-hidden />Bloquear</> : <><LockOpen size={15} aria-hidden />Desbloquear</>}</button>
              </div>
            </div>
            <div role="tablist" className="flex gap-1 border-b border-border my-4">
              {([["compras", "Compras"], ["faturas", "Faturas"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 h-10 -mb-px border-b-2 text-sm font-medium ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>))}
            </div>

            {tab === "compras" && (<>
              <State loading={purchases.isLoading} error={purchases.error} />
              {invFilter && <p className="text-xs text-muted-foreground mb-2">Mostrando só a fatura selecionada. <button type="button" className="text-primary font-semibold underline" onClick={() => setInvFilter("")}>Ver todas</button></p>}
              {purchases.data && shown.length === 0 && <EmptyState icon={ShoppingBag} title="Nenhuma compra neste recorte">{line !== "geral" ? `Não há compras na linha ${BUCKET_LABEL[line]}.` : "Registre a primeira compra deste cartão."}</EmptyState>}
              {shown.length > 0 && (<>
                <Table head={["Data", "Compra", "Categoria", "Linha de negócio", "Fatura", "Valor", ""]} right={[5]}>
                  {shown.map((x) => (
                    <tr key={x.id} className={x.cancelled ? "opacity-60" : ""}>
                      <Td>{d(x.purchase_date)}</Td>
                      <Td><span className={`font-medium ${x.cancelled ? "line-through" : ""}`}>{x.description}</span>{x.merchant && <span className="block text-xs text-muted-foreground">{x.merchant}</span>}{x.cancelled && <span className="block text-xs text-destructive">Cancelada: {x.cancel_reason}</span>}</Td>
                      <Td>{x.category ?? <span className="text-muted-foreground">Sem categoria</span>}</Td>
                      <Td>{BUCKET_LABEL[x.business_line] ?? x.business_line}</Td>
                      <Td>{d(x.closing_date)}{x.payable_status === "paid" && <span className="block"><Badge tone="success">Paga</Badge></span>}</Td>
                      <Td num>{brl(x.amount_cents)}</Td>
                      <Td>{!x.cancelled && x.payable_status === "open" && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => void cancelPurchase(x)}>Cancelar</button>}</Td>
                    </tr>))}
                </Table>
                <p className="text-sm mt-3 text-right">Total das compras exibidas (sem canceladas): <b className="tabular">{brl(shownTotal)}</b></p>
              </>)}
              <p className="text-[11px] text-muted-foreground mt-2">Cada compra é uma única despesa no financeiro: ela aparece uma vez em Contas a pagar, na DRE, nos relatórios e na linha de negócio escolhida.</p>
            </>)}

            {tab === "faturas" && (<>
              <State loading={invoices.isLoading} error={invoices.error} />
              {invoices.data && invoices.data.length === 0 && <EmptyState icon={CalendarClock} title="Ainda não há faturas">A primeira fatura nasce com a primeira compra do cartão.</EmptyState>}
              <ul className="grid gap-3">
                {(invoices.data ?? []).map((i) => (
                  <li key={i.id} className="rounded-lg border border-border p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">Fatura de {d(i.closing_date)} <Badge tone={i.state === "paga" ? "success" : i.state === "fechada" ? "danger" : "info"}>{i.state === "paga" ? "Paga" : i.state === "fechada" ? "Fechada — a pagar" : "Aberta"}</Badge></p>
                      <p className="text-xs text-muted-foreground">Ciclo {d(i.cycle_start)} a {d(i.closing_date)} · vence em {d(i.due_date)} · {i.purchases} compra(s)</p>
                      {i.paid_at && <p className="text-xs text-muted-foreground">Paga em {new Date(i.paid_at).toLocaleDateString("pt-BR")}</p>}
                      {i.bank_line && <p className="text-xs text-success">Conciliada com o extrato de {d(i.bank_line.txn_date)}: {i.bank_line.description}</p>}
                      {i.state === "paga" && !i.bank_line && <p className="text-xs text-muted-foreground">Ainda não conciliada com o extrato (Financeiro ▸ Conciliação).</p>}
                    </div>
                    <div className="flex items-center gap-3"><span className="tabular text-lg font-extrabold" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{brl(i.total_cents)}</span>
                      <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => { setInvFilter(i.id); setTab("compras"); }}>Ver compras</button>
                      {i.state === "fechada" && <button type="button" className={`${btnPrimary} hp-btn-sm`} onClick={() => { setPay(i); setPayAcc(sel.financial_account_id ?? ""); setPayDate(todayIso()); }}>Registrar pagamento</button>}
                    </div>
                  </li>))}
              </ul>
            </>)}
          </section>
        )}
      </>)}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo cartão corporativo</DialogTitle><DialogDescription>Não informe o número completo nem o CVV: o sistema só guarda apelido, emissor, bandeira, limite, datas e (opcional) os 4 últimos dígitos.</DialogDescription></DialogHeader>
          <form onSubmit={createCard} className="grid gap-3 sm:grid-cols-2" noValidate>
            <div><label htmlFor="cc-unit" className="block text-xs mb-1">Unidade</label><select id="cc-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{(units.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div><label htmlFor="cc-nick" className="block text-xs mb-1">Apelido</label><input id="cc-nick" value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="Ex.: Marketing" /></div>
            <div><label htmlFor="cc-issuer" className="block text-xs mb-1">Emissor</label><input id="cc-issuer" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="Ex.: Banco X" /></div>
            <div><label htmlFor="cc-brand" className="block text-xs mb-1">Bandeira</label><select id="cc-brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}>{BRANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label htmlFor="cc-limit" className="block text-xs mb-1">Limite total (R$)</label><input id="cc-limit" inputMode="decimal" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} placeholder="5.000,00" /></div>
            <div><label htmlFor="cc-last4" className="block text-xs mb-1">4 últimos dígitos (opcional)</label><input id="cc-last4" inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "") })} placeholder="1234" /></div>
            <div><label htmlFor="cc-close" className="block text-xs mb-1">Dia do fechamento (1–28)</label><input id="cc-close" type="number" min={1} max={28} value={f.closing} onChange={(e) => setF({ ...f, closing: e.target.value })} /></div>
            <div><label htmlFor="cc-due" className="block text-xs mb-1">Dia do vencimento (1–28)</label><input id="cc-due" type="number" min={1} max={28} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
            <div><label htmlFor="cc-holder" className="block text-xs mb-1">Responsável (opcional)</label><input id="cc-holder" value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></div>
            <div><label htmlFor="cc-acc" className="block text-xs mb-1">Conta que paga a fatura (opcional)</label><select id="cc-acc" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="">Escolher ao pagar</option>{(accounts.data ?? []).filter((a) => a.unit_id === null || a.unit_id === f.unit).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <DialogFooter className="sm:col-span-2"><button type="button" className={btnGhost} onClick={() => setNewOpen(false)}>Cancelar</button><button type="submit" className={btnPrimary}>Cadastrar cartão</button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Registrar compra{sel ? ` — ${sel.nickname}` : ""}</DialogTitle><DialogDescription>A compra entra na fatura do ciclo da data informada e vira uma despesa (competência = mês da compra, vencimento = o da fatura).</DialogDescription></DialogHeader>
          <form onSubmit={addPurchase} className="grid gap-3 sm:grid-cols-2" noValidate>
            <div><label htmlFor="cp-date" className="block text-xs mb-1">Data da compra</label><input id="cp-date" type="date" value={p.date} max={todayIso()} onChange={(e) => setP({ ...p, date: e.target.value })} /></div>
            <div><label htmlFor="cp-amount" className="block text-xs mb-1">Valor (R$)</label><input id="cp-amount" inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} placeholder="0,00" /></div>
            <div className="sm:col-span-2"><label htmlFor="cp-desc" className="block text-xs mb-1">Descrição</label><input id="cp-desc" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></div>
            <div><label htmlFor="cp-merchant" className="block text-xs mb-1">Estabelecimento (opcional)</label><input id="cp-merchant" value={p.merchant} onChange={(e) => setP({ ...p, merchant: e.target.value })} /></div>
            <div><label htmlFor="cp-cat" className="block text-xs mb-1">Categoria</label><select id="cp-cat" value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })}><option value="">Sem categoria</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="block text-xs mb-1">Unidade</label><input value={sel?.unit_name ?? ""} readOnly aria-readonly /></div>
            <div><label htmlFor="cp-line" className="block text-xs mb-1">Linha de negócio</label><select id="cp-line" value={p.line} onChange={(e) => setP({ ...p, line: e.target.value, split: false })}>{LINES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            {p.line === "shared" && (
              <div className="sm:col-span-2 rounded-md border border-border p-3 grid gap-2">
                <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={p.split} onChange={(e) => setP({ ...p, split: e.target.checked })} />Ratear entre as linhas</label>
                {p.split && <div><label htmlFor="cp-phy" className="block text-xs mb-1">% HP Fisioterapia (o restante vai para HP Academy)</label><input id="cp-phy" inputMode="decimal" value={p.physio} onChange={(e) => setP({ ...p, physio: e.target.value })} /></div>}
                {!p.split && <p className="text-xs text-muted-foreground">Sem rateio, a despesa fica como “Compartilhado / não alocado”.</p>}
              </div>)}
            <div className="sm:col-span-2"><label htmlFor="cp-note" className="block text-xs mb-1">Observação (opcional)</label><input id="cp-note" value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} /></div>
            <DialogFooter className="sm:col-span-2"><button type="button" className={btnGhost} onClick={() => setBuyOpen(false)}>Cancelar</button><button type="submit" className={btnPrimary}>Registrar compra</button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar pagamento da fatura</DialogTitle><DialogDescription>{pay ? `Fatura de ${d(pay.closing_date)} — ${brl(pay.total_cents)}. As despesas do ciclo passam a pagas na data e na conta informadas (nenhuma despesa nova é criada).` : ""}</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div><label htmlFor="pi-acc" className="block text-xs mb-1">Conta que pagou</label><select id="pi-acc" value={payAcc} onChange={(e) => setPayAcc(e.target.value)}><option value="">Selecione…</option>{accOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label htmlFor="pi-date" className="block text-xs mb-1">Data do pagamento</label><input id="pi-date" type="date" value={payDate} max={todayIso()} onChange={(e) => setPayDate(e.target.value)} /></div>
          </div>
          <DialogFooter><button type="button" className={btnGhost} onClick={() => setPay(null)}>Cancelar</button><button type="button" className={btnPrimary} onClick={() => void doPay()}>Confirmar pagamento</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FinanceCards;
