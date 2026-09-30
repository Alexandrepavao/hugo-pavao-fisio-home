import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errText, Msg, useMsg, btnGhost, btnPrimary } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { StaffUser } from "../crm/types";

interface EntityDetail {
  id: string; cnpj: string | null; legal_name: string; trade_name: string | null;
  state_registration: string | null; state_registration_exempt: boolean; municipal_registration: string | null;
  legal_nature: string | null; cnae_main: string | null; tax_regime: string | null; founded_on: string | null;
  email_general: string | null; email_finance: string | null; email_billing: string | null; phone: string | null; whatsapp: string | null;
  cep: string | null; street: string | null; street_number: string | null; complement: string | null; neighborhood: string | null;
  city: string | null; state_uf: string | null; registration_status: string; origin: string | null;
  internal_owner_user_id: string | null; notes: string | null;
  representatives: { id: string; person_id: string; full_name: string; role_title: string | null; representation_type: string }[];
}

const REP_LABEL: Record<string, string> = { legal_representative: "Representante legal", contact: "Contato", billing: "Financeiro/faturamento" };

/** Ficha de pessoa jurídica: edição completa via legal_entity_upsert (valida CNPJ e duplicidade no servidor).
 *  Representantes são sempre vínculos a pessoas físicas já cadastradas. */
