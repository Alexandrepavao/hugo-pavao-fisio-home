import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDateTime } from "@/lib/format";
import { Badge, errText, Msg, Tabs, promptText, useMsg } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import LeadTypeBadge from "./LeadTypeBadge";
import { LEAD_TYPE, isLeadKind, pipeLabel } from "./leadTypes";
import { cardName, isStale, type Opp, type PipelineInfo, type Stage, type StaffUser, type Task } from "./types";

interface SiblingOpp { id: string; title: string; status: string; stage_id: string; pipeline_id: string; created_at: string; legal_entity: { legal_name: string; trade_name: string | null } | null }

interface Props { opp: Opp | null; stages: Stage[]; users: StaffUser[]; onClose: () => void; onChanged: () => void }

const CHANNELS: [string, string][] = [["note", "Nota"], ["call", "Ligação"], ["meeting", "Reunião"], ["whatsapp", "WhatsApp (registro manual)"], ["email", "E-mail (registro manual)"]];
const CH_LABEL: Record<string, string> = { note: "Nota", call: "Ligação", meeting: "Reunião", whatsapp: "WhatsApp", email: "E-mail", system: "Sistema" };
const EV_LABEL: Record<string, string> = { stage_changed: "Mudança de etapa", owner_changed: "Troca de responsável", created: "Oportunidade criada" };

