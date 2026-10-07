import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Msg, State, Table, Td, btnGhost, btnPrimary, errText, promptText, useMsg } from "@/lib/ui";
import { useUnits } from "../finance/shared";
import SubjectSearch, { type Subject } from "./SubjectSearch";
import { CONTRACT_KIND, CONTRACT_STATUS, HISTORY_LABEL, useAssignable } from "./central";

interface Row { id: string; kind: string; title: string; subject_type: string; subject_name: string | null; responsible: string | null; responsible_name: string | null; status: string; starts_on: string | null; ends_on: string | null; due_date: string | null; sent_at: string | null; signed_on: string | null; situation: string }
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const d = (v: string | null) => (v ? fmtDate(`${v}T12:00:00Z`) : "—");

const History = ({ id }: { id: string }) => {
  const h = useQuery({ queryKey: ["adm-contract-history", id], queryFn: async () => { const { data, error } = await supabase.rpc("adm_contract_history", { p_id: id }); if (error) throw error; return data as { at: string; action: string; note: string | null; actor: string }[]; } });
  return (<div className="px-3 pb-3"><State loading={h.isLoading} error={h.error} />
    <ol className="grid gap-1 text-xs text-muted-foreground" aria-label="Histórico do contrato">{h.data?.map((e, i) => <li key={i}><span className="tabular">{fmtDateTime(e.at)}</span> · <b className="text-foreground">{HISTORY_LABEL[e.action] ?? e.action}</b>{e.note ? ` — ${e.note}` : ""} <span>({e.actor})</span></li>)}</ol></div>);
};

