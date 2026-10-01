import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, parseCents } from "@/lib/format";
import { ListFilterBar } from "@/lib/ListFilterBar";
import { btnGhost, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

const Partners = () => {
  const qc = useQueryClient(); const [tab, setTab] = useState("parceiros"); const [msg, m] = useMsg();
  const [pp, setPp] = useState(""); const [unit, setUnit] = useState(""); const [desc, setDesc] = useState(""); const [amount, setAmount] = useState("");
  // filtros das listas (os campos acima, do formulário de repasse, só preenchem)
  const [q, setQ] = useState(""); const [fStatus, setFStatus] = useState(""); const [fUnit, setFUnit] = useState(""); const [fPartner, setFPartner] = useState("");
  const changeTab = (t: string) => { setTab(t); setQ(""); setFStatus(""); setFUnit(""); setFPartner(""); };
  const partners = useQuery({ queryKey: ["partners"], queryFn: async () => (await supabase.from("partner_profiles").select("person_id, status, specialty, council_registration, approved_at, onboarding, person:people(full_name)").order("created_at", { ascending: false })).data as unknown as { person_id: string; status: string; specialty: string | null; council_registration: string | null; approved_at: string | null; onboarding: Record<string, boolean>; person: { full_name: string } }[] });
  const refs = useQuery({ queryKey: ["referrals"], enabled: tab === "indicacoes", queryFn: async () => (await supabase.from("referrals").select("id, created_at, code, referrer:people!referrals_referrer_person_id_fkey(full_name), referred:people!referrals_referred_person_id_fkey(full_name)").order("created_at", { ascending: false }).limit(200)).data as unknown as { id: string; created_at: string; code: string; referrer: { full_name: string }; referred: { full_name: string } }[] });
  const payouts = useQuery({ queryKey: ["payouts"], enabled: tab === "repasses", queryFn: async () => (await supabase.from("partner_payouts").select("id, unit_id, partner_person_id, description, amount_cents, status, reference_month, partner:people(full_name)").order("created_at", { ascending: false })).data as unknown as { id: string; unit_id: string; partner_person_id: string; description: string; amount_cents: number; status: string; reference_month: string; partner: { full_name: string } }[] });
  const units = useQuery({ queryKey: ["units"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });

  const step = async (p: { person_id: string; onboarding: Record<string, boolean> }, k: string) => { const { error } = await supabase.from("partner_profiles").update({ onboarding: { ...p.onboarding, [k]: !p.onboarding[k] } }).eq("person_id", p.person_id); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["partners"] }); };
  const addPayout = async (e: FormEvent) => { e.preventDefault(); const cents = parseCents(amount); const { data: u } = await supabase.auth.getUser(); const { data: org } = await supabase.from("units").select("org_id").eq("id", unit).single();
    if (!pp || !unit || !desc.trim() || cents == null) return m.err("Selecione parceiro e unidade e informe descrição e valor.");
    const { error } = await supabase.from("partner_payouts").insert({ org_id: org?.org_id, unit_id: unit, partner_person_id: pp, description: desc.trim(), amount_cents: cents, created_by: u.user?.id });
    if (error) m.err(errText(error)); else { m.ok("Repasse criado (pendente de autorização)."); setDesc(""); setAmount(""); void qc.invalidateQueries({ queryKey: ["payouts"] }); } };
  const setSt = async (id: string, s: string) => { const { error } = await supabase.rpc("payout_set_status", { p_id: id, p_status: s }); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["payouts"] }); };
  const lc = q.trim().toLowerCase(); const has = (...v: (string | null | undefined)[]) => !lc || v.some((x) => (x ?? "").toLowerCase().includes(lc));
  const PSTAT: Record<string, string> = { active: "Ativo", onboarding: "Em integração", inactive: "Inativo" }; const RSTAT: Record<string, string> = { pending: "Pendente", authorized: "Autorizado", paid: "Pago", cancelled: "Cancelado" };
  const shownPartners = (partners.data ?? []).filter((p) => has(p.person.full_name, p.council_registration, p.specialty) && (!fStatus || p.status === fStatus));
  const shownRefs = (refs.data ?? []).filter((r) => has(r.referrer.full_name, r.referred.full_name, r.code));
  const shownPayouts = (payouts.data ?? []).filter((x) => has(x.partner.full_name, x.description) && (!fStatus || x.status === fStatus) && (!fUnit || x.unit_id === fUnit) && (!fPartner || x.partner_person_id === fPartner));
  const OB: Record<string, string> = { contrato: "Contrato", formacao: "Formação", integracao: "Integração" };

  return (<div>
    <PageHead eyebrow="Relacionamento" title="Parceiros" hint="A aprovação acontece no funil “Parceiros” (etapa Ativo). Corporativo e pesquisas: modelo pronto no banco; telas dedicadas ainda pendentes." />
    <Msg m={msg} /><Tabs tabs={[["parceiros", "Parceiros"], ["indicacoes", "Indicações"], ["repasses", "Repasses"]]} value={tab} onChange={changeTab} />
    {/* filtro único: busca visível; unidade (só em Repasses) visível; estado e parceiro dentro do botão Filtros */}
    <ListFilterBar search={{ id: "pf-q", label: "Buscar", placeholder: tab === "indicacoes" ? "Buscar por nome ou código…" : tab === "repasses" ? "Buscar por parceiro ou descrição…" : "Buscar parceiro…", value: q, onChange: setQ }}
      onClear={() => { setQ(""); setFStatus(""); setFUnit(""); setFPartner(""); }} {...(tab === "repasses" ? { unit: fUnit, units: units.data ?? [], onUnit: setFUnit } : {})}
      extraCount={(tab !== "indicacoes" && fStatus ? 1 : 0) + (tab === "repasses" && fPartner ? 1 : 0)}
      extraSummary={[tab !== "indicacoes" && fStatus ? `Estado: ${(tab === "repasses" ? RSTAT : PSTAT)[fStatus]}` : "", tab === "repasses" && fPartner ? `Parceiro: ${partners.data?.find((p) => p.person_id === fPartner)?.person.full_name ?? ""}` : ""].filter(Boolean).join(" · ") || undefined}
      extra={tab === "indicacoes" ? undefined : <div className="grid gap-3">
        <div><label htmlFor="pff-status" className="block text-xs mb-1">Estado</label><select id="pff-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">Todos</option>{Object.entries(tab === "repasses" ? RSTAT : PSTAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {tab === "repasses" && <div><label htmlFor="pff-partner" className="block text-xs mb-1">Parceiro</label><select id="pff-partner" value={fPartner} onChange={(e) => setFPartner(e.target.value)}><option value="">Todos</option>{partners.data?.map((p) => <option key={p.person_id} value={p.person_id}>{p.person.full_name}</option>)}</select></div>}
      </div>} />
    {tab === "parceiros" && (<><State loading={partners.isLoading} error={partners.error} empty={partners.data?.length === 0} emptyText="Nenhum parceiro aprovado. Mova uma oportunidade do funil Parceiros até “Ativo”." />
      {partners.data && partners.data.length > 0 && shownPartners.length === 0 && <p className="text-sm text-muted-foreground mb-3">Nenhum parceiro com os filtros escolhidos. Ajuste ou limpe os filtros.</p>}
      {shownPartners.length > 0 && <Table head={["Parceiro", "Estado", "Registro", "Integração"]}>{shownPartners.map((p) => <tr key={p.person_id}><Td>{p.person.full_name}</Td><Td>{p.status === "active" ? "Ativo" : p.status === "onboarding" ? "Em integração" : "Inativo"}</Td><Td>{p.council_registration ?? "—"}</Td>
        <Td><div className="flex flex-wrap gap-1">{Object.entries(p.onboarding).map(([k, v]) => <button key={k} className={`text-xs px-2 py-1 border ${v ? "bg-primary text-primary-foreground border-primary" : "border-border"}`} onClick={() => step(p, k)}>{v ? "✓ " : ""}{OB[k] ?? k}</button>)}</div></Td></tr>)}</Table>}</>)}
    {tab === "indicacoes" && (<><State loading={refs.isLoading} error={refs.error} empty={refs.data?.length === 0} emptyText="Nenhuma indicação registrada." />
      {refs.data && refs.data.length > 0 && shownRefs.length === 0 && <p className="text-sm text-muted-foreground mb-3">Nenhuma indicação com a busca informada.</p>}
      {shownRefs.length > 0 && <Table head={["Data", "Quem indicou", "Indicado", "Código"]}>{shownRefs.map((r) => <tr key={r.id}><Td>{fmtDate(r.created_at)}</Td><Td>{r.referrer.full_name}</Td><Td>{r.referred.full_name}</Td><Td>{r.code}</Td></tr>)}</Table>}</>)}
    {tab === "repasses" && (<><form onSubmit={addPayout} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div><label htmlFor="rpp" className="block text-xs mb-1">Parceiro</label><select id="rpp"   value={pp} onChange={(e) => setPp(e.target.value)}><option value="">…</option>{partners.data?.map((p) => <option key={p.person_id} value={p.person_id}>{p.person.full_name}</option>)}</select></div>
      <div><label htmlFor="rpu" className="block text-xs mb-1">Unidade</label><select id="rpu"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div className="sm:col-span-2"><label htmlFor="rpd" className="block text-xs mb-1">Descrição</label><input id="rpd"   value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div><label htmlFor="rpv" className="block text-xs mb-1">Valor (R$)</label><input id="rpv"   value={amount} onChange={(e) => setAmount(e.target.value)} /></div><button className="hp-btn hp-btn-primary sm:w-fit">Criar</button></form>
      <State loading={payouts.isLoading} error={payouts.error} empty={payouts.data?.length === 0} emptyText="Nenhum repasse." />
      {payouts.data && payouts.data.length > 0 && shownPayouts.length === 0 && <p className="text-sm text-muted-foreground mb-3">Nenhum repasse com os filtros escolhidos. Ajuste ou limpe os filtros.</p>}
      {shownPayouts.length > 0 && <Table head={["Parceiro", "Descrição", "Valor", "Estado", ""]} right={[2]}>{shownPayouts.map((p) => <tr key={p.id}><Td>{p.partner.full_name}</Td><Td>{p.description}</Td><Td num>{brl(p.amount_cents)}</Td><Td>{{ pending: "Pendente", authorized: "Autorizado", paid: "Pago", cancelled: "Cancelado" }[p.status]}</Td>
        <Td>{p.status === "pending" && <button className={btnGhost + " hp-btn-sm"} onClick={() => setSt(p.id, "authorized")}>Autorizar</button>}{p.status === "authorized" && <button className={btnGhost + " hp-btn-sm"} onClick={() => setSt(p.id, "paid")}>Marcar pago</button>}</Td></tr>)}</Table>}</>)}
  </div>);
};
export default Partners;
