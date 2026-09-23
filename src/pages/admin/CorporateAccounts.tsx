import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, toExclusive, useUnits, type RangePreset } from "@/lib/period";
import { btnDanger, btnGhost, btnPrimary, errText, Msg, PageHead, State, StatCard, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Account { id: string; name: string; document: string | null; unit_id: string; active: boolean }
interface Contact { id: string; name: string; role: string | null; email: string | null; phone: string | null; is_billing: boolean }
interface Contract { id: string; title: string; starts_on: string; ends_on: string | null; status: string; notes: string | null }

/** Contas corporativas: uma empresa CLIENTE do HP (nunca uma organização nova) que paga pelo atendimento de
 * pessoas já cadastradas — empresa pagadora e pessoa atendida ficam sempre separadas (corporate_members só
 * liga, nunca duplica o cadastro). Relatórios de uso/valores são sempre agregados (k-anonimato: 5+ vínculos). */
const CorporateAccounts = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState(""); const [document_, setDocument] = useState(""); const [unit, setUnit] = useState("");
  const units = useUnits();
  const accounts = useQuery({ queryKey: ["corporate-accounts"], queryFn: async () => (await supabase.from("corporate_accounts").select("id, name, document, unit_id, active").order("name")).data as Account[] });

  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return m.err("Informe o nome da empresa."); if (!unit) return m.err("Selecione a unidade.");
    const { data: o } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("corporate_accounts").insert({ org_id: o?.id, unit_id: unit, name: name.trim(), document: document_ || null });
    if (error) return m.err(errText(error));
    m.ok("Conta corporativa criada."); setName(""); setDocument(""); setUnit(""); void qc.invalidateQueries({ queryKey: ["corporate-accounts"] });
  };
  const toggle = async (a: Account) => { const { error } = await supabase.from("corporate_accounts").update({ active: !a.active }).eq("id", a.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["corporate-accounts"] }); };
  const unitName = (id: string) => units.data?.find((u) => u.id === id)?.name ?? "—";

  const account = accounts.data?.find((a) => a.id === sel);
  return (<div>
    <PageHead eyebrow="Financeiro" title="Contas corporativas" hint="Empresa cliente do HP que paga pelo atendimento de pessoas já cadastradas — nunca uma organização nova, nunca um cadastro duplicado de paciente." />
    <Msg m={msg} />
    <form onSubmit={create} className="hp-card p-5 mb-6 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="ca-name" className="block text-xs mb-1">Nome da empresa</label><input id="ca-name"   value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label htmlFor="ca-doc" className="block text-xs mb-1">CNPJ (opcional)</label><input id="ca-doc"   value={document_} onChange={(e) => setDocument(e.target.value)} /></div>
      <div><label htmlFor="ca-unit" className="block text-xs mb-1">Unidade</label><select id="ca-unit"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <button className={btnPrimary + " sm:col-span-4 w-fit"}>Criar conta corporativa</button>
    </form>
    <State loading={accounts.isLoading} error={accounts.error} empty={accounts.data?.length === 0} emptyText="Nenhuma conta corporativa cadastrada." />
    {accounts.data && accounts.data.length > 0 && <Table head={["Empresa", "CNPJ", "Unidade", "Estado", ""]}>
      {accounts.data.map((a) => <tr key={a.id}><Td>{a.name}</Td><Td>{a.document ?? "—"}</Td><Td>{unitName(a.unit_id)}</Td><Td>{a.active ? "Ativa" : "Inativa"}</Td>
        <Td className="flex gap-2"><button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(a.id === sel ? null : a.id)}>{a.id === sel ? "Fechar" : "Gerenciar"}</button>
          <button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(a)}>{a.active ? "Desativar" : "Ativar"}</button></Td></tr>)}
    </Table>}
    {account && <AccountManager account={account} />}
  </div>);
};

