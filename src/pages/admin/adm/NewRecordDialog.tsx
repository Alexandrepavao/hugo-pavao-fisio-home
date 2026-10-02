import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { errText, Tabs, btnGhost, btnPrimary } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnits } from "../finance/shared";

/** Cria PF (reutiliza create_person — mesma verificação de duplicidade da tela Pessoas) ou PJ (legal_entity_upsert,
 *  valida CNPJ e duplicidade no servidor). Não é obrigatório preencher tudo aqui — o resto se completa na ficha. */
const NewRecordDialog = ({ open, onOpenChange, onCreatedPerson, onCreatedEntity }: {
  open: boolean; onOpenChange: (v: boolean) => void; onCreatedPerson: (id: string) => void; onCreatedEntity: (id: string) => void;
}) => {
  const [tab, setTab] = useState("pf");
  const units = useUnits();
  const [name, setName] = useState(""); const [unitId, setUnitId] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [legalName, setLegalName] = useState(""); const [cnpj, setCnpj] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [dupCandidates, setDupCandidates] = useState<{ full_name: string }[] | null>(null);

  const reset = () => { setName(""); setUnitId(""); setEmail(""); setPhone(""); setLegalName(""); setCnpj(""); setErr(null); setDupCandidates(null); };
  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const submitPf = async (e: FormEvent, force = false) => {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return setErr("Informe o nome.");
    if (!unitId) return setErr("Selecione a unidade.");
    setBusy(true);
    const { data, error } = await supabase.rpc("create_person", { p_full_name: name.trim(), p_unit_id: unitId, p_kinds: ["lead"], p_email: email || null, p_phone: phone || null, p_notes: null, p_force: force });
    setBusy(false);
    if (error) return setErr(errText(error));
    if (data.status === "duplicates") { setDupCandidates(data.candidates.map((c: { full_name: string; visible: boolean }) => ({ full_name: c.visible ? c.full_name : "Cadastro semelhante (sem permissão para ver o nome)" }))); return; }
    reset(); onCreatedPerson(data.id);
  };

  const submitPj = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!legalName.trim()) return setErr("Informe a razão social.");
    setBusy(true);
    const { data, error } = await supabase.rpc("legal_entity_upsert", { p_id: null, p_data: { legal_name: legalName.trim(), cnpj: cnpj || null } });
    setBusy(false);
    if (error) return setErr(errText(error));
    reset(); onCreatedEntity(data.id);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Novo cadastro</DialogTitle><DialogDescription>Comece com o mínimo — o resto se completa na ficha.</DialogDescription></DialogHeader>
        <Tabs tabs={[["pf", "Pessoa física"], ["pj", "Pessoa jurídica"]]} value={tab} onChange={(v) => { setTab(v); setErr(null); setDupCandidates(null); }} />

        {tab === "pf" && (
          <form onSubmit={(e) => submitPf(e)} id="new-pf" className="grid gap-3" noValidate>
            <div><label htmlFor="np-name" className="block mb-1">Nome completo</label><input id="np-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label htmlFor="np-unit" className="block mb-1">Unidade</label><select id="np-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Selecione…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div><label htmlFor="np-email" className="block mb-1">E-mail (opcional)</label><input id="np-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label htmlFor="np-phone" className="block mb-1">Telefone (opcional)</label><input id="np-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            {dupCandidates && (
              <div className="hp-card p-3 text-sm">
                <p className="font-medium mb-1">Cadastro(s) semelhante(s) encontrado(s):</p>
                <ul className="list-disc pl-4 mb-2">{dupCandidates.map((d, i) => <li key={i}>{d.full_name}</li>)}</ul>
                <button type="button" className={btnGhost + " hp-btn-sm"} onClick={(e) => submitPf(e as unknown as FormEvent, true)}>Criar mesmo assim</button>
              </div>
            )}
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          </form>
        )}
        {tab === "pj" && (
          <form onSubmit={submitPj} id="new-pj" className="grid gap-3" noValidate>
            <div><label htmlFor="np-razao" className="block mb-1">Razão social</label><input id="np-razao" value={legalName} onChange={(e) => setLegalName(e.target.value)} /></div>
            <div><label htmlFor="np-cnpj" className="block mb-1">CNPJ (opcional)</label><input id="np-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          </form>
        )}
        <DialogFooter>
          <button type="button" className={btnGhost} onClick={() => close(false)}>Cancelar</button>
          <button form={tab === "pf" ? "new-pf" : "new-pj"} disabled={busy} className={btnPrimary}>{busy ? "Criando…" : "Criar"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewRecordDialog;
