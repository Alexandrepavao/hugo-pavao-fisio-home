import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errText, Msg, useMsg, btnGhost, btnPrimary } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUnits } from "../finance/shared";
import type { StaffUser } from "../crm/types";

interface PersonDetail {
  id: string; full_name: string; preferred_name: string | null; document_number: string | null;
  cep: string | null; street: string | null; street_number: string | null; complement: string | null; neighborhood: string | null;
  city: string | null; state_uf: string | null; country: string | null;
  registration_status: string; origin: string | null; internal_owner_user_id: string | null; notes: string | null;
  unit_id: string | null;
  contacts: { id: string; type: string; value: string; is_primary: boolean }[];
  kinds: string[];
  extra_units: string[];
}

const KIND_LABEL: Record<string, string> = { lead: "Lead", patient: "Paciente", partner: "Parceiro", student: "Aluno", staff: "Colaborador", contact: "Contato", supplier: "Fornecedor" };

/** Ficha de pessoa física: edição dos campos administrativos, sobre o cadastro central (people/person_contacts).
 *  Documento sempre completo aqui (a tela só abre pra quem já vê o diretório; máscara é só na listagem). */
const PersonAdmSheet = ({ personId, onClose, onChanged }: { personId: string | null; onClose: () => void; onChanged: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const units = useUnits();
  const [form, setForm] = useState<Partial<PersonDetail>>({});
  const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const open = !!personId;

  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const detail = useQuery({ queryKey: ["adm-person", personId], enabled: open, queryFn: async () => {
    const { data: p, error } = await supabase.from("people").select("id, full_name, preferred_name, document_number, cep, street, street_number, complement, neighborhood, city, state_uf, country, registration_status, origin, internal_owner_user_id, notes, unit_id").eq("id", personId!).single();
    if (error) throw error;
    const { data: contacts } = await supabase.from("person_contacts").select("id, type, value, is_primary").eq("person_id", personId!);
    const { data: kinds } = await supabase.from("person_kinds").select("kind").eq("person_id", personId!);
    const { data: extraUnits } = await supabase.from("person_units").select("unit_id").eq("person_id", personId!);
    return { ...p, contacts: contacts ?? [], kinds: (kinds ?? []).map((k) => k.kind), extra_units: (extraUnits ?? []).map((u) => u.unit_id) } as PersonDetail;
  } });

  useEffect(() => {
    if (detail.data) {
      setForm(detail.data);
      setEmail(detail.data.contacts.find((c) => c.type === "email")?.value ?? "");
      setPhone(detail.data.contacts.find((c) => c.type === "phone" || c.type === "whatsapp")?.value ?? "");
    }
  }, [detail.data]);

  const save = async () => {
    if (!personId) return;
    const { error } = await supabase.from("people").update({
      full_name: form.full_name, preferred_name: form.preferred_name || null, document_number: form.document_number || null,
      cep: form.cep || null, street: form.street || null, street_number: form.street_number || null, complement: form.complement || null,
      neighborhood: form.neighborhood || null, city: form.city || null, state_uf: form.state_uf || null, country: form.country || "BR",
      registration_status: form.registration_status || "ativo", origin: form.origin || null,
      internal_owner_user_id: form.internal_owner_user_id || null, notes: form.notes || null,
    }).eq("id", personId);
    if (error) return m.err(errText(error));

    const existingEmail = detail.data?.contacts.find((c) => c.type === "email");
    if (email && !existingEmail) await supabase.from("person_contacts").insert({ org_id: (await supabase.from("people").select("org_id").eq("id", personId).single()).data?.org_id, person_id: personId, type: "email", value: email, is_primary: true });
    else if (email && existingEmail && email !== existingEmail.value) await supabase.from("person_contacts").update({ value: email }).eq("id", existingEmail.id);
    else if (!email && existingEmail) await supabase.from("person_contacts").delete().eq("id", existingEmail.id);

    const existingPhone = detail.data?.contacts.find((c) => c.type === "phone" || c.type === "whatsapp");
    if (phone && !existingPhone) await supabase.from("person_contacts").insert({ org_id: (await supabase.from("people").select("org_id").eq("id", personId).single()).data?.org_id, person_id: personId, type: "phone", value: phone, is_primary: true });
    else if (phone && existingPhone && phone !== existingPhone.value) await supabase.from("person_contacts").update({ value: phone }).eq("id", existingPhone.id);
    else if (!phone && existingPhone) await supabase.from("person_contacts").delete().eq("id", existingPhone.id);

    m.ok("Cadastro salvo.");
    void qc.invalidateQueries({ queryKey: ["adm-person", personId] });
    onChanged();
  };

  const set = <K extends keyof PersonDetail>(k: K, v: PersonDetail[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        {personId && (<>
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{form.full_name ?? "Pessoa física"}</SheetTitle>
            <SheetDescription>Vínculos: {(form.kinds ?? []).map((k) => KIND_LABEL[k] ?? k).join(", ") || "nenhum"}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <Msg m={msg} />
            {detail.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {form.id && (
              <div className="grid gap-4">
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Identificação</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label htmlFor="pf-name" className="block text-xs mb-1">Nome completo</label><input id="pf-name" value={form.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></div>
                    <div><label htmlFor="pf-pref" className="block text-xs mb-1">Nome preferido</label><input id="pf-pref" value={form.preferred_name ?? ""} onChange={(e) => set("preferred_name", e.target.value)} /></div>
                    <div><label htmlFor="pf-doc" className="block text-xs mb-1">CPF</label><input id="pf-doc" value={form.document_number ?? ""} onChange={(e) => set("document_number", e.target.value)} placeholder="000.000.000-00" /></div>
                    <div><label htmlFor="pf-email" className="block text-xs mb-1">E-mail</label><input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                    <div><label htmlFor="pf-phone" className="block text-xs mb-1">Telefone/WhatsApp</label><input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Endereço</h3>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div><label htmlFor="pf-cep" className="block text-xs mb-1">CEP</label><input id="pf-cep" value={form.cep ?? ""} onChange={(e) => set("cep", e.target.value)} /></div>
                    <div className="sm:col-span-2"><label htmlFor="pf-street" className="block text-xs mb-1">Logradouro</label><input id="pf-street" value={form.street ?? ""} onChange={(e) => set("street", e.target.value)} /></div>
                    <div><label htmlFor="pf-num" className="block text-xs mb-1">Número</label><input id="pf-num" value={form.street_number ?? ""} onChange={(e) => set("street_number", e.target.value)} /></div>
                    <div><label htmlFor="pf-comp" className="block text-xs mb-1">Complemento</label><input id="pf-comp" value={form.complement ?? ""} onChange={(e) => set("complement", e.target.value)} /></div>
                    <div><label htmlFor="pf-bairro" className="block text-xs mb-1">Bairro</label><input id="pf-bairro" value={form.neighborhood ?? ""} onChange={(e) => set("neighborhood", e.target.value)} /></div>
                    <div><label htmlFor="pf-city" className="block text-xs mb-1">Cidade</label><input id="pf-city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></div>
                    <div><label htmlFor="pf-uf" className="block text-xs mb-1">UF</label><input id="pf-uf" maxLength={2} value={form.state_uf ?? ""} onChange={(e) => set("state_uf", e.target.value.toUpperCase())} /></div>
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Administrativo</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><label htmlFor="pf-status" className="block text-xs mb-1">Status cadastral</label>
                      <select id="pf-status" value={form.registration_status ?? "ativo"} onChange={(e) => set("registration_status", e.target.value)}><option value="ativo">Ativo</option><option value="pendente">Pendente</option><option value="inativo">Inativo</option></select></div>
                    <div><label htmlFor="pf-owner" className="block text-xs mb-1">Responsável interno</label>
                      <select id="pf-owner" value={form.internal_owner_user_id ?? ""} onChange={(e) => set("internal_owner_user_id", e.target.value)}><option value="">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
                    <div><label htmlFor="pf-origin" className="block text-xs mb-1">Origem do cadastro</label><input id="pf-origin" value={form.origin ?? ""} onChange={(e) => set("origin", e.target.value)} placeholder="Ex.: indicação, site, evento" /></div>
                    <div><label htmlFor="pf-unit" className="block text-xs mb-1">Unidade principal</label>
                      <select id="pf-unit" value={form.unit_id ?? ""} disabled><option value="">—</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                      <p className="text-[11px] text-muted-foreground mt-1">Unidade principal é definida em Pessoas.</p></div>
                    <div className="sm:col-span-3"><label htmlFor="pf-notes" className="block text-xs mb-1">Observações administrativas</label><textarea id="pf-notes" rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>
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

export default PersonAdmSheet;
