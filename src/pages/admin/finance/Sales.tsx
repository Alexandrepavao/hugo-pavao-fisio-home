import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime, newKey, parseCents } from "@/lib/format";
import { btnDanger, btnGhost, promptText, errText, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";
import { REC_ST, SALE_ST, type Account, type Pay, type Rec, type Sale } from "./shared";

/** "Vendas e recebimentos": venda contratada (vendas), valor a receber e recebimento efetivo (recebíveis) — conceitos separados, na mesma tela por fluxo de trabalho. */
const FinanceSales = () => {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get("venda") ? "vendas" : "recebiveis");
  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Vendas e recebimentos" hint="Venda contratada, valor a receber e recebimento efetivo são conceitos separados. Valores em reais, calculados em centavos inteiros." />
      <Tabs tabs={[["vendas", "Vendas"], ["recebiveis", "Recebíveis e recebimentos"]]} value={tab} onChange={setTab} />
      {tab === "vendas" && <SalesTab />}
      {tab === "recebiveis" && <Receivables />}
    </div>
  );
};

const SalesTab = () => {
  const [sp] = useSearchParams(); const qc = useQueryClient(); const [msg, m] = useMsg();
  const [person, setPerson] = useState(sp.get("pessoa") ?? ""); const [unit, setUnit] = useState(sp.get("unidade") ?? ""); const [opp] = useState(sp.get("venda") ?? "");
  const [product, setProduct] = useState(""); const [qty, setQty] = useState("1"); const [discount, setDiscount] = useState("0,00"); const [inst, setInst] = useState("1"); const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState(""); const [busy, setBusy] = useState(false);
  const products = useQuery({ queryKey: ["products"], queryFn: async () => (await supabase.from("products").select("id, name, price_cents, kind").eq("active", true).order("name")).data ?? [] });
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });
  const chosen = useQuery({ queryKey: ["person", person], enabled: !!person, queryFn: async () => (await supabase.from("people").select("id, full_name").eq("id", person).single()).data });
  const found = useQuery({ queryKey: ["ppl", search], enabled: search.length >= 2, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? [] });
  const sales = useQuery({ queryKey: ["sales"], queryFn: async () => (await supabase.from("sales").select("id, status, total_cents, discount_cents, installments, sold_at, created_at, unit_id, person:people(full_name)").order("created_at", { ascending: false }).limit(100)).data as unknown as Sale[] });

  const create = async (e: FormEvent) => {
    e.preventDefault(); const disc = parseCents(discount); const pr = products.data?.find((p) => p.id === product);
    if (!person || !unit) return m.err("Selecione a pessoa e a unidade."); if (!pr) return m.err("Selecione o produto."); if (disc == null) return m.err("Desconto inválido.");
    setBusy(true);
    const { error } = await supabase.rpc("sale_create", { p_person: person, p_unit: unit, p_opportunity: opp || null, p_items: [{ product_id: pr.id, qty: Number(qty) || 1 }], p_discount_cents: disc, p_installments: Number(inst) || 1, p_first_due: due });
    setBusy(false); if (error) return m.err(errText(error)); m.ok("Venda criada como pendente. Confirme para gerar contrato e parcelas."); void qc.invalidateQueries({ queryKey: ["sales"] });
  };
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) m.err(errText(error)); else { m.ok(ok); void qc.invalidateQueries({ queryKey: ["sales"] }); } };

  return (<>
    <Msg m={msg} />
    <form onSubmit={create} className="hp-card p-5 mb-6 grid gap-3 sm:grid-cols-3" noValidate>
      <div className="sm:col-span-3 text-sm text-muted-foreground">{opp ? "Venda originada de uma oportunidade (sem recadastro)." : "Nova venda"}</div>
      <div className="sm:col-span-2"><label htmlFor="sp" className="block text-sm mb-1">Pessoa</label>
        <input id="sp"   value={chosen.data?.full_name ?? search} onChange={(e) => { setPerson(""); setSearch(e.target.value); }} />
        {!person && found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border bg-card hover:bg-muted" onClick={() => { setPerson(p.id); if (p.unit_id) setUnit(p.unit_id); }}>{p.full_name}</button>)}</div>
      <div><label htmlFor="su" className="block text-sm mb-1">Unidade</label><select id="su"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Selecione…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="sm:col-span-2"><label htmlFor="pr" className="block text-sm mb-1">Produto</label><select id="pr"   value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Selecione…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} — {brl(p.price_cents)}</option>)}</select></div>
      <div><label htmlFor="qt" className="block text-sm mb-1">Quantidade</label><input id="qt" inputMode="numeric"   value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      <div><label htmlFor="ds" className="block text-sm mb-1">Desconto (R$)</label><input id="ds" inputMode="decimal"   value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
      <div><label htmlFor="in" className="block text-sm mb-1">Parcelas</label><input id="in" inputMode="numeric"   value={inst} onChange={(e) => setInst(e.target.value)} /></div>
      <div><label htmlFor="fd" className="block text-sm mb-1">1º vencimento</label><input id="fd" type="date"   value={due} onChange={(e) => setDue(e.target.value)} /></div>
      <div className="sm:col-span-3"><button disabled={busy} className="hp-btn hp-btn-primary disabled:opacity-60">{busy ? "Criando…" : "Criar venda"}</button></div>
    </form>
    <State loading={sales.isLoading} error={sales.error} empty={sales.data?.length === 0} emptyText="Nenhuma venda registrada." />
    {sales.data && sales.data.length > 0 && <Table head={["Pessoa", "Total", "Desconto", "Parcelas", "Estado", "Data", ""]} right={[1, 2, 3]}>
      {sales.data.map((s) => <tr key={s.id}><Td>{s.person?.full_name}</Td><Td num>{brl(s.total_cents)}</Td><Td num>{brl(s.discount_cents)}</Td><Td num>{s.installments}</Td><Td>{SALE_ST[s.status]}</Td><Td>{fmtDate(s.sold_at ?? s.created_at)}</Td>
        <Td>{s.status === "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={() => act("sale_confirm", { p_sale: s.id }, "Venda confirmada: contrato, parcelas e regras do produto aplicados.")}>Confirmar</button>}
          {s.status !== "cancelled" && <button className={btnDanger + " hp-btn-sm ml-2"} onClick={async () => { const r = await promptText("Cancelar venda", "Motivo do cancelamento", { multiline: true, confirmLabel: "Cancelar venda", danger: true }); if (r) void act("sale_cancel", { p_sale: s.id, p_reason: r }, "Venda cancelada."); }}>Cancelar</button>}</Td></tr>)}</Table>}
  </>);
};

