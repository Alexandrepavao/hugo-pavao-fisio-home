import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Lock, Pencil, Plus } from "lucide-react";
import { brl, newKey } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Badge, EmptyState, Msg, PageHead, State, Table, Tabs, Td, btnGhost, btnPrimary, confirmDialog, errText, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCOUNT_KIND, fmtYmd, pfRpc, todayYmd, type PfAccount } from "./pf";
import { MoneyInput, centsFrom, centsToInput, useInvalidatePf, usePfRefs } from "./PfShared";

interface Inv { id: string; cycle_start: string; closing_date: string; due_date: string; total_cents: number; paid_cents: number; state: "aberta" | "fechada" | "paga" }
interface CardOv { id: string; nickname: string; issuer: string; brand: string; last4: string | null; status: string; limit_cents: number; closing_day: number; due_day: number; pay_account_id: string | null; used_cents: number; available_cents: number;
  current_invoice: { id: string; closing_date: string; due_date: string; total_cents: number; paid_cents: number } | null; invoices: Inv[]; future_purchases_cents: number; due_next_30_cents: number }
const BRANDS: [string, string][] = [["visa", "Visa"], ["mastercard", "Mastercard"], ["elo", "Elo"], ["amex", "American Express"], ["hipercard", "Hipercard"], ["outra", "Outra"]];
const BRAND_LABEL = Object.fromEntries(BRANDS) as Record<string, string>;
const KIND_LABEL = { transfer: "Transferência", reserve: "Aporte na reserva", goal: "Aporte em meta", investment: "Investimento" } as const;

/** Representação visual SEGURA do cartão (mesma identidade dos cartões da empresa): só apelido, emissor, bandeira (texto) e 4 últimos dígitos. O limite não é dinheiro disponível. */
const CardVisual = ({ c, selected, onSelect }: { c: CardOv; selected: boolean; onSelect: () => void }) => {
  const used = Math.min(100, Math.max(0, Math.round((c.used_cents / c.limit_cents) * 100)));
  return (
    <li className="list-none">
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`Cartão ${c.nickname}${c.status === "blocked" ? " (bloqueado)" : ""}`} className={`hp-ccard-wrap w-full text-left ${selected ? "is-selected" : ""}`} data-testid="pf-cartao">
        <span className={`hp-ccard hp-ccard-${c.brand}${c.status !== "active" ? " is-blocked" : ""}`}>
          <span className="flex items-start justify-between gap-2"><span className="font-bold text-[13px] leading-4">{c.issuer}</span><span className="text-[11px] font-semibold tracking-wider uppercase opacity-90">{BRAND_LABEL[c.brand] ?? c.brand}</span></span>
          <span aria-hidden className="hp-ccard-chip" />
          <span className="tabular tracking-[.18em] text-[15px] font-semibold">•••• •••• •••• {c.last4 ?? "••••"}</span>
          <span className="flex items-end justify-between gap-2"><span className="min-w-0"><span className="block font-bold text-[14px] leading-5 truncate">{c.nickname}</span></span><span className="text-[11px] opacity-90 text-right leading-4 shrink-0">Fecha dia {c.closing_day}<br />Vence dia {c.due_day}</span></span>
          {c.status !== "active" && <span className="hp-ccard-lock"><Lock size={14} aria-hidden />{c.status === "blocked" ? "Bloqueado" : "Encerrado"}</span>}
        </span>
        <span className="block px-1 pt-3">
          <span className="flex items-baseline justify-between text-xs text-muted-foreground"><span>Limite disponível</span><span className="tabular font-bold text-foreground text-sm">{brl(Math.max(0, c.available_cents))}</span></span>
          <span className="hp-rank-bar block mt-1.5" role="img" aria-label={`${used}% do limite em uso`}><i style={{ width: `${Math.max(used, 2)}%`, ["--rc" as string]: used >= 85 ? "var(--destructive)" : used >= 60 ? "var(--warning)" : "var(--chart-2)" }} /></span>
          <span className="flex justify-between text-[11px] text-muted-foreground mt-1.5"><span>Limite {brl(c.limit_cents)}</span><span>Usado {brl(c.used_cents)}</span></span>
        </span>
      </button>
    </li>
  );
};

