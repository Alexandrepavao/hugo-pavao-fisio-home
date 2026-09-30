import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge, Msg, State, Table, Td, btnGhost, btnPrimary, confirmDialog, errText, useMsg } from "@/lib/ui";
import { KIND_LABEL, PEND_KIND, useAdmConfig, type AdmConfig } from "./central";

const APPLIES = ["pf", "pj", "professional", "patient", "lead", "student", "partner", "staff", "contact", "supplier"];
const CHECK = { field: "Dado do cadastro", document: "Documento vigente", contract: "Contrato assinado e vigente" } as const;

/** Prazos e requisitos configuráveis (por tipo de cadastro e vínculo). Só gestor/administrador operacional edita; quem administra a unidade apenas lê. Reaproveitável no ERP white label. */
const RequirementsTab = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const cfg = useAdmConfig(); const c = cfg.data;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-config"] }); void qc.invalidateQueries({ queryKey: ["adm-central"] }); void qc.invalidateQueries({ queryKey: ["adm-docs"] }); };
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) { m.err(errText(error)); return false; } m.ok(ok); refresh(); return true; };
  if (cfg.isLoading || cfg.error || !c) return <State loading={cfg.isLoading} error={cfg.error} />;
  return <Body c={c} msg={msg} call={call} />;
};