const Receivables = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [filter, setFilter] = useState("aberto"); const [pay, setPay] = useState<Rec | null>(null);
  const recs = useQuery({ queryKey: ["recs"], queryFn: async () => (await supabase.from("receivables").select("id, installment_no, installments_total, due_date, amount_cents, status, sale_id, person:people(full_name)").order("due_date").limit(300)).data as unknown as Rec[] });
  const pays = useQuery({ queryKey: ["pays"], queryFn: async () => (await supabase.from("payments").select("id, kind, amount_cents, paid_at, method, receivable_id, refund_of").order("paid_at", { ascending: false }).limit(300)).data as Pay[] });
  const today = new Date().toISOString().slice(0, 10);
  const rows = (recs.data ?? []).filter((r) => filter === "todos" ? true : filter === "vencidos" ? ["open", "partial"].includes(r.status) && r.due_date < today : filter === "pagos" ? r.status === "paid" : ["open", "partial"].includes(r.status));
  const net = (id: string) => (pays.data ?? []).filter((p) => p.receivable_id === id).reduce((a, p) => a + (p.kind === "payment" ? p.amount_cents : -p.amount_cents), 0);
  const refund = async (p: Pay) => {
    const v = await promptText("Estornar recebimento", `Valor do estorno em R$ (máximo ${brl(p.amount_cents)})`, { defaultValue: (p.amount_cents / 100).toFixed(2).replace(".", ",") }); const cents = v ? parseCents(v) : null; if (cents == null) return;
    const reason = await promptText("Motivo do estorno", "Motivo (obrigatório)", { multiline: true, confirmLabel: "Estornar", danger: true }); if (!reason) return;
    const { error } = await supabase.rpc("payment_refund", { p_payment: p.id, p_amount_cents: cents, p_reason: reason, p_idempotency_key: newKey("refund") });
    if (error) m.err(errText(error)); else { m.ok("Estorno registrado."); void qc.invalidateQueries(); }
  };
  return (<>
    <Msg m={msg} />
    <div className="mb-4 flex gap-2">{[["aberto", "Em aberto"], ["vencidos", "Vencidos"], ["pagos", "Pagos"], ["todos", "Todos"]].map(([k, l]) => <button key={k} className={filter === k ? "hp-btn hp-btn-primary" : btnGhost} onClick={() => setFilter(k)}>{l}</button>)}</div>
    {pay && <PayForm rec={pay} balance={pay.amount_cents - net(pay.id)} onClose={() => setPay(null)} onDone={() => { setPay(null); m.ok("Recebimento registrado."); void qc.invalidateQueries(); }} />}
    <State loading={recs.isLoading} error={recs.error} empty={rows.length === 0} emptyText="Nenhuma parcela neste filtro." />
    {rows.length > 0 && <Table head={["Pessoa", "Parcela", "Vencimento", "Valor", "Recebido (líquido)", "Estado", ""]} right={[3, 4]}>
      {rows.map((r) => <tr key={r.id}><Td>{r.person?.full_name}</Td><Td>{r.installment_no}/{r.installments_total}</Td><Td><span className={["open", "partial"].includes(r.status) && r.due_date < today ? "text-destructive" : ""}>{fmtDate(r.due_date + "T12:00:00Z")}</span></Td>
        <Td num>{brl(r.amount_cents)}</Td><Td num>{brl(net(r.id))}</Td><Td>{REC_ST[r.status]}</Td><Td>{["open", "partial"].includes(r.status) && <button className={btnGhost + " hp-btn-sm"} onClick={() => setPay(r)}>Receber</button>}</Td></tr>)}</Table>}
    <h2 className="text-xl mt-10 mb-3">Últimos recebimentos e estornos</h2>
    {pays.data && pays.data.length > 0 ? <Table head={["Data", "Tipo", "Valor", "Forma", ""]} right={[2]}>
      {pays.data.slice(0, 30).map((p) => <tr key={p.id}><Td>{fmtDateTime(p.paid_at)}</Td><Td>{p.kind === "payment" ? "Recebimento" : "Estorno"}</Td><Td num>{brl(p.amount_cents)}</Td><Td>{p.method ?? "—"}</Td><Td>{p.kind === "payment" && <button className="text-destructive text-sm" onClick={() => refund(p)}>Estornar</button>}</Td></tr>)}</Table> : <p className="text-muted-foreground">Sem movimentos.</p>}
  </>);
};