const PfAccounts = () => {
  const [sp, setSp] = useSearchParams(); const tab = ["contas", "cartoes", "movimentacoes"].includes(sp.get("aba") ?? "") ? sp.get("aba")! : "contas";
  const refs = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const accounts = useQuery({ queryKey: ["pf", "accounts-ov"], queryFn: () => pfRpc<{ accounts: (PfAccount & { balance_cents: number })[]; total_cents: number }>("pf_accounts_overview") });
  const cards = useQuery({ queryKey: ["pf", "cards-ov"], queryFn: () => pfRpc<{ cards: CardOv[] }>("pf_cards_overview") });
  const [selCard, setSelCard] = useState(""); const [accDlg, setAccDlg] = useState<{ edit: (PfAccount & { balance_cents?: number }) | null } | null>(null); const [cardDlg, setCardDlg] = useState<{ edit: CardOv | null } | null>(null);
  const [trDlg, setTrDlg] = useState(false); const [payInv, setPayInv] = useState<{ card: CardOv; inv: Inv } | null>(null);
  const cardList = useMemo(() => cards.data?.cards ?? [], [cards.data]);
  useEffect(() => { if (cardList.length && !cardList.some((c) => c.id === selCard)) setSelCard(cardList[0].id); }, [cardList, selCard]);
  const sel = cardList.find((c) => c.id === selCard);
  const purchases = useQuery({ queryKey: ["pf", "card-purchases", selCard], enabled: !!selCard && tab === "cartoes", queryFn: async () => (supabase.from("pf_entries").select("id, description, competence_date, amount_cents, installment_no, installment_total, status, invoice_id").eq("card_id", selCard).neq("status", "cancelled").order("competence_date", { ascending: false }).limit(80).then((r) => r.data ?? [])) as Promise<{ id: string; description: string; competence_date: string; amount_cents: number; installment_no: number | null; installment_total: number | null; status: string; invoice_id: string }[]> });
  const transfers = useQuery({ queryKey: ["pf", "transfers"], enabled: tab === "movimentacoes", queryFn: async () => (await pfRpc<{ transfers: { id: string; on_date: string; amount_cents: number; kind: keyof typeof KIND_LABEL; from: string; to: string; note: string | null; voided: boolean }[] }>("pf_transfers_list", { p_from: "2000-01-01", p_to: todayYmd() })).transfers });
  const setTab = (v: string) => { const n = new URLSearchParams(sp); n.set("aba", v); setSp(n, { replace: true }); };
  const voidTransfer = async (id: string) => { if (!(await confirmDialog("Estornar movimentação?", "Os saldos voltam ao que eram antes dela.", "Estornar", true))) return; try { await pfRpc("pf_transfer_void", { p_id: id }); invalidate(); } catch (err) { m.err(errText(err as { message: string })); } };

  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Contas e cartões" hint="Saldos, limites, faturas e movimentações patrimoniais. Transferência entre contas suas e aporte em reserva não são receita nem custo de vida; o limite do cartão não é dinheiro disponível."
        actions={<div className="flex gap-2"><button type="button" className={btnGhost} onClick={() => setTrDlg(true)}><ArrowLeftRight size={16} aria-hidden />Transferir / aportar</button><button type="button" className={btnPrimary} onClick={() => tab === "cartoes" ? setCardDlg({ edit: null }) : setAccDlg({ edit: null })}><Plus size={16} aria-hidden />{tab === "cartoes" ? "Novo cartão" : "Nova conta"}</button></div>} />
      <Tabs tabs={[["contas", "Contas"], ["cartoes", "Cartões e faturas"], ["movimentacoes", "Movimentações"]]} value={tab} onChange={setTab} /><Msg m={msg} />

      {tab === "contas" && (<>
        <State loading={accounts.isLoading} error={accounts.error} />
        {accounts.data && accounts.data.accounts.length === 0 && <EmptyState title="Nenhuma conta cadastrada">Cadastre sua conta corrente, poupança ou dinheiro, com o saldo inicial.</EmptyState>}
        {accounts.data && accounts.data.accounts.length > 0 && (<>
          <p className="text-sm mb-3">Saldo total das contas ativas: <strong className="tabular" data-testid="pf-saldo-total">{brl(accounts.data.total_cents)}</strong></p>
          <Table head={["Conta", "Tipo", "Saldo inicial", "Saldo atual", "Reserva", ""]} right={[2, 3]}>
            {accounts.data.accounts.map((a) => (
              <tr key={a.id} data-testid="pf-conta"><Td><strong>{a.name}</strong>{!a.active && <Badge>Inativa</Badge>}</Td><Td>{ACCOUNT_KIND[a.kind]}</Td><Td num>{brl(a.opening_balance_cents)}<div className="text-xs text-muted-foreground">em {fmtYmd(a.opening_date)}</div></Td>
                <Td num><strong>{brl(a.balance_cents)}</strong></Td><Td>{a.counts_for_reserve ? <Badge tone="success">Compõe a reserva</Badge> : "—"}</Td><Td><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setAccDlg({ edit: a })}><Pencil size={13} aria-hidden />Editar</button></Td></tr>))}
          </Table></>)}
      </>)}

      {tab === "cartoes" && (<>
        <State loading={cards.isLoading} error={cards.error} />
        {cards.data && cardList.length === 0 && <EmptyState title="Nenhum cartão cadastrado">Cadastre apelido, emissor, bandeira, limite e dias de fechamento e vencimento. Nunca informe o número completo.</EmptyState>}
        {sel && (
          <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
            <ul className="grid gap-5 content-start">{cardList.map((c) => <CardVisual key={c.id} c={c} selected={c.id === selCard} onSelect={() => setSelCard(c.id)} />)}</ul>
            <div className="grid gap-4 content-start">
              <div className="hp-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm" data-testid="pf-cartao-resumo">
                <div><p className="text-xs text-muted-foreground">Limite</p><p className="tabular font-semibold">{brl(sel.limit_cents)}</p></div>
                <div><p className="text-xs text-muted-foreground">Utilizado (faturas em aberto)</p><p className="tabular font-semibold">{brl(sel.used_cents)}</p></div>
                <div><p className="text-xs text-muted-foreground">Disponível</p><p className="tabular font-semibold">{brl(sel.available_cents)}</p></div>
                <div><p className="text-xs text-muted-foreground">Vence em 30 dias</p><p className="tabular font-semibold">{brl(sel.due_next_30_cents)}</p></div>
                <div className="col-span-2"><p className="text-xs text-muted-foreground">Fatura atual</p><p className="tabular font-semibold">{sel.current_invoice ? `${brl(sel.current_invoice.total_cents)} · vence ${fmtYmd(sel.current_invoice.due_date)}` : "sem compras no ciclo"}</p></div>
                <div className="col-span-2"><p className="text-xs text-muted-foreground">Compras e parcelas futuras</p><p className="tabular font-semibold">{brl(sel.future_purchases_cents)}</p></div>
                <div className="col-span-2 sm:col-span-4 flex gap-2 pt-1"><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setCardDlg({ edit: sel })}><Pencil size={13} aria-hidden />Editar cartão</button></div>
              </div>
              <section><h3 className="text-sm font-medium mb-2">Faturas</h3>
                <Table head={["Fatura (ciclo)", "Fecha", "Vence", "Total", "Pago", "Situação", ""]} right={[3, 4]}>
                  {sel.invoices.map((i) => (
                    <tr key={i.id} data-testid="pf-fatura"><Td>{fmtYmd(i.cycle_start)}</Td><Td>{fmtYmd(i.closing_date)}</Td><Td>{fmtYmd(i.due_date)}</Td><Td num>{brl(i.total_cents)}</Td><Td num>{brl(i.paid_cents)}</Td>
                      <Td><Badge tone={i.state === "paga" ? "success" : i.state === "fechada" ? "warning" : "neutral"}>{i.state === "paga" ? "Paga" : i.state === "fechada" ? "Fechada" : "Aberta"}</Badge></Td>
                      <Td>{i.paid_cents < i.total_cents ? <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setPayInv({ card: sel, inv: i })}>Pagar fatura</button> : null}</Td></tr>))}
                </Table>
                <p className="text-xs text-muted-foreground mt-1">Pagar a fatura liquida a obrigação sem criar nova despesa: cada compra já foi contada na data dela.</p></section>
              <section><h3 className="text-sm font-medium mb-2">Compras e parcelas</h3>
                {(purchases.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma compra neste cartão.</p> : (
                  <Table head={["Data", "Descrição", "Valor", "Situação"]} right={[2]}>{(purchases.data ?? []).map((p) => <tr key={p.id}><Td>{fmtYmd(p.competence_date)}</Td><Td>{p.description}{p.installment_no ? ` (${p.installment_no}/${p.installment_total})` : ""}</Td><Td num>{brl(p.amount_cents)}</Td><Td><Badge tone={p.status === "settled" ? "success" : "neutral"}>{p.status === "settled" ? "Fatura paga" : "Na fatura"}</Badge></Td></tr>)}</Table>)}
              </section>
            </div>
          </div>
        )}
      </>)}

      {tab === "movimentacoes" && (<>
        <State loading={transfers.isLoading} error={transfers.error} empty={transfers.data?.length === 0} emptyText="Nenhuma transferência ou aporte registrado." />
        {transfers.data && transfers.data.length > 0 && (
          <Table head={["Data", "Tipo", "De", "Para", "Valor", ""]} right={[4]}>
            {transfers.data.map((t) => <tr key={t.id} className={t.voided ? "opacity-60 line-through" : undefined}><Td>{fmtYmd(t.on_date)}</Td><Td>{KIND_LABEL[t.kind]}{t.note ? <div className="text-xs text-muted-foreground">{t.note}</div> : null}</Td><Td>{t.from}</Td><Td>{t.to}</Td><Td num>{brl(t.amount_cents)}</Td><Td>{!t.voided ? <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void voidTransfer(t.id)}>Estornar</button> : <Badge>Estornada</Badge>}</Td></tr>)}
          </Table>)}
      </>)}

      {accDlg && <AccountDialog edit={accDlg.edit} onClose={() => setAccDlg(null)} />}
      {cardDlg && <CardDialog edit={cardDlg.edit} accounts={refs.accounts} onClose={() => setCardDlg(null)} />}
      {trDlg && <TransferDialog accounts={refs.accounts.filter((a) => a.active)} onClose={() => setTrDlg(false)} />}
      {payInv && <PayInvoiceDialog card={payInv.card} inv={payInv.inv} accounts={refs.accounts.filter((a) => a.active)} onClose={() => setPayInv(null)} />}
    </div>
  );
};

