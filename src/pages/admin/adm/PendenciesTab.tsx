import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { download, fmtDate, fmtDateTime, toCsv } from "@/lib/format";
import { Badge, Msg, State, Table, Td, btnGhost, btnPrimary, errText, promptText, useMsg } from "@/lib/ui";
import { useUnits } from "../finance/shared";
import SubjectSearch, { type Subject } from "./SubjectSearch";
import { HISTORY_LABEL, PEND_KIND, PEND_STATUS, subjectRoute, useAssignable, usePendencies, type Pendency } from "./central";

const History = ({ id }: { id: string }) => {
  const h = useQuery({ queryKey: ["adm-pend-history", id], queryFn: async () => { const { data, error } = await supabase.rpc("adm_pendency_history", { p_id: id }); if (error) throw error; return data as { at: string; action: string; note: string | null; actor: string }[]; } });
  return (<div className="px-3 pb-3"><State loading={h.isLoading} error={h.error} />
    <ol className="grid gap-1 text-xs text-muted-foreground" aria-label="Histórico da pendência">{h.data?.map((e, i) => <li key={i}><span className="tabular">{fmtDateTime(e.at)}</span> · <b className="text-foreground">{HISTORY_LABEL[e.action] ?? e.action}</b>{e.note ? ` — ${e.note}` : ""} <span>({e.actor})</span></li>)}</ol></div>);
};

