import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime, newKey, parseCents } from "@/lib/format";
import { btnDanger, btnGhost, promptText, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Sale { id: string; status: string; total_cents: number; discount_cents: number; installments: number; sold_at: string | null; created_at: string; unit_id: string; person: { full_name: string } | null }
interface Rec { id: string; installment_no: number; installments_total: number; due_date: string; amount_cents: number; status: string; sale_id: string; person: { full_name: string } | null }
interface Pay { id: string; kind: string; amount_cents: number; paid_at: string; method: string | null; receivable_id: string; refund_of: string | null }
interface Account { id: string; name: string }
const SALE_ST: Record<string, string> = { pending: "Pendente", confirmed: "Confirmada", cancelled: "Cancelada" };
const REC_ST: Record<string, string> = { open: "Em aberto", partial: "Parcial", paid: "Paga", cancelled: "Cancelada", refunded: "Estornada" };

const Finance = () => {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get("venda") ? "vendas" : "recebiveis");
  return (
    <div>
      <PageHead eyebrow="HP Finance" title="Vendas e financeiro" hint="Venda contratada, valor a receber, recebimento efetivo, serviço realizado e receita reconhecida são conceitos separados. Valores em reais, calculados em centavos inteiros." />
      <Tabs tabs={[["vendas", "Vendas"], ["recebiveis", "Recebíveis e recebimentos"], ["pagar", "Contas a pagar"], ["comissoes", "Comissões"], ["projecao", "Projeção de mensalidades"]]} value={tab} onChange={setTab} />
      {tab === "vendas" && <Sales />}
      {tab === "recebiveis" && <Receivables />}
      {tab === "pagar" && <Payables />}
      {tab === "comissoes" && <Commissions />}
      {tab === "projecao" && <Forecast />}
    </div>
  );
};

