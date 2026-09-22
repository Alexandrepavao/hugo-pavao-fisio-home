import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Pause, Play, Plus, Timer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, EmptyState, errText, FilterBar, FilterField, Msg, PageHead, State, Tabs, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MyDayTask { id: string; title: string; start_time: string | null; category: string; urgency: string; importance: string; completed: boolean; person: string | null; opportunity_title: string | null }
interface CrmTaskRow { id: string; title: string; due_at: string; kind: string; person: string | null }
interface ApptRow { id: string; starts_at: string; ends_at: string; status: string; person: string; service: string }
interface MyDay { tasks: MyDayTask[]; crm_tasks: CrmTaskRow[]; appointments: ApptRow[] }
interface FocusSession { id: string; started_at: string; ended_at: string | null; planned_minutes: number }
interface TeamItem { id: string; title: string; owner: string; start_time: string | null; category: string }

const CAT_LABEL: Record<string, string> = { trabalho: "Trabalho", pessoal: "Pessoal", estudo: "Estudo" };
const todayISO = () => new Date().toISOString().slice(0, 10);

/** "Meu dia": combina tarefas pessoais, tarefas de CRM atribuídas e a agenda clínica (quando a pessoa é profissional) — nunca duplica compromissos. */
const Productivity = () => {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState("dia");
  const [date, setDate] = useState(todayISO());
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const isManager = hasRole("manager", "ops_admin", "unit_manager");

  const day = useQuery({ queryKey: ["my-day", date], queryFn: async () => { const { data, error } = await supabase.rpc("my_day", { p_date: date }); if (error) throw error; return data as MyDay; } });
  const focus = useQuery({ queryKey: ["focus-open"], queryFn: async () => ((await supabase.from("focus_sessions").select("id, started_at, ended_at, planned_minutes").is("ended_at", null).order("started_at", { ascending: false }).limit(1)).data?.[0] ?? null) as FocusSession | null });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["my-day"] }); void qc.invalidateQueries({ queryKey: ["focus-open"] }); };
  const toggle = async (id: string) => { const { error } = await supabase.rpc("staff_task_toggle", { p_id: id }); error ? m.err(errText(error)) : refresh(); };

  const pending = useMemo(() => (day.data?.tasks ?? []).filter((t) => !t.completed).length + (day.data?.crm_tasks ?? []).length, [day.data]);

  return (
    <div>
      <PageHead eyebrow="Pessoal" title="Meu dia" hint="Suas tarefas, os compromissos de CRM atribuídos a você e sua agenda clínica, em um só lugar — sem duplicar nada. Tarefas pessoais são privadas até que você as marque como visíveis à equipe."
        actions={<button className="hp-btn hp-btn-primary" onClick={() => setShowNew(true)}><Plus size={16} aria-hidden />Nova tarefa</button>} />
      {isManager && <Tabs tabs={[["dia", "Meu dia"], ["equipe", "Equipe"]]} value={tab} onChange={setTab} />}
      <Msg m={msg} />
      <FilterBar>
        <FilterField label="Data" htmlFor="pd-date"><input id="pd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FilterField>
        {date !== todayISO() && <button className="hp-btn hp-btn-outline" onClick={() => setDate(todayISO())}>Hoje</button>}
        {tab === "dia" && <span className="ml-auto self-center text-sm text-muted-foreground">{pending} pendente(s)</span>}
      </FilterBar>

      {tab === "dia" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_18rem] items-start">
          <div className="grid gap-5">
            <State loading={day.isLoading} error={day.error} />
            {day.data && (
              <>
                <Section title="Agenda clínica" empty={day.data.appointments.length === 0} emptyText="Nenhum atendimento seu hoje.">
                  <ul className="grid gap-2">{day.data.appointments.map((a) => (
                    <li key={a.id} className="hp-card p-3 flex items-center justify-between gap-3 text-sm">
                      <span><b className="tabular">{fmtDateTime(a.starts_at).split(" ")[1]}</b> — {a.person} · {a.service}</span><Badge tone="info">{{ scheduled: "Agendado", confirmed: "Confirmado", attended: "Compareceu" }[a.status] ?? a.status}</Badge>
                    </li>))}</ul>
                </Section>
                <Section title="Tarefas de CRM atribuídas" empty={day.data.crm_tasks.length === 0} emptyText="Nenhuma tarefa de CRM vencendo até esta data.">
                  <ul className="grid gap-2">{day.data.crm_tasks.map((t) => (
                    <li key={t.id} className="hp-card p-3 flex items-center justify-between gap-3 text-sm"><span>{t.title}{t.person && <span className="text-muted-foreground"> · {t.person}</span>}</span>
                      <span className="flex items-center gap-2"><span className="text-xs text-muted-foreground tabular">{fmtDateTime(t.due_at)}</span><Link className="text-accent text-xs font-medium" to="/admin/crm">Abrir no CRM</Link></span></li>))}</ul>
                </Section>
                <Section title="Minhas tarefas" empty={day.data.tasks.length === 0} emptyText="Nenhuma tarefa pessoal para esta data. Crie uma ou vincule a uma oportunidade.">
                  <ul className="grid gap-2">{day.data.tasks.map((t) => (
                    <li key={t.id} className="hp-card p-3 flex items-start gap-3">
                      <button onClick={() => toggle(t.id)} aria-label={t.completed ? "Marcar como pendente" : "Marcar como concluída"} className="mt-0.5 shrink-0">
                        {t.completed ? <CheckCircle2 size={18} style={{ color: "hsl(var(--success))" }} /> : <Circle size={18} className="text-muted-foreground" />}</button>
                      <div className="min-w-0 flex-1">
                        <p className={t.completed ? "line-through text-muted-foreground" : ""}>{t.title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1 text-xs">
                          {t.start_time && <Badge>{t.start_time.slice(0, 5)}</Badge>}<Badge>{CAT_LABEL[t.category]}</Badge>
                          {t.urgency === "urgente" && t.importance === "importante" && <Badge tone="danger">Urgente e importante</Badge>}
                          {(t.person || t.opportunity_title) && <span className="text-muted-foreground">{[t.opportunity_title, t.person].filter(Boolean).join(" · ")}</span>}
                        </div>
                      </div>
                      <button className="hp-btn hp-btn-outline hp-btn-sm shrink-0" onClick={async () => { const { error } = await supabase.rpc("focus_start", { p_task: t.id, p_minutes: 25 }); error ? m.err(errText(error)) : refresh(); }}><Timer size={13} aria-hidden />Focar</button>
                    </li>))}</ul>
                </Section>
              </>
            )}
          </div>
          <FocusWidget session={focus.data} onChanged={refresh} />
        </div>
      )}
      {tab === "equipe" && isManager && <TeamDay date={date} />}
      <NewTaskDialog open={showNew} onOpenChange={setShowNew} date={date} onCreated={() => { setShowNew(false); refresh(); }} />
    </div>
  );
};

