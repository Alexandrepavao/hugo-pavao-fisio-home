import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { btnGhost, errText, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";

interface Row { id: string; name: string; active: boolean; kind?: string }
interface Category extends Row { dre_classification: string | null }
interface Account extends Row { unit_id: string | null }

const CLASS_LABEL: Record<string, string> = { deducao: "Dedução", custo_direto: "Custo direto", despesa_operacional: "Despesa operacional" };

/** Configurações financeiras: contas, categorias (+ classificação DRE) e centros de custo. Sem exclusão (evita quebrar histórico já lançado; desativar é reversível). */
const FinanceSettings = () => (
  <div>
    <PageHead eyebrow="Financeiro" title="Configurações" hint="Contas, categorias e centros de custo usados em vendas, recebimentos, contas a pagar, comissões e na DRE." />
    <div className="grid gap-8 lg:grid-cols-3">
      <AccountsSection />
      <CategoriesSection />
      <CrudSection title="Centros de custo" table="cost_centers" placeholder="Nome do centro de custo" extra={{}} />
    </div>
  </div>
);

/** Conta financeira: a unidade é obrigatória porque a conciliação bancária (extrato → recebimento/conta a
 * pagar) sempre acontece dentro de uma unidade — sem ela, nenhum extrato pode ser importado para essa conta. */
const AccountsSection = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [name, setName] = useState(""); const [unit, setUnit] = useState("");
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true).order("name")).data ?? [] });
  const list = useQuery({ queryKey: ["financial_accounts"], queryFn: async () => (await supabase.from("financial_accounts").select("id, name, active, unit_id").order("name")).data as Account[] });
  const unitName = (id: string | null) => units.data?.find((u) => u.id === id)?.name ?? "—";
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return; if (!unit) return m.err("Selecione a unidade desta conta.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("financial_accounts").insert({ org_id: org?.id, name: name.trim(), kind: "bank", unit_id: unit });
    if (error) m.err(errText(error)); else { m.ok("Criado."); setName(""); void qc.invalidateQueries({ queryKey: ["financial_accounts"] }); }
  };
  const toggle = async (r: Account) => { const { error } = await supabase.from("financial_accounts").update({ active: !r.active }).eq("id", r.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["financial_accounts"] }); };
  return (
    <section>
      <h2 className="text-lg mb-2">Contas financeiras</h2>
      <Msg m={msg} />
      <form onSubmit={add} className="grid gap-2 mb-3" noValidate>
        <label className="sr-only" htmlFor="fa-name">Nome da conta</label>
        <input id="fa-name"   placeholder="Nome da conta (ex.: Banco X — corrente)" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="fa-unit">Unidade</label>
        <select id="fa-unit"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Unidade…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <button className={btnGhost + " w-fit"}>Criar</button>
      </form>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nada cadastrado." />
      {list.data && list.data.length > 0 && <Table head={["Nome", "Unidade", "Estado", ""]}>{list.data.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td>{unitName(r.unit_id)}</Td><Td>{r.active ? "Ativo" : "Inativo"}</Td>
        <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(r)}>{r.active ? "Desativar" : "Ativar"}</button></Td></tr>)}</Table>}
    </section>
  );
};

/** Classificação DRE de cada categoria de despesa: é ela que decide se o lançamento entra em dedução, custo
 * direto ou despesa operacional na DRE — sem classificação, o lançamento fica separado como "sem classificar". */
const CategoriesSection = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [name, setName] = useState(""); const [classification, setClassification] = useState("");
  const list = useQuery({ queryKey: ["finance_categories"], queryFn: async () => (await supabase.from("finance_categories").select("id, name, active, dre_classification").eq("kind", "expense").order("name")).data as Category[] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return; const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("finance_categories").insert({ org_id: org?.id, name: name.trim(), kind: "expense", dre_classification: classification || null });
    if (error) m.err(errText(error)); else { m.ok("Categoria criada."); setName(""); setClassification(""); void qc.invalidateQueries({ queryKey: ["finance_categories"] }); }
  };
  const setClass = async (c: Category, value: string) => {
    const { error } = await supabase.from("finance_categories").update({ dre_classification: value || null }).eq("id", c.id);
    if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["finance_categories"] });
  };
  const toggle = async (c: Category) => { const { error } = await supabase.from("finance_categories").update({ active: !c.active }).eq("id", c.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["finance_categories"] }); };

  return (
    <section>
      <h2 className="text-lg mb-2">Categorias de despesa</h2>
      <p className="text-xs text-muted-foreground mb-2">A classificação DRE decide onde cada categoria entra no resultado. Sem classificação, o lançamento fica separado como "sem classificar" — nunca é somado à despesa operacional por padrão.</p>
      <Msg m={msg} />
      <form onSubmit={add} className="grid gap-2 mb-3" noValidate>
        <label className="sr-only" htmlFor="fc-name">Nome da categoria</label>
        <input id="fc-name"   placeholder="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="fc-class">Classificação DRE</label>
        <select id="fc-class"   value={classification} onChange={(e) => setClassification(e.target.value)}>
          <option value="">Sem classificação DRE (definir depois)</option>
          {Object.entries(CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={btnGhost + " w-fit"}>Criar categoria</button>
      </form>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma categoria de despesa cadastrada." />
      {list.data && list.data.length > 0 && <Table head={["Nome", "Classificação DRE", "Estado", ""]}>
        {list.data.map((c) => (
          <tr key={c.id}><Td>{c.name}</Td>
            <Td><select   value={c.dre_classification ?? ""} onChange={(e) => setClass(c, e.target.value)} aria-label={`Classificação DRE de ${c.name}`}>
              <option value="">Sem classificar</option>{Object.entries(CLASS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Td>
            <Td>{c.active ? "Ativa" : "Inativa"}</Td>
            <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(c)}>{c.active ? "Desativar" : "Ativar"}</button></Td>
          </tr>
        ))}</Table>}
    </section>
  );
};

const CrudSection = ({ title, table, placeholder, extra }: { title: string; table: "cost_centers"; placeholder: string; extra: Record<string, string> }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [name, setName] = useState("");
  const list = useQuery({ queryKey: [table], queryFn: async () => (await supabase.from(table).select("id, name, active").order("name")).data as Row[] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return; const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from(table).insert({ org_id: org?.id, name: name.trim(), ...extra });
    if (error) m.err(errText(error)); else { m.ok("Criado."); setName(""); void qc.invalidateQueries({ queryKey: [table] }); }
  };
  const toggle = async (r: Row) => { const { error } = await supabase.from(table).update({ active: !r.active }).eq("id", r.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: [table] }); };
  return (
    <section>
      <h2 className="text-lg mb-2">{title}</h2>
      <Msg m={msg} />
      <form onSubmit={add} className="flex gap-2 mb-3"><label className="sr-only" htmlFor={`cs-${table}`}>{placeholder}</label>
        <input id={`cs-${table}`}   placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} /><button className={btnGhost}>Criar</button></form>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nada cadastrado." />
      {list.data && list.data.length > 0 && <Table head={["Nome", "Estado", ""]}>{list.data.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td>{r.active ? "Ativo" : "Inativo"}</Td>
        <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(r)}>{r.active ? "Desativar" : "Ativar"}</button></Td></tr>)}</Table>}
    </section>
  );
};

export default FinanceSettings;