const Sales = () => {
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
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); error ? m.err(errText(error)) : (m.ok(ok), void qc.invalidateQueries({ queryKey: ["sales"] })); };

  return (<>
    <Msg m={msg} />
    <form onSubmit={create} className="bg-card border border-border p-5 mb-6 grid gap-3 sm:grid-cols-3" noValidate>
      <div className="sm:col-span-3 text-sm text-navy-400">{opp ? "Venda originada de uma oportunidade (sem recadastro)." : "Nova venda"}</div>
      <div className="sm:col-span-2"><label htmlFor="sp" className="block text-sm mb-1">Pessoa</label>
        <input id="sp" className={inputCls} value={chosen.data?.full_name ?? search} onChange={(e) => { setPerson(""); setSearch(e.target.value); }} />
        {!person && found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border bg-card hover:bg-muted" onClick={() => { setPerson(p.id); if (p.unit_id) setUnit(p.unit_id); }}>{p.full_name}</button>)}</div>
      <div><label htmlFor="su" className="block text-sm mb-1">Unidade</label><select id="su" className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Selecione…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="sm:col-span-2"><label htmlFor="pr" className="block text-sm mb-1">Produto</label><select id="pr" className={inputCls} value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Selecione…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} — {brl(p.price_cents)}</option>)}</select></div>
      <div><label htmlFor="qt" className="block text-sm mb-1">Quantidade</label><input id="qt" inputMode="numeric" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
      <div><label htmlFor="ds" className="block text-sm mb-1">Desconto (R$)</label><input id="ds" inputMode="decimal" className={inputCls} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
      <div><label htmlFor="in" className="block text-sm mb-1">Parcelas</label><input id="in" inputMode="numeric" className={inputCls} value={inst} onChange={(e) => setInst(e.target.value)} /></div>
      <div><label htmlFor="fd" className="block text-sm mb-1">1º vencimento</label><input id="fd" type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></div>
      <div className="sm:col-span-3"><button disabled={busy} className="btn-primary !py-3 disabled:opacity-60">{busy ? "Criando…" : "Criar venda"}</button></div>
    </form>
    <State loading={sales.isLoading} error={sales.error} empty={sales.data?.length === 0} emptyText="Nenhuma venda registrada." />
    {sales.data && sales.data.length > 0 && <Table head={["Pessoa", "Total", "Desconto", "Parcelas", "Estado", "Data", ""]} right={[1, 2, 3]}>
      {sales.data.map((s) => <tr key={s.id}><Td>{s.person?.full_name}</Td><Td num>{brl(s.total_cents)}</Td><Td num>{brl(s.discount_cents)}</Td><Td num>{s.installments}</Td><Td>{SALE_ST[s.status]}</Td><Td>{fmtDate(s.sold_at ?? s.created_at)}</Td>
        <Td>{s.status === "pending" && <button className={btnGhost + " !py-1"} onClick={() => act("sale_confirm", { p_sale: s.id }, "Venda confirmada: contrato, parcelas e regras do produto aplicados.")}>Confirmar</button>}
          {s.status !== "cancelled" && <button className={btnDanger + " !py-1 ml-2"} onClick={async () => { const r = await promptText("Cancelar venda", "Motivo do cancelamento", { multiline: true, confirmLabel: "Cancelar venda", danger: true }); if (r) void act("sale_cancel", { p_sale: s.id, p_reason: r }, "Venda cancelada."); }}>Cancelar</button>}</Td></tr>)}</Table>}
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
    error ? m.err(errText(error)) : (m.ok("Estorno registrado."), void qc.invalidateQueries());
  };
  return (<>
    <Msg m={msg} />
    <div className="mb-4 flex gap-2">{[["aberto", "Em aberto"], ["vencidos", "Vencidos"], ["pagos", "Pagos"], ["todos", "Todos"]].map(([k, l]) => <button key={k} className={filter === k ? "btn-primary !py-2 !px-4" : btnGhost} onClick={() => setFilter(k)}>{l}</button>)}</div>
    {pay && <PayForm rec={pay} balance={pay.amount_cents - net(pay.id)} onClose={() => setPay(null)} onDone={() => { setPay(null); m.ok("Recebimento registrado."); void qc.invalidateQueries(); }} />}
    <State loading={recs.isLoading} error={recs.error} empty={rows.length === 0} emptyText="Nenhuma parcela neste filtro." />
    {rows.length > 0 && <Table head={["Pessoa", "Parcela", "Vencimento", "Valor", "Recebido (líquido)", "Estado", ""]} right={[3, 4]}>
      {rows.map((r) => <tr key={r.id}><Td>{r.person?.full_name}</Td><Td>{r.installment_no}/{r.installments_total}</Td><Td><span className={["open", "partial"].includes(r.status) && r.due_date < today ? "text-destructive" : ""}>{fmtDate(r.due_date + "T12:00:00Z")}</span></Td>
        <Td num>{brl(r.amount_cents)}</Td><Td num>{brl(net(r.id))}</Td><Td>{REC_ST[r.status]}</Td><Td>{["open", "partial"].includes(r.status) && <button className={btnGhost + " !py-1"} onClick={() => setPay(r)}>Receber</button>}</Td></tr>)}</Table>}
    <h2 className="text-xl mt-10 mb-3">Últimos recebimentos e estornos</h2>
    {pays.data && pays.data.length > 0 ? <Table head={["Data", "Tipo", "Valor", "Forma", ""]} right={[2]}>
      {pays.data.slice(0, 30).map((p) => <tr key={p.id}><Td>{fmtDateTime(p.paid_at)}</Td><Td>{p.kind === "payment" ? "Recebimento" : "Estorno"}</Td><Td num>{brl(p.amount_cents)}</Td><Td>{p.method ?? "—"}</Td><Td>{p.kind === "payment" && <button className="text-destructive text-sm" onClick={() => refund(p)}>Estornar</button>}</Td></tr>)}</Table> : <p className="text-navy-400">Sem movimentos.</p>}
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
      <div><label htmlFor="pa" className="block text-xs mb-1">Valor (R$)</label><input id="pa" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label htmlFor="pm" className="block text-xs mb-1">Forma</label><select id="pm" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="transferencia">Transferência</option></select></div>
      <div><label htmlFor="pc" className="block text-xs mb-1">Conta</label><select id="pc" className={inputCls} value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">Sem conta</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="flex gap-2"><button disabled={busy} className="btn-primary !py-2 disabled:opacity-60">Registrar</button><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button></div>
      {err && <p role="alert" className="sm:col-span-4 text-sm text-destructive">{err}</p>}
    </form>
  );
};