/** Pendências administrativas: registrar, atribuir, prazo, concluir (com nota), reabrir, cancelar, histórico e exportação. */
const PendenciesTab = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "open"); const [unit, setUnit] = useState(""); const [owner, setOwner] = useState(""); const [type, setType] = useState("");
  const [showNew, setShowNew] = useState(false); const [openHist, setOpenHist] = useState<string | null>(null);
  const units = useUnits(); const assignable = useAssignable(unit || undefined);
  const list = usePendencies(unit, { owner, type, kind: "", status: "" }, status === "all" ? "" : status, 300);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-pendencies"] }); void qc.invalidateQueries({ queryKey: ["adm-central"] }); void qc.invalidateQueries({ queryKey: ["adm-pend-history"] }); };
  const call = async (fn: string, args: Record<string, unknown>, ok: string) => { const { error } = await supabase.rpc(fn, args); if (error) m.err(errText(error)); else { m.ok(ok); refresh(); } };

  // novo
  const [kind, setKind] = useState("outro"); const [title, setTitle] = useState(""); const [detail, setDetail] = useState(""); const [subject, setSubject] = useState<Subject | null>(null);
  const [resp, setResp] = useState(""); const [due, setDue] = useState(""); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault(); if (title.trim().length < 3) return m.err("Descreva o motivo (mínimo 3 letras).");
    setBusy(true);
    const { error } = await supabase.rpc("adm_pendency_create", { p_kind: kind, p_title: title, p_detail: detail || null, p_subject_type: subject ? "person" : null, p_subject: subject?.id ?? null, p_unit: subject ? null : unit || null, p_responsible: resp || null, p_due: due || null });
    setBusy(false); if (error) return m.err(errText(error));
    m.ok("Pendência registrada."); setTitle(""); setDetail(""); setSubject(null); setResp(""); setDue(""); setShowNew(false); refresh();
  };

  const assign = async (p: Pendency) => {
    const v = await promptText("Responsável", "Quem fica responsável por esta pendência?", { kind: "select", required: false, defaultValue: p.responsible ?? "", options: [{ value: "", label: "Sem responsável" }, ...(assignable.data ?? []).map((u) => ({ value: u.user_id, label: u.name }))] });
    if (v === null) return; void call("adm_pendency_assign", { p_id: p.id, p_responsible: v || null }, "Responsável atualizado.");
  };
  const setDueDate = async (p: Pendency) => {
    const v = await promptText("Novo prazo", "Data (AAAA-MM-DD)", { defaultValue: p.due_date ?? "" }); if (v === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return m.err("Use o formato AAAA-MM-DD."); void call("adm_pendency_set_due", { p_id: p.id, p_due: v }, "Prazo atualizado.");
  };
  const resolve = async (p: Pendency) => { const v = await promptText("Concluir pendência", "Como foi resolvida?", { multiline: true, confirmLabel: "Concluir", required: true }); if (v) void call("adm_pendency_resolve", { p_id: p.id, p_note: v }, "Pendência concluída."); };
  const reopen = async (p: Pendency) => { const v = await promptText("Reabrir pendência", "Motivo da reabertura", { multiline: true, confirmLabel: "Reabrir", required: true }); if (v) void call("adm_pendency_reopen", { p_id: p.id, p_reason: v }, "Pendência reaberta."); };
  const cancel = async (p: Pendency) => { const v = await promptText("Cancelar pendência", "Motivo do cancelamento", { multiline: true, confirmLabel: "Cancelar pendência", danger: true, required: true }); if (v) void call("adm_pendency_cancel", { p_id: p.id, p_reason: v }, "Pendência cancelada."); };
  const exportCsv = () => download("pendencias-administrativas.csv", toCsv((list.data ?? []).map((p) => ({ Registro: p.subject_name ?? "", Tipo: PEND_KIND[p.kind] ?? p.kind, Motivo: p.title, Responsável: p.responsible_name ?? "", Unidade: p.unit_name ?? "", Prazo: p.due_date ?? "", Situação: p.overdue ? "Atrasada" : PEND_STATUS[p.status], Origem: p.origin === "auto" ? "Automática" : "Manual", "Aberta em": p.opened_at, "Concluída em": p.resolved_at ?? "" }))));

  return (
    <div className="grid gap-4">
      <Msg m={msg} />
      <div className="flex flex-wrap items-end gap-3">
        <div><label htmlFor="pd-status" className="block text-xs mb-1">Situação</label><select id="pd-status" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Abertas</option><option value="overdue">Atrasadas</option><option value="resolved">Concluídas</option><option value="cancelled">Canceladas</option><option value="all">Todas</option></select></div>
        <div><label htmlFor="pd-unit" className="block text-xs mb-1">Unidade</label><select id="pd-unit" className="!w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="pd-owner" className="block text-xs mb-1">Responsável</label><select id="pd-owner" className="!w-auto" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option>{assignable.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="pd-type" className="block text-xs mb-1">Cadastro</label><select id="pd-type" className="!w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">PF e PJ</option><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></div>
        <div className="ml-auto flex gap-2"><button type="button" className={btnGhost} onClick={exportCsv} disabled={!list.data?.length}>Exportar CSV</button><button type="button" className={btnPrimary} onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>Nova pendência</button></div>
      </div>
      {showNew && (
        <form onSubmit={create} className="hp-card p-4 grid gap-3 sm:grid-cols-2" aria-label="Nova pendência" noValidate>
          <div><label htmlFor="np-kind" className="block text-xs mb-1">Tipo</label><select id="np-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(PEND_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="np-title" className="block text-xs mb-1">Motivo</label><input id="np-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
          <SubjectSearch kind="person" value={subject} onChange={setSubject} id="np-subject" label="Cadastro vinculado (opcional)" />
          <div><label htmlFor="np-resp" className="block text-xs mb-1">Responsável</label><select id="np-resp" value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Sem responsável</option>{assignable.data?.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
          <div><label htmlFor="np-due" className="block text-xs mb-1">Prazo (vazio = prazo padrão do tipo)</label><input id="np-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div><label htmlFor="np-detail" className="block text-xs mb-1">Detalhes (sem informação de saúde)</label><input id="np-detail" value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} /></div>
          <div className="sm:col-span-2"><button className={btnPrimary} disabled={busy}>{busy ? "Registrando…" : "Registrar pendência"}</button></div>
        </form>)}
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma pendência neste filtro." />
      {list.data && list.data.length > 0 && (
        <Table head={["Registro", "Motivo", "Responsável", "Prazo", "Situação", "Ações"]}>
          {list.data.flatMap((p) => { const route = subjectRoute(p.subject_type, p.subject_name);
            return [
              <tr key={p.id}>
                <Td><span className="font-medium">{p.subject_name ?? "—"}</span><span className="block text-xs text-muted-foreground">{PEND_KIND[p.kind] ?? p.kind}{p.unit_name ? ` · ${p.unit_name}` : ""}</span></Td>
                <Td>{p.title}{p.origin === "auto" && <span className="block text-[11px] text-muted-foreground">detectada automaticamente</span>}</Td>
                <Td>{p.responsible_name ?? <span className="text-muted-foreground">Sem responsável</span>}</Td>
                <Td>{p.due_date ? <span className={p.overdue ? "text-destructive font-medium" : ""}>{fmtDate(`${p.due_date}T12:00:00Z`)}{p.overdue && ` (${p.overdue_days} d)`}</span> : "—"}</Td>
                <Td>{p.status === "open" ? (p.overdue ? <Badge tone="danger">Atrasada</Badge> : <Badge tone="info">Aberta</Badge>) : p.status === "resolved" ? <Badge tone="success">Concluída</Badge> : <Badge>Cancelada</Badge>}{p.reopened_count > 0 && <span className="block text-[11px] text-muted-foreground">reaberta {p.reopened_count}×</span>}</Td>
                <Td><span className="flex flex-wrap gap-1.5">
                  {p.status === "open" && <><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => resolve(p)}>Concluir</button><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => assign(p)}>Responsável</button><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => setDueDate(p)}>Prazo</button><button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => cancel(p)}>Cancelar</button></>}
                  {p.status === "resolved" && <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => reopen(p)}>Reabrir</button>}
                  {route && <Link className={`${btnGhost} hp-btn-sm`} to={route}>Abrir</Link>}
                  <button type="button" className={`${btnGhost} hp-btn-sm`} aria-expanded={openHist === p.id} onClick={() => setOpenHist(openHist === p.id ? null : p.id)}>Histórico</button></span></Td>
              </tr>,
              ...(openHist === p.id ? [<tr key={p.id + "-h"}><td colSpan={6} className="bg-muted/30"><History id={p.id} /></td></tr>] : []),
            ]; })}
        </Table>)}
    </div>
  );
};

export default PendenciesTab;
