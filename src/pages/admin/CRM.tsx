import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CalendarClock, KanbanSquare, LayoutList, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, EmptyState, errText, FilterBar, FilterField, Msg, PageHead, promptText, State, Table, Tabs, Td, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import OpportunitySheet from "./crm/OpportunitySheet";
import { initials, isStale, STALE_H, type Opp, type Stage, type StaffUser, type Task } from "./crm/types";

const RANK = ["patients", "education", "partners", "companies", "custom"];

const CRM = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState("funil");
  const [pipeId, setPipeId] = useState("");
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [q, setQ] = useState(""); const [owner, setOwner] = useState(""); const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false); const [dragId, setDragId] = useState<string | null>(null);
  const [msg, m] = useMsg();
  const stale = sp.get("filtro") === "sem-retorno";

  const pipes = useQuery({ queryKey: ["pipelines"], queryFn: async () => ((await supabase.from("pipelines").select("id, name, kind").eq("active", true)).data ?? []).sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind) || a.name.localeCompare(b.name)) });
  const pid = pipeId || pipes.data?.[0]?.id || "";
  const stages = useQuery({ queryKey: ["stages", pid], enabled: !!pid, queryFn: async () => (await supabase.from("pipeline_stages").select("*").eq("pipeline_id", pid).order("position")).data as Stage[] });
  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const reasons = useQuery({ queryKey: ["loss"], queryFn: async () => (await supabase.from("loss_reasons").select("id, name").eq("active", true)).data ?? [] });
  const oppKey = ["opps", pid];
  const opps = useQuery({ queryKey: oppKey, enabled: !!pid, queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("id, title, value_cents, status, stage_id, owner_user_id, unit_id, person_id, next_contact_at, last_contact_at, created_at, source, campaign, person:people(id, full_name)")
      .eq("pipeline_id", pid).order("created_at", { ascending: false }).limit(500);
    if (error) throw error; return data as unknown as Opp[];
  } });
  const nameOf = (id: string | null) => users.data?.find((u) => u.user_id === id)?.name ?? "Sem responsável";

  const filtered = useMemo(() => (opps.data ?? []).filter((o) => {
    if (q && !`${o.title} ${o.person?.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (owner && (owner === "none" ? o.owner_user_id : o.owner_user_id !== owner)) return false;
    if (stale && !isStale(o)) return false;
    return true;
  }), [opps.data, q, owner, stale]);
  const stageList = stages.data ?? [];
  const opened = opps.data?.find((o) => o.id === openId) ?? null;

  const move = useMutation({
    mutationFn: async ({ id, stage, reason }: { id: string; stage: string; reason?: string }) => {
      const { error } = await supabase.from("opportunities").update({ stage_id: stage, ...(reason ? { lost_reason_id: reason } : {}) }).eq("id", id); if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {           // atualização otimista; falha reverte
      await qc.cancelQueries({ queryKey: oppKey }); const prev = qc.getQueryData<Opp[]>(oppKey);
      qc.setQueryData<Opp[]>(oppKey, (cur) => (cur ?? []).map((o) => (o.id === id ? { ...o, stage_id: stage } : o))); return { prev };
    },
    onError: (e: { message: string; code?: string }, _v, ctx) => { if (ctx?.prev) qc.setQueryData(oppKey, ctx.prev); m.err(`Não foi possível mover: ${errText(e)}`); },
    onSuccess: () => m.ok("Etapa atualizada (histórico registrado)."),
    onSettled: () => { void qc.invalidateQueries({ queryKey: oppKey }); },
  });
  const moveTo = async (o: Opp, stageId: string) => {
    if (o.stage_id === stageId) return;
    const st = stageList.find((s) => s.id === stageId);
    if (st?.kind === "lost") {
      const reason = await promptText("Marcar como perdida", "Motivo da perda", { kind: "select", options: (reasons.data ?? []).map((r) => ({ value: r.id, label: r.name })), confirmLabel: "Marcar como perdida", danger: true });
      if (!reason) return; move.mutate({ id: o.id, stage: stageId, reason });
    } else move.mutate({ id: o.id, stage: stageId });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }));
  const onDragEnd = (e: DragEndEvent) => { setDragId(null); const o = opps.data?.find((x) => x.id === e.active.id); if (o && e.over) void moveTo(o, String(e.over.id)); };
  const dragged = opps.data?.find((o) => o.id === dragId) ?? null;

  const tasks = useQuery({ queryKey: ["tasks"], enabled: tab === "tarefas", queryFn: async () => (await supabase.from("crm_tasks").select("*").is("done_at", null).order("due_at")).data as Task[] });
  const done = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("crm_tasks").update({ done_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); void qc.invalidateQueries({ queryKey: ["opp-tasks"] }); } });

  return (
    <div>
      <PageHead eyebrow="Comercial" title="Oportunidades" hint="Funis, responsáveis, tarefas e histórico. Arraste os cards entre etapas ou use o menu ⋯ (teclado: Espaço para pegar, setas para mover)."
        actions={<button className="hp-btn hp-btn-primary" onClick={() => setShowNew(true)}><Plus size={16} aria-hidden />Nova oportunidade</button>} />
      <Tabs tabs={[["funil", "Funis"], ["tarefas", "Tarefas"]]} value={tab} onChange={setTab} />
      <Msg m={msg} />

      {tab === "tarefas" && (<>
        <State loading={tasks.isLoading} error={tasks.error} empty={tasks.data?.length === 0} emptyText="Nenhuma tarefa pendente." />
        {tasks.data && tasks.data.length > 0 && <Table head={["Tarefa", "Vencimento", "Responsável", ""]}>
          {tasks.data.map((t) => <tr key={t.id}><Td><span className={new Date(t.due_at) < new Date() ? "text-destructive" : ""}>{t.title}</span></Td><Td>{fmtDateTime(t.due_at)}</Td><Td>{nameOf(t.assignee_user_id)}</Td>
            <Td><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => done.mutate(t.id)}>Concluir</button></Td></tr>)}</Table>}
      </>)}

      {tab === "funil" && (<>
        <FilterBar right={
          <div role="group" aria-label="Visualização" className="inline-flex rounded-md border border-input overflow-hidden">
            <button aria-pressed={view === "kanban"} onClick={() => setView("kanban")} className={`hp-btn hp-btn-sm rounded-none border-0 ${view === "kanban" ? "hp-btn-primary" : "hp-btn-outline"}`}><KanbanSquare size={14} aria-hidden />Kanban</button>
            <button aria-pressed={view === "lista"} onClick={() => setView("lista")} className={`hp-btn hp-btn-sm rounded-none border-0 ${view === "lista" ? "hp-btn-primary" : "hp-btn-outline"}`}><LayoutList size={14} aria-hidden />Lista</button>
          </div>}>
          <FilterField label="Funil" htmlFor="f-funil"><select id="f-funil" value={pid} onChange={(e) => setPipeId(e.target.value)}>{(pipes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FilterField>
          <FilterField label="Buscar" htmlFor="f-q" className="min-w-[14rem]">
            <div className="relative"><Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="f-q" style={{ paddingLeft: "2rem", paddingRight: q ? "2rem" : undefined }} placeholder="Pessoa ou título" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
              {q && <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1" aria-label="Limpar busca" onClick={() => setQ("")}><X size={14} /></button>}</div></FilterField>
          <FilterField label="Responsável" htmlFor="f-owner"><select id="f-owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option><option value="none">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></FilterField>
          <label className="flex items-center gap-2 text-sm h-9"><input type="checkbox" checked={stale} onChange={(e) => setSp(e.target.checked ? { filtro: "sem-retorno" } : {})} />Sem retorno há {STALE_H}h+</label>
        </FilterBar>

        <State loading={opps.isLoading || stages.isLoading} error={opps.error} />
        {stages.data && opps.data && view === "kanban" && (
          <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}
            accessibility={{ screenReaderInstructions: { draggable: "Para mover a oportunidade, pressione Espaço, use as setas para escolher a etapa e pressione Espaço para soltar. Esc cancela." } }}>
            <div className="overflow-x-auto pb-2" style={{ overscrollBehaviorX: "contain" }} tabIndex={0} role="region" aria-label="Quadro do funil">
              <div className="flex gap-3 items-stretch" style={{ width: "max-content", minWidth: "100%" }}>
                {stageList.map((s) => <Column key={s.id} stage={s} items={filtered.filter((o) => o.stage_id === s.id)} allStages={stageList} nameOf={nameOf} onOpen={setOpenId} onMove={moveTo} dragging={!!dragId} />)}
              </div>
            </div>
            <DragOverlay>{dragged && <CardBody o={dragged} nameOf={nameOf} overlay />}</DragOverlay>
          </DndContext>
        )}
        {stages.data && opps.data && view === "lista" && (filtered.length === 0 ? <EmptyState icon={KanbanSquare} title="Nenhuma oportunidade com estes filtros">Ajuste os filtros ou crie uma nova oportunidade.</EmptyState> : (
          <div className="grid gap-5">{stageList.map((s) => { const items = filtered.filter((o) => o.stage_id === s.id); if (!items.length) return null; return (
            <section key={s.id} aria-label={s.name}><h3 className="mb-2 flex items-center gap-2">{s.name}<Badge>{items.length}</Badge></h3>
              <Table head={["Pessoa", "Título", "Responsável", "Próximo contato", "Origem", "Valor"]} right={[5]}>
                {items.map((o) => <tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}><Td><button className="font-medium text-left hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }}>{o.person?.full_name}</button>{isStale(o) && <span className="ml-2"><Badge tone="danger">Sem retorno</Badge></span>}</Td>
                  <Td>{o.title}</Td><Td>{nameOf(o.owner_user_id)}</Td><Td>{fmtDateTime(o.next_contact_at)}</Td><Td>{o.source ?? "—"}</Td><Td num>{o.value_cents > 0 ? brl(o.value_cents) : "—"}</Td></tr>)}</Table></section>); })}</div>))}
      </>)}

      <OpportunitySheet opp={opened} stages={stageList} users={users.data ?? []} onClose={() => setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: oppKey })} />
      <NewOpp open={showNew} onOpenChange={setShowNew} pipeId={pid} onDone={() => { setShowNew(false); void qc.invalidateQueries({ queryKey: oppKey }); m.ok("Oportunidade criada."); }} />
    </div>
  );
};

const Column = ({ stage, items, allStages, nameOf, onOpen, onMove, dragging }: { stage: Stage; items: Opp[]; allStages: Stage[]; nameOf: (id: string | null) => string; onOpen: (id: string) => void; onMove: (o: Opp, stageId: string) => void; dragging: boolean }) => {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = items.reduce((a, o) => a + o.value_cents, 0);
  return (
    <section ref={setNodeRef} aria-label={`${stage.name}: ${items.length}`} className="flex flex-col rounded-lg border shrink-0"
      style={{ width: "17.5rem", background: isOver ? "hsl(var(--info-soft))" : "hsl(var(--muted) / .7)", borderColor: isOver ? "hsl(var(--ring))" : "hsl(var(--border))", maxHeight: "calc(100vh - 18.5rem)", minHeight: dragging ? "8rem" : undefined }}>
      <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
        <h3 className="!text-[0.8125rem] flex items-center gap-1.5">{stage.kind === "won" && <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--success))" }} />}{stage.kind === "lost" && <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--destructive))" }} />}{stage.name}</h3>
        <span className="text-xs text-muted-foreground tabular" title={total > 0 ? "Soma do valor das oportunidades desta etapa (valor informado na oportunidade ou na venda)" : undefined}>{items.length}{total > 0 ? ` · ${brl(total)}` : ""}</span>
      </header>
      <ul className="flex-1 overflow-y-auto p-2 grid gap-2 content-start" style={{ minHeight: "4rem" }}>
        {items.length === 0 && <li className="text-xs text-muted-foreground text-center py-3">Nenhuma oportunidade</li>}
        {items.map((o) => <Card key={o.id} o={o} stages={allStages} nameOf={nameOf} onOpen={onOpen} onMove={onMove} />)}
      </ul>
    </section>
  );
};

const CardBody = ({ o, nameOf, overlay }: { o: Opp; nameOf: (id: string | null) => string; overlay?: boolean }) => (
  <div className="hp-card p-3 text-left" style={overlay ? { boxShadow: "var(--shadow-pop)", width: "16.5rem" } : undefined}>
    <p className="font-medium text-foreground leading-5 pr-6 break-words">{o.person?.full_name ?? "—"}</p>
    <p className="text-xs text-muted-foreground mt-0.5 break-words">{o.title}</p>
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {isStale(o) && <Badge tone="danger">Sem retorno</Badge>}
      {o.next_contact_at && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock size={12} aria-hidden />{fmtDate(o.next_contact_at)}</span>}
      {o.value_cents > 0 && <span className="text-xs tabular font-medium">{brl(o.value_cents)}</span>}
    </div>
    <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
      <span className="truncate">{o.source ?? "manual"}</span>
      <span className={`grid place-items-center rounded-full font-semibold ${o.owner_user_id ? "bg-primary text-primary-foreground" : "border border-dashed border-input text-muted-foreground"}`} style={{ width: "1.375rem", height: "1.375rem", fontSize: "0.625rem" }} title={nameOf(o.owner_user_id)} aria-label={`Responsável: ${nameOf(o.owner_user_id)}`}>{o.owner_user_id ? initials(nameOf(o.owner_user_id)) : "?"}</span>
    </div>
  </div>
);

const Card = ({ o, stages, nameOf, onOpen, onMove }: { o: Opp; stages: Stage[]; nameOf: (id: string | null) => string; onOpen: (id: string) => void; onMove: (o: Opp, stageId: string) => void }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: o.id });
  return (
    <li ref={setNodeRef} style={{ opacity: isDragging ? 0.35 : 1, position: "relative", touchAction: "manipulation" }}>
      <div {...attributes} {...listeners} role="button" aria-roledescription="item arrastável" aria-label={`${o.person?.full_name ?? "Oportunidade"}, ${o.title}. Enter abre os detalhes.`} tabIndex={0} className="cursor-grab active:cursor-grabbing rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => onOpen(o.id)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen(o.id); } else listeners?.onKeyDown?.(e); }}>
        <CardBody o={o} nameOf={nameOf} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-muted text-muted-foreground" aria-label={`Ações de ${o.person?.full_name ?? "oportunidade"}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}><MoreHorizontal size={16} /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => onOpen(o.id)}>Abrir detalhes</DropdownMenuItem>
          <DropdownMenuSub><DropdownMenuSubTrigger>Mover para…</DropdownMenuSubTrigger><DropdownMenuSubContent>
            {stages.map((s) => <DropdownMenuItem key={s.id} disabled={s.id === o.stage_id} onSelect={() => onMove(o, s.id)}>{s.name}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub>
          {o.status === "open" && <><DropdownMenuSeparator /><DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Fechamento</DropdownMenuLabel>
            {stages.filter((s) => s.kind !== "open").map((s) => <DropdownMenuItem key={s.id} onSelect={() => onMove(o, s.id)}>{s.kind === "won" ? "Marcar como ganha" : "Marcar como perdida"}</DropdownMenuItem>)}</>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};

const NewOpp = ({ open, onOpenChange, pipeId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; pipeId: string; onDone: () => void }) => {
  const [search, setSearch] = useState(""); const [title, setTitle] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string; unit_id: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const found = useQuery({ queryKey: ["ppl-search", search], enabled: open && search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(8)).data ?? [] });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!person?.unit_id) return setErr("Selecione uma pessoa com unidade definida."); if (!title.trim()) return setErr("Informe o título.");
    setBusy(true); const { error } = await supabase.rpc("crm_create_opportunity", { p_person_id: person.id, p_pipeline_id: pipeId, p_unit_id: person.unit_id, p_title: title.trim(), p_source: "manual" }); setBusy(false);
    if (error) return setErr(errText(error)); setPerson(null); setSearch(""); setTitle(""); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova oportunidade</DialogTitle><DialogDescription>O responsável é distribuído automaticamente entre os comerciais da unidade.</DialogDescription></DialogHeader>
        <form onSubmit={submit} id="new-opp" className="grid gap-3" noValidate>
          <div><label htmlFor="no-p" className="block mb-1">Pessoa</label><input id="no-p" autoComplete="off" placeholder="Busque pelo nome" value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />
            {!person && found.data && found.data.length > 0 && <ul className="hp-card mt-1 overflow-hidden">{found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button></li>)}</ul>}
            <p className="text-xs text-muted-foreground mt-1">Não encontrou? Cadastre em <Link className="underline" to="/admin/pessoas">Pessoas</Link> (com verificação de duplicidade).</p></div>
          <div><label htmlFor="no-t" className="block mb-1">Título</label><input id="no-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Check-up — avaliação" /></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </form>
        <DialogFooter><button type="button" className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button><button form="new-opp" disabled={busy} className="hp-btn hp-btn-primary">{busy ? "Criando…" : "Criar oportunidade"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CRM;