const AccountManager = ({ account }: { account: Account }) => {
  const [tab, setTab] = useState("contatos");
  return (<section className="mt-8 border-t border-border pt-6">
    <h2 className="text-2xl mb-3">{account.name}</h2>
    <Tabs tabs={[["contatos", "Contatos"], ["contratos", "Contratos"], ["membros", "Pessoas atendidas"], ["relatorio", "Relatório de utilização"]]} value={tab} onChange={setTab} />
    {tab === "contatos" && <Contacts account={account} />}
    {tab === "contratos" && <Contracts account={account} />}
    {tab === "membros" && <Members account={account} />}
    {tab === "relatorio" && <Report account={account} />}
  </section>);
};

const Contacts = ({ account }: { account: Account }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [billing, setBilling] = useState(false);
  const contacts = useQuery({ queryKey: ["corp-contacts", account.id], queryFn: async () => (await supabase.from("corporate_contacts").select("id, name, role, email, phone, is_billing").eq("account_id", account.id).order("name")).data as Contact[] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return m.err("Informe o nome do contato.");
    const { error } = await supabase.from("corporate_contacts").insert({ account_id: account.id, name: name.trim(), role: role || null, email: email || null, phone: phone || null, is_billing: billing });
    if (error) return m.err(errText(error));
    m.ok("Contato adicionado."); setName(""); setRole(""); setEmail(""); setPhone(""); setBilling(false); void qc.invalidateQueries({ queryKey: ["corp-contacts", account.id] });
  };
  const remove = async (id: string) => { const { error } = await supabase.from("corporate_contacts").delete().eq("id", id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["corp-contacts", account.id] }); };
  return (<><Msg m={msg} />
    <p className="text-xs text-muted-foreground mb-3">O contato marcado como "responsável financeiro" é quem recebe cobranças e comunicados administrativos da empresa — só um por conta.</p>
    <form onSubmit={add} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div><label htmlFor="cc-name" className="block text-xs mb-1">Nome</label><input id="cc-name"   value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label htmlFor="cc-role" className="block text-xs mb-1">Cargo</label><input id="cc-role"   value={role} onChange={(e) => setRole(e.target.value)} /></div>
      <div><label htmlFor="cc-email" className="block text-xs mb-1">E-mail</label><input id="cc-email" type="email"   value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label htmlFor="cc-phone" className="block text-xs mb-1">Telefone</label><input id="cc-phone"   value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      <label className="flex items-center gap-1.5 text-sm !font-normal pb-1.5"><input type="checkbox" checked={billing} onChange={(e) => setBilling(e.target.checked)} />Responsável financeiro</label>
      <button className={btnGhost + " sm:col-span-5 w-fit"}>Adicionar contato</button>
    </form>
    <State loading={contacts.isLoading} error={contacts.error} empty={contacts.data?.length === 0} emptyText="Nenhum contato cadastrado." />
    {contacts.data && contacts.data.length > 0 && <Table head={["Nome", "Cargo", "E-mail", "Telefone", "", ""]}>
      {contacts.data.map((c) => <tr key={c.id}><Td>{c.name}{c.is_billing && <span className="hp-badge ml-2">Financeiro</span>}</Td><Td>{c.role ?? "—"}</Td><Td>{c.email ?? "—"}</Td><Td>{c.phone ?? "—"}</Td>
        <Td><button className="text-destructive text-sm" onClick={() => remove(c.id)}>Remover</button></Td></tr>)}
    </Table>}
  </>);
};

