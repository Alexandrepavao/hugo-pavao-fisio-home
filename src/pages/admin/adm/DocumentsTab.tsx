import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { Badge, Msg, State, Table, Td, btnGhost, btnPrimary, confirmDialog, errText, useMsg } from "@/lib/ui";
import { useUnits } from "../finance/shared";
import SubjectSearch, { type Subject } from "./SubjectSearch";
import { DOC_STATE, useAdmConfig } from "./central";

interface DocRow { doc_id?: string; subject_type: string; subject_id: string; subject_name: string; doc_type: string; title?: string; expires_on?: string | null; state: string }

/** Documentos de cadastro (PF e PJ): registrar com validade, acompanhar vencidos/vencendo/sem validade e ver o que é exigido e está ausente. O arquivo é opcional nesta etapa. */
const DocumentsTab = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const cfg = useAdmConfig(); const units = useUnits();
  const [state, setState] = useState(""); const [type, setType] = useState(""); const [unit, setUnit] = useState(""); const [showNew, setShowNew] = useState(false);
  const list = useQuery({ queryKey: ["adm-docs", unit, type, state], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("adm_documents_list", { p_unit: unit || null, p_type: type || null, p_state: state || null, p_limit: 300 }); if (error) throw error; return data as DocRow[]; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-docs"] }); void qc.invalidateQueries({ queryKey: ["adm-central"] }); };

  const [kind, setKind] = useState<"person" | "legal_entity">("person"); const [subject, setSubject] = useState<Subject | null>(null); const [dt, setDt] = useState("");
  const [title, setTitle] = useState(""); const [ref, setRef] = useState(""); const [issued, setIssued] = useState(""); const [expires, setExpires] = useState(""); const [busy, setBusy] = useState(false);
  const types = (cfg.data?.doc_types ?? []).filter((t) => t.active && t.applies_to === (kind === "person" ? "pf" : "pj"));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!subject) return m.err("Escolha o cadastro."); if (!dt) return m.err("Escolha o tipo de documento."); if (title.trim().length < 2) return m.err("Informe o título.");
    setBusy(true);
    const { error } = await supabase.rpc("adm_document_register", { p_subject_type: kind, p_subject: subject.id, p_doc_type: dt, p_title: title, p_reference: ref || null, p_issued_on: issued || null, p_expires_on: expires || null, p_notes: null });
    setBusy(false); if (error) return m.err(errText(error));
    m.ok("Documento registrado."); setTitle(""); setRef(""); setIssued(""); setExpires(""); setSubject(null); setShowNew(false); refresh();
  };
  const remove = async (r: DocRow) => {
    if (!r.doc_id || !(await confirmDialog("Remover documento?", `${r.doc_type} de ${r.subject_name}. O registro deixa de valer (fica guardado no histórico do banco).`, "Remover", true))) return;
    const { error } = await supabase.rpc("adm_document_remove", { p_subject_type: r.subject_type === "pf" ? "person" : "legal_entity", p_id: r.doc_id });
    if (error) m.err(errText(error)); else { m.ok("Documento removido."); refresh(); }
  };

  return (
    <div className="grid gap-4">
      <Msg m={msg} />
      <p className="text-sm text-muted-foreground">Só o documento <b>mais recente de cada tipo</b> conta como vigente (renovar não deixa o antigo “vencido”). “Ausente” = documento exigido por um requisito (aba Requisitos) sem nenhum registro. Não registre informação de saúde aqui.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div><label htmlFor="dc-state" className="block text-xs mb-1">Situação</label><select id="dc-state" className="!w-auto" value={state} onChange={(e) => setState(e.target.value)}><option value="">Todas</option>{Object.entries(DOC_STATE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="dc-type" className="block text-xs mb-1">Cadastro</label><select id="dc-type" className="!w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">PF e PJ</option><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></div>
        <div><label htmlFor="dc-unit" className="block text-xs mb-1">Unidade</label><select id="dc-unit" className="!w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="ml-auto"><button type="button" className={btnPrimary} onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>Registrar documento</button></div>
      </div>
      {showNew && (
        <form onSubmit={submit} className="hp-card p-4 grid gap-3 sm:grid-cols-2" aria-label="Registrar documento" noValidate>
          <div><label htmlFor="rd-kind" className="block text-xs mb-1">Tipo de cadastro</label><select id="rd-kind" value={kind} onChange={(e) => { setKind(e.target.value as "person" | "legal_entity"); setSubject(null); setDt(""); }}><option value="person">Pessoa física</option><option value="legal_entity">Pessoa jurídica</option></select></div>
          <SubjectSearch kind={kind} value={subject} onChange={setSubject} id="rd-subject" />
          <div><label htmlFor="rd-type" className="block text-xs mb-1">Tipo de documento</label><select id="rd-type" value={dt} onChange={(e) => setDt(e.target.value)}><option value="">Selecione…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.has_expiry ? "" : " (não vence)"}</option>)}</select>
            {types.length === 0 && <p className="text-xs text-muted-foreground mt-1">Nenhum tipo configurado para este cadastro — crie em Requisitos › Tipos de documento.</p>}</div>
          <div><label htmlFor="rd-title" className="block text-xs mb-1">Título</label><input id="rd-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label htmlFor="rd-ref" className="block text-xs mb-1">Número/referência (opcional)</label><input id="rd-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2"><div><label htmlFor="rd-iss" className="block text-xs mb-1">Emissão</label><input id="rd-iss" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} /></div><div><label htmlFor="rd-exp" className="block text-xs mb-1">Validade</label><input id="rd-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div></div>
          <div className="sm:col-span-2"><button className={btnPrimary} disabled={busy}>{busy ? "Registrando…" : "Registrar"}</button></div>
        </form>)}
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhum documento neste filtro." />
      {list.data && list.data.length > 0 && (
        <Table head={["Cadastro", "Documento", "Validade", "Situação", ""]}>
          {list.data.map((r, i) => (
            <tr key={(r.doc_id ?? r.subject_id) + i}>
              <Td><span className="font-medium">{r.subject_name}</span><span className="block text-xs text-muted-foreground">{r.subject_type === "pf" ? "Pessoa física" : r.subject_type === "pj" ? "Pessoa jurídica" : "Profissional"}</span></Td>
              <Td>{r.doc_type}{r.title ? <span className="block text-xs text-muted-foreground">{r.title}</span> : null}</Td>
              <Td>{r.expires_on ? fmtDate(`${r.expires_on}T12:00:00Z`) : "—"}</Td>
              <Td><Badge tone={r.state === "vencido" || r.state === "ausente" ? "danger" : r.state === "vencendo" || r.state === "sem_validade" ? "warning" : "success"}>{DOC_STATE[r.state] ?? r.state}</Badge></Td>
              <Td>{r.doc_id && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => remove(r)}>Remover</button>}</Td>
            </tr>))}
        </Table>)}
    </div>
  );
};

export default DocumentsTab;
