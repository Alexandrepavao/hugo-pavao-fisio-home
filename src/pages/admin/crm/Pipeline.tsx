import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CalendarClock, KanbanSquare, LayoutList, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { Badge, EmptyState, errText, Msg, PageHead, promptText, State, Table, Td, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import OpportunitySheet from "./OpportunitySheet";
import CompanyDialog from "./CompanyDialog";
import LeadTypeBadge from "./LeadTypeBadge";
import { LEAD_TYPE, isLeadKind } from "./leadTypes";
import { cardName, initials, isStale, type Opp, type PipelineOverview, type Stage, type StaffUser } from "./types";

const RANK = ["patients", "partners", "education", "companies", "custom"];

/** Pipeline: negociação por etapas de um negócio específico (Kanban). Diferente de "Gestão de leads" (a fila
 *  de qualificação/distribuição de quem ainda não foi trabalhado) — os dois usam o mesmo registro (opportunities),
 *  só a lente é diferente: aqui é "onde este negócio está no funil", lá é "quem ainda não foi contatado". */
const Pipeline = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [q, setQ] = useState(""); const [owner, setOwner] = useState("");
  const openId = sp.get("abrir");
  const setOpenId = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set("abrir", id); else n.delete("abrir"); setSp(n, { replace: true }); };
  const [showNew, setShowNew] = useState(false); const [dragId, setDragId] = useState<string | null>(null);
  const [msg, m] = useMsg();
  const stale = sp.get("filtro") === "sem-retorno";

  const pipes = useQuery({ queryKey: ["pipelines"], queryFn: async () => ((await supabase.from("pipelines").select("id, name, kind").eq("active", true)).data ?? []).sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind) || a.name.localeCompare(b.name)) });
  const overview = useQuery({ queryKey: ["crm-overview"], queryFn: async () => { const { data, error } = await supabase.rpc("crm_pipeline_overview"); if (error) throw error; return (data ?? []) as PipelineOverview[]; } });
  const fromUrl = sp.get("funil");
  const pid = (fromUrl && pipes.data?.some((p) => p.id === fromUrl) ? fromUrl : "") || pipes.data?.[0]?.id || "";
  const pickPipe = (id: string) => { const n = new URLSearchParams(sp); n.set("funil", id); n.delete("abrir"); setSp(n, { replace: true }); };
  const curPipe = pipes.data?.find((p) => p.id === pid);
  const stages = useQuery({ queryKey: ["stages", pid], enabled: !!pid, queryFn: async () => (await supabase.from("pipeline_stages").select("*").eq("pipeline_id", pid).order("position")).data as Stage[] });
  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const reasons = useQuery({ queryKey: ["loss"], queryFn: async () => (await supabase.from("loss_reasons").select("id, name").eq("active", true)).data ?? [] });
  const oppKey = ["opps", pid];
  const opps = useQuery({ queryKey: oppKey, enabled: !!pid, queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("id, title, value_cents, status, stage_id, owner_user_id, unit_id, person_id, pipeline_id, legal_entity_id, next_contact_at, last_contact_at, created_at, source, campaign, person:people(id, full_name), legal_entity:legal_entities(id, legal_name, trade_name)")
      .eq("pipeline_id", pid).order("created_at", { ascending: false }).limit(500);
    if (error) throw error; return data as unknown as Opp[];
  } });
  const nameOf = (id: string | null) => users.data?.find((u) => u.user_id === id)?.name ?? "Sem responsável";

  const filtered = useMemo(() => (opps.data ?? []).filter((o) => {
    if (q && !`${o.title} ${o.person?.full_name ?? ""} ${o.legal_entity?.legal_name ?? ""} ${o.legal_entity?.trade_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
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
    onSettled: () => { void qc.invalidateQueries({ queryKey: oppKey }); void qc.invalidateQueries({ queryKey: ["crm-overview"] }); },
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

  const extraCount = (owner ? 1 : 0) + (stale ? 1 : 0);
  const extraSummary = [owner && (owner === "none" ? "Sem responsável" : nameOf(owner)), stale && "Sem retorno"].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHead eyebrow="CRM" title="Pipeline" hint="Um funil para cada tipo de lead. A mesma pessoa pode estar em mais de um funil ao mesmo tempo, e cada oportunidade anda sozinha. Arraste os cards entre etapas ou use o menu ⋯ (teclado: Espaço para pegar, setas para mover)."
        actions={<button className="hp-btn hp-btn-primary" onClick={() => setShowNew(true)}><Plus size={16} aria-hidden />Nova oportunidade</button>} />
      <Msg m={msg} />

      <nav aria-label="Tipos de lead (funis)" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4" data-testid="funis-tipos">
        {(pipes.data ?? []).map((p) => {
          const ov = overview.data?.find((x) => x.pipeline_id === p.id); const active = p.id === pid; const kind = isLeadKind(p.kind) ? p.kind : null; const t = kind ? LEAD_TYPE[kind] : null; const Icon = t?.icon;
          return (
            <button key={p.id} type="button" aria-pressed={active} data-funil={p.id} data-kind={p.kind} onClick={() => pickPipe(p.id)}
              className={`text-left rounded-xl border p-3 transition-colors ${active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/40"}`}>
              <span className="flex items-center gap-2 text-[13px] font-semibold">{Icon && <span className={`grid place-items-center h-6 w-6 rounded-full ${t!.chip}`}><Icon size={13} aria-hidden /></span>}<span className="truncate">{t ? t.label : p.name}</span></span>
              <span className="flex items-baseline gap-1.5 mt-1.5"><span className="text-2xl font-bold tabular" data-testid="funil-abertas">{ov ? ov.open_count : "—"}</span><span className="text-xs text-muted-foreground">{ov?.open_count === 1 ? "aberta" : "abertas"}{ov && ov.people_count !== ov.open_count ? ` · ${ov.people_count} pessoas` : ""}</span></span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground truncate">{ov && ov.open_value_cents > 0 ? `${brl(ov.open_value_cents)} em aberto` : t?.description ?? p.name}{ov && ov.stale_count > 0 ? ` · ${ov.stale_count} sem retorno` : ""}</span>
            </button>);
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <label className="sr-only" htmlFor="f-q">Buscar</label>
          <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input id="f-q" style={{ paddingLeft: "2rem", paddingRight: q ? "2rem" : undefined }} placeholder="Pessoa ou título" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} className="!h-9 rounded-full !py-0 text-[13px] min-w-[12rem]" />
          {q && <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1" aria-label="Limpar busca" onClick={() => setQ("")}><X size={14} /></button>}
        </div>
        <PeriodFilter onClear={() => { setOwner(""); const n = new URLSearchParams(sp); n.delete("filtro"); setSp(n); }} extraCount={extraCount} extraSummary={extraSummary || undefined}
          extra={
            <div className="grid gap-3">
              <div><label htmlFor="f-owner" className="block text-xs mb-1">Responsável</label>
                <select id="f-owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option><option value="none">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
              <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={stale} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.checked) n.set("filtro", "sem-retorno"); else n.delete("filtro"); setSp(n); }} />Sem retorno há 48h+</label>
            </div>
          } />
        <div role="group" aria-label="Visualização" className="inline-flex rounded-full border border-input overflow-hidden ml-auto">
          <button aria-pressed={view === "kanban"} onClick={() => setView("kanban")} className={`hp-btn hp-btn-sm rounded-none border-0 ${view === "kanban" ? "hp-btn-primary" : "hp-btn-outline"}`}><KanbanSquare size={14} aria-hidden />Kanban</button>
          <button aria-pressed={view === "lista"} onClick={() => setView("lista")} className={`hp-btn hp-btn-sm rounded-none border-0 ${view === "lista" ? "hp-btn-primary" : "hp-btn-outline"}`}><LayoutList size={14} aria-hidden />Lista</button>
        </div>
      </div>

      <State loading={opps.isLoading || stages.isLoading} error={opps.error} />
      {stages.data && opps.data && view === "kanban" && (
        <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}
          accessibility={{ screenReaderInstructions: { draggable: "Para mover a oportunidade, pressione Espaço, use as setas para escolher a etapa e pressione Espaço para soltar. Esc cancela." } }}>
          <div className="overflow-x-auto pb-2" style={{ overscrollBehaviorX: "contain" }} tabIndex={0} role="region" aria-label="Quadro do funil">
            <div className="flex gap-3 items-stretch" style={{ width: "max-content", minWidth: "100%" }}>
              {stageList.map((s) => <Column key={s.id} stage={s} items={filtered.filter((o) => o.stage_id === s.id)} allStages={stageList} nameOf={nameOf} onOpen={setOpenId} onMove={moveTo} dragging={!!dragId} />)}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>{dragged && <CardBody o={dragged} nameOf={nameOf} overlay />}</DragOverlay>
        </DndContext>
      )}
      {stages.data && opps.data && view === "lista" && (filtered.length === 0 ? <EmptyState icon={KanbanSquare} title="Nenhuma oportunidade com estes filtros">Ajuste os filtros ou crie uma nova oportunidade.</EmptyState> : (
        <div className="grid gap-5">{stageList.map((s) => { const items = filtered.filter((o) => o.stage_id === s.id); if (!items.length) return null; return (
          <section key={s.id} aria-label={s.name}><h3 className="mb-2 flex items-center gap-2">{s.name}<Badge>{items.length}</Badge></h3>
            <Table head={["Pessoa", "Título", "Responsável", "Próximo contato", "Origem", "Valor"]} right={[5]}>
              {items.map((o) => <tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}><Td><button className="font-medium text-left hover:underline" onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }}>{cardName(o)}</button>{isStale(o) && <span className="ml-2"><Badge tone="danger">Sem retorno</Badge></span>}</Td>
              <Td>{o.title}</Td><Td>{nameOf(o.owner_user_id)}</Td><Td>{fmtDate(o.next_contact_at)}</Td><Td>{o.source ?? "—"}</Td><Td num>{o.value_cents > 0 ? brl(o.value_cents) : "—"}</Td></tr>)}</Table></section>); })}</div>))}

      <OpportunitySheet opp={opened} stages={stageList} users={users.data ?? []} onClose={() => setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: oppKey })} />
      <NewOpp open={showNew} onOpenChange={setShowNew} pipeId={pid} kind={curPipe?.kind ?? ""} pipeName={curPipe?.name ?? ""} onDone={() => { setShowNew(false); void qc.invalidateQueries({ queryKey: oppKey }); void qc.invalidateQueries({ queryKey: ["crm-overview"] }); m.ok("Oportunidade criada."); }} />
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
    <p className="font-medium text-foreground leading-5 pr-6 break-words">{cardName(o)}</p>
    <p className="text-xs text-muted-foreground mt-0.5 break-words">{o.legal_entity ? `Contato: ${o.person?.full_name ?? "—"}` : o.title}</p>
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
    <li ref={setNodeRef} style={{ position: "relative", touchAction: "manipulation" }}>
      {isDragging && <div aria-hidden className="absolute inset-0 rounded-lg border-2 border-dashed border-input" style={{ background: "hsl(var(--muted) / .5)" }} />}
      <div style={isDragging ? { visibility: "hidden" } : undefined}>
      <div {...attributes} {...listeners} role="button" aria-roledescription="item arrastável" aria-label={`${cardName(o)}, ${o.title}. Enter abre os detalhes.`} tabIndex={0} className="cursor-grab active:cursor-grabbing rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => onOpen(o.id)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen(o.id); } else listeners?.onKeyDown?.(e); }}>
        <CardBody o={o} nameOf={nameOf} />
      </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button className={`absolute top-1.5 right-1.5 p-1 rounded hover:bg-muted text-muted-foreground ${isDragging ? "invisible" : ""}`} aria-label={`Ações de ${cardName(o)}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}><MoreHorizontal size={16} /></button></DropdownMenuTrigger>
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

interface PersonPick { id: string; full_name: string; unit_id: string | null }
const NewOpp = ({ open, onOpenChange, pipeId, kind, pipeName, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; pipeId: string; kind: string; pipeName: string; onDone: () => void }) => {
  const b2b = kind === "companies";
  const [search, setSearch] = useState(""); const [title, setTitle] = useState(""); const [person, setPerson] = useState<PersonPick | null>(null);
  const [cSearch, setCSearch] = useState(""); const [company, setCompany] = useState<{ id: string; name: string } | null>(null); const [newCompany, setNewCompany] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const found = useQuery({ queryKey: ["ppl-search", search], enabled: open && search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name, unit_id").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(8)).data ?? [] });
  const cq = cSearch.replace(/[%_,()]/g, "");
  const foundCo = useQuery({ queryKey: ["co-search", cSearch], enabled: open && b2b && cSearch.length >= 2 && !company, queryFn: async () => (await supabase.from("legal_entities").select("id, legal_name, trade_name").or(`legal_name.ilike.%${cq}%,trade_name.ilike.%${cq}%`).is("merged_into_id", null).limit(8)).data ?? [] });
  const pickPerson = async (id: string) => { const { data } = await supabase.from("people").select("id, full_name, unit_id").eq("id", id).maybeSingle(); if (data) setPerson(data as PersonPick); };
  const pickCompany = async (c: { id: string; name: string }) => {
    setCompany(c); setCSearch(""); if (!title.trim()) setTitle(`B2B — ${c.name}`);
    const { data } = await supabase.from("legal_entity_representatives").select("person_id, is_primary").eq("legal_entity_id", c.id).order("is_primary", { ascending: false }).limit(1);
    if (data?.[0] && !person) await pickPerson(data[0].person_id);       // o contato principal da empresa já vem escolhido (dá para trocar)
  };
  const reset = () => { setPerson(null); setSearch(""); setTitle(""); setCompany(null); setCSearch(""); setErr(null); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (b2b && !company) return setErr("Escolha a empresa ou cadastre uma nova.");
    if (!person?.unit_id) return setErr(b2b ? "Escolha o contato na empresa (uma pessoa com unidade definida)." : "Selecione uma pessoa com unidade definida."); if (!title.trim()) return setErr("Informe o título.");
    if (lock.current) return; lock.current = true; setBusy(true);
    if (b2b && company) { const { error: le } = await supabase.rpc("crm_company_link_contact", { p_company: company.id, p_person: person.id, p_role: null }); if (le) { setBusy(false); lock.current = false; return setErr(errText(le)); } }
    const { error } = await supabase.rpc("crm_create_opportunity", { p_person_id: person.id, p_pipeline_id: pipeId, p_unit_id: person.unit_id, p_title: title.trim(), p_source: "manual", ...(b2b && company ? { p_legal_entity_id: company.id } : {}) }); setBusy(false); lock.current = false;
    if (error) return setErr(errText(error)); reset(); onDone();
  };
  return (<>
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova oportunidade</DialogTitle><DialogDescription>No funil <b>{pipeName}</b> {isLeadKind(kind) ? <LeadTypeBadge kind={kind} /> : null} O responsável é distribuído automaticamente entre os comerciais da unidade. A mesma pessoa pode ter uma oportunidade em cada funil.</DialogDescription></DialogHeader>
        <form onSubmit={submit} id="new-opp" className="grid gap-3" noValidate>
          {b2b && (
            <div><label htmlFor="no-c" className="block mb-1">Empresa</label>
              <input id="no-c" autoComplete="off" placeholder="Busque pelo nome da empresa" value={company ? company.name : cSearch} onChange={(e) => { setCompany(null); setCSearch(e.target.value); }} />
              {!company && foundCo.data && foundCo.data.length > 0 && <ul className="hp-card mt-1 overflow-hidden">{foundCo.data.map((c) => <li key={c.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => void pickCompany({ id: c.id, name: c.trade_name || c.legal_name })}>{c.trade_name || c.legal_name}</button></li>)}</ul>}
              <p className="text-xs text-muted-foreground mt-1">Não encontrou? <button type="button" className="underline" onClick={() => setNewCompany(true)}>Cadastrar empresa</button> (com verificação de duplicidade).</p></div>)}
          <div><label htmlFor="no-p" className="block mb-1">{b2b ? "Contato na empresa" : "Pessoa"}</label><input id="no-p" autoComplete="off" placeholder="Busque pelo nome" value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />
            {!person && found.data && found.data.length > 0 && <ul className="hp-card mt-1 overflow-hidden">{found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button></li>)}</ul>}
            <p className="text-xs text-muted-foreground mt-1">Não encontrou? Cadastre em <Link className="underline" to="/admin/pessoas">Pessoas</Link> (com verificação de duplicidade).</p></div>
          <div><label htmlFor="no-t" className="block mb-1">Título</label><input id="no-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={b2b ? "Ex.: Programa de bem-estar corporativo" : "Ex.: Check-up — avaliação"} /></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </form>
        <DialogFooter><button type="button" className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button><button form="new-opp" disabled={busy} className="hp-btn hp-btn-primary">{busy ? "Criando…" : "Criar oportunidade"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
    {b2b && <CompanyDialog open={newCompany} onOpenChange={setNewCompany} contactRequired title="Cadastrar empresa" onDone={(r) => { setNewCompany(false); setCompany({ id: r.id, name: r.name }); if (!title.trim()) setTitle(`B2B — ${r.name}`); if (r.contactId) void pickPerson(r.contactId); }} />}
  </>);
};

export default Pipeline;