const Section = ({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText: string; children: React.ReactNode }) => (
  <section><h2 className="!text-[0.9375rem] mb-2">{title}</h2>{empty ? <p className="text-sm text-muted-foreground hp-card p-3">{emptyText}</p> : children}</section>
);

const FocusWidget = ({ session, onChanged }: { session: FocusSession | null | undefined; onChanged: () => void }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!session) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [session]);
  const elapsedS = session ? Math.floor((now - new Date(session.started_at).getTime()) / 1000) : 0;
  const totalS = (session?.planned_minutes ?? 25) * 60;
  const remaining = Math.max(totalS - elapsedS, 0);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0"); const ss = String(remaining % 60).padStart(2, "0");
  const start = async (min: number) => { await supabase.rpc("focus_start", { p_task: null, p_minutes: min }); onChanged(); };
  const stop = async () => { if (session) await supabase.rpc("focus_stop", { p_id: session.id }); onChanged(); };
  return (
    <aside className="hp-card p-4 lg:sticky lg:top-20">
      <h2 className="!text-[0.9375rem] mb-3 flex items-center gap-2"><Timer size={16} aria-hidden />Sessão de foco</h2>
      {session ? (<>
        <p className="text-3xl font-bold tabular text-center my-3" aria-live="polite" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>{remaining === 0 ? "Concluído!" : `${mm}:${ss}`}</p>
        <button className="hp-btn hp-btn-outline w-full" onClick={stop}><Pause size={14} aria-hidden />Encerrar sessão</button>
      </>) : (<>
        <p className="text-sm text-muted-foreground mb-3">Nenhuma sessão ativa. Escolha a duração:</p>
        <div className="grid grid-cols-3 gap-2">{[25, 45, 60].map((min) => <button key={min} className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => start(min)}><Play size={12} aria-hidden />{min} min</button>)}</div>
      </>)}
    </aside>
  );
};