/** Painel lateral da oportunidade: resumo, histórico unificado e tarefas. */
const OpportunitySheet = ({ opp, stages, users, onClose, onChanged }: Props) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [tab, setTab] = useState("resumo");
  const [note, setNote] = useState(""); const [channel, setChannel] = useState("note"); const [taskTitle, setTaskTitle] = useState(""); const [taskDue, setTaskDue] = useState("");
  const id = opp?.id;
  const hist = useQuery({ queryKey: ["opp-hist", id], enabled: !!id, queryFn: async () => {
    const [i, e] = await Promise.all([
      supabase.from("interactions").select("id, channel, summary, created_at").eq("opportunity_id", id!).order("created_at", { ascending: false }),
      supabase.from("opportunity_events").select("id, kind, created_at, from_stage_id, to_stage_id").eq("opportunity_id", id!).order("created_at", { ascending: false })]);
    return { interactions: i.data ?? [], events: e.data ?? [] };
  } });
  const tasks = useQuery({ queryKey: ["opp-tasks", id], enabled: !!id, queryFn: async () => (await supabase.from("crm_tasks").select("*").eq("opportunity_id", id!).is("done_at", null).order("due_at")).data as Task[] });
  const pipes = useQuery({ queryKey: ["pipelines-info"], queryFn: async () => ((await supabase.from("pipelines").select("id, name, kind").eq("active", true)).data ?? []) as PipelineInfo[] });
  const allStages = useQuery({ queryKey: ["stages-all"], queryFn: async () => (await supabase.from("pipeline_stages").select("*").order("position")).data as Stage[] });
  const reasons = useQuery({ queryKey: ["loss"], queryFn: async () => (await supabase.from("loss_reasons").select("id, name").eq("active", true)).data ?? [] });
  const mine = useQuery({ queryKey: ["person-opps", opp?.person_id], enabled: !!opp, queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("id, title, status, stage_id, pipeline_id, created_at, legal_entity:legal_entities(legal_name, trade_name)").eq("person_id", opp!.person_id).order("created_at");
    if (error) throw error; return data as unknown as SiblingOpp[];
  } });
  const [addPipe, setAddPipe] = useState("");
  const stageName = (sid: string | null) => (allStages.data ?? stages).find((s) => s.id === sid)?.name ?? "—";
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["opp-hist", id] }); void qc.invalidateQueries({ queryKey: ["opp-tasks", id] }); void qc.invalidateQueries({ queryKey: ["person-opps"] }); void qc.invalidateQueries({ queryKey: ["crm-overview"] }); onChanged(); };
  const pipeOf = (pid: string | undefined) => (pipes.data ?? []).find((p) => p.id === pid);
  const curPipeId = opp?.pipeline_id ?? (allStages.data ?? []).find((s) => s.id === opp?.stage_id)?.pipeline_id;
  // cada oportunidade anda sozinha pelo funil dela: mover uma nunca move as outras da mesma pessoa
  const moveSibling = async (o: SiblingOpp, stageId: string) => {
    if (o.stage_id === stageId) return; const st = (allStages.data ?? []).find((x) => x.id === stageId); let reason: string | undefined;
    if (st?.kind === "lost") {
      const r = await promptText("Marcar como perdida", "Motivo da perda", { kind: "select", options: (reasons.data ?? []).map((x) => ({ value: x.id, label: x.name })), confirmLabel: "Marcar como perdida", danger: true });
      if (!r) return; reason = r;
    }
    const { error } = await supabase.from("opportunities").update({ stage_id: stageId, ...(reason ? { lost_reason_id: reason } : {}) }).eq("id", o.id);
    if (error) return m.err(errText(error)); m.ok(`Etapa atualizada em ${pipeOf(o.pipeline_id) ? pipeLabel(pipeOf(o.pipeline_id)!) : "o funil"} (as outras oportunidades não mudaram).`); refresh();
  };
  const addToPipe = async () => {
    const pl = pipeOf(addPipe); if (!pl || !opp) return;
    const label = isLeadKind(pl.kind) ? LEAD_TYPE[pl.kind].label : pl.name;
    const { error } = await supabase.rpc("crm_create_opportunity", { p_person_id: opp.person_id, p_pipeline_id: pl.id, p_unit_id: opp.unit_id, p_title: `${label} — ${opp.person?.full_name ?? ""}`.trim(), p_source: "manual" });
    if (error) return m.err(errText(error)); setAddPipe(""); m.ok(`${opp.person?.full_name ?? "A pessoa"} agora também está no funil ${pipeLabel(pl)}.`); refresh();
  };
  const openPipeIds = new Set((mine.data ?? []).filter((o) => o.status === "open").map((o) => o.pipeline_id));
  const addable = (pipes.data ?? []).filter((p) => p.kind !== "companies" && !openPipeIds.has(p.id));

  const orgId = async () => (await supabase.from("people").select("org_id").eq("id", opp!.person_id).single()).data?.org_id;
  const addNote = async (e: FormEvent) => {
    e.preventDefault(); if (!note.trim() || !opp) return; const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("interactions").insert({ org_id: await orgId(), person_id: opp.person_id, unit_id: opp.unit_id, opportunity_id: opp.id, channel, summary: note.trim(), created_by: u.user?.id });
    if (error) return m.err(errText(error)); setNote(""); m.ok("Registro salvo."); refresh();
  };
  const patch = async (p: Record<string, unknown>, ok: string) => { const { error } = await supabase.from("opportunities").update(p).eq("id", opp!.id); if (error) m.err(errText(error)); else { m.ok(ok); refresh(); } };
  const addTask = async (e: FormEvent) => {
    e.preventDefault(); if (!taskTitle.trim() || !opp) return; const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("crm_tasks").insert({ org_id: await orgId(), unit_id: opp.unit_id, opportunity_id: opp.id, person_id: opp.person_id, assignee_user_id: opp.owner_user_id ?? u.user?.id, kind: "follow_up", title: taskTitle.trim(), due_at: taskDue ? new Date(taskDue).toISOString() : new Date().toISOString(), created_by: u.user?.id });
    if (error) return m.err(errText(error)); setTaskTitle(""); setTaskDue(""); m.ok("Tarefa criada."); refresh();
  };
  const finish = async (tid: string) => { await supabase.from("crm_tasks").update({ done_at: new Date().toISOString() }).eq("id", tid); refresh(); };

  const timeline = [
    ...(hist.data?.interactions ?? []).map((i) => ({ t: i.created_at, k: CH_LABEL[i.channel] ?? i.channel, x: i.summary })),
    ...(hist.data?.events ?? []).map((e) => ({ t: e.created_at, k: "Sistema", x: e.kind === "stage_changed" ? `${EV_LABEL[e.kind]}: ${stageName(e.from_stage_id)} → ${stageName(e.to_stage_id)}` : EV_LABEL[e.kind] ?? e.kind })),
  ].sort((a, b) => b.t.localeCompare(a.t));

  return (
    <Sheet open={!!opp} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
        {opp && (<>
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1">
            <SheetTitle className="text-[1.0625rem]">{cardName(opp)}</SheetTitle>
            <SheetDescription>{opp.legal_entity ? `Contato: ${opp.person?.full_name ?? "—"} · ${opp.title}` : opp.title}</SheetDescription>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {isLeadKind(pipeOf(curPipeId)?.kind) && <LeadTypeBadge kind={pipeOf(curPipeId)?.kind} />}<Badge tone="info">{stageName(opp.stage_id)}</Badge>
              {opp.status === "won" && <Badge tone="success">Ganha</Badge>}{opp.status === "lost" && <Badge tone="danger">Perdida</Badge>}
              {isStale(opp) && <Badge tone="danger">Sem retorno há 48h+</Badge>}
              {opp.source && <Badge>{opp.source}</Badge>}{opp.campaign && <Badge tone="gold">{opp.campaign}</Badge>}
            </div>
          </SheetHeader>
          <div className="px-5 pt-3"><Tabs tabs={[["resumo", "Resumo"], ["historico", "Histórico"], ["tarefas", `Tarefas${tasks.data?.length ? ` (${tasks.data.length})` : ""}`]]} value={tab} onChange={setTab} /></div>
          <div className="flex-1 overflow-y-auto px-5 pb-6">
            <Msg m={msg} />
            {tab === "resumo" && (
              <div className="grid gap-4">
                <div><label htmlFor="ow" className="block mb-1">Responsável</label>
                  <select id="ow" value={opp.owner_user_id ?? ""} onChange={(e) => patch({ owner_user_id: e.target.value || null }, "Responsável atualizado.")}><option value="">Sem responsável</option>{users.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
                <div><label htmlFor="nc" className="block mb-1">Próximo contato</label>
                  <input id="nc" type="datetime-local" defaultValue={opp.next_contact_at ? opp.next_contact_at.slice(0, 16) : ""} onBlur={(e) => e.target.value && patch({ next_contact_at: new Date(e.target.value).toISOString() }, "Próximo contato agendado.")} /></div>
                <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Valor</dt><dd className="tabular">{opp.value_cents > 0 ? brl(opp.value_cents) : "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Criada em</dt><dd>{fmtDateTime(opp.created_at)}</dd></div><div><dt className="text-xs text-muted-foreground">Último contato</dt><dd>{fmtDateTime(opp.last_contact_at)}</dd></div></dl>
                <section aria-label="Oportunidades desta pessoa" data-testid="opps-da-pessoa" className="grid gap-2 rounded-lg border border-border p-3">
                  <h4 className="text-sm font-semibold">{opp.person?.full_name?.split(" ")[0] ?? "Pessoa"} em todos os funis</h4>
                  <p className="text-xs text-muted-foreground -mt-1">Cada oportunidade tem a sua própria etapa: avançar uma não move as outras.</p>
                  <ul className="grid gap-2">
                    {(mine.data ?? []).map((o) => { const pl = pipeOf(o.pipeline_id); const sts = (allStages.data ?? []).filter((x) => x.pipeline_id === o.pipeline_id);
                      return (
                        <li key={o.id} data-testid="opp-irma" data-pipeline={o.pipeline_id} className={`rounded-md border p-2.5 grid gap-1.5 ${o.id === opp.id ? "border-primary/50 bg-primary/5" : "border-border"}`}>
                          <div className="flex flex-wrap items-center gap-1.5"><LeadTypeBadge kind={pl?.kind} />{pl && !isLeadKind(pl.kind) && <span className="text-xs font-medium">{pl.name}</span>}{o.id === opp.id && <Badge tone="info">Esta</Badge>}{o.status === "won" && <Badge tone="success">Ganha</Badge>}{o.status === "lost" && <Badge tone="danger">Perdida</Badge>}</div>
                          <p className="text-xs text-muted-foreground break-words">{o.legal_entity ? `${o.legal_entity.trade_name || o.legal_entity.legal_name} · ` : ""}{o.title}</p>
                          <div className="flex items-center gap-2">
                            <label className="sr-only" htmlFor={`st-${o.id}`}>Etapa em {pl ? pipeLabel(pl) : "funil"}</label>
                            <select id={`st-${o.id}`} className="!h-8 !py-0 text-xs flex-1" value={o.stage_id} onChange={(e) => void moveSibling(o, e.target.value)}>{sts.map((x) => <option key={x.id} value={x.id}>{x.kind === "won" ? `${x.name} (ganha)` : x.kind === "lost" ? `${x.name} (perdida)` : x.name}</option>)}</select>
                            {o.id !== opp.id && <Link className="hp-btn hp-btn-outline hp-btn-sm" to={`/admin/crm/oportunidades?funil=${o.pipeline_id}&abrir=${o.id}`}>Abrir</Link>}
                          </div>
                        </li>); })}
                  </ul>
                  {addable.length > 0 && (
                    <div className="flex items-center gap-2 pt-1"><label className="sr-only" htmlFor="add-funil">Adicionar a outro funil</label>
                      <select id="add-funil" className="!h-8 !py-0 text-xs flex-1" value={addPipe} onChange={(e) => setAddPipe(e.target.value)}><option value="">Adicionar a outro funil…</option>{addable.map((p) => <option key={p.id} value={p.id}>{pipeLabel(p)}</option>)}</select>
                      <button type="button" className="hp-btn hp-btn-outline hp-btn-sm" disabled={!addPipe} onClick={() => void addToPipe()}>Adicionar</button></div>)}
                </section>
                <Link className="hp-btn hp-btn-outline" data-testid="opp-open-conversation" to={`/admin/crm/conversas?pessoa=${opp.person_id}&oportunidade=${opp.id}`}>Abrir conversa</Link>
                {opp.status === "open" && <Link className="hp-btn hp-btn-primary" to={`/admin/financeiro/vendas?venda=${opp.id}&pessoa=${opp.person_id}&unidade=${opp.unit_id}`}>Converter em venda</Link>}
              </div>
            )}
            {tab === "historico" && (<div className="grid gap-4">
              <form onSubmit={addNote} className="grid gap-2">
                <label htmlFor="ch" className="sr-only">Canal</label>
                <select id="ch" value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label htmlFor="nt" className="sr-only">Nota</label><textarea id="nt" rows={3} placeholder="Registrar contato ou nota comercial…" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="hp-btn hp-btn-outline w-fit">Registrar</button>
                <p className="text-xs text-muted-foreground">WhatsApp e e-mail são registros manuais: nenhuma integração de mensagens está conectada.</p>
              </form>
              <ol className="grid gap-3 border-l border-border pl-4">{timeline.length === 0 && <li className="text-sm text-muted-foreground">Sem registros ainda.</li>}
                {timeline.map((h, i) => <li key={i} className="text-sm"><span className="block text-xs text-muted-foreground">{fmtDateTime(h.t)} · {h.k}</span>{h.x}</li>)}</ol></div>)}
            {tab === "tarefas" && (<div className="grid gap-3">
              <form onSubmit={addTask} className="grid gap-2"><label htmlFor="tk" className="sr-only">Nova tarefa</label><input id="tk" placeholder="Nova tarefa" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                <label htmlFor="td" className="sr-only">Vencimento</label><input id="td" type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} /><button className="hp-btn hp-btn-outline w-fit">Adicionar tarefa</button></form>
              <ul className="grid gap-2">{(tasks.data ?? []).length === 0 && <li className="text-sm text-muted-foreground">Nenhuma tarefa pendente.</li>}
                {(tasks.data ?? []).map((t) => <li key={t.id} className="hp-card p-3 flex items-start justify-between gap-2 text-sm"><span>{t.title}<span className={`block text-xs ${new Date(t.due_at) < new Date() ? "text-destructive" : "text-muted-foreground"}`}>{fmtDateTime(t.due_at)}</span></span><button className="text-accent text-sm font-medium" onClick={() => finish(t.id)}>Concluir</button></li>)}</ul></div>)}
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
};
export default OpportunitySheet;
