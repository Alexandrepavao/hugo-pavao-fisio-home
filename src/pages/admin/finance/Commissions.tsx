import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { btnGhost, errText, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Rule { id: string; name: string; product_id: string | null; beneficiary_user_id: string | null; percent_bp: number; active: boolean; product: { name: string } | null }
interface Member { user_id: string; display_name: string; email: string; roles: unknown[] }

const FinanceCommissions = () => {
  const [tab, setTab] = useState("lancamentos");
  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Comissões e repasses" hint="Comissões são geradas automaticamente a cada recebimento, conforme as regras ativas; estornos geram lançamento negativo proporcional." />
      <Tabs tabs={[["lancamentos", "Lançamentos"], ["regras", "Regras de comissão"]]} value={tab} onChange={setTab} />
      {tab === "lancamentos" && <Entries />}
      {tab === "regras" && <Rules />}
    </div>
  );
};

const Entries = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const list = useQuery({ queryKey: ["commissions"], queryFn: async () => (await supabase.from("commission_entries").select("id, amount_cents, status, created_at, sale_id").order("created_at", { ascending: false }).limit(200)).data ?? [] });
  const set = async (id: string, s: string) => { const { error } = await supabase.rpc("commission_set_status", { p_entry: id, p_status: s }); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["commissions"] }); };
  return (<><Msg m={msg} />
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma comissão gerada." />
    {list.data && list.data.length > 0 && <Table head={["Data", "Valor", "Estado", ""]} right={[1]}>{list.data.map((c) => <tr key={c.id}><Td>{fmtDate(c.created_at)}</Td><Td num>{brl(c.amount_cents)}</Td><Td>{{ pending: "Pendente", authorized: "Autorizada", paid: "Paga", reversed: "Estornada" }[c.status as string]}</Td>
      <Td>{c.status === "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={() => set(c.id, "authorized")}>Autorizar</button>}{c.status === "authorized" && <button className={btnGhost + " hp-btn-sm"} onClick={() => set(c.id, "paid")}>Marcar paga</button>}</Td></tr>)}</Table>}</>);
};

/** Regras: produto nulo = vale para todos; beneficiário nulo = responsável da oportunidade (definido no momento do pagamento). */
const Rules = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [name, setName] = useState(""); const [product, setProduct] = useState(""); const [beneficiary, setBeneficiary] = useState(""); const [pct, setPct] = useState("10");
  const products = useQuery({ queryKey: ["products-cr"], queryFn: async () => (await supabase.from("products").select("id, name").eq("active", true).order("name")).data ?? [] });
  const team = useQuery({ queryKey: ["team-cr"], queryFn: async () => ((await supabase.rpc("list_team")).data ?? []) as Member[] });
  const rules = useQuery({ queryKey: ["comm-rules"], queryFn: async () => (await supabase.from("commission_rules").select("id, name, product_id, beneficiary_user_id, percent_bp, active, product:products(name)").order("name")).data as unknown as Rule[] });
  const memberName = (uid: string | null) => uid ? (team.data?.find((t) => t.user_id === uid)?.display_name ?? "—") : "Responsável da oportunidade";

  const add = async (e: FormEvent) => {
    e.preventDefault(); const { data: org } = await supabase.from("organizations").select("id").single();
    const bp = Math.round(Number(pct.replace(",", ".")) * 100);
    if (!name.trim()) return m.err("Informe um nome para a regra."); if (!(bp >= 1 && bp <= 10000)) return m.err("Percentual deve ser entre 0,01% e 100%.");
    const { error } = await supabase.from("commission_rules").insert({ org_id: org?.id, name: name.trim(), product_id: product || null, beneficiary_user_id: beneficiary || null, percent_bp: bp });
    if (error) m.err(errText(error)); else { m.ok("Regra criada."); setName(""); setPct("10"); void qc.invalidateQueries({ queryKey: ["comm-rules"] }); }
  };
  const toggle = async (r: Rule) => { const { error } = await supabase.from("commission_rules").update({ active: !r.active }).eq("id", r.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["comm-rules"] }); };

  return (<><Msg m={msg} />
    <p className="text-sm text-muted-foreground mb-3">A regra mais específica que casar com a venda é aplicada a cada recebimento. Percentual incide sobre o valor recebido (não sobre o total da venda).</p>
    <form onSubmit={add} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="crn" className="block text-xs mb-1">Nome da regra</label><input id="crn"   value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label htmlFor="crp" className="block text-xs mb-1">Produto (opcional)</label><select id="crp"   value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Todos os produtos</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div><label htmlFor="crb" className="block text-xs mb-1">Beneficiário (opcional)</label><select id="crb"   value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}><option value="">Responsável da oportunidade</option>{team.data?.map((t) => <option key={t.user_id} value={t.user_id}>{t.display_name}</option>)}</select></div>
      <div><label htmlFor="crv" className="block text-xs mb-1">Percentual (%)</label><input id="crv" inputMode="decimal"   value={pct} onChange={(e) => setPct(e.target.value)} /></div>
      <div className="sm:col-span-5"><button className="hp-btn hp-btn-primary">Criar regra</button></div>
    </form>
    <State loading={rules.isLoading} error={rules.error} empty={rules.data?.length === 0} emptyText="Nenhuma regra de comissão cadastrada." />
    {rules.data && rules.data.length > 0 && <Table head={["Nome", "Produto", "Beneficiário", "Percentual", "Estado", ""]}>
      {rules.data.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td>{r.product?.name ?? "Todos"}</Td><Td>{memberName(r.beneficiary_user_id)}</Td><Td num>{(r.percent_bp / 100).toFixed(2).replace(".", ",")}%</Td><Td>{r.active ? "Ativa" : "Inativa"}</Td>
        <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(r)}>{r.active ? "Desativar" : "Ativar"}</button></Td></tr>)}</Table>}</>);
};

export default FinanceCommissions;
