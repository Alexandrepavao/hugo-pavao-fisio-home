import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { errText, btnGhost, btnPrimary } from "@/lib/ui";
import { isFullName, UF_LIST } from "@/lib/quiz";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnits } from "../finance/shared";

export interface CompanyResult { id: string; name: string; contactId: string | null }
interface Dup { id: string; name: string; reason: "cnpj" | "nome" }
interface PersonCand { id: string | null; full_name: string; visible: boolean }

const EMPTY = { name: "", trade: "", cnpj: "", email: "", phone: "", city: "", uf: "", unit: "", cName: "", cRole: "", cEmail: "", cPhone: "" };

/** Cadastro de EMPRESA (lead B2B) com um contato opcional: cria a empresa pelo CRM (função própria, sem abrir o cadastro administrativo completo) e liga o contato como representante.
 *  Nunca duplica sem decisão: mesmo CNPJ devolve a existente; mesmo nome pede a sua escolha (usar a existente ou criar mesmo assim); contato parecido idem. */
const CompanyDialog = ({ open, onOpenChange, onDone, contactRequired = false, title = "Nova empresa" }: {
  open: boolean; onOpenChange: (v: boolean) => void; onDone: (r: CompanyResult) => void; contactRequired?: boolean; title?: string;
}) => {
  const units = useUnits();
  const [f, setF] = useState(EMPTY); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<Dup | null>(null); const [personDup, setPersonDup] = useState<{ companyId: string; cands: PersonCand[] } | null>(null);
  const set = (k: keyof typeof EMPTY, v: string) => setF((x) => ({ ...x, [k]: v }));
  const reset = () => { setF(EMPTY); setErr(null); setDup(null); setPersonDup(null); setBusy(false); };
  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  /** companyId: empresa já decidida (existente ou recém-criada); usePerson: contato escolhido entre os candidatos; forcePerson: criar o contato mesmo parecido. */
  const run = async (o: { companyId?: string; forceCompany?: boolean; usePerson?: string; forcePerson?: boolean } = {}) => {
    setErr(null);
    if (f.name.trim().length < 2) return setErr("Informe o nome da empresa.");
    if (!f.unit) return setErr("Escolha a unidade.");
    const wantsContact = !!f.cName.trim() || !!o.usePerson;
    if (contactRequired && !wantsContact) return setErr("Informe o contato na empresa (nome, e-mail ou telefone).");
    if (f.cName.trim() && !o.usePerson) {
      if (!isFullName(f.cName)) return setErr("Informe nome e sobrenome do contato.");
      if (!f.cEmail.trim() && !f.cPhone.trim()) return setErr("Informe e-mail ou telefone do contato.");
    }
    setBusy(true);
    try {
      let companyId = o.companyId ?? null;
      if (!companyId) {
        const { data: r, error } = await supabase.rpc("crm_company_create", { p_legal_name: f.name.trim(), p_trade_name: f.trade.trim() || null, p_cnpj: f.cnpj.trim() || null, p_email: f.email.trim() || null, p_phone: f.phone.trim() || null,
          p_city: f.city.trim() || null, p_uf: f.uf || null, p_unit: f.unit, p_contact_person: null, p_contact_role: null, p_force: !!o.forceCompany });
        if (error) throw error;
        if (r.status !== "created") {
          const { data: ex } = await supabase.from("legal_entities").select("legal_name, trade_name").eq("id", r.id).maybeSingle();
          setDup({ id: r.id, name: ex?.trade_name || ex?.legal_name || "empresa já cadastrada", reason: r.status === "existing" ? "cnpj" : "nome" }); return;
        }
        companyId = r.id as string;
      }
      let contactId: string | null = o.usePerson ?? null;
      if (!contactId && f.cName.trim()) {
        const { data, error } = await supabase.rpc("create_person", { p_full_name: f.cName.trim(), p_unit_id: f.unit, p_kinds: ["contact"], p_email: f.cEmail.trim() || null, p_phone: f.cPhone.trim() || null, p_notes: null, p_force: !!o.forcePerson });
        if (error) throw error;
        if (data.status === "duplicates") { setPersonDup({ companyId, cands: data.candidates as PersonCand[] }); return; }
        contactId = data.id as string;
      }
      if (contactId) { const { error } = await supabase.rpc("crm_company_link_contact", { p_company: companyId, p_person: contactId, p_role: f.cRole.trim() || null }); if (error) throw error; }
      const result = { id: companyId, name: f.trade.trim() || f.name.trim(), contactId };
      reset(); onDone(result);
    } catch (e) { setErr(errText(e as { message: string; code?: string })); } finally { setBusy(false); }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void run(); };
  const field = (id: string, label: string, k: keyof typeof EMPTY, p: { type?: string; placeholder?: string; required?: boolean } = {}) =>
    <div><label htmlFor={id} className="block text-xs mb-1">{label}{p.required ? " *" : ""}</label><input id={id} type={p.type ?? "text"} placeholder={p.placeholder} value={f[k]} onChange={(e) => set(k, e.target.value)} /></div>;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Empresa ou estabelecimento para parceria B2B. O contato é a pessoa com quem a HP Group vai falar; o resto se completa depois na ficha da empresa.</DialogDescription></DialogHeader>
        <form onSubmit={onSubmit} id="company-form" className="grid gap-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("co-name", "Nome da empresa (razão social)", "name", { required: true })}</div>
            {field("co-trade", "Nome fantasia", "trade")}{field("co-cnpj", "CNPJ", "cnpj", { placeholder: "00.000.000/0000-00" })}
            {field("co-email", "E-mail da empresa", "email", { type: "email" })}{field("co-phone", "Telefone", "phone")}
            {field("co-city", "Cidade", "city")}
            <div><label htmlFor="co-uf" className="block text-xs mb-1">UF</label><select id="co-uf" value={f.uf} onChange={(e) => set("uf", e.target.value)}><option value="">—</option>{UF_LIST.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
            <div className="sm:col-span-2"><label htmlFor="co-unit" className="block text-xs mb-1">Unidade *</label><select id="co-unit" value={f.unit} onChange={(e) => set("unit", e.target.value)}><option value="">Selecione…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-2 rounded-lg border border-border p-3"><legend className="px-1 text-xs font-semibold">Contato na empresa{contactRequired ? " *" : " (opcional)"}</legend>
            <div className="sm:col-span-2">{field("co-cname", "Nome completo do contato", "cName")}</div>
            {field("co-crole", "Cargo", "cRole")}{field("co-cemail", "E-mail do contato", "cEmail", { type: "email" })}{field("co-cphone", "Telefone / WhatsApp do contato", "cPhone")}
          </fieldset>

          {dup && (
            <div role="alert" className="hp-card p-3 text-sm grid gap-2" data-testid="company-dup">
              <p className="font-medium">{dup.reason === "cnpj" ? `Já existe uma empresa com este CNPJ: ${dup.name}.` : `Já existe uma empresa com este nome: ${dup.name}.`}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary + " hp-btn-sm"} disabled={busy} onClick={() => { const id = dup.id; setDup(null); void run({ companyId: id }); }}>Usar a empresa existente</button>
                {dup.reason === "nome" && <button type="button" className={btnGhost + " hp-btn-sm"} disabled={busy} onClick={() => { setDup(null); void run({ forceCompany: true }); }}>Criar mesmo assim (outra empresa)</button>}
              </div>
            </div>)}
          {personDup && (
            <div role="alert" className="hp-card p-3 text-sm grid gap-2" data-testid="contact-dup">
              <p className="font-medium">Já existe cadastro parecido com este contato:</p>
              <ul className="grid gap-1">{personDup.cands.map((c, i) => <li key={i} className="flex items-center justify-between gap-2"><span>{c.visible ? c.full_name : "Cadastro semelhante (sem permissão para ver o nome)"}</span>
                {c.visible && c.id && <button type="button" className={btnGhost + " hp-btn-sm"} disabled={busy} onClick={() => { const id = personDup.companyId; const pid = c.id!; setPersonDup(null); void run({ companyId: id, usePerson: pid }); }}>Usar este contato</button>}</li>)}</ul>
              <button type="button" className={btnGhost + " hp-btn-sm w-fit"} disabled={busy} onClick={() => { const id = personDup.companyId; setPersonDup(null); void run({ companyId: id, forcePerson: true }); }}>Criar como outra pessoa</button>
            </div>)}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </form>
        <DialogFooter><button type="button" className={btnGhost} onClick={() => close(false)}>Cancelar</button><button form="company-form" disabled={busy} className={btnPrimary}>{busy ? "Salvando…" : "Cadastrar empresa"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompanyDialog;
