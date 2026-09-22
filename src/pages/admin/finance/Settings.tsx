import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { btnGhost, errText, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";

interface Row { id: string; name: string; active: boolean; kind?: string }

/** Configurações financeiras: contas, categorias e centros de custo. Cadastro simples — sem exclusão (evita quebrar histórico já lançado; desativar é reversível). */
const FinanceSettings = () => (
  <div>
    <PageHead eyebrow="Financeiro" title="Configurações" hint="Contas, categorias e centros de custo usados em vendas, recebimentos, contas a pagar e comissões." />
    <div className="grid gap-8 lg:grid-cols-3">
      <CrudSection title="Contas financeiras" table="financial_accounts" placeholder="Nome da conta (ex.: Banco X — corrente)" extra={{ kind: "bank" }} />
      <CrudSection title="Categorias de despesa" table="finance_categories" placeholder="Nome da categoria" extra={{ kind: "expense" }} />
      <CrudSection title="Centros de custo" table="cost_centers" placeholder="Nome do centro de custo" extra={{}} />
    </div>
  </div>
);

const CrudSection = ({ title, table, placeholder, extra }: { title: string; table: "financial_accounts" | "finance_categories" | "cost_centers"; placeholder: string; extra: Record<string, string> }) => {
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
