import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, parseCents } from "@/lib/format";
import { btnGhost, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

const Partners = () => {
  const qc = useQueryClient(); const [tab, setTab] = useState("parceiros"); const [msg, m] = useMsg();
  const [pp, setPp] = useState(""); const [unit, setUnit] = useState(""); const [desc, setDesc] = useState(""); const [amount, setAmount] = useState("");
  const partners = useQuery({ queryKey: ["partners"], queryFn: async () => (await supabase.from("partner_profiles").select("person_id, status, specialty, council_registration, approved_at, onboarding, person:people(full_name)").order("created_at", { ascending: false })).data as unknown as { person_id: string; status: string; specialty: string | null; council_registration: string | null; approved_at: string | null; onboarding: Record<string, boolean>; person: { full_name: string } }[] });
  const refs = useQuery({ queryKey: ["referrals"], enabled: tab === "indicacoes", queryFn: async () => (await supabase.from("referrals").select("id, created_at, code, referrer:people!referrals_referrer_person_id_fkey(full_name), referred:people!referrals_referred_person_id_fkey(full_name)").order("created_at", { ascending: false }).limit(200)).data as unknown as { id: string; created_at: string; code: string; referrer: { full_name: string }; referred: { full_name: string } }[] });
  const payouts = useQuery({ queryKey: ["payouts"], enabled: tab === "repasses", queryFn: async () => (await supabase.from("partner_payouts").select("id, description, amount_cents, status, reference_month, partner:people(full_name)").order("created_at", { ascending: false })).data as unknown as { id: string; description: string; amount_cents: number; status: string; reference_month: string; partner: { full_name: string } }[] });
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });

  const step = async (p: { person_id: string; onboarding: Record<string, boolean> }, k: string) => { const { error } = await supabase.from("partner_profiles").update({ onboarding: { ...p.onboarding, [k]: !p.onboarding[k] } }).eq("person_id", p.person_id); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["partners"] }); };
  const addPayout = async (e: FormEvent) => { e.preventDefault(); const cents = parseCents(amount); const { data: u } = await supabase.auth.getUser(); const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    if (!pp || !unit || !desc.trim() || cents == null) return m.err("Selecione parceiro e unidade e informe descrição e valor.");
    const { error } = await supabase.from("partner_payouts").insert({ org_id: org?.org_id, unit_id: unit, partner_person_id: pp, description: desc.trim(), amount_cents: cents, created_by: u.user?.id });
    if (error) m.err(errText(error)); else { m.ok("Repasse criado (pendente de autorização)."); setDesc(""); setAmount(""); void qc.invalidateQueries({ queryKey: ["payouts"] }); } };
  const setSt = async (id: string, s: string) => { const { error } = await supabase.rpc("payout_set_status", { p_id: id, p_status: s }); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["payouts"] }); };
  const OB: Record<string, string> = { contrato: "Contrato", formacao: "Formação", integracao: "Integração" };

  return (<div>
    <PageHead eyebrow="Relacionamento" title="Parceiros" hint="A aprovação acontece no funil “Parceiros” (etapa Ativo). Corporativo e pesquisas: modelo pronto no banco; telas dedicadas ainda pendentes." />
    <Msg m={msg} /><Tabs tabs={[["parceiros", "Parceiros"], ["indicacoes", "Indicações"], ["repasses", "Repasses"]]} value={tab} onChange={setTab} />
    {tab === "parceiros" && (<><State loading={partners.isLoading} error={partners.error} empty={partners.data?.length === 0} emptyText="Nenhum parceiro aprovado. Mova uma oportunidade do funil Parceiros até “Ativo”." />
      {partners.data && partners.data.length > 0 && <Table head={["Parceiro", "Estado", "Registro", "Integração"]}>{partners.data.map((p) => <tr key={p.person_id}><Td>{p.person.full_name}</Td><Td>{p.status === "active" ? "Ativo" : p.status === "onboarding" ? "Em integração" : "Inativo"}</Td><Td>{p.council_registration ?? "—"}</Td>
        <Td><div className="flex flex-wrap gap-1">{Object.entries(p.onboarding).map(([k, v]) => <button key={k} className={`text-xs px-2 py-1 border ${v ? "bg-primary text-primary-foreground border-primary" : "border-border"}`} onClick={() => step(p, k)}>{v ? "✓ " : ""}{OB[k] ?? k}</button>)}</div></Td></tr>)}</Table>}</>)}
    {tab === "indicacoes" && (<><State loading={refs.isLoading} error={refs.error} empty={refs.data?.length === 0} emptyText="Nenhuma indicação registrada." />
      {refs.data && refs.data.length > 0 && <Table head={["Data", "Quem indicou", "Indicado", "Código"]}>{refs.data.map((r) => <tr key={r.id}><Td>{fmtDate(r.created_at)}</Td><Td>{r.referrer.full_name}</Td><Td>{r.referred.full_name}</Td><Td>{r.code}</Td></tr>)}</Table>}</>)}
    {tab === "repasses" && (<><form onSubmit={addPayout} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div><label htmlFor="rpp" className="block text-xs mb-1">Parceiro</label><select id="rpp"   value={pp} onChange={(e) => setPp(e.target.value)}><option value="">…</option>{partners.data?.map((p) => <option key={p.person_id} value={p.person_id}>{p.person.full_name}</option>)}</select></div>
      <div><label htmlFor="rpu" className="block text-xs mb-1">Unidade</label><select id="rpu"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="sm:col-span-2"><label htmlFor="rpd" className="block text-xs mb-1">Descrição</label><input id="rpd"   value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div><label htmlFor="rpv" className="block text-xs mb-1">Valor (R$)</label><input id="rpv"   value={amount} onChange={(e) => setAmount(e.target.value)} /></div><button className="hp-btn hp-btn-primary sm:w-fit">Criar</button></form>
      <State loading={payouts.isLoading} error={payouts.error} empty={payouts.data?.length === 0} emptyText="Nenhum repasse." />
      {payouts.data && payouts.data.length > 0 && <Table head={["Parceiro", "Descrição", "Valor", "Estado", ""]} right={[2]}>{payouts.data.map((p) => <tr key={p.id}><Td>{p.partner.full_name}</Td><Td>{p.description}</Td><Td num>{brl(p.amount_cents)}</Td><Td>{{ pending: "Pendente", authorized: "Autorizado", paid: "Pago", cancelled: "Cancelado" }[p.status]}</Td>
        <Td>{p.status === "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={() => setSt(p.id, "authorized")}>Autorizar</button>}{p.status === "authorized" && <button className={btnGhost + " hp-btn-sm"} onClick={() => setSt(p.id, "paid")}>Marcar pago</button>}</Td></tr>)}</Table>}</>)}
  </div>);
};
export default Partners;