/** Contratos ADMINISTRATIVOS (não os de venda nem os de receita recorrente): rascunho → enviado para assinatura → assinatura REGISTRADA manualmente. Não é assinatura eletrônica. */
const ContractsTab = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const units = useUnits();
  const [status, setStatus] = useState(""); const [unit, setUnit] = useState(""); const [owner, setOwner] = useState(""); const [showNew, setShowNew] = useState(false); const [openHist, setOpenHist] = useState<string | null>(null);
  const assignable = useAssignable(unit || undefined);
  const list = useQuery({ queryKey: ["adm-contracts", unit, owner, status], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("adm_contracts_list", { p_unit: unit || null, p_owner: owner || null, p_type: null, p_status: status || null, p_limit: 300 }); if (error) throw error; return data as Row[]; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-contracts"] }); void qc.invalidateQueries({ queryKey: ["adm-central"] }); void qc.invalidateQueries({ queryKey: ["adm-contract-history"] }); };
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) m.err(errText(error)); else { m.ok(ok); refresh(); } };

  const [kind, setKind] = useState("prestacao_servico"); const [subKind, setSubKind] = useState<"person" | "legal_entity">("person"); const [subject, setSubject] = useState<Subject | null>(null);
  const [title, setTitle] = useState(""); const [resp, setResp] = useState(""); const [starts, setStarts] = useState(""); const [ends, setEnds] = useState(""); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!subject) return m.err("Escolha o cadastro."); if (title.trim().length < 2) return m.err("Informe o título do contrato.");
    setBusy(true);
    const { error } = await supabase.rpc("adm_contract_create", { p_kind: kind, p_title: title, p_subject_type: subKind, p_subject: subject.id, p_responsible: resp || null, p_starts_on: starts || null, p_ends_on: ends || null, p_notes: null });
    setBusy(false); if (error) return m.err(errText(error));
    m.ok("Contrato registrado como rascunho."); setTitle(""); setSubject(null); setStarts(""); setEnds(""); setShowNew(false); refresh();
  };
  const send = async (r: Row) => { const v = await promptText("Enviar para assinatura", "Prazo para assinar (AAAA-MM-DD)", { defaultValue: "", confirmLabel: "Enviar", required: false }); if (v === null) return;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return m.err("Use o formato AAAA-MM-DD."); void call("adm_contract_send", { p_id: r.id, p_sign_until: v || null }, "Contrato enviado para assinatura."); };
  const sign = async (r: Row) => { const v = await promptText("Registrar assinatura", "Data em que foi assinado (AAAA-MM-DD). É um registro manual, não assinatura eletrônica.", { defaultValue: today(), confirmLabel: "Registrar" }); if (v === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return m.err("Use o formato AAAA-MM-DD."); void call("adm_contract_sign", { p_id: r.id, p_signed_on: v, p_note: null }, "Assinatura registrada."); };
  const cancel = async (r: Row) => { const v = await promptText("Cancelar contrato", "Motivo", { multiline: true, confirmLabel: "Cancelar contrato", danger: true, required: true }); if (v) void call("adm_contract_cancel", { p_id: r.id, p_reason: v }, "Contrato cancelado."); };
  const assign = async (r: Row) => { const v = await promptText("Responsável", "Quem acompanha este contrato?", { kind: "select", required: false, defaultValue: r.responsible ?? "", options: [{ value: "", label: "Sem responsável" }, ...(assignable.data ?? []).map((u) => ({ value: u.user_id, label: u.name }))] }); if (v !== null) void call("adm_contract_assign", { p_id: r.id, p_responsible: v || null }, "Responsável atualizado."); };

  return (
    <div className="grid gap-4">
      <Msg m={msg} />
      <p className="text-sm text-muted-foreground">Contrato administrativo do cadastro (prestação de serviço, parceria, termo…). <b>Registrar a assinatura é um registro manual</b> — não há assinatura eletrônica nesta versão. Contratos de venda e de receita recorrente continuam nas áreas deles.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div><label htmlFor="ct-status" className="block text-xs mb-1">Situação</label><select id="ct-status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(CONTRACT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="ct-unit" className="block text-xs mb-1">Unidade</label><select id="ct-unit" className="!w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="ct-owner" className="block text-xs mb-1">Responsável</label><select id="ct-owner" className="!w-auto" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option>{assignable.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
        <div className="ml-auto"><button type="button" className={btnPrimary} onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>Novo contrato</button></div>
      </div>
      {showNew && (
        <form onSubmit={create} className="hp-card p-4 grid gap-3 sm:grid-cols-2" aria-label="Novo contrato" noValidate>
          <div><label htmlFor="nc-kind" className="block text-xs mb-1">Tipo de contrato</label><select id="nc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(CONTRACT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="nc-title" className="block text-xs mb-1">Título</label><input id="nc-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label htmlFor="nc-sub" className="block text-xs mb-1">Cadastro</label><select id="nc-sub" value={subKind} onChange={(e) => { setSubKind(e.target.value as "person" | "legal_entity"); setSubject(null); }}><option value="person">Pessoa física</option><option value="legal_entity">Pessoa jurídica</option></select></div>
          <SubjectSearch kind={subKind} value={subject} onChange={setSubject} id="nc-subject" label="Nome" />
          <div><label htmlFor="nc-resp" className="block text-xs mb-1">Responsável</label><select id="nc-resp" value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Sem responsável</option>{assignable.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2"><div><label htmlFor="nc-start" className="block text-xs mb-1">Início</label><input id="nc-start" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} /></div><div><label htmlFor="nc-end" className="block text-xs mb-1">Término</label><input id="nc-end" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} /></div></div>
          <div className="sm:col-span-2"><button className={btnPrimary} disabled={busy}>{busy ? "Registrando…" : "Registrar contrato"}</button></div>
        </form>)}
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhum contrato neste filtro." />
      {list.data && list.data.length > 0 && (
        <Table head={["Contrato", "Cadastro", "Responsável", "Datas", "Situação", "Ações"]}>
          {list.data.flatMap((r) => [
            <tr key={r.id}>
              <Td><span className="font-medium">{r.title}</span><span className="block text-xs text-muted-foreground">{CONTRACT_KIND[r.kind] ?? r.kind}</span></Td>
              <Td>{r.subject_name ?? "—"}<span className="block text-xs text-muted-foreground">{r.subject_type === "person" ? "Pessoa física" : "Pessoa jurídica"}</span></Td>
              <Td>{r.responsible_name ?? <span className="text-muted-foreground">Sem responsável</span>}</Td>
              <Td className="text-xs">Vigência: {d(r.starts_on)} a {d(r.ends_on)}{r.status === "awaiting_signature" && <span className="block">Assinar até {d(r.due_date)}</span>}{r.signed_on && <span className="block">Assinado em {d(r.signed_on)}</span>}</Td>
              <Td><Badge tone={r.situation === "vencido" ? "danger" : r.situation === "a_vencer" || r.status === "awaiting_signature" ? "warning" : r.status === "signed" ? "success" : "neutral"}>{CONTRACT_STATUS[r.situation] ?? r.situation}</Badge>
                {r.status === "awaiting_signature" && r.due_date && r.due_date < today() && <span className="block text-[11px] text-destructive">prazo de assinatura vencido</span>}</Td>
              <Td><span className="flex flex-wrap gap-1.5">
                {r.status === "draft" && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => send(r)}>Enviar para assinatura</button>}
                {r.status === "awaiting_signature" && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => sign(r)}>Registrar assinatura</button>}
                {r.status !== "cancelled" && <><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => assign(r)}>Responsável</button><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => cancel(r)}>Cancelar</button></>}
                <button type="button" className={`${btnGhost} hp-btn-sm`} aria-expanded={openHist === r.id} onClick={() => setOpenHist(openHist === r.id ? null : r.id)}>Histórico</button></span></Td>
            </tr>,
            ...(openHist === r.id ? [<tr key={r.id + "-h"}><td colSpan={6} className="bg-muted/30"><History id={r.id} /></td></tr>] : []),
          ])}
        </Table>)}
    </div>
  );
};

export default ContractsTab;
