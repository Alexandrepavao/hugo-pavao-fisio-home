import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, newKey, parseCents } from "@/lib/format";
import { Badge, Msg, State, btnGhost, btnPrimary, confirmDialog, errText, useMsg, type Tone } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FREQ_LABEL, fmtYmd, pfRpc, refOf, statusLabel, todayYmd, type PfAccount, type PfCategory, type PfItem, type PfKind, type PfRef } from "./pf";

// ---------------------------------------------------------------- dados de apoio (listas dos formulários)
export interface PfCard { id: string; nickname: string; issuer: string; brand: string; last4: string | null; limit_cents: number; closing_day: number; due_day: number; pay_account_id: string | null; status: string }
export const usePfRefs = () => {
  const cats = useQuery({ queryKey: ["pf", "categories"], queryFn: async () => ((await supabase.from("pf_categories").select("id, name, kind, parent_id, essential, active").order("name")).data ?? []) as PfCategory[] });
  const accounts = useQuery({ queryKey: ["pf", "accounts-list"], queryFn: async () => ((await supabase.from("pf_accounts").select("id, name, kind, opening_balance_cents, opening_date, counts_for_reserve, active").order("name")).data ?? []) as PfAccount[] });
  const cards = useQuery({ queryKey: ["pf", "cards-list"], queryFn: async () => ((await supabase.from("pf_cards").select("id, nickname, issuer, brand, last4, limit_cents, closing_day, due_day, pay_account_id, status").order("nickname")).data ?? []) as PfCard[] });
  return { cats: cats.data ?? [], accounts: accounts.data ?? [], cards: cards.data ?? [], loading: cats.isLoading || accounts.isLoading || cards.isLoading };
};
export const useInvalidatePf = () => { const qc = useQueryClient(); return () => void qc.invalidateQueries({ queryKey: ["pf"] }); };

export const MoneyInput = ({ id, value, onChange, label, placeholder = "0,00", required }: { id: string; value: string; onChange: (v: string) => void; label: string; placeholder?: string; required?: boolean }) => (
  <div><label htmlFor={id} className="block text-xs mb-1">{label}</label><input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} autoComplete="off" /></div>
);
export const centsFrom = (s: string): number | null => parseCents(s);
export const centsToInput = (c: number): string => (c / 100).toFixed(2).replace(".", ",");

export const CategorySelect = ({ id, kind, cats, value, onChange, label = "Categoria" }: { id: string; kind: PfKind; cats: PfCategory[]; value: string; onChange: (v: string) => void; label?: string }) => {
  const tops = cats.filter((c) => c.kind === kind && !c.parent_id && c.active);
  return (
    <div><label htmlFor={id} className="block text-xs mb-1">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sem categoria</option>
        {tops.map((t) => (<optgroup key={t.id} label={t.name}><option value={t.id}>{t.name} (geral)</option>{cats.filter((c) => c.parent_id === t.id && c.active).map((s) => <option key={s.id} value={s.id}>{t.name} › {s.name}</option>)}</optgroup>))}
      </select></div>
  );
};

export const statusTone = (i: Pick<PfItem, "status" | "overdue">): Tone => (i.status === "settled" ? "success" : i.status === "cancelled" ? "neutral" : i.overdue ? "danger" : i.status === "partial" ? "warning" : i.status === "planned" ? "info" : "neutral");
export const StatusBadge = ({ i }: { i: PfItem }) => (<span className="inline-flex gap-1 flex-wrap"><Badge tone={statusTone(i)}>{statusLabel(i)}</Badge>{i.overdue && <Badge tone="danger">Vencido</Badge>}</span>);