const AccountDialog = ({ edit, onClose }: { edit: (PfAccount & { balance_cents?: number }) | null; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [name, setName] = useState(edit?.name ?? ""); const [kind, setKind] = useState(edit?.kind ?? "checking"); const [opening, setOpening] = useState(edit ? centsToInput(edit.opening_balance_cents) : "0,00");
  const [date, setDate] = useState(edit?.opening_date ?? todayYmd()); const [reserve, setReserve] = useState(edit?.counts_for_reserve ?? false); const [active, setActive] = useState(edit?.active ?? true); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const c = opening.trim().startsWith("-") ? -(centsFrom(opening.trim().slice(1)) ?? NaN) : centsFrom(opening); if (c == null || Number.isNaN(c)) return m.err("Informe o saldo inicial (ex.: 1.500,00).");
    setBusy(true); try { await pfRpc("pf_account_save", { p_id: edit?.id ?? null, p_name: name, p_kind: kind, p_opening_cents: c, p_opening_date: date, p_reserve: reserve, p_active: active }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md" data-testid="pf-conta-dialog">
      <DialogHeader><DialogTitle>{edit ? "Editar conta" : "Nova conta"}</DialogTitle><DialogDescription>O saldo inicial vale na data informada; os movimentos a partir dela alteram o saldo.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div><label htmlFor="ac-name" className="block text-xs mb-1">Nome</label><input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="ac-kind" className="block text-xs mb-1">Tipo</label><select id="ac-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(ACCOUNT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="ac-date" className="block text-xs mb-1">Data do saldo inicial</label><input id="ac-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
        <MoneyInput id="ac-open" value={opening} onChange={setOpening} label="Saldo inicial" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} className="!w-4 !h-4" />Esta conta compõe a reserva de emergência</label>
        {edit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="!w-4 !h-4" />Conta ativa</label>}
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar conta"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};

const CardDialog = ({ edit, accounts, onClose }: { edit: CardOv | null; accounts: PfAccount[]; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [nick, setNick] = useState(edit?.nickname ?? ""); const [issuer, setIssuer] = useState(edit?.issuer ?? ""); const [brand, setBrand] = useState(edit?.brand ?? "visa");
  const [last4, setLast4] = useState(edit?.last4 ?? ""); const [limit, setLimit] = useState(edit ? centsToInput(edit.limit_cents) : ""); const [closing, setClosing] = useState(String(edit?.closing_day ?? 10)); const [due, setDue] = useState(String(edit?.due_day ?? 20));
  const [acc, setAcc] = useState(edit?.pay_account_id ?? ""); const [status, setStatus] = useState(edit?.status ?? "active"); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const c = centsFrom(limit); if (c == null || c <= 0) return m.err("Informe o limite do cartão.");
    setBusy(true); try { await pfRpc("pf_card_save", { p_id: edit?.id ?? null, p_nickname: nick, p_issuer: issuer, p_brand: brand, p_limit_cents: c, p_closing_day: Number(closing), p_due_day: Number(due), p_last4: last4 || null, p_pay_account: acc || null, p_status: status }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto" data-testid="pf-cartao-dialog">
      <DialogHeader><DialogTitle>{edit ? "Editar cartão" : "Novo cartão"}</DialogTitle><DialogDescription>Só os 4 últimos dígitos: nunca o número completo, CVV ou senhas.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="cd-nick" className="block text-xs mb-1">Apelido</label><input id="cd-nick" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} /></div><div><label htmlFor="cd-iss" className="block text-xs mb-1">Emissor</label><input id="cd-iss" value={issuer} onChange={(e) => setIssuer(e.target.value)} maxLength={60} /></div></div>
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="cd-brand" className="block text-xs mb-1">Bandeira</label><select id="cd-brand" value={brand} onChange={(e) => setBrand(e.target.value)}>{BRANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div><div><label htmlFor="cd-l4" className="block text-xs mb-1">4 últimos dígitos (opcional)</label><input id="cd-l4" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" /></div></div>
        <MoneyInput id="cd-limit" value={limit} onChange={setLimit} label="Limite" />
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="cd-clo" className="block text-xs mb-1">Dia de fechamento (1–28)</label><input id="cd-clo" type="number" min={1} max={28} value={closing} onChange={(e) => setClosing(e.target.value)} /></div><div><label htmlFor="cd-due" className="block text-xs mb-1">Dia de vencimento (1–28)</label><input id="cd-due" type="number" min={1} max={28} value={due} onChange={(e) => setDue(e.target.value)} /></div></div>
        <div><label htmlFor="cd-acc" className="block text-xs mb-1">Conta que paga a fatura (opcional)</label><select id="cd-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">—</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        {edit && <div><label htmlFor="cd-st" className="block text-xs mb-1">Situação</label><select id="cd-st" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Ativo</option><option value="blocked">Bloqueado</option><option value="closed">Encerrado</option></select></div>}
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Salvar cartão"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};

const TransferDialog = ({ accounts, onClose }: { accounts: PfAccount[]; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [amount, setAmount] = useState(""); const [date, setDate] = useState(todayYmd());
  const [kind, setKind] = useState<keyof typeof KIND_LABEL>("transfer"); const [note, setNote] = useState(""); const [key] = useState(() => newKey("pft")); const [busy, setBusy] = useState(false);
  const goals = useQuery({ queryKey: ["pf", "goals-list"], queryFn: async () => ((await supabase.from("pf_goals").select("id, name").eq("active", true)).data ?? []) as { id: string; name: string }[] }); const [goal, setGoal] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const c = centsFrom(amount); if (c == null || c <= 0) return m.err("Informe o valor."); if (!from || !to) return m.err("Escolha as duas contas.");
    setBusy(true); try { await pfRpc("pf_transfer_create", { p_from: from, p_to: to, p_amount_cents: c, p_date: date, p_kind: kind, p_goal: kind === "goal" ? goal || null : null, p_note: note || null, p_key: key }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md" data-testid="pf-transfer-dialog">
      <DialogHeader><DialogTitle>Transferir ou aportar</DialogTitle><DialogDescription>Movimentação entre as suas contas: não é receita nem despesa e não entra no custo de vida.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div><label htmlFor="tr-kind" className="block text-xs mb-1">Tipo</label><select id="tr-kind" value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KIND_LABEL)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="tr-from" className="block text-xs mb-1">De</label><select id="tr-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Escolha…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label htmlFor="tr-to" className="block text-xs mb-1">Para</label><select id="tr-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Escolha…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        {kind === "goal" && <div><label htmlFor="tr-goal" className="block text-xs mb-1">Meta</label><select id="tr-goal" value={goal} onChange={(e) => setGoal(e.target.value)}><option value="">Escolha…</option>{(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>}
        <div className="grid grid-cols-2 gap-3"><MoneyInput id="tr-amount" value={amount} onChange={setAmount} label="Valor" /><div><label htmlFor="tr-date" className="block text-xs mb-1">Data</label><input id="tr-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
        <div><label htmlFor="tr-note" className="block text-xs mb-1">Observação</label><input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Registrar"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};

const PayInvoiceDialog = ({ card, inv, accounts, onClose }: { card: CardOv; inv: Inv; accounts: PfAccount[]; onClose: () => void }) => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [amount, setAmount] = useState(centsToInput(inv.total_cents - inv.paid_cents)); const [date, setDate] = useState(todayYmd()); const [acc, setAcc] = useState(card.pay_account_id ?? ""); const [key] = useState(() => newKey("pfi")); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const c = centsFrom(amount); if (c == null || c <= 0) return m.err("Informe o valor."); if (!acc) return m.err("Escolha a conta de pagamento.");
    setBusy(true); try { await pfRpc("pf_invoice_pay", { p_invoice: inv.id, p_account: acc, p_amount_cents: c, p_paid_on: date, p_key: key }); invalidate(); onClose(); } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md" data-testid="pf-fatura-dialog">
      <DialogHeader><DialogTitle>Pagar fatura — {card.nickname}</DialogTitle><DialogDescription>Vence {fmtYmd(inv.due_date)} · total {brl(inv.total_cents)} · falta {brl(inv.total_cents - inv.paid_cents)}. O pagamento sai da conta e liquida a obrigação; não cria nova despesa.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <MoneyInput id="pi-amount" value={amount} onChange={setAmount} label="Valor pago" />
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="pi-date" className="block text-xs mb-1">Data</label><input id="pi-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></div><div><label htmlFor="pi-acc" className="block text-xs mb-1">Conta</label><select id="pi-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Escolha…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Salvando…" : "Confirmar pagamento"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};

export default PfAccounts;
