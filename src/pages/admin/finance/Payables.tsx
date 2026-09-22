import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, parseCents } from "@/lib/format";
import { btnGhost, errText, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";
import type { Account } from "./shared";

const FinancePayables = () => {
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
    if (error) m.err(errText(error)); else { m.ok("Conta cadastrada."); setDesc(""); setAmount(""); void qc.invalidateQueries({ queryKey: ["payables"] }); }
  };
  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Contas a pagar" hint="Obrigações, vencimentos e pagamentos. Marcar como paga registra a baixa e a competência para o DRE." />
      <Msg m={msg} />
      <form onSubmit={add} className="hp-card p-5 mb-6 grid gap-3 sm:grid-cols-5 items-end" noValidate>
        <div className="sm:col-span-2"><label htmlFor="pd" className="block text-xs mb-1">Descrição</label><input id="pd"   value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div><label htmlFor="pv" className="block text-xs mb-1">Valor (R$)</label><input id="pv"   value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label htmlFor="pdue" className="block text-xs mb-1">Vencimento</label><input id="pdue" type="date"   value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div><label htmlFor="pun" className="block text-xs mb-1">Unidade</label><select id="pun"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="pcat" className="block text-xs mb-1">Categoria</label><select id="pcat"   value={cat} onChange={(e) => setCat(e.target.value)}><option value="">…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="hp-btn hp-btn-primary">Cadastrar</button>
      </form>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma conta a pagar." />
      {list.data && list.data.length > 0 && <Table head={["Descrição", "Vencimento", "Valor", "Estado", ""]} right={[2]}>
        {list.data.map((p) => <tr key={p.id}><Td>{p.description}</Td><Td>{fmtDate(p.due_date + "T12:00:00Z")}</Td><Td num>{brl(p.amount_cents)}</Td><Td>{p.status === "paid" ? `Paga em ${fmtDate(p.paid_at)}` : p.status === "open" ? "Em aberto" : "Cancelada"}</Td>
          <Td>{p.status === "open" && <button className={btnGhost + " hp-btn-sm"} onClick={async () => { const { error } = await supabase.rpc("payable_pay", { p_id: p.id, p_account: accounts.data?.[0]?.id ?? null }); if (error) m.err(errText(error)); else { m.ok("Baixa registrada."); void qc.invalidateQueries({ queryKey: ["payables"] }); } }}>Marcar como paga</button>}</Td></tr>)}</Table>}
    </div>
  );
};

export default FinancePayables;