const LegalEntitySheet = ({ entityId, onClose, onChanged }: { entityId: string | null; onClose: () => void; onChanged: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [form, setForm] = useState<Partial<EntityDetail>>({});
  const [repSearch, setRepSearch] = useState(""); const [repRole, setRepRole] = useState(""); const [repType, setRepType] = useState("contact");
  const open = !!entityId;

  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const detail = useQuery({ queryKey: ["adm-entity", entityId], enabled: open, queryFn: async () => {
    const { data: e, error } = await supabase.from("legal_entities").select("*").eq("id", entityId!).single();
    if (error) throw error;
    const { data: reps } = await supabase.from("legal_entity_representatives").select("id, person_id, role_title, representation_type, person:people(full_name)").eq("legal_entity_id", entityId!);
    return { ...e, representatives: (reps ?? []).map((r) => ({ id: r.id, person_id: r.person_id, role_title: r.role_title, representation_type: r.representation_type, full_name: (r.person as unknown as { full_name: string } | null)?.full_name ?? "—" })) } as EntityDetail;
  } });
  const found = useQuery({ queryKey: ["ppl-rep-search", repSearch], enabled: repSearch.length >= 2, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${repSearch.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(8)).data ?? [] });

  useEffect(() => { if (detail.data) setForm(detail.data); }, [detail.data]);
  const set = <K extends keyof EntityDetail>(k: K, v: EntityDetail[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!entityId) return;
    const { error } = await supabase.rpc("legal_entity_upsert", { p_id: entityId, p_data: form as Record<string, unknown> });
    if (error) return m.err(errText(error));
    m.ok("Empresa salva.");
    void qc.invalidateQueries({ queryKey: ["adm-entity", entityId] }); onChanged();
  };
  const addRep = async (personId: string) => {
    if (!entityId) return;
    const { error } = await supabase.from("legal_entity_representatives").insert({ legal_entity_id: entityId, person_id: personId, role_title: repRole || null, representation_type: repType });
    if (error) return m.err(errText(error));
    setRepSearch(""); setRepRole(""); m.ok("Representante vinculado.");
    void qc.invalidateQueries({ queryKey: ["adm-entity", entityId] });
  };
  const removeRep = async (repId: string) => {
    const { error } = await supabase.from("legal_entity_representatives").delete().eq("id", repId);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["adm-entity", entityId] });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        {entityId && (<>
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{form.legal_name ?? "Pessoa jurídica"}</SheetTitle>
            <SheetDescription>{form.trade_name ?? "Sem nome fantasia"}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <Msg m={msg} />
            {detail.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {form.id && (
              <div className="grid gap-4">
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Identificação</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label htmlFor="pj-razao" className="block text-xs mb-1">Razão social</label><input id="pj-razao" value={form.legal_name ?? ""} onChange={(e) => set("legal_name", e.target.value)} /></div>
                    <div><label htmlFor="pj-fantasia" className="block text-xs mb-1">Nome fantasia</label><input id="pj-fantasia" value={form.trade_name ?? ""} onChange={(e) => set("trade_name", e.target.value)} /></div>
                    <div><label htmlFor="pj-cnpj" className="block text-xs mb-1">CNPJ</label><input id="pj-cnpj" value={form.cnpj ?? ""} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" /></div>
                    <div><label htmlFor="pj-ie" className="block text-xs mb-1">Inscrição estadual</label><input id="pj-ie" value={form.state_registration ?? ""} disabled={form.state_registration_exempt} onChange={(e) => set("state_registration", e.target.value)} /></div>
                    <label className="flex items-center gap-1.5 text-sm self-end pb-2"><input type="checkbox" checked={!!form.state_registration_exempt} onChange={(e) => set("state_registration_exempt", e.target.checked)} />Isento</label>
                    <div><label htmlFor="pj-im" className="block text-xs mb-1">Inscrição municipal</label><input id="pj-im" value={form.municipal_registration ?? ""} onChange={(e) => set("municipal_registration", e.target.value)} /></div>
                    <div><label htmlFor="pj-nat" className="block text-xs mb-1">Natureza jurídica</label><input id="pj-nat" value={form.legal_nature ?? ""} onChange={(e) => set("legal_nature", e.target.value)} /></div>
                    <div><label htmlFor="pj-cnae" className="block text-xs mb-1">CNAE principal</label><input id="pj-cnae" value={form.cnae_main ?? ""} onChange={(e) => set("cnae_main", e.target.value)} /></div>
                    <div><label htmlFor="pj-regime" className="block text-xs mb-1">Regime tributário</label><input id="pj-regime" value={form.tax_regime ?? ""} onChange={(e) => set("tax_regime", e.target.value)} /></div>
                    <div><label htmlFor="pj-abertura" className="block text-xs mb-1">Data de abertura</label><input id="pj-abertura" type="date" value={form.founded_on ?? ""} onChange={(e) => set("founded_on", e.target.value)} /></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Contato</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label htmlFor="pj-email" className="block text-xs mb-1">E-mail geral</label><input id="pj-email" type="email" value={form.email_general ?? ""} onChange={(e) => set("email_general", e.target.value)} /></div>
                    <div><label htmlFor="pj-email-fin" className="block text-xs mb-1">E-mail financeiro</label><input id="pj-email-fin" type="email" value={form.email_finance ?? ""} onChange={(e) => set("email_finance", e.target.value)} /></div>
                    <div><label htmlFor="pj-email-fat" className="block text-xs mb-1">E-mail de faturamento</label><input id="pj-email-fat" type="email" value={form.email_billing ?? ""} onChange={(e) => set("email_billing", e.target.value)} /></div>
                    <div><label htmlFor="pj-phone" className="block text-xs mb-1">Telefone</label><input id="pj-phone" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
                    <div><label htmlFor="pj-wa" className="block text-xs mb-1">WhatsApp</label><input id="pj-wa" value={form.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} /></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Endereço</h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div><label htmlFor="pj-cep" className="block text-xs mb-1">CEP</label><input id="pj-cep" value={form.cep ?? ""} onChange={(e) => set("cep", e.target.value)} /></div>
                    <div className="sm:col-span-2"><label htmlFor="pj-street" className="block text-xs mb-1">Logradouro</label><input id="pj-street" value={form.street ?? ""} onChange={(e) => set("street", e.target.value)} /></div>
                    <div><label htmlFor="pj-num" className="block text-xs mb-1">Número</label><input id="pj-num" value={form.street_number ?? ""} onChange={(e) => set("street_number", e.target.value)} /></div>
                    <div><label htmlFor="pj-comp" className="block text-xs mb-1">Complemento</label><input id="pj-comp" value={form.complement ?? ""} onChange={(e) => set("complement", e.target.value)} /></div>
                    <div><label htmlFor="pj-bairro" className="block text-xs mb-1">Bairro</label><input id="pj-bairro" value={form.neighborhood ?? ""} onChange={(e) => set("neighborhood", e.target.value)} /></div>
                    <div><label htmlFor="pj-city" className="block text-xs mb-1">Cidade</label><input id="pj-city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></div>
                    <div><label htmlFor="pj-uf" className="block text-xs mb-1">UF</label><input id="pj-uf" maxLength={2} value={form.state_uf ?? ""} onChange={(e) => set("state_uf", e.target.value.toUpperCase())} /></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Administrativo</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><label htmlFor="pj-status" className="block text-xs mb-1">Status cadastral</label>
                      <select id="pj-status" value={form.registration_status ?? "ativo"} onChange={(e) => set("registration_status", e.target.value)}><option value="ativo">Ativo</option><option value="pendente">Pendente</option><option value="inativo">Inativo</option></select></div>
                    <div><label htmlFor="pj-owner" className="block text-xs mb-1">Responsável interno</label>
                      <select id="pj-owner" value={form.internal_owner_user_id ?? ""} onChange={(e) => set("internal_owner_user_id", e.target.value)}><option value="">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
                    <div><label htmlFor="pj-origin" className="block text-xs mb-1">Origem do cadastro</label><input id="pj-origin" value={form.origin ?? ""} onChange={(e) => set("origin", e.target.value)} /></div>
                    <div className="sm:col-span-3"><label htmlFor="pj-notes" className="block text-xs mb-1">Observações administrativas</label><textarea id="pj-notes" rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Representantes e contatos (sempre pessoas físicas cadastradas)</h3>
                  {form.representatives && form.representatives.length > 0 && (
                    <ul className="grid gap-1.5 mb-3">
                      {form.representatives.map((r) => (
                        <li key={r.id} className="flex items-center justify-between text-sm bg-muted/50 px-3 py-2">
                          <span>{r.full_name}{r.role_title ? ` — ${r.role_title}` : ""} <span className="text-xs text-muted-foreground">({REP_LABEL[r.representation_type] ?? r.representation_type})</span></span>
                          <button className="text-destructive text-xs" onClick={() => removeRep(r.id)}>Remover</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid gap-2 sm:grid-cols-4 relative">
                    <div className="sm:col-span-2 relative">
                      <label htmlFor="pj-rep-search" className="sr-only">Buscar pessoa</label>
                      <input id="pj-rep-search" placeholder="Buscar pessoa física" value={repSearch} onChange={(e) => setRepSearch(e.target.value)} />
                      {found.data && found.data.length > 0 && (
                        <ul className="hp-card mt-1 overflow-hidden absolute z-10 w-full">
                          {found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => addRep(p.id)}>{p.full_name}</button></li>)}
                        </ul>
                      )}
                    </div>
                    <input placeholder="Cargo (opcional)" value={repRole} onChange={(e) => setRepRole(e.target.value)} />
                    <select value={repType} onChange={(e) => setRepType(e.target.value)}>{Object.entries(REP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </div>
                </section>
              </div>
            )}
          </div>
          <div className="px-5 py-4 border-t border-border flex justify-between gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Fechar</button>
            <button type="button" className={btnPrimary} onClick={() => void save()}>Salvar</button>
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
};

export default LegalEntitySheet;