// ---------------------------------------------------------------- novo lançamento
type Rep = "single" | "recurring" | "installment";
export const EntryFormDialog = ({ open, onOpenChange, defaults, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { kind?: PfKind; date?: string }; onSaved?: () => void }) => {
  const { cats, accounts, cards } = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const [key, setKey] = useState(() => newKey("pfe"));
  const [kind, setKind] = useState<PfKind>(defaults?.kind ?? "expense"); const [desc, setDesc] = useState(""); const [amount, setAmount] = useState(""); const [cat, setCat] = useState("");
  const [nature, setNature] = useState<"fixed" | "variable">("fixed"); const [rep, setRep] = useState<Rep>("single"); const [target, setTarget] = useState<"account" | "card">("account");
  const [acc, setAcc] = useState(""); const [card, setCard] = useState(""); const [due, setDue] = useState(defaults?.date ?? todayYmd()); const [buy, setBuy] = useState(defaults?.date ?? todayYmd()); const [comp, setComp] = useState("");
  const [freq, setFreq] = useState("monthly"); const [start, setStart] = useState(defaults?.date ?? todayYmd()); const [dd, setDd] = useState(""); const [dd2, setDd2] = useState(""); const [endMode, setEndMode] = useState<"none" | "date" | "count">("none"); const [endDate, setEndDate] = useState(""); const [endCount, setEndCount] = useState("6");
  const [count, setCount] = useState("3"); const [first, setFirst] = useState(defaults?.date ?? todayYmd()); const [essential, setEssential] = useState(false); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false);
  // a cada abertura o formulário começa limpo (nova chave de idempotência; reenviar o MESMO formulário continua sem duplicar)
  useEffect(() => {
    if (!open) return;
    const d = defaults?.date ?? todayYmd();
    setKey(newKey("pfe")); m.clear(); setKind(defaults?.kind ?? "expense"); setDesc(""); setAmount(""); setCat(""); setNature("fixed"); setRep("single"); setTarget("account"); setAcc(""); setCard("");
    setDue(d); setBuy(d); setComp(""); setFreq("monthly"); setStart(d); setDd(""); setDd2(""); setEndMode("none"); setEndDate(""); setEndCount("6"); setCount("3"); setFirst(d); setEssential(false); setNotes("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeAccs = accounts.filter((a) => a.active); const activeCards = cards.filter((c) => c.status === "active");
  const catKind = cats.find((c) => c.id === cat);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); const cents = centsFrom(amount);
    if (desc.trim().length < 2) return m.err("Informe a descrição.");
    if (cents == null || cents <= 0) return m.err(rep === "installment" ? "Informe o valor TOTAL da compra (ex.: 1.200,00)." : nature === "variable" && rep === "recurring" ? "Informe uma estimativa (ex.: 300,00) ou use um valor aproximado." : "Informe o valor (ex.: 150,00).");
    if (target === "card" && !card) return m.err("Escolha o cartão.");
    const p: Record<string, unknown> = { kind, description: desc.trim(), amount_cents: cents, category_id: cat || null, nature, repetition: rep, essential, notes: notes.trim() || null, idempotency_key: key };
    if (kind === "expense" && target === "card") p.card_id = card; else if (acc) p.account_id = acc;
    if (rep === "single") { if (target === "card" && kind === "expense") p.purchase_date = buy; else { p.due_date = due; if (comp) p.competence_date = comp; } }
    if (rep === "recurring") {
      const r: Record<string, unknown> = { frequency: freq, start_date: start, end_mode: endMode };
      if (["monthly", "quarterly", "semiannual", "annual", "semimonthly"].includes(freq) && dd) r.due_day = Number(dd);
      if (freq === "semimonthly") { r.due_day = Number(dd); r.due_day2 = Number(dd2); }
      if (endMode === "date") r.end_date = endDate; if (endMode === "count") r.end_count = Number(endCount);
      p.recurrence = r; if (nature === "variable") p.is_estimate = true;
    }
    if (rep === "installment") p.installments = { count: Number(count), total_cents: cents, first_date: target === "card" && kind === "expense" ? buy : first };
    setBusy(true);
    try { await pfRpc("pf_entry_create", { p }); invalidate(); onSaved?.(); onOpenChange(false); setDesc(""); setAmount(""); setNotes(""); }
    catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto" data-testid="pf-entry-dialog">
        <DialogHeader><DialogTitle>Novo lançamento</DialogTitle><DialogDescription>Receita ou despesa pessoal. “Fixo/variável” é o comportamento do valor; “avulso/recorrente/parcelado” é a repetição — são coisas diferentes.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Msg m={msg} />
          <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-2">
            {(["expense", "income"] as PfKind[]).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setCat(""); if (k === "income") setTarget("account"); }} className={`hp-btn ${kind === k ? "hp-btn-primary" : "hp-btn-outline"}`}>{k === "expense" ? "Despesa" : "Receita"}</button>)}
          </div>
          <div><label htmlFor="pe-desc" className="block text-xs mb-1">Descrição</label><input id="pe-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={140} autoComplete="off" /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <MoneyInput id="pe-amount" value={amount} onChange={setAmount} label={rep === "installment" ? "Valor total da compra" : nature === "variable" && rep === "recurring" ? "Valor estimado por ocorrência" : "Valor"} />
            <CategorySelect id="pe-cat" kind={kind} cats={cats} value={cat} onChange={setCat} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><span className="block text-xs mb-1">Comportamento do valor</span>
              <div role="radiogroup" aria-label="Comportamento do valor" className="flex gap-2">{([["fixed", "Fixo"], ["variable", "Variável"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={nature === k} onClick={() => setNature(k)} className={`hp-btn hp-btn-sm ${nature === k ? "hp-btn-primary" : "hp-btn-outline"}`}>{l}</button>)}</div></div>
            <div><span className="block text-xs mb-1">Repetição</span>
              <div role="radiogroup" aria-label="Repetição" className="flex gap-2 flex-wrap">{([["single", "Avulso"], ["recurring", "Recorrente"], ["installment", "Parcelado"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={rep === k} onClick={() => setRep(k)} className={`hp-btn hp-btn-sm ${rep === k ? "hp-btn-primary" : "hp-btn-outline"}`}>{l}</button>)}</div></div>
          </div>
          {kind === "expense" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label htmlFor="pe-target" className="block text-xs mb-1">Paga com</label>
                <select id="pe-target" value={target} onChange={(e) => setTarget(e.target.value as "account" | "card")}><option value="account">Conta</option><option value="card">Cartão de crédito</option></select></div>
              {target === "card"
                ? <div><label htmlFor="pe-card" className="block text-xs mb-1">Cartão</label><select id="pe-card" value={card} onChange={(e) => setCard(e.target.value)}><option value="">Escolha…</option>{activeCards.map((c) => <option key={c.id} value={c.id}>{c.nickname}</option>)}</select></div>
                : <div><label htmlFor="pe-acc" className="block text-xs mb-1">Conta (opcional agora)</label><select id="pe-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Definir ao pagar</option>{activeAccs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
            </div>
          )}
          {kind === "income" && <div><label htmlFor="pe-acc2" className="block text-xs mb-1">Conta de recebimento (opcional agora)</label><select id="pe-acc2" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Definir ao receber</option>{activeAccs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}

          {rep === "single" && (target === "card" && kind === "expense"
            ? <div><label htmlFor="pe-buy" className="block text-xs mb-1">Data da compra</label><input id="pe-buy" type="date" value={buy} onChange={(e) => setBuy(e.target.value)} /></div>
            : <div className="grid sm:grid-cols-2 gap-3"><div><label htmlFor="pe-due" className="block text-xs mb-1">Vencimento</label><input id="pe-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
                <div><label htmlFor="pe-comp" className="block text-xs mb-1">Competência (opcional)</label><input id="pe-comp" type="date" value={comp} onChange={(e) => setComp(e.target.value)} /></div></div>)}

          {rep === "installment" && (
            <div className="grid sm:grid-cols-2 gap-3 rounded-md border border-border p-3" data-testid="pe-parcelas">
              <div><label htmlFor="pe-count" className="block text-xs mb-1">Quantidade de parcelas</label><input id="pe-count" type="number" min={2} max={360} value={count} onChange={(e) => setCount(e.target.value)} /></div>
              {target === "card" && kind === "expense"
                ? <div><label htmlFor="pe-buy2" className="block text-xs mb-1">Data da compra (1ª parcela)</label><input id="pe-buy2" type="date" value={buy} onChange={(e) => setBuy(e.target.value)} /></div>
                : <div><label htmlFor="pe-first" className="block text-xs mb-1">1º vencimento</label><input id="pe-first" type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></div>}
              <p className="sm:col-span-2 text-xs text-muted-foreground">Os centavos são distribuídos exatamente (a soma das parcelas é o total). Parcelas futuras ficam previstas e entram no custo de vida dos meses delas.</p>
            </div>
          )}

          {rep === "recurring" && (
            <div className="grid sm:grid-cols-2 gap-3 rounded-md border border-border p-3" data-testid="pe-recorrencia">
              <div><label htmlFor="pe-freq" className="block text-xs mb-1">Frequência</label><select id="pe-freq" value={freq} onChange={(e) => setFreq(e.target.value)}>{Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label htmlFor="pe-start" className="block text-xs mb-1">Data inicial</label><input id="pe-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              {["monthly", "quarterly", "semiannual", "annual", "semimonthly"].includes(freq) && <div><label htmlFor="pe-dd" className="block text-xs mb-1">{freq === "semimonthly" ? "1º dia do mês" : "Dia do vencimento"}</label><input id="pe-dd" type="number" min={1} max={31} value={dd} onChange={(e) => setDd(e.target.value)} placeholder="igual ao dia inicial" /></div>}
              {freq === "semimonthly" && <div><label htmlFor="pe-dd2" className="block text-xs mb-1">2º dia do mês</label><input id="pe-dd2" type="number" min={1} max={31} value={dd2} onChange={(e) => setDd2(e.target.value)} /></div>}
              <div><label htmlFor="pe-end" className="block text-xs mb-1">Término</label><select id="pe-end" value={endMode} onChange={(e) => setEndMode(e.target.value as "none" | "date" | "count")}><option value="none">Sem prazo definido</option><option value="count">Após N ocorrências</option><option value="date">Em uma data</option></select></div>
              {endMode === "count" && <div><label htmlFor="pe-ec" className="block text-xs mb-1">Número de ocorrências</label><input id="pe-ec" type="number" min={1} value={endCount} onChange={(e) => setEndCount(e.target.value)} /></div>}
              {endMode === "date" && <div><label htmlFor="pe-ed" className="block text-xs mb-1">Data final</label><input id="pe-ed" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>}
              <p className="sm:col-span-2 text-xs text-muted-foreground">Vencimento nos dias 29, 30 ou 31: em meses menores usa o <strong>último dia do mês</strong>. As ocorrências futuras são calculadas (não são gravadas de uma vez).</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} className="!w-4 !h-4" />Despesa essencial (necessária ao padrão de vida)</label>
          <div><label htmlFor="pe-notes" className="block text-xs mb-1">Observações</label><textarea id="pe-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {catKind && catKind.kind !== kind && <p className="text-xs text-warning">A categoria escolhida é de outro tipo.</p>}
          <DialogFooter><button type="button" className={btnGhost} onClick={() => onOpenChange(false)}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar lançamento"}</button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- liquidar (pagar/receber)
export const SettleDialog = ({ item, onClose, onDone }: { item: PfItem | null; onClose: () => void; onDone?: () => void }) => {
  const { accounts } = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(todayYmd()); const [acc, setAcc] = useState(""); const [final, setFinal] = useState(false); const [key, setKey] = useState(() => newKey("pfs")); const [busy, setBusy] = useState(false);
  useEffect(() => { if (item) { setAmount(item.remaining_cents > 0 ? centsToInput(item.remaining_cents) : ""); setDate(todayYmd()); setAcc(item.account_id ?? ""); setFinal(item.nature === "variable" && (item.is_estimate || item.source === "virtual")); setKey(newKey("pfs")); m.clear?.(); } }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const verb = item.kind === "income" ? "Receber" : "Pagar";
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const cents = centsFrom(amount); if (cents == null || cents <= 0) return m.err("Informe o valor."); if (!acc) return m.err("Escolha a conta.");
    setBusy(true);
    try { await pfRpc("pf_entry_settle", { p_ref: refOf(item), p_amount_cents: cents, p_date: date, p_account: acc, p_final: final, p_key: key }); invalidate(); onDone?.(); onClose(); }
    catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="pf-settle-dialog">
        <DialogHeader><DialogTitle>{verb}: {item.description}</DialogTitle><DialogDescription>{item.kind === "income" ? "Registre o recebimento" : "Registre o pagamento"}. Valor previsto {brl(item.amount_cents)}{item.settled_cents > 0 ? ` · já ${item.kind === "income" ? "recebido" : "pago"} ${brl(item.settled_cents)}` : ""}.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <Msg m={msg} />
          <MoneyInput id="ps-amount" value={amount} onChange={setAmount} label={item.kind === "income" ? "Valor recebido" : "Valor pago"} />
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="ps-date" className="block text-xs mb-1">Data</label><input id="ps-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><label htmlFor="ps-acc" className="block text-xs mb-1">Conta</label><select id="ps-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          </div>
          {item.nature === "variable" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} className="!w-4 !h-4 mt-0.5" /><span>Este é o <strong>valor real</strong> da conta (substitui a previsão de {brl(item.amount_cents)}, que fica guardada no histórico).</span></label>}
          <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : item.kind === "income" ? "Confirmar recebimento" : "Confirmar pagamento"}</button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- editar (somente esta / esta e as próximas / toda a série)
export type Scope = "this" | "following" | "all";
export const EditDialog = ({ item, focusDue, onClose, onDone }: { item: PfItem | null; focusDue?: boolean; onClose: () => void; onDone?: () => void }) => {
  const { cats } = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const [scope, setScope] = useState<Scope>("this"); const [desc, setDesc] = useState(""); const [amount, setAmount] = useState(""); const [due, setDue] = useState(""); const [cat, setCat] = useState(""); const [notes, setNotes] = useState(""); const [freq, setFreq] = useState(""); const [dd, setDd] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (item) { setScope("this"); setDesc(item.description); setAmount(centsToInput(item.amount_cents)); setDue(item.due_date); setCat(item.category_id ?? ""); setNotes(""); setFreq(""); setDd(""); m.clear?.(); } }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const isSeries = !!item.series_id; const locked = item.settled_cents > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const patch: Record<string, unknown> = {};
    if (desc.trim() !== item.description) patch.description = desc.trim();
    const cents = centsFrom(amount); if (cents == null || cents <= 0) return m.err("Informe o valor."); if (cents !== item.amount_cents) patch.amount_cents = cents;
    if (scope === "this" && !item.is_card && due !== item.due_date) patch.due_date = due;
    if ((cat || null) !== item.category_id) patch.category_id = cat || null;
    if (notes.trim()) patch.notes = notes.trim();
    if (scope === "following") { if (freq) patch.frequency = freq; if (dd) patch.due_day = Number(dd); }
    if (Object.keys(patch).length === 0) return m.err("Nada foi alterado.");
    setBusy(true);
    try { await pfRpc("pf_entry_update", { p_ref: refOf(item), p_scope: scope, p_patch: patch }); invalidate(); onDone?.(); onClose(); }
    catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto" data-testid="pf-edit-dialog">
        <DialogHeader><DialogTitle>{focusDue ? "Reagendar" : "Editar"}: {item.description}</DialogTitle><DialogDescription>{locked ? "Já há valor liquidado: valor e data não podem mudar (estorne a liquidação antes). " : ""}O passado liquidado nunca é alterado.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <Msg m={msg} />
          {isSeries && (
            <fieldset className="grid gap-1.5 rounded-md border border-border p-3" data-testid="pf-scope"><legend className="text-xs px-1">Alcance da alteração</legend>
              {([["this", "Somente esta ocorrência"], ["following", "Esta e as próximas (a série é dividida aqui)"], ["all", "Toda a série (sem mexer nas já liquidadas nem nas editadas à parte)"]] as [Scope, string][]).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} className="!w-4 !h-4" />{l}</label>))}
            </fieldset>
          )}
          <div><label htmlFor="ed-desc" className="block text-xs mb-1">Descrição</label><input id="ed-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={140} /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <MoneyInput id="ed-amount" value={amount} onChange={setAmount} label="Valor" />
            {!item.is_card && scope === "this" ? <div><label htmlFor="ed-due" className="block text-xs mb-1">Vencimento{item.due_date !== item.occurrence_date && item.occurrence_date ? ` (original ${fmtYmd(item.occurrence_date)})` : ""}</label><input id="ed-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} autoFocus={focusDue} /></div> : <div />}
          </div>
          <CategorySelect id="ed-cat" kind={item.kind} cats={cats} value={cat} onChange={setCat} />
          {scope === "following" && (
            <div className="grid sm:grid-cols-2 gap-3 rounded-md border border-border p-3"><p className="sm:col-span-2 text-xs text-muted-foreground">Opcional — mudar a regra a partir desta ocorrência:</p>
              <div><label htmlFor="ed-freq" className="block text-xs mb-1">Frequência</label><select id="ed-freq" value={freq} onChange={(e) => setFreq(e.target.value)}><option value="">Manter</option>{Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label htmlFor="ed-dd" className="block text-xs mb-1">Novo dia do vencimento</label><input id="ed-dd" type="number" min={1} max={31} value={dd} onChange={(e) => setDd(e.target.value)} /></div></div>
          )}
          <div><label htmlFor="ed-notes" className="block text-xs mb-1">Observação (substitui a atual)</label><textarea id="ed-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar alteração"}</button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- cancelar
export const CancelDialog = ({ item, onClose, onDone }: { item: PfItem | null; onClose: () => void; onDone?: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [scope, setScope] = useState<"this" | "following">("this"); const [busy, setBusy] = useState(false);
  useEffect(() => { if (item) { setScope("this"); m.clear?.(); } }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const multi = !!item.series_id || item.repetition === "installment";
  const go = async () => {
    setBusy(true);
    try { await pfRpc("pf_entry_cancel", { p_ref: refOf(item), p_scope: scope }); invalidate(); onDone?.(); onClose(); }
    catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="pf-cancel-dialog">
        <DialogHeader><DialogTitle>Cancelar: {item.description}</DialogTitle><DialogDescription>Cancelar não apaga o passado nem o que já foi liquidado.</DialogDescription></DialogHeader>
        <Msg m={msg} />
        {multi && (
          <fieldset className="grid gap-1.5 rounded-md border border-border p-3"><legend className="text-xs px-1">Alcance</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="cs" checked={scope === "this"} onChange={() => setScope("this")} className="!w-4 !h-4" />Somente {item.repetition === "installment" ? "esta parcela" : "esta ocorrência"}</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="cs" checked={scope === "following"} onChange={() => setScope("following")} className="!w-4 !h-4" />{item.repetition === "installment" ? "Esta e as próximas parcelas" : "Encerrar a recorrência a partir desta (esta e as próximas)"}</label>
          </fieldset>
        )}
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Voltar</button><button className="hp-btn hp-btn-danger" onClick={() => void go()} disabled={busy}>{busy ? "Cancelando…" : "Confirmar cancelamento"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- ficha do lançamento (detalhe, histórico, liquidações, comprovante, ações)
interface EntryFull { id: string; kind: PfKind; description: string; category_id: string | null; account_id: string | null; card_id: string | null; invoice_id: string | null; competence_date: string; due_date: string; original_due_date: string; amount_cents: number; estimated_cents: number | null; is_estimate: boolean; nature: "fixed" | "variable"; repetition: "single" | "recurring" | "installment"; series_id: string | null; occurrence_date: string | null; installment_no: number | null; installment_total: number | null; status: PfItem["status"]; settled_cents: number; essential: boolean; notes: string | null; receipt_path: string | null }
export type ItemTarget = { ref: PfRef; date?: string } | null;

const toItem = (e: EntryFull, catName: string | null): PfItem => ({
  key: `e:${e.id}`, source: "entry", entry_id: e.id, series_id: e.series_id, occurrence_date: e.occurrence_date, invoice_id: e.invoice_id, kind: e.kind, description: e.description, category_id: e.category_id, category_name: catName,
  account_id: e.account_id, card_id: e.card_id, cal_date: e.card_id ? e.competence_date : e.due_date, due_date: e.due_date, cash_date: e.card_id ? null : e.due_date, competence_date: e.competence_date, amount_cents: e.amount_cents, settled_cents: e.settled_cents,
  remaining_cents: ["cancelled", "settled"].includes(e.status) ? 0 : Math.max(e.amount_cents - e.settled_cents, 0), status: e.status, nature: e.nature, repetition: e.repetition, is_estimate: e.is_estimate,
  installment: e.installment_no ? `${e.installment_no}/${e.installment_total}` : null, essential: e.essential, cash_in: 0, cash_out: 0, is_card: !!e.card_id, no_estimate: false, overdue: !e.card_id && ["planned", "open", "partial"].includes(e.status) && e.due_date < todayYmd(),
});

export const ItemSheet = ({ target, onClose, onChanged }: { target: ItemTarget; onClose: () => void; onChanged?: () => void }) => {
  const { cats, accounts, cards } = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const [settle, setSettle] = useState<PfItem | null>(null); const [edit, setEdit] = useState<{ item: PfItem; due?: boolean } | null>(null); const [cancel, setCancel] = useState<PfItem | null>(null);
  const loaded = useQuery({
    queryKey: ["pf", "item", JSON.stringify(target)], enabled: !!target,
    queryFn: async (): Promise<{ item: PfItem | null; entry: EntryFull | null }> => {
      const t = target!;
      if (t.ref.entry_id) {
        const { data, error } = await supabase.from("pf_entries").select("id, kind, description, category_id, account_id, card_id, invoice_id, competence_date, due_date, original_due_date, amount_cents, estimated_cents, is_estimate, nature, repetition, series_id, occurrence_date, installment_no, installment_total, status, settled_cents, essential, notes, receipt_path").eq("id", t.ref.entry_id).maybeSingle();
        if (error) throw error; if (!data) return { item: null, entry: null };
        const e = data as EntryFull; return { item: toItem(e, cats.find((c) => c.id === e.category_id)?.name ?? null), entry: e };
      }
      const d = t.ref.occurrence_date ?? t.date!;
      const ag = await pfRpc<{ items: PfItem[] }>("pf_agenda", { p_from: d, p_to: d, p_filters: {} });
      return { item: ag.items.find((i) => i.series_id === t.ref.series_id && i.occurrence_date === t.ref.occurrence_date) ?? null, entry: null };
    },
  });
  const settlements = useQuery({
    queryKey: ["pf", "item-settlements", loaded.data?.entry?.id], enabled: !!loaded.data?.entry,
    queryFn: async () => ((await supabase.from("pf_settlements").select("id, amount_cents, settled_on, voided_at, account_id").eq("entry_id", loaded.data!.entry!.id).order("settled_on")).data ?? []) as { id: string; amount_cents: number; settled_on: string; voided_at: string | null; account_id: string }[],
  });
  const events = useQuery({
    queryKey: ["pf", "item-events", loaded.data?.entry?.id], enabled: !!loaded.data?.entry,
    queryFn: async () => ((await supabase.from("pf_entry_events").select("id, kind, detail, at").eq("entry_id", loaded.data!.entry!.id).order("at", { ascending: false }).limit(20)).data ?? []) as { id: number; kind: string; detail: Record<string, unknown>; at: string }[],
  });
  const item = loaded.data?.item ?? null; const entry = loaded.data?.entry ?? null;
  const after = () => { invalidate(); onChanged?.(); };
  const void_ = async (id: string) => { if (!(await confirmDialog("Estornar liquidação?", "O valor volta a ficar em aberto e o histórico é preservado.", "Estornar", true))) return; try { await pfRpc("pf_settlement_void", { p_id: id }); after(); } catch (err) { m.err(errText(err as { message: string })); } };
  const upload = async (file: File | undefined) => {
    if (!file || !entry) return; if (file.size > 8 * 1024 * 1024) return m.err("O comprovante passa de 8 MB.");
    try {
      const { data: u } = await supabase.auth.getUser(); const uid = u.user?.id; if (!uid) throw new Error("sessão expirada");
      const path = `${uid}/${entry.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_").slice(0, 80)}`;
      const up = await supabase.storage.from("pf-private").upload(path, file, { upsert: false }); if (up.error) throw up.error;
      await pfRpc("pf_entry_set_receipt", { p_entry: entry.id, p_path: path }); m.ok("Comprovante anexado."); after();
    } catch (err) { m.err(errText(err as { message: string })); }
  };
  const openReceipt = async () => { if (!entry?.receipt_path) return; const { data, error } = await supabase.storage.from("pf-private").createSignedUrl(entry.receipt_path, 3600); if (error || !data) return m.err("Não foi possível abrir o comprovante."); window.open(data.signedUrl, "_blank", "noopener"); };
  const acc = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—"; const card = cards.find((c) => c.id === item?.card_id);
  const R = ({ k, v }: { k: string; v: ReactNode }) => <div><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-sm">{v}</dd></div>;

  return (<>
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0" data-testid="pf-item-sheet">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5"><SheetTitle className="text-[1.0625rem]">{item?.description ?? "Lançamento"}</SheetTitle><SheetDescription>{item ? `${item.kind === "income" ? "Receita" : "Despesa"} pessoal` : "Carregando…"}</SheetDescription></SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5 grid gap-4 content-start">
          <State loading={loaded.isLoading} error={loaded.error} empty={!loaded.isLoading && !item} emptyText="Lançamento não encontrado (pode ter sido alterado)." /><Msg m={msg} />
          {item && (<>
            <div className="flex flex-wrap gap-1.5"><StatusBadge i={item} />{item.source === "virtual" && <Badge tone="info">Ocorrência calculada</Badge>}<Badge>{item.nature === "fixed" ? "Valor fixo" : "Valor variável"}</Badge>{item.repetition !== "single" && <Badge>{item.repetition === "recurring" ? "Recorrente" : `Parcela ${item.installment}`}</Badge>}{item.essential && <Badge tone="gold">Essencial</Badge>}</div>
            <dl className="grid grid-cols-2 gap-3">
              <R k="Valor" v={<strong className="tabular">{brl(item.amount_cents)}</strong>} /><R k={item.kind === "income" ? "Recebido" : "Pago"} v={<span className="tabular">{brl(item.settled_cents)}</span>} />
              <R k="Vencimento" v={fmtYmd(item.due_date)} /><R k="Competência" v={fmtYmd(item.competence_date)} />
              <R k="Categoria" v={item.category_name ?? "—"} /><R k={item.is_card ? "Cartão" : "Conta"} v={item.is_card ? (card ? `${card.nickname}${card.last4 ? ` ••${card.last4}` : ""}` : "—") : acc(item.account_id)} />
              {entry?.estimated_cents != null && <R k="Previsão original" v={<span className="tabular">{brl(entry.estimated_cents)}</span>} />}
              {entry && entry.original_due_date !== entry.due_date && <R k="Vencimento original" v={fmtYmd(entry.original_due_date)} />}
            </dl>
            {item.no_estimate && <p className="text-xs text-warning">Esta recorrência variável ainda não tem estimativa: informe o valor ao liquidar.</p>}
            {entry?.notes && <p className="text-sm rounded-md bg-muted/50 p-2.5">{entry.notes}</p>}
            {item.is_card && <p className="text-xs text-muted-foreground">Compra no cartão: a despesa já está registrada. A saída de caixa acontece no pagamento da <Link className="text-accent hover:underline" to="/admin/financeiro/pessoal/contas">fatura</Link>.</p>}
            {item.status !== "cancelled" && (
              <div className="flex flex-wrap gap-2" data-testid="pf-item-actions">
                {!item.is_card && item.status !== "settled" && <button type="button" className={btnPrimary} onClick={() => setSettle(item)}>{item.kind === "income" ? "Receber" : "Pagar"}</button>}
                <button type="button" className={btnGhost} onClick={() => setEdit({ item })}>Editar</button>
                {!item.is_card && item.settled_cents === 0 && <button type="button" className={btnGhost} onClick={() => setEdit({ item, due: true })}>Reagendar</button>}
                <button type="button" className={btnGhost} onClick={() => setCancel(item)}>Cancelar</button>
              </div>
            )}
            {settlements.data && settlements.data.length > 0 && (
              <section><h4 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Liquidações</h4>
                <ul className="grid gap-1.5">{settlements.data.map((s) => <li key={s.id} className="flex items-center justify-between gap-2 text-sm"><span className={s.voided_at ? "line-through text-muted-foreground" : ""}>{fmtYmd(s.settled_on)} · {acc(s.account_id)} · <span className="tabular">{brl(s.amount_cents)}</span></span>{!s.voided_at ? <button type="button" className="text-accent text-sm hover:underline" onClick={() => void void_(s.id)}>Estornar</button> : <Badge>Estornada</Badge>}</li>)}</ul></section>
            )}
            {entry && !entry.card_id && (
              <section><h4 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Comprovante (privado)</h4>
                <div className="flex items-center gap-2 flex-wrap">{entry.receipt_path ? <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void openReceipt()}>Abrir comprovante</button> : <span className="text-sm text-muted-foreground">Nenhum anexado.</span>}
                  <label className={btnGhost + " hp-btn-sm cursor-pointer"}>{entry.receipt_path ? "Trocar" : "Anexar"}<input type="file" className="sr-only" accept="image/*,application/pdf" onChange={(e) => void upload(e.target.files?.[0])} /></label></div></section>
            )}
            {events.data && events.data.length > 0 && (
              <section><h4 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Histórico</h4>
                <ol className="grid gap-1 text-xs text-muted-foreground">{events.data.map((ev) => <li key={ev.id}>{new Date(ev.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })} · {EVENT_LABEL[ev.kind] ?? ev.kind}{ev.kind === "rescheduled" ? ` (${fmtYmd(String(ev.detail.from))} → ${fmtYmd(String(ev.detail.to))})` : ""}</li>)}</ol></section>
            )}
          </>)}
        </div>
      </SheetContent>
    </Sheet>
    <SettleDialog item={settle} onClose={() => setSettle(null)} onDone={after} />
    <EditDialog item={edit?.item ?? null} focusDue={edit?.due} onClose={() => setEdit(null)} onDone={after} />
    <CancelDialog item={cancel} onClose={() => setCancel(null)} onDone={() => { after(); onClose(); }} />
  </>);
};
const EVENT_LABEL: Record<string, string> = { created: "Criado", edited: "Editado", rescheduled: "Reagendado", settled: "Liquidado", settlement_voided: "Liquidação estornada", cancelled: "Cancelado", materialized: "Ocorrência confirmada", series_split: "Série dividida", business_link: "Vinculado a retirada da empresa" };

// ---------------------------------------------------------------- detalhamento de indicador (mesmas linhas do cartão)
export interface KpiRow { row_date: string; description: string; category_name: string | null; amount_cents: number; kind: PfKind; status: string; nature: string; ref: PfRef & { invoice_id?: string } }
export const KpiSheet = ({ trigger, onClose }: { trigger: { kind: string; from: string; to: string; title: string; formula?: string } | null; onClose: () => void }) => {
  const [target, setTarget] = useState<ItemTarget>(null);
  const q = useQuery({ queryKey: ["pf", "kpi-detail", trigger?.kind, trigger?.from, trigger?.to], enabled: !!trigger, queryFn: () => pfRpc<{ total_cents: number; rows: KpiRow[]; count: number }>("pf_kpi_detail", { p_kind: trigger!.kind, p_from: trigger!.from, p_to: trigger!.to }) });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  return (<>
    <Sheet open={!!trigger} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0" data-testid="pf-kpi-sheet">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5"><SheetTitle className="text-[1.0625rem]">{trigger?.title}</SheetTitle><SheetDescription>{trigger?.formula ?? "Lançamentos que compõem o indicador"}</SheetDescription></SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <State loading={q.isLoading} error={q.error} />
          {q.data && (<>
            <p className="text-[2rem] leading-9 font-bold tabular" data-testid="pf-kpi-total">{brl(q.data.total_cents)}</p><p className="text-[13px] text-muted-foreground mt-1">{q.data.count} registro(s) · o total é o mesmo do cartão</p>
            <ul className="grid gap-2 mt-4">
              {rows.length === 0 && <li className="text-sm text-muted-foreground">Nenhum registro neste critério.</li>}
              {rows.map((r, i) => (
                <li key={i} className="hp-card p-3 text-sm flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="font-medium break-words">{r.description}</p><p className="text-xs text-muted-foreground">{fmtYmd(r.row_date)}{r.category_name ? ` · ${r.category_name}` : ""}</p>
                    {(r.ref.entry_id || r.ref.series_id) ? <button type="button" className="text-xs text-accent hover:underline" onClick={() => setTarget({ ref: r.ref, date: r.row_date })}>Abrir lançamento</button> : r.ref.invoice_id ? <Link className="text-xs text-accent hover:underline" to="/admin/financeiro/pessoal/contas">Ver fatura</Link> : null}</div>
                  <p className="tabular font-medium shrink-0">{brl(r.amount_cents)}</p>
                </li>))}
            </ul>
          </>)}
        </div>
      </SheetContent>
    </Sheet>
    <ItemSheet target={target} onClose={() => setTarget(null)} />
  </>);
};

