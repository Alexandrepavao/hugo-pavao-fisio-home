import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellRing, ChevronRight, Clock, MessageCircle, UserPlus, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";

import { Badge, errText } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initials } from "../types";
import { CHANNEL_LABEL, STATUS_LABEL } from "../niches";
import { fmtPhone, phoneOf, refreshConversations, useScheduledActions, useStaff, waLink, type ConvMessage, type ScheduledRow } from "./api";
import ScheduleDialog from "./ScheduleDialog";

type Mode = "outbound" | "inbound" | "note";
const MODES: [Mode, string][] = [["outbound", "Mensagem"], ["inbound", "Resposta recebida"], ["note", "Nota interna"]];
const MODE_HELP: Record<Mode, string> = {
  outbound: "“Abrir WhatsApp” só abre o wa.me com o texto e registra aqui. O HP não confirma envio, entrega nem leitura.",
  inbound: "Registro manual do que o contato respondeu.",
  note: "Só a equipe do CRM vê. Não vai para o contato.",
};

interface ConvRow {
  id: string; person_id: string; opportunity_id: string | null; unit_id: string; channel: "whatsapp" | "phone" | "email"; status: "open" | "pending" | "resolved";
  person: { full_name: string; person_contacts: { type: string; normalized: string; is_primary: boolean }[] } | null;
  participants: { user_id: string; role: "owner" | "collaborator"; added_at: string }[];
}

const TZ = "America/Sao_Paulo";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayLabel = (iso: string) => {
  const k = dayKey(iso); if (k === dayKey(new Date().toISOString())) return "Hoje"; if (k === dayKey(new Date(Date.now() - 864e5).toISOString())) return "Ontem";
  const d = new Date(iso); const sameYear = d.toLocaleDateString("sv-SE", { timeZone: TZ, year: "numeric" }) === new Date().toLocaleDateString("sv-SE", { timeZone: TZ, year: "numeric" });
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: TZ });
};

const DateSep = ({ iso }: { iso: string }) => <li className="flex justify-center py-1" data-testid="msg-date"><span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground">{dayLabel(iso)}</span></li>;