const Body = ({ c, msg, call }: { c: AdmConfig; msg: ReturnType<typeof useMsg>[0]; call: (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean> }) => {
  const ro = !c.can_edit;
  // prazos
  const [exp, setExp] = useState(String(c.settings.expiring_days)); const [low, setLow] = useState(String(c.settings.package_low_sessions)); const [wait, setWait] = useState(String(c.settings.waiting_alert_days));
  const [due, setDue] = useState<Record<string, string>>(Object.fromEntries(Object.keys(PEND_KIND).map((k) => [k, c.settings.pendency_due_days[k] != null ? String(c.settings.pendency_due_days[k]) : ""])));
  const saveSettings = async (e: FormEvent) => {
    e.preventDefault(); const dd: Record<string, number> = {}; for (const [k, v] of Object.entries(due)) if (v.trim()) dd[k] = Number(v);
    await call("adm_settings_save", { p_expiring_days: Number(exp), p_package_low_sessions: Number(low), p_waiting_alert_days: Number(wait), p_due_days: dd }, "Configuração salva.");
  };
  // tipo de documento
  const [dtCode, setDtCode] = useState(""); const [dtLabel, setDtLabel] = useState(""); const [dtApplies, setDtApplies] = useState("pf"); const [dtExpiry, setDtExpiry] = useState(true);
  const addType = async (e: FormEvent) => { e.preventDefault(); if (await call("adm_doc_type_save", { p_id: null, p_code: dtCode.trim(), p_label: dtLabel, p_applies_to: dtApplies, p_has_expiry: dtExpiry, p_active: true }, "Tipo de documento criado.")) { setDtCode(""); setDtLabel(""); } };
  // requisito
  const [rqApplies, setRqApplies] = useState("pf"); const [rqType, setRqType] = useState<"field" | "document" | "contract">("field"); const [rqRef, setRqRef] = useState(""); const [rqLabel, setRqLabel] = useState("");
  const refs = rqType === "field" ? (c.catalog.field_refs[rqApplies === "pj" ? "pj" : rqApplies === "professional" ? "professional" : "pf"] ?? []).map((r) => ({ ref: r.ref, label: r.label }))
    : rqType === "document" ? c.doc_types.filter((t) => t.active && t.applies_to === (rqApplies === "pj" ? "pj" : "pf")).map((t) => ({ ref: t.code, label: t.label })) : c.catalog.contract_kinds;
  const addReq = async (e: FormEvent) => { e.preventDefault(); const label = rqLabel.trim() || refs.find((r) => r.ref === rqRef)?.label || ""; if (!rqRef) return; if (await call("adm_requirement_save", { p_id: null, p_applies_to: rqApplies, p_check_type: rqType, p_check_ref: rqRef, p_label: label, p_required: true, p_active: true }, "Requisito criado.")) { setRqRef(""); setRqLabel(""); } };
  const refLabel = (r: AdmConfig["requirements"][number]) => r.check_type === "field" ? (c.catalog.field_refs[r.applies_to === "pj" ? "pj" : r.applies_to === "professional" ? "professional" : "pf"]?.find((x) => x.ref === r.check_ref)?.label ?? r.check_ref)
    : r.check_type === "document" ? (c.doc_types.find((t) => t.code === r.check_ref)?.label ?? r.check_ref) : (c.catalog.contract_kinds.find((k) => k.ref === r.check_ref)?.label ?? r.check_ref);

  return (
    <div className="grid gap-8">
      <Msg m={msg} />
      {ro && <p role="note" className="hp-card p-3 text-sm">Você pode <b>ver</b> os requisitos e prazos, mas só gestor e administrador operacional alteram.</p>}
      <section aria-label="Prazos e limites"><h2 className="text-xl mb-1">Prazos e limites</h2>
        <p className="text-sm text-muted-foreground mb-3">Janelas de vencimento e prazos padrão das pendências. Mudar aqui muda o cálculo dos indicadores na hora (nada é reescrito no histórico).</p>
        <form onSubmit={saveSettings} className="hp-card p-4 grid gap-3 sm:grid-cols-3" noValidate>
          <div><label htmlFor="st-exp" className="block text-xs mb-1">“Vencendo” = em até (dias)</label><input id="st-exp" inputMode="numeric" value={exp} disabled={ro} onChange={(e) => setExp(e.target.value)} /></div>
          <div><label htmlFor="st-low" className="block text-xs mb-1">Pacote “perto do fim” = saldo até (sessões)</label><input id="st-low" inputMode="numeric" value={low} disabled={ro} onChange={(e) => setLow(e.target.value)} /></div>
          <div><label htmlFor="st-wait" className="block text-xs mb-1">Solicitação “esperando demais” = a partir de (dias)</label><input id="st-wait" inputMode="numeric" value={wait} disabled={ro} onChange={(e) => setWait(e.target.value)} /></div>
          <fieldset className="sm:col-span-3 grid gap-2 sm:grid-cols-3"><legend className="text-xs mb-1">Prazo padrão das pendências, por tipo (dias; vazio = 7)</legend>
            {Object.entries(PEND_KIND).map(([k, l]) => <div key={k}><label htmlFor={`due-${k}`} className="block text-xs mb-1">{l}</label><input id={`due-${k}`} inputMode="numeric" value={due[k]} disabled={ro} onChange={(e) => setDue({ ...due, [k]: e.target.value })} /></div>)}</fieldset>
          {!ro && <div className="sm:col-span-3"><button className={btnPrimary}>Salvar prazos</button></div>}
        </form>
      </section>

      <section aria-label="Tipos de documento"><h2 className="text-xl mb-1">Tipos de documento</h2>
        <p className="text-sm text-muted-foreground mb-3">Catálogo dos documentos que podem ser registrados. O código não muda depois de criado (os requisitos apontam para ele).</p>
        {c.doc_types.length === 0 ? <p className="text-sm text-muted-foreground mb-3">Nenhum tipo ainda.</p> : (
          <Table head={["Tipo", "Código", "Cadastro", "Vence?", "Situação"]}>{c.doc_types.map((t) => (
            <tr key={t.id}><Td>{t.label}</Td><Td className="tabular text-xs">{t.code}</Td><Td>{t.applies_to === "pf" ? "Pessoa física" : "Pessoa jurídica"}</Td><Td>{t.has_expiry ? "Sim" : "Não"}</Td>
              <Td><span className="flex items-center gap-2">{t.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}{!ro && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => call("adm_doc_type_save", { p_id: t.id, p_code: t.code, p_label: t.label, p_applies_to: t.applies_to, p_has_expiry: t.has_expiry, p_active: !t.active }, t.active ? "Tipo desativado." : "Tipo ativado.")}>{t.active ? "Desativar" : "Ativar"}</button>}</span></Td></tr>))}</Table>)}
        {!ro && <form onSubmit={addType} className="hp-card p-4 mt-3 grid gap-3 sm:grid-cols-4 items-end" aria-label="Novo tipo de documento" noValidate>
          <div><label htmlFor="dt-label" className="block text-xs mb-1">Nome</label><input id="dt-label" value={dtLabel} onChange={(e) => setDtLabel(e.target.value)} /></div>
          <div><label htmlFor="dt-code" className="block text-xs mb-1">Código (a-z, 0-9, _)</label><input id="dt-code" value={dtCode} onChange={(e) => setDtCode(e.target.value)} /></div>
          <div><label htmlFor="dt-ap" className="block text-xs mb-1">Cadastro</label><select id="dt-ap" value={dtApplies} onChange={(e) => setDtApplies(e.target.value)}><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></div>
          <div><label className="flex items-center gap-2 text-sm !font-normal mb-2"><input type="checkbox" checked={dtExpiry} onChange={(e) => setDtExpiry(e.target.checked)} />Tem validade</label><button className={btnPrimary}>Criar tipo</button></div>
        </form>}
      </section>

      <section aria-label="Requisitos"><h2 className="text-xl mb-1">Requisitos por tipo de cadastro e vínculo</h2>
        <p className="text-sm text-muted-foreground mb-3">Um cadastro está <b>completo</b> quando atende todos os requisitos ativos e obrigatórios do seu tipo (PF/PJ) e de cada um dos seus vínculos. Profissional: requisitos para atender. Os primeiros são o padrão que já valia (documento, cidade, UF, contato) — edite à vontade.</p>
        <Table head={["Vale para", "Tipo", "Requisito", "Obrigatório", "Ativo", ""]}>{c.requirements.map((r) => (
          <tr key={r.id}><Td>{KIND_LABEL[r.applies_to] ?? r.applies_to}</Td><Td>{CHECK[r.check_type]}</Td><Td>{r.label}<span className="block text-xs text-muted-foreground">{refLabel(r)}</span></Td>
            <Td>{ro ? (r.required ? "Sim" : "Não") : <input type="checkbox" aria-label={`Obrigatório: ${r.label}`} checked={r.required} onChange={() => call("adm_requirement_save", { p_id: r.id, p_applies_to: r.applies_to, p_check_type: r.check_type, p_check_ref: r.check_ref, p_label: r.label, p_required: !r.required, p_active: r.active }, "Requisito atualizado.")} />}</Td>
            <Td>{ro ? (r.active ? "Sim" : "Não") : <input type="checkbox" aria-label={`Ativo: ${r.label}`} checked={r.active} onChange={() => call("adm_requirement_save", { p_id: r.id, p_applies_to: r.applies_to, p_check_type: r.check_type, p_check_ref: r.check_ref, p_label: r.label, p_required: r.required, p_active: !r.active }, "Requisito atualizado.")} />}</Td>
            <Td>{!ro && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={async () => { if (await confirmDialog("Excluir requisito?", r.label, "Excluir", true)) void call("adm_requirement_delete", { p_id: r.id }, "Requisito excluído."); }}>Excluir</button>}</Td></tr>))}</Table>
        {!ro && <form onSubmit={addReq} className="hp-card p-4 mt-3 grid gap-3 sm:grid-cols-5 items-end" aria-label="Novo requisito" noValidate>
          <div><label htmlFor="rq-ap" className="block text-xs mb-1">Vale para</label><select id="rq-ap" value={rqApplies} onChange={(e) => { setRqApplies(e.target.value); setRqRef(""); }}>{APPLIES.map((a) => <option key={a} value={a}>{KIND_LABEL[a] ?? a}</option>)}</select></div>
          <div><label htmlFor="rq-type" className="block text-xs mb-1">Tipo de requisito</label><select id="rq-type" value={rqType} onChange={(e) => { setRqType(e.target.value as "field" | "document" | "contract"); setRqRef(""); }}>{Object.entries(CHECK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="rq-ref" className="block text-xs mb-1">Exigir</label><select id="rq-ref" value={rqRef} onChange={(e) => setRqRef(e.target.value)}><option value="">Selecione…</option>{refs.map((r) => <option key={r.ref} value={r.ref}>{r.label}</option>)}</select></div>
          <div><label htmlFor="rq-label" className="block text-xs mb-1">Rótulo (opcional)</label><input id="rq-label" value={rqLabel} onChange={(e) => setRqLabel(e.target.value)} /></div>
          <div><button className={btnPrimary}>Adicionar requisito</button></div>
        </form>}
      </section>
    </div>
  );
};

export default RequirementsTab;
