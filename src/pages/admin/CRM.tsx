import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDateTime } from "@/lib/format";
import { btnGhost, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Stage { id: string; name: string; position: number; kind: "open" | "won" | "lost"; pipeline_id: string }
interface Opp {
  id: string; title: string; value_cents: number; status: string; stage_id: string; owner_user_id: string | null; unit_id: string; person_id: string;
  next_contact_at: string | null; last_contact_at: string | null; created_at: string; source: string | null; person: { id: string; full_name: string } | null;
}
interface User { user_id: string; name: string }
interface Task { id: string; title: string; due_at: string; kind: string; assignee_user_id: string | null; opportunity_id: string | null; person_id: string | null }

const STALE_H = 48;

const CRM = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<"funil" | "tarefas">("funil");
  const [pipeId, setPipeId] = useState("");
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [q, setQ] = useState(""); const [owner, setOwner] = useState(""); const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [msg, m] = useMsg();
  const stale = sp.get("filtro") === "sem-retorno";

  const pipes = useQuery({ queryKey: ["pipelines"], queryFn: async () => {
    const rank = ["patients", "education", "partners", "companies", "custom"];
    return ((await supabase.from("pipelines").select("id, name, kind").eq("active", true)).data ?? []).sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind) || a.name.localeCompare(b.name));
  } });
  const pid = pipeId || pipes.data?.[0]?.id || "";
  const stages = useQuery({ queryKey: ["stages", pid], enabled: !!pid, queryFn: async () => (await supabase.from("pipeline_stages").select("*").eq("pipeline_id", pid).order("position")).data as Stage[] });
  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as User[] });
  const reasons = useQuery({ queryKey: ["loss"], queryFn: async () => (await supabase.from("loss_reasons").select("id, name").eq("active", true)).data ?? [] });
  const opps = useQuery({ queryKey: ["opps", pid], enabled: !!pid, queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("id, title, value_cents, status, stage_id, owner_user_id, unit_id, person_id, next_contact_at, last_contact_at, created_at, source, person:people(id, full_name)")
      .eq("pipeline_id", pid).order("created_at", { ascending: false }).limit(500);
    if (error) throw error; return data as unknown as Opp[];
  } });
  const nameOf = (id: string | null) => users.data?.find((u) => u.user_id === id)?.name ?? "Sem responsável";

  const filtered = useMemo(() => (opps.data ?? []).filter((o) => {
    if (q && !(`${o.title} ${o.person?.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (owner && (owner === "none" ? o.owner_user_id : o.owner_user_id !== owner)) return false;
    if (stale && !(o.status === "open" && new Date(o.last_contact_at ?? o.created_at).getTime() < Date.now() - STALE_H * 36e5)) return false;
    return true;
  }), [opps.data, q, owner, stale]);

  const move = useMutation({
    mutationFn: async ({ id, stage, reason }: { id: string; stage: string; reason?: string }) => {
      const { error } = await supabase.from("opportunities").update({ stage_id: stage, ...(reason ? { lost_reason_id: reason } : {}) }).eq("id", id); if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["opps", pid] }); m.ok("Etapa atualizada (histórico registrado)."); },
    onError: (e: { message: string; code?: string }) => m.err(errText(e)),
  });
  const onMove = (o: Opp, stage: string) => {
    const st = stages.data?.find((s) => s.id === stage);
    if (st?.kind === "lost") {
      const list = (reasons.data ?? []).map((r, i) => `${i + 1}. ${r.name}`).join("\n");
      const n = Number(window.prompt(`Motivo da perda (digite o número):\n${list}`));
      const r = reasons.data?.[n - 1]; if (!r) return m.err("Informe um motivo de perda válido.");
      move.mutate({ id: o.id, stage, reason: r.id });
    } else move.mutate({ id: o.id, stage });
  };

  const tasks = useQuery({ queryKey: ["tasks"], enabled: tab === "tarefas", queryFn: async () => (await supabase.from("crm_tasks").select("*").is("done_at", null).order("due_at")).data as Task[] });
  const done = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("crm_tasks").update({ done_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); void qc.invalidateQueries({ queryKey: ["opp-tasks"] }); } });

  return (
    <div>
      <PageHead eyebrow="HP CRM" title="Oportunidades" actions={<button className="btn-primary !py-3" onClick={() => setShowNew(!showNew)}>{showNew ? "Fechar" : "Nova oportunidade"}</button>} />
      <Tabs tabs={[["funil", "Funis"], ["tarefas", "Tarefas"]]} value={tab} onChange={(v) => setTab(v as "funil" | "tarefas")} />
      <Msg m={msg} />
      {showNew && <NewOpp pipeId={pid} onDone={() => { setShowNew(false); void qc.invalidateQueries({ queryKey: ["opps", pid] }); }} />}

      {tab === "tarefas" && (<>
        <State loading={tasks.isLoading} error={tasks.error} empty={tasks.data?.length === 0} emptyText="Nenhuma tarefa pendente." />
        {tasks.data && tasks.data.length > 0 && <Table head={["Tarefa", "Vencimento", "Responsável", ""]}>
          {tasks.data.map((t) => <tr key={t.id}><Td><span className={new Date(t.due_at) < new Date() ? "text-destructive" : ""}>{t.title}</span></Td><Td>{fmtDateTime(t.due_at)}</Td><Td>{nameOf(t.assignee_user_id)}</Td>
            <Td><button className={btnGhost + " !py-1"} onClick={() => done.mutate(t.id)}>Concluir</button></Td></tr>)}</Table>}
      </>)}

      {tab === "funil" && (<>
        <div className="flex flex-wrap gap-3 mb-4 items-end">
          <div><label htmlFor="pp" className="block text-xs mb-1">Funil</label><select id="pp" className={inputCls} value={pid} onChange={(e) => setPipeId(e.target.value)}>{(pipes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label htmlFor="qq" className="block text-xs mb-1">Buscar</label><input id="qq" className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou título" /></div>
          <div><label htmlFor="oo" className="block text-xs mb-1">Responsável</label><select id="oo" className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option><option value="none">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={stale} onChange={(e) => setSp(e.target.checked ? { filtro: "sem-retorno" } : {})} /> Sem retorno há {STALE_H}h+</label>
          <div className="ml-auto flex gap-1"><button className={view === "kanban" ? "btn-primary !py-2 !px-4" : btnGhost} onClick={() => setView("kanban")}>Kanban</button><button className={view === "lista" ? "btn-primary !py-2 !px-4" : btnGhost} onClick={() => setView("lista")}>Lista</button></div>
        </div>
        <State loading={opps.isLoading || stages.isLoading} error={opps.error} empty={!!opps.data && filtered.length === 0} emptyText="Nenhuma oportunidade com estes filtros." />
        {stages.data && opps.data && view === "kanban" && (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {stages.data.map((s) => { const items = filtered.filter((o) => o.stage_id === s.id); return (
              <section key={s.id} aria-label={s.name} className="min-w-[16rem] w-64 shrink-0 bg-muted/50 border border-border">
                <h2 className="p-3 text-sm font-medium flex justify-between border-b border-border">{s.name}<span className="tabular text-navy-400">{items.length}</span></h2>
                <ul className="p-2 space-y-2">{items.map((o) => (
                  <li key={o.id} className="bg-card border border-border p-3">
                    <button className="text-left text-navy-900 hover:underline" onClick={() => setOpenId(o.id)}>{o.person?.full_name ?? "—"}</button>
                    <p className="text-xs text-navy-400">{o.title}</p>
                    {o.value_cents > 0 && <p className="text-xs tabular">{brl(o.value_cents)}</p>}
                    {o.status === "open" && new Date(o.last_contact_at ?? o.created_at).getTime() < Date.now() - STALE_H * 36e5 && <p className="text-xs text-destructive">Sem retorno</p>}
                    <label className="sr-only" htmlFor={`mv-${o.id}`}>Mover para</label>
                    <select id={`mv-${o.id}`} className="mt-2 w-full text-xs border border-input bg-card p-1" value={o.stage_id} onChange={(e) => onMove(o, e.target.value)}>
                      {stages.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  </li>))}</ul>
              </section>); })}
          </div>
        )}
        {stages.data && opps.data && view === "lista" && filtered.length > 0 && (
          <Table head={["Pessoa", "Título", "Etapa", "Responsável", "Próximo contato", "Origem"]}>
            {filtered.map((o) => <tr key={o.id}><Td><button className="hover:underline" onClick={() => setOpenId(o.id)}>{o.person?.full_name}</button></Td><Td>{o.title}</Td>
              <Td>{stages.data!.find((s) => s.id === o.stage_id)?.name}</Td><Td>{nameOf(o.owner_user_id)}</Td><Td>{fmtDateTime(o.next_contact_at)}</Td><Td>{o.source ?? "—"}</Td></tr>)}</Table>
        )}
        {openId && opps.data && <Detail opp={opps.data.find((o) => o.id === openId)!} users={users.data ?? []} onClose={() => setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: ["opps", pid] })} />}
      </>)}
    </div>
  );
};

const Detail = ({ opp, users, onClose, onChanged }: { opp: Opp; users: User[]; onClose: () => void; onChanged: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [note, setNote] = useState(""); const [channel, setChannel] = useState("note"); const [taskTitle, setTaskTitle] = useState(""); const [taskDue, setTaskDue] = useState("");
  const events = useQuery({ queryKey: ["opp-hist", opp?.id], enabled: !!opp, queryFn: async () => {
    const [i, e] = await Promise.all([
      supabase.from("interactions").select("id, channel, summary, created_at").eq("opportunity_id", opp.id).order("created_at", { ascending: false }),
      supabase.from("opportunity_events").select("id, kind, created_at, data").eq("opportunity_id", opp.id).order("created_at", { ascending: false })]);
    return { interactions: i.data ?? [], events: e.data ?? [] };
  } });
  const tasks = useQuery({ queryKey: ["opp-tasks", opp?.id], enabled: !!opp, queryFn: async () => (await supabase.from("crm_tasks").select("*").eq("opportunity_id", opp.id).is("done_at", null).order("due_at")).data as Task[] });
  if (!opp) return null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["opp-hist", opp.id] }); void qc.invalidateQueries({ queryKey: ["opp-tasks", opp.id] }); onChanged(); };

  const addNote = async (e: FormEvent) => {
    e.preventDefault(); if (!note.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("interactions").insert({ org_id: (await supabase.from("people").select("org_id").eq("id", opp.person_id).single()).data?.org_id, person_id: opp.person_id, unit_id: opp.unit_id, opportunity_id: opp.id, channel, summary: note.trim(), created_by: u.user?.id });
    if (error) return m.err(errText(error)); setNote(""); m.ok("Registro salvo."); refresh();
  };
  const patch = async (p: Record<string, unknown>, ok: string) => { const { error } = await supabase.from("opportunities").update(p).eq("id", opp.id); error ? m.err(errText(error)) : (m.ok(ok), refresh()); };
  const addTask = async (e: FormEvent) => {
    e.preventDefault(); if (!taskTitle.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const { data: org } = await supabase.from("people").select("org_id").eq("id", opp.person_id).single();
    const { error } = await supabase.from("crm_tasks").insert({ org_id: org?.org_id, unit_id: opp.unit_id, opportunity_id: opp.id, person_id: opp.person_id, assignee_user_id: opp.owner_user_id ?? u.user?.id, kind: "follow_up", title: taskTitle.trim(), due_at: taskDue ? new Date(taskDue).toISOString() : new Date().toISOString(), created_by: u.user?.id });
    if (error) return m.err(errText(error)); setTaskTitle(""); setTaskDue(""); m.ok("Tarefa criada."); refresh();
  };
  const finish = async (id: string) => { await supabase.from("crm_tasks").update({ done_at: new Date().toISOString() }).eq("id", id); refresh(); };

  return (
    <aside aria-label="Detalhe da oportunidade" className="fixed inset-y-0 right-0 w-full sm:w-[28rem] bg-background border-l border-border shadow-xl overflow-y-auto p-5 z-50">
      <div className="flex justify-between items-start mb-4"><div><h2 className="text-xl">{opp.person?.full_name}</h2><p className="text-sm text-navy-400">{opp.title}</p></div><button onClick={onClose} aria-label="Fechar" className="text-2xl leading-none">×</button></div>
      <Msg m={msg} />
      <div className="grid gap-3 mb-6">
        <div><label htmlFor="ow" className="block text-xs mb-1">Responsável</label>
          <select id="ow" className={inputCls} value={opp.owner_user_id ?? ""} onChange={(e) => patch({ owner_user_id: e.target.value || null }, "Responsável atualizado.")}><option value="">Sem responsável</option>{users.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="nc" className="block text-xs mb-1">Próximo contato</label>
          <input id="nc" type="datetime-local" className={inputCls} defaultValue={opp.next_contact_at ? opp.next_contact_at.slice(0, 16) : ""} onBlur={(e) => e.target.value && patch({ next_contact_at: new Date(e.target.value).toISOString() }, "Próximo contato agendado.")} /></div>
        {opp.status === "open" && <Link className={btnGhost + " text-center"} to={`/admin/financeiro?venda=${opp.id}&pessoa=${opp.person_id}&unidade=${opp.unit_id}`}>Converter em venda</Link>}
      </div>
      <h3 className="text-lg mb-2">Tarefas</h3>
      <ul className="mb-2 space-y-1">{(tasks.data ?? []).map((t) => <li key={t.id} className="flex justify-between gap-2 text-sm"><span>{t.title} <span className="text-navy-400">({fmtDateTime(t.due_at)})</span></span><button className="text-accent" onClick={() => finish(t.id)}>Concluir</button></li>)}</ul>
      <form onSubmit={addTask} className="flex gap-2 mb-6"><input aria-label="Nova tarefa" className={inputCls} placeholder="Nova tarefa" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /><input aria-label="Vencimento" type="datetime-local" className={inputCls + " max-w-[11rem]"} value={taskDue} onChange={(e) => setTaskDue(e.target.value)} /><button className={btnGhost}>+</button></form>
      <h3 className="text-lg mb-2">Nova nota comercial</h3>
      <form onSubmit={addNote} className="mb-6 space-y-2"><select aria-label="Canal" className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="note">Nota</option><option value="call">Ligação</option><option value="whatsapp">WhatsApp (registro manual)</option><option value="email">E-mail (registro manual)</option><option value="meeting">Reunião</option></select>
        <textarea aria-label="Nota" rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /><button className={btnGhost}>Registrar</button></form>
      <h3 className="text-lg mb-2">Histórico</h3>
      <ul className="space-y-2 text-sm">{[...(events.data?.interactions ?? []).map((i) => ({ t: i.created_at, x: `${i.channel === "system" ? "Sistema" : i.channel}: ${i.summary}` })), ...(events.data?.events ?? []).map((e) => ({ t: e.created_at, x: e.kind === "stage_changed" ? "Mudança de etapa" : e.kind === "owner_changed" ? "Troca de responsável" : "Oportunidade criada" }))]
        .sort((a, b) => b.t.localeCompare(a.t)).map((h, i) => <li key={i}><span className="text-navy-400">{fmtDateTime(h.t)}</span> — {h.x}</li>)}</ul>
    </aside>
  );
};

const NewOpp = ({ pipeId, onDone }: { pipeId: string; onDone: () => void }) => {
  const [search, setSearch] = useState(""); const [title, setTitle] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string; unit_id: string | null } | null>(null);
  const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const found = useQuery({ queryKey: ["ppl-search", search], enabled: search.length >= 2, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(8)).data ?? [] });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!person?.unit_id) return m.err("Selecione uma pessoa com unidade definida."); if (!title.trim()) return m.err("Informe o título.");
    setBusy(true); const { error } = await supabase.rpc("crm_create_opportunity", { p_person_id: person.id, p_pipeline_id: pipeId, p_unit_id: person.unit_id, p_title: title.trim(), p_source: "manual" }); setBusy(false);
    error ? m.err(errText(error)) : onDone();
  };
  return (
    <form onSubmit={submit} className="bg-card border border-border p-5 mb-6 grid gap-3 sm:grid-cols-2" noValidate>
      <div><label htmlFor="ps" className="block text-sm mb-1">Pessoa (busque pelo nome)</label><input id="ps" className={inputCls} value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />
        {!person && found.data && found.data.length > 0 && <ul className="border border-border bg-card">{found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left p-2 hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button></li>)}</ul>}
        <p className="text-xs text-navy-400 mt-1">Não encontrou? Cadastre em <Link className="underline" to="/admin/pessoas">Pessoas</Link> (com verificação de duplicidade).</p></div>
      <div><label htmlFor="tt" className="block text-sm mb-1">Título</label><input id="tt" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <Msg m={msg} /><div className="sm:col-span-2"><button disabled={busy} className="btn-primary !py-3 disabled:opacity-60">{busy ? "Criando…" : "Criar (responsável distribuído automaticamente)"}</button></div>
    </form>
  );
};

export default CRM;