const Bubble = ({ m, name }: { m: ConvMessage; name: string }) => {
  if (m.direction === "system") return <li className="text-center text-xs text-muted-foreground py-0.5" data-testid="msg-system">{m.body} <span className="opacity-70">· {hhmm(m.created_at)}</span></li>;
  const out = m.direction === "outbound"; const note = m.direction === "note";
  return (
    <li className={`flex ${out || note ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.direction}`}>
      <div className={`max-w-[85%] sm:max-w-[68%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${note ? "bg-[hsl(var(--accent)/.12)] border border-[hsl(var(--accent)/.35)] rounded-br-sm" : out ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className={`pt-1 text-[11px] text-right ${out ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
          {note ? `Nota interna · ${name}` : out ? `${name} · ${m.delivery === "whatsapp_opened" ? "WhatsApp aberto · sem confirmação de entrega" : "registrada"}` : "Resposta registrada manualmente"} · {hhmm(m.created_at)}
        </p>
      </div>
    </li>
  );
};

/** Coluna central: cabeçalho com atendentes/estado, mensagens e compositor. */
const ConversationThread = ({ id, myId, isManager, onBack, panelOpen, onTogglePanel, onMsg }: {
  id: string; myId: string | null; isManager: boolean; onBack: () => void; panelOpen: boolean; onTogglePanel: () => void; onMsg: { ok: (t: string) => void; err: (t: string) => void };
}) => {
  const qc = useQueryClient(); const staff = useStaff(); const sched = useScheduledActions(onMsg);
  const [mode, setMode] = useState<Mode>("outbound"); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState(false); const [scheduleOpen, setScheduleOpen] = useState(false); const endRef = useRef<HTMLLIElement>(null);
  const [reschedId, setReschedId] = useState<string | null>(null); const [reschedAt, setReschedAt] = useState("");

  const conv = useQuery({ queryKey: ["crm-conv", id], queryFn: async () => {
    const { data, error } = await supabase.from("crm_conversations").select("id, person_id, opportunity_id, unit_id, channel, status, person:people(full_name, person_contacts(type, normalized, is_primary)), participants:crm_conversation_participants(user_id, role, added_at)").eq("id", id).single();
    if (error) throw error; return data as unknown as ConvRow;
  } });
  const msgs = useQuery({ queryKey: ["crm-msgs", id], refetchInterval: 8000, queryFn: async () => {
    const { data, error } = await supabase.from("crm_messages").select("id, direction, body, delivery, author_user_id, created_at").eq("conversation_id", id).order("created_at").order("id").limit(500);
    if (error) throw error; return data as ConvMessage[];
  } });
  const pending = useQuery({ queryKey: ["crm-conv-sched", id], refetchInterval: 30000, queryFn: async () => {
    const { data, error } = await supabase.from("crm_scheduled_messages").select("id, conversation_id, person_id, body, scheduled_for, status, assignee_user_id, sent_at, cancelled_at").eq("conversation_id", id).eq("status", "scheduled").order("scheduled_for");
    if (error) throw error; return data as unknown as ScheduledRow[];
  } });

  const c = conv.data; const name = c?.person?.full_name ?? "—"; const phone = phoneOf(c?.person?.person_contacts);
  const nameOf = (uid: string | null) => (uid === myId ? "Você" : staff.data?.find((u) => u.user_id === uid)?.name ?? "Equipe");
  const mine = !!c?.participants.some((p) => p.user_id === myId);
  const canAct = mine || isManager;
  const lastId = msgs.data?.[msgs.data.length - 1]?.id;

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [id, lastId]);
  // marcar como lida quando a conversa está aberta e chega mensagem nova
  useEffect(() => { if (!c) return; void supabase.rpc("crm_conversation_mark_read", { p_conversation: id }).then(() => { void qc.invalidateQueries({ queryKey: ["crm-inbox"] }); void qc.invalidateQueries({ queryKey: ["crm-unread"] }); }); }, [id, lastId, !!c]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (fn: string, args: Record<string, unknown>, ok?: string) => {
    const { error } = await supabase.rpc(fn, args); if (error) { onMsg.err(errText(error)); return false; } if (ok) onMsg.ok(ok); refreshConversations(qc, id); return true;
  };
  const post = async (e: FormEvent) => {
    e.preventDefault(); const body = text.trim(); if (!body || !c) return;
    if (mode === "outbound") {
      if (c.channel === "whatsapp" && !phone) return onMsg.err("Esta pessoa não tem telefone cadastrado: não há para onde abrir o WhatsApp. Cadastre o telefone ou registre como nota.");
      if (c.channel === "whatsapp" && phone) window.open(waLink(phone, body), "_blank", "noopener,noreferrer");   // antes do await: evita bloqueio de pop-up
    }
    setBusy(true);
    const { error } = await supabase.rpc("crm_conversation_post", { p_conversation: id, p_direction: mode, p_body: body, p_whatsapp_opened: mode === "outbound" && c.channel === "whatsapp" });
    setBusy(false);
    if (error) return onMsg.err(mode === "outbound" && c.channel === "whatsapp" && phone ? `O WhatsApp foi aberto, mas o registro falhou: ${errText(error)}` : errText(error));
    setText(""); refreshConversations(qc, id);
    onMsg.ok(mode === "outbound" ? "WhatsApp aberto e registrado na conversa (sem confirmação de envio)." : mode === "inbound" ? "Resposta registrada." : "Nota registrada.");
  };

  const dueCount = useMemo(() => (pending.data ?? []).filter((s) => new Date(s.scheduled_for) <= new Date()).length, [pending.data]);

  if (conv.isLoading) return <section className="grid place-items-center h-full text-sm text-muted-foreground">Carregando conversa…</section>;
  if (conv.error || !c) return <section className="grid place-items-center h-full p-6 text-sm text-destructive" role="alert">Conversa não encontrada ou sem acesso. <button className="underline ml-1" onClick={onBack}>Voltar</button></section>;

  return (
    <section aria-label={`Conversa com ${name}`} className="flex flex-col min-h-0 h-full min-w-0 bg-background">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card min-w-0">
        <button className="lg:hidden hp-btn hp-btn-outline hp-btn-sm" onClick={onBack} aria-label="Voltar para a lista"><ArrowLeft size={15} aria-hidden /></button>
        <button className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-lg px-1 py-0.5 hover:bg-muted/60" onClick={onTogglePanel} aria-expanded={panelOpen} data-testid="conv-panel-toggle"
          aria-label={panelOpen ? `Recolher a ficha de ${name}` : `Abrir a ficha de ${name}`}>
          <span aria-hidden className="shrink-0 size-10 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-semibold">{initials(name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-semibold truncate leading-5" data-testid="conv-title">{name}</span>
            <span className="block text-xs text-muted-foreground truncate">{CHANNEL_LABEL[c.channel]} · {fmtPhone(phone)} · {c.participants.length ? `${c.participants.length} atendente${c.participants.length > 1 ? "s" : ""}` : "sem atendente"}</span>
          </span>
          <ChevronRight size={16} aria-hidden className={`shrink-0 text-muted-foreground transition-transform ${panelOpen ? "rotate-180" : ""}`} />
        </button>
        {mine
          ? <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => void call("crm_conversation_leave", { p_conversation: id }, "Você saiu da conversa.")}>Sair</button>
          : <button className="hp-btn hp-btn-primary hp-btn-sm" data-testid="conv-join" onClick={() => void call("crm_conversation_join", { p_conversation: id }, "Você entrou na conversa.")}><UserPlus size={14} aria-hidden />Entrar</button>}
        <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setTeam(true)} data-testid="conv-team" aria-label="Atendimento da conversa: atendentes e estado"><Users size={14} aria-hidden /><span className="hidden 2xl:inline">Atendimento</span></button>
      </header>

      {(pending.data?.length ?? 0) > 0 && (
        <div className="border-b border-border bg-[hsl(var(--accent)/.07)] px-3 py-2 grid gap-1.5" data-testid="conv-scheduled">
          <p className="text-xs font-medium flex items-center gap-1.5"><Clock size={13} aria-hidden />Lembretes de envio {dueCount > 0 && <Badge tone="warning">{dueCount} vencido{dueCount > 1 ? "s" : ""}</Badge>}</p>
          {(pending.data ?? []).map((s) => {
            const due = new Date(s.scheduled_for) <= new Date();
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="conv-sched-item">
                <span className="min-w-0 flex-1 truncate" title={s.body}>“{s.body}”</span>
                <span className={`text-xs ${due ? "text-destructive font-medium" : "text-muted-foreground"}`}>{due ? "Vencido · " : ""}{fmtDateTime(s.scheduled_for)} · {nameOf(s.assignee_user_id)}</span>
                {canAct || s.assignee_user_id === myId ? (<>
                  <button className="hp-btn hp-btn-primary hp-btn-sm" data-testid="sched-send" onClick={() => void sched.sendNow(s, phone)}><MessageCircle size={13} aria-hidden />Abrir WhatsApp</button>
                  <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => { setReschedId(reschedId === s.id ? null : s.id); setReschedAt(""); }}>Remarcar</button>
                  <button className="hp-btn hp-btn-outline hp-btn-sm" data-testid="sched-cancel" onClick={() => void sched.cancel(s)}>Cancelar</button>
                </>) : null}
                {reschedId === s.id && (
                  <span className="basis-full flex gap-2"><label htmlFor={`rs-${s.id}`} className="sr-only">Novo horário</label><input id={`rs-${s.id}`} type="datetime-local" value={reschedAt} onChange={(e) => setReschedAt(e.target.value)} />
                    <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={!reschedAt} onClick={() => { void sched.reschedule(s, reschedAt).then(() => setReschedId(null)); }}>Salvar</button></span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ol className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 grid content-start gap-2 bg-muted/30" data-testid="conv-messages" aria-live="polite" aria-label="Mensagens">
        {msgs.isLoading && <li className="text-sm text-muted-foreground text-center">Carregando mensagens…</li>}
        {(msgs.data ?? []).map((m, i, all) => (
          <Fragment key={m.id}>{(i === 0 || dayKey(all[i - 1].created_at) !== dayKey(m.created_at)) && <DateSep iso={m.created_at} />}<Bubble m={m} name={nameOf(m.author_user_id)} /></Fragment>
        ))}
        <li ref={endRef} aria-hidden />
      </ol>

      <div className="border-t border-border bg-card px-3 py-2.5 grid gap-2" data-testid="conv-composer">
        {!canAct ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">Você pode ler esta conversa. Entre nela para responder, registrar ou criar lembretes.</span>
            <button className="hp-btn hp-btn-primary hp-btn-sm" onClick={() => void call("crm_conversation_join", { p_conversation: id }, "Você entrou na conversa.")}>Entrar na conversa</button></div>
        ) : (
          <form onSubmit={post} className="grid gap-2">
            <div role="tablist" aria-label="Tipo de registro" className="flex flex-wrap gap-1.5">
              {MODES.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={mode === k} data-testid={`mode-${k}`} className="hp-pill !h-7 !px-2.5 !text-xs" data-active={mode === k} onClick={() => setMode(k)}>{l}</button>)}
            </div>
            <label htmlFor="conv-text" className="sr-only">Texto</label>
            <textarea id="conv-text" rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} data-testid="conv-text"
              placeholder={mode === "outbound" ? `Escreva o texto para ${name.split(" ")[0]}…` : mode === "inbound" ? "O que o contato respondeu…" : "Anotação para a equipe…"} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground flex-1 basis-56 min-w-0">{MODE_HELP[mode]}</p>
              <div className="flex gap-2 ml-auto">
                {mode === "outbound" && <button type="button" className="hp-btn hp-btn-outline" data-testid="conv-schedule" disabled={!text.trim()} onClick={() => setScheduleOpen(true)}><BellRing size={15} aria-hidden />Lembrete de envio</button>}
                <button className="hp-btn hp-btn-primary" disabled={busy || !text.trim()} data-testid="conv-send">{mode === "outbound" ? <><MessageCircle size={15} aria-hidden />Abrir WhatsApp</> : mode === "inbound" ? "Registrar resposta" : "Salvar nota"}</button>
              </div>
            </div>
          </form>
        )}
      </div>

      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} conversationId={id} personName={name} initialBody={text} myId={myId} onDone={(t) => { setText(""); onMsg.ok(t); }} />
      <TeamDialog open={team} onOpenChange={setTeam} conv={c} myId={myId} canAct={canAct} isManager={isManager} nameOf={nameOf} call={call} staff={staff.data ?? []} />
    </section>
  );
};

/** Multiatendimento: quem atende, adicionar atendente e transferir (responsável ou gestor). */
const TeamDialog = ({ open, onOpenChange, conv, myId, canAct, isManager, nameOf, call, staff }: {
  open: boolean; onOpenChange: (o: boolean) => void; conv: ConvRow; myId: string | null; canAct: boolean; isManager: boolean; nameOf: (id: string | null) => string;
  call: (fn: string, args: Record<string, unknown>, ok?: string) => Promise<boolean>; staff: { user_id: string; name: string }[];
}) => {
  const [add, setAdd] = useState(""); const [to, setTo] = useState(""); const [keep, setKeep] = useState(true);
  const owner = conv.participants.find((p) => p.role === "owner"); const isOwner = owner?.user_id === myId;
  const inTeam = new Set(conv.participants.map((p) => p.user_id));
  const candidates = staff.filter((u) => !inTeam.has(u.user_id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Atendimento da conversa</DialogTitle><DialogDescription>Mais de uma pessoa pode atender. O responsável é um só; colaboradores ajudam e respondem junto.</DialogDescription></DialogHeader>
        <ul className="grid gap-1.5" data-testid="team-list">
          {conv.participants.length === 0 && <li className="text-sm text-muted-foreground">Ninguém atende esta conversa (ela está na fila).</li>}
          {conv.participants.map((p) => <li key={p.user_id} className="flex items-center justify-between text-sm"><span>{nameOf(p.user_id)}</span><Badge tone={p.role === "owner" ? "gold" : "neutral"}>{p.role === "owner" ? "Responsável" : "Colaborador"}</Badge></li>)}
        </ul>
        {canAct && (
          <div className="grid gap-3 pt-2 border-t border-border">
            <div><label htmlFor="tm-status" className="block mb-1">Estado da conversa</label>
              <select id="tm-status" value={conv.status} onChange={(e) => void call("crm_conversation_set_status", { p_conversation: conv.id, p_status: e.target.value })}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label htmlFor="tm-add" className="block mb-1">Adicionar atendente</label>
              <div className="flex gap-2"><select id="tm-add" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Escolha…</option>{candidates.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select>
                <button className="hp-btn hp-btn-outline" disabled={!add} onClick={() => void call("crm_conversation_add_participant", { p_conversation: conv.id, p_user: add }, "Atendente adicionado.").then(() => setAdd(""))}>Adicionar</button></div></div>
            {(isOwner || isManager) && (
              <div><label htmlFor="tm-to" className="block mb-1">Transferir a conversa para</label>
                <div className="flex gap-2"><select id="tm-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Escolha…</option>{staff.filter((u) => u.user_id !== owner?.user_id).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select>
                  <button className="hp-btn hp-btn-primary" disabled={!to} data-testid="team-transfer" onClick={() => void call("crm_conversation_transfer", { p_conversation: conv.id, p_to: to, p_keep: keep }, "Conversa transferida.").then((ok) => { if (ok) { setTo(""); onOpenChange(false); } })}>Transferir</button></div>
                <label className="flex items-center gap-2 pt-2 text-sm font-normal"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Continuar como colaborador</label>
                <p className="text-xs text-muted-foreground pt-1">A oportunidade e as mensagens agendadas pendentes passam para o novo responsável.</p></div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ConversationThread;