const TeamDay = ({ date }: { date: string }) => {
  const [unit, setUnit] = useState("");
  const units = useQuery({ queryKey: ["units-td"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true)).data ?? [] });
  const team = useQuery({ queryKey: ["team-day", date, unit], queryFn: async () => { const { data, error } = await supabase.rpc("team_day", { p_date: date, p_unit: unit || null }); if (error) throw error; return data as TeamItem[]; } });
  return (<>
    <FilterBar><FilterField label="Unidade" htmlFor="td-unit"><select id="td-unit" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas as suas unidades</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></FilterField>
      <p className="text-xs text-muted-foreground self-center max-w-sm">Mostra apenas tarefas que cada pessoa marcou como visíveis à equipe — conteúdo privado não aparece aqui.</p></FilterBar>
    <State loading={team.isLoading} error={team.error} />
    {team.data && (team.data.length === 0 ? <EmptyState title="Nenhuma tarefa de equipe para esta data">Cada pessoa decide o que compartilhar marcando a tarefa como "visível à equipe".</EmptyState> : (
      <ul className="grid gap-2">{team.data.map((t) => <li key={t.id} className="hp-card p-3 flex items-center justify-between text-sm"><span>{t.title} <span className="text-muted-foreground">· {t.owner}</span></span><div className="flex gap-1.5">{t.start_time && <Badge>{t.start_time.slice(0, 5)}</Badge>}<Badge>{CAT_LABEL[t.category]}</Badge></div></li>)}</ul>
    ))}
  </>);
};

const NewTaskDialog = ({ open, onOpenChange, date, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; date: string; onCreated: () => void }) => {
  const [title, setTitle] = useState(""); const [time, setTime] = useState(""); const [category, setCategory] = useState("trabalho");
  const [urgency, setUrgency] = useState("nao_urgente"); const [importance, setImportance] = useState("importante"); const [visibility, setVisibility] = useState("private");
  const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string; unit_id: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const found = useQuery({ queryKey: ["task-ppl", search], enabled: open && search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).limit(6)).data ?? [] });
  const reset = () => { setTitle(""); setTime(""); setPerson(null); setSearch(""); setErr(null); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!title.trim()) return setErr("Informe o título."); setBusy(true);
    const { data: u } = await supabase.auth.getUser(); const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("staff_tasks").insert({ org_id: org?.id, owner_user_id: u.user?.id, unit_id: person?.unit_id ?? null, title: title.trim(), task_date: date, start_time: time || null, category, urgency, importance, visibility, person_id: person?.id ?? null });
    setBusy(false); if (error) return setErr(errText(error)); reset(); onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Nova tarefa</DialogTitle><DialogDescription>Privada por padrão. Marque "Visível à equipe" para que colegas da unidade a vejam.</DialogDescription></DialogHeader>
        <form id="new-task" onSubmit={submit} className="grid gap-3" noValidate>
          <div><label htmlFor="nt-title" className="block mb-1">Título</label><input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="nt-time" className="block mb-1">Horário (opcional)</label><input id="nt-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            <div><label htmlFor="nt-cat" className="block mb-1">Categoria</label><select id="nt-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(CAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="nt-urg" className="block mb-1">Urgência</label><select id="nt-urg" value={urgency} onChange={(e) => setUrgency(e.target.value)}><option value="urgente">Urgente</option><option value="nao_urgente">Não urgente</option></select></div>
            <div><label htmlFor="nt-imp" className="block mb-1">Importância</label><select id="nt-imp" value={importance} onChange={(e) => setImportance(e.target.value)}><option value="importante">Importante</option><option value="nao_importante">Não importante</option></select></div>
          </div>
          <div><label htmlFor="nt-p" className="block mb-1">Vincular a uma pessoa (opcional)</label><input id="nt-p" autoComplete="off" placeholder="Buscar pelo nome" value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />
            {!person && found.data && found.data.length > 0 && <ul className="hp-card mt-1 overflow-hidden">{found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button></li>)}</ul>}</div>
          <label className="flex items-center gap-2 !font-normal"><input type="checkbox" checked={visibility === "team"} onChange={(e) => setVisibility(e.target.checked ? "team" : "private")} />Visível à equipe da unidade</label>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </form>
        <DialogFooter><button className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button><button form="new-task" disabled={busy} className="hp-btn hp-btn-primary">{busy ? "Salvando…" : "Criar tarefa"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Productivity;