const PayForm = ({ rec, balance, onClose, onDone }: { rec: Rec; balance: number; onClose: () => void; onDone: () => void }) => {
  const [amount, setAmount] = useState((balance / 100).toFixed(2).replace(".", ",")); const [method, setMethod] = useState("pix"); const [acct, setAcct] = useState(""); const [key] = useState(() => newKey("pay"));
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: async () => (await supabase.from("financial_accounts").select("id, name").eq("active", true)).data as Account[] });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); const cents = parseCents(amount); if (cents == null || cents <= 0) return setErr("Valor inválido."); setBusy(true);
    const { error } = await supabase.rpc("payment_record", { p_receivable: rec.id, p_amount_cents: cents, p_paid_at: new Date().toISOString(), p_method: method, p_account: acct || null, p_idempotency_key: key });
    setBusy(false); error ? setErr(errText(error)) : onDone();
  };
  return (
    <form onSubmit={submit} className="bg-card border border-accent p-4 mb-4 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <p className="sm:col-span-4">Recebimento de <strong>{rec.person?.full_name}</strong> — parcela {rec.installment_no}/{rec.installments_total} (saldo {brl(balance)}). Recebimento parcial é permitido; repetir o envio não duplica.</p>
      <div><label htmlFor="pa" className="block text-xs mb-1">Valor (R$)</label><input id="pa"   value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label htmlFor="pm" className="block text-xs mb-1">Forma</label><select id="pm"   value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="transferencia">Transferência</option></select></div>
      <div><label htmlFor="pc" className="block text-xs mb-1">Conta</label><select id="pc"   value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">Sem conta</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="flex gap-2"><button disabled={busy} className="hp-btn hp-btn-primary disabled:opacity-60">Registrar</button><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button></div>
      {err && <p role="alert" className="sm:col-span-4 text-sm text-destructive">{err}</p>}
    </form>
  );
};

export default FinanceSales;