const Payables = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [desc, setDesc] = useState(""); const [amount, setAmount] = useState(""); const [due, setDue] = useState(new Date().toISOString().slice(0, 10)); const [unit, setUnit] = useState(""); const [cat, setCat] = useState("");
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });
  const cats = useQuery({ queryKey: ["cats"], queryFn: async () => (await supabase.from("finance_categories").select("id, name").eq("kind", "expense")).data ?? [] });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: async () => (await supabase.from("financial_accounts").select("id, name").eq("active", true)).data as Account[] });
  const list = useQuery({ queryKey: ["payables"], queryFn: async () => (await supabase.from("payables").select("id, description, amount_cents, due_date, status, paid_at").order("due_date").limit(200)).data ?? [] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); const cents = parseCents(amount); const { data: u } = await supabase.auth.getUser();
    if (!desc.trim() || !unit || cents == null) return m.err("Preencha descrição, unidade e valor.");
    const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    const { error } = await supabase.from("payables").insert({ org_id: org?.org_id, unit_id: unit, category_id: cat || null, description: desc.trim(), amount_cents: cents, due_date: due, competence_month: due.slice(0, 8) + "01", created_by: u.user?.id });
    error ? m.err(errText(error)) : (m.ok("Conta cadastrada."), setDesc(""), setAmount(""), void qc.invalidateQueries({ queryKey: ["payables"] }));
  };
  return (<>
    <Msg m={msg} />
    <form onSubmit={add} className="bg-card border border-border p-5 mb-6 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="pd" className="block text-xs mb-1">Descrição</label><input id="pd" className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div><label htmlFor="pv" className="block text-xs mb-1">Valor (R$)</label><input id="pv" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label htmlFor="pdue" className="block text-xs mb-1">Vencimento</label><input id="pdue" type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></div>
      <div><label htmlFor="pun" className="block text-xs mb-1">Unidade</label><select id="pun" className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="pcat" className="block text-xs mb-1">Categoria</label><select id="pcat" className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <button className="btn-primary !py-2">Cadastrar</button>
    </form>
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma conta a pagar." />
    {list.data && list.data.length > 0 && <Table head={["Descrição", "Vencimento", "Valor", "Estado", ""]} right={[2]}>
      {list.data.map((p) => <tr key={p.id}><Td>{p.description}</Td><Td>{fmtDate(p.due_date + "T12:00:00Z")}</Td><Td num>{brl(p.amount_cents)}</Td><Td>{p.status === "paid" ? `Paga em ${fmtDate(p.paid_at)}` : p.status === "open" ? "Em aberto" : "Cancelada"}</Td>
        <Td>{p.status === "open" && <button className={btnGhost + " !py-1"} onClick={async () => { const { error } = await supabase.rpc("payable_pay", { p_id: p.id, p_account: accounts.data?.[0]?.id ?? null }); error ? m.err(errText(error)) : (m.ok("Baixa registrada."), void qc.invalidateQueries({ queryKey: ["payables"] })); }}>Marcar como paga</button>}</Td></tr>)}</Table>}
  </>);
};

const Commissions = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const list = useQuery({ queryKey: ["commissions"], queryFn: async () => (await supabase.from("commission_entries").select("id, amount_cents, status, created_at, sale_id").order("created_at", { ascending: false }).limit(200)).data ?? [] });
  const set = async (id: string, s: string) => { const { error } = await supabase.rpc("commission_set_status", { p_entry: id, p_status: s }); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["commissions"] }); };
  return (<><Msg m={msg} /><p className="text-sm text-navy-400 mb-3">Geradas a cada recebimento conforme as regras cadastradas; estornos geram lançamento negativo. Regras de comissão são configuradas por SQL/gestor nesta versão (tela de regras pendente).</p>
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma comissão gerada." />
    {list.data && list.data.length > 0 && <Table head={["Data", "Valor", "Estado", ""]} right={[1]}>{list.data.map((c) => <tr key={c.id}><Td>{fmtDate(c.created_at)}</Td><Td num>{brl(c.amount_cents)}</Td><Td>{{ pending: "Pendente", authorized: "Autorizada", paid: "Paga", reversed: "Estornada" }[c.status as string]}</Td>
      <Td>{c.status === "pending" && <button className={btnGhost + " !py-1"} onClick={() => set(c.id, "authorized")}>Autorizar</button>}{c.status === "authorized" && <button className={btnGhost + " !py-1"} onClick={() => set(c.id, "paid")}>Marcar paga</button>}</Td></tr>)}</Table>}</>);
};

const Forecast = () => {
  const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10);
  const f = useQuery({ queryKey: ["forecast", next], queryFn: async () => { const { data, error } = await supabase.rpc("subscription_forecast", { p_month: next }); if (error) throw error; return data as { person_id: string; person_name: string; product_name: string; projected_amount_cents: number; origin_paid_at: string; origin_competence: string }[]; } });
  const total = (f.data ?? []).reduce((a, r) => a + r.projected_amount_cents, 0);
  return (<>
    <p className="bg-accent/10 border border-accent/40 p-3 text-sm mb-4"><strong>Projeção — não é conta a receber.</strong> Mensalidade paga na competência anterior contribui para o mês seguinte; quem pagou só antes disso não entra; estornos e cancelamentos saem; já contratado no mês não é duplicado.</p>
    <State loading={f.isLoading} error={f.error} empty={f.data?.length === 0} emptyText="Sem mensalidades pagas no mês anterior para projetar (indisponível)." />
    {f.data && f.data.length > 0 && <><p className="mb-3">Total projetado: <strong className="tabular">{brl(total)}</strong></p>
      <Table head={["Pessoa", "Produto", "Valor projetado", "Origem (pagamento em)", "Competência de origem"]} right={[2]}>{f.data.map((r) => <tr key={r.person_id + r.product_name}><Td>{r.person_name}</Td><Td>{r.product_name}</Td><Td num>{brl(r.projected_amount_cents)}</Td><Td>{fmtDate(r.origin_paid_at)}</Td><Td>{fmtDate(r.origin_competence + "T12:00:00Z").slice(3)}</Td></tr>)}</Table></>}
  </>);
};

export default Finance;