const Contracts = ({ account }: { account: Account }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [starts, setStarts] = useState(new Date().toISOString().slice(0, 10)); const [ends, setEnds] = useState(""); const [notes, setNotes] = useState("");
  const [product, setProduct] = useState(""); const [condition, setCondition] = useState("");
  const contracts = useQuery({ queryKey: ["corp-contracts", account.id], queryFn: async () => (await supabase.from("corporate_contracts").select("id, title, starts_on, ends_on, status, notes").eq("account_id", account.id).order("starts_on", { ascending: false })).data as Contract[] });
  const products = useQuery({ queryKey: ["products-corp"], queryFn: async () => (await supabase.from("products").select("id, name").eq("active", true).order("name")).data ?? [] });
  const items = useQuery({ queryKey: ["corp-contract-items", sel], enabled: !!sel, queryFn: async () => (await supabase.from("corporate_contract_items").select("id, condition_notes, product:products(name)").eq("contract_id", sel)).data as unknown as { id: string; condition_notes: string | null; product: { name: string } | null }[] });

  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!title.trim()) return m.err("Informe o título do contrato."); const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("corporate_contracts").insert({ account_id: account.id, title: title.trim(), starts_on: starts, ends_on: ends || null, notes: notes || null, created_by: u.user?.id });
    if (error) return m.err(errText(error));
    m.ok("Contrato criado."); setTitle(""); setEnds(""); setNotes(""); void qc.invalidateQueries({ queryKey: ["corp-contracts", account.id] });
  };
  const setStatus = async (c: Contract) => { const { error } = await supabase.from("corporate_contracts").update({ status: c.status === "active" ? "ended" : "active" }).eq("id", c.id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["corp-contracts", account.id] }); };
  const addItem = async () => { if (!product || !sel) return; const { error } = await supabase.from("corporate_contract_items").insert({ contract_id: sel, product_id: product, condition_notes: condition || null }); if (error) m.err(errText(error)); else { setProduct(""); setCondition(""); void qc.invalidateQueries({ queryKey: ["corp-contract-items", sel] }); } };
  const removeItem = async (id: string) => { const { error } = await supabase.from("corporate_contract_items").delete().eq("id", id); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["corp-contract-items", sel] }); };

  return (<><Msg m={msg} />
    <form onSubmit={create} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="cn-title" className="block text-xs mb-1">Título do contrato</label><input id="cn-title"   value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div><label htmlFor="cn-start" className="block text-xs mb-1">Início</label><input id="cn-start" type="date"   value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
      <div><label htmlFor="cn-end" className="block text-xs mb-1">Fim (opcional)</label><input id="cn-end" type="date"   value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
      <div className="sm:col-span-4"><label htmlFor="cn-notes" className="block text-xs mb-1">Observações (opcional)</label><input id="cn-notes"   value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <button className={btnGhost + " sm:col-span-4 w-fit"}>Criar contrato</button>
    </form>
    <State loading={contracts.isLoading} error={contracts.error} empty={contracts.data?.length === 0} emptyText="Nenhum contrato corporativo ainda." />
    {contracts.data && contracts.data.length > 0 && <ul className="grid gap-2">
      {contracts.data.map((c) => (
        <li key={c.id} className="hp-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-medium">{c.title}</p><p className="text-xs text-muted-foreground">{fmtDate(c.starts_on + "T12:00:00Z")} {c.ends_on ? `→ ${fmtDate(c.ends_on + "T12:00:00Z")}` : "(sem data de fim)"}</p></div>
            <div className="flex items-center gap-2"><span className="hp-badge">{c.status === "active" ? "Ativo" : "Encerrado"}</span>
              <button className={btnGhost + " hp-btn-sm"} onClick={() => setStatus(c)}>{c.status === "active" ? "Encerrar" : "Reativar"}</button>
              <button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(sel === c.id ? null : c.id)}>{sel === c.id ? "Fechar" : "Produtos/condições"}</button></div>
          </div>
          {sel === c.id && (
            <div className="mt-3 border-t border-border pt-3">
              {items.data && items.data.length > 0 && <ul className="mb-3 grid gap-1.5">
                {items.data.map((it) => <li key={it.id} className="flex items-center justify-between text-sm bg-muted/50 px-3 py-2">
                  <span>{it.product?.name}{it.condition_notes && ` — ${it.condition_notes}`}</span><button className="text-destructive text-xs" onClick={() => removeItem(it.id)}>Remover</button></li>)}
              </ul>}
              <div className="flex flex-wrap gap-2">
                <select   value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Produto/serviço…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input   placeholder="Condição negociada (opcional)" value={condition} onChange={(e) => setCondition(e.target.value)} />
                <button type="button" className={btnGhost + " hp-btn-sm"} onClick={addItem}>Adicionar</button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>}
  </>);
};

const Members = ({ account }: { account: Account }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [search, setSearch] = useState("");
  const members = useQuery({ queryKey: ["corp-members", account.id], queryFn: async () => (await supabase.from("corporate_members").select("person_id, person:people(id, full_name)").eq("account_id", account.id)).data as unknown as { person_id: string; person: { id: string; full_name: string } }[] });
  const found = useQuery({ queryKey: ["ppl-corp", search], enabled: search.length >= 2, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? [] });
  const add = async (pid: string) => { const { error } = await supabase.from("corporate_members").insert({ account_id: account.id, person_id: pid }); if (error) m.err(errText(error)); else { m.ok("Pessoa vinculada — o cadastro dela não foi duplicado, só ligado a esta conta."); setSearch(""); void qc.invalidateQueries({ queryKey: ["corp-members", account.id] }); } };
  const remove = async (pid: string) => { const { error } = await supabase.from("corporate_members").delete().eq("account_id", account.id).eq("person_id", pid); if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["corp-members", account.id] }); };
  return (<><Msg m={msg} />
    <p className="text-xs text-muted-foreground mb-3">Liga uma pessoa já cadastrada a esta empresa — nunca cria um cadastro novo nem duplica o existente. A empresa é quem paga; a pessoa aqui é quem é atendida.</p>
    <div className="hp-card p-4 mb-4"><label htmlFor="cm-search" className="block text-xs mb-1">Buscar pessoa pelo nome</label><input id="cm-search"   value={search} onChange={(e) => setSearch(e.target.value)} />
      {found.data?.filter((p) => !members.data?.some((mm) => mm.person_id === p.id)).map((p) => <button type="button" key={p.id} className="block w-full text-left px-3 py-2 border border-border bg-card hover:bg-muted text-sm mt-1" onClick={() => add(p.id)}>{p.full_name} — vincular</button>)}
    </div>
    <State loading={members.isLoading} error={members.error} empty={members.data?.length === 0} emptyText="Nenhuma pessoa vinculada ainda." />
    {members.data && members.data.length > 0 && <Table head={["Pessoa", ""]}>{members.data.map((mm) => <tr key={mm.person_id}><Td>{mm.person.full_name}</Td><Td><button className="text-destructive text-sm" onClick={() => remove(mm.person_id)}>Desvincular</button></Td></tr>)}</Table>}
  </>);
};

const Report = ({ account }: { account: Account }) => {
  const [preset, setPreset] = useState<RangePreset>("ano"); const [custom, setCustom] = useState(presetRange("ano")); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();
  const report = useQuery({ queryKey: ["corp-report", account.id, from, to], queryFn: async () => {
    const { data, error } = await supabase.rpc("corporate_account_report", { p_account: account.id, p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to) }); if (error) throw error;
    return data as { members: number; available: boolean; attended_sessions?: number; billed_cents?: number };
  } });
  return (<>
    <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit="" units={units.data} compare={compare}
      onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
      onUnit={() => {}} onCompare={setCompare} onClear={() => { setPreset("ano"); setCustom(presetRange("ano")); setCompare(false); }} />
    <State loading={report.isLoading} error={report.error} />
    {report.data && !report.data.available && (
      <p className="hp-card p-4 text-sm text-muted-foreground">Relatório indisponível: {report.data.members} pessoa(s) vinculada(s) — o mínimo de 5 evita expor dado individual (inclusive de atendimento clínico) de um grupo pequeno.</p>
    )}
    {report.data && report.data.available && (
      <ul className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Pessoas vinculadas" value={report.data.members} />
        <StatCard label="Atendimentos realizados no período" value={report.data.attended_sessions?.toLocaleString("pt-BR") ?? "0"} />
        <StatCard label="Valor recebido no período" value={brl(report.data.billed_cents ?? 0)} basis="Recebimentos de pessoas vinculadas a esta conta — nunca prontuário ou conteúdo clínico individual." />
      </ul>
    )}
  </>);
};

export default CorporateAccounts;
