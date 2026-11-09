import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime, newKey } from "@/lib/format";
import { Badge, btnGhost, btnPrimary, errText, inputCls, KpiGrid, Msg, State, StatCard, Table, Td, useMsg, type Tone } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/auth/AuthProvider";
import { useActing } from "./acting";

export const CAT: Record<string, string> = { agenda: "Agenda / remarcação", pagamento: "Pagamento / pacote", clinica: "Dúvida sobre treino ou orientação (clínica)", tecnico: "Problema técnico", outro: "Outro assunto" };
const ST: Record<string, [string, Tone]> = { open: ["Aberto", "info"], in_progress: ["Em atendimento", "warning"], waiting_patient: ["Aguardando você", "gold"], resolved: ["Resolvido", "success"] };
const SLA: Record<string, [string, Tone]> = { ok: ["No prazo", "neutral"], warning: ["Prazo perto do fim", "warning"], breached: ["Fora do prazo", "danger"], met: ["Respondido no prazo", "success"], late: ["Respondido fora do prazo", "warning"] };
const URGENCIA = "Este canal não é para urgências. Em emergência, ligue 192 (SAMU).";

interface Msg1 { id: string; role: string; body: string; at: string; who: string; internal?: boolean }
interface Mine { id: string; category: string; subject: string; status: string; created_at: string; due_at: string; resolved_at: string | null; last_at: string | null }

/** Chamados do paciente (ou de quem o representa, com escopo “chamados”): só quem já tem pagamento confirmado abre. O prazo de 1ª resposta é de 24 horas. */
export const PatientTickets = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { acting } = useActing(); const [open, setOpen] = useState<string | null>(null);
  const [cat, setCat] = useState("agenda"); const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const elig = useQuery({ queryKey: ["ticket-elig", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_ticket_eligibility"); if (error) throw error; return !!data; } });
  const list = useQuery({ queryKey: ["my-tickets", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_tickets"); if (error) throw error; return (data ?? []) as Mine[]; } });
  const create = async (e: FormEvent) => {
    e.preventDefault(); const { data, error } = await supabase.rpc("my_ticket_open", { p_category: cat, p_subject: subject, p_body: body, p_key: newKey("t") }); if (error) return m.err(errText(error));
    m.ok("Chamado aberto. Respondemos em até 24 horas."); setSubject(""); setBody(""); void qc.invalidateQueries({ queryKey: ["my-tickets"] }); setOpen(data as string);
  };
  return (
    <section aria-label="Chamados">
      <p className="mb-3 text-sm text-muted-foreground">Fale com a equipe do <b>Suporte Humanizado da HP</b>. Respondemos em até 24 horas (chamados clínicos: 24 horas corridas; demais: 24 horas úteis).</p>
      <p role="note" className="mb-4 rounded border border-primary/40 bg-primary/10 px-3 py-2 text-sm">{URGENCIA}</p>
      <Msg m={msg} />
      {elig.error ? <p className="text-sm text-muted-foreground">O suporte não está disponível para este acesso.</p> : elig.data === false ? (
        <p className="hp-card p-4 text-sm" data-testid="ticket-ineligible">Os chamados são para quem já tem um <b>pagamento confirmado</b> de sessão, pacote ou protocolo. Se você acha que isso é um engano, fale com a recepção.</p>
      ) : (
        <form onSubmit={create} className="hp-card mb-6 grid gap-3 p-4 text-sm" aria-label="Novo chamado">
          <h3 className="text-base font-semibold">Novo chamado</h3>
          <div><label htmlFor="tk-c" className="mb-1 block text-xs">Assunto geral</label><select id="tk-c" className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>{Object.entries(CAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="tk-s" className="mb-1 block text-xs">Título</label><input id="tk-s" className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required /></div>
          <div><label htmlFor="tk-b" className="mb-1 block text-xs">Mensagem</label><textarea id="tk-b" rows={4} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} required /></div>
          {cat === "clinica" && <p className="text-xs text-muted-foreground">Chamados clínicos são lidos apenas pelo seu fisioterapeuta e pela administração. Se sentir piora importante ou dor intensa, procure atendimento.</p>}
          <button className={btnPrimary + " justify-self-start"}>Abrir chamado</button>
        </form>)}
      <h3 className="mb-2 text-base font-semibold">Meus chamados</h3>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Você ainda não abriu chamados." />
      <ul className="grid gap-2">{list.data?.map((t) => { const [l, tone] = ST[t.status] ?? [t.status, "neutral" as Tone];
        return <li key={t.id} className="hp-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="my-ticket"><span><b>{t.subject}</b> <span className="text-muted-foreground">· {CAT[t.category]} · {fmtDateTime(t.created_at)}</span></span>
          <span className="flex items-center gap-2"><Badge tone={tone}>{l}</Badge><button className={btnGhost + " hp-btn-sm"} onClick={() => setOpen(t.id)}>Abrir</button></span></li>; })}</ul>
      {open && <Thread id={open} mine onClose={() => setOpen(null)} />}
    </section>
  );
};

/** Conversa do chamado (paciente: my_ticket; equipe/fisio: support_ticket com notas internas, reclassificação e situação). */
const Thread = ({ id, mine, onClose }: { id: string; mine?: boolean; onClose: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [text, setText] = useState(""); const [internal, setInternal] = useState(false); const { acting } = useActing();
  const q = useQuery({ queryKey: ["ticket", id, !!mine, acting], retry: false, refetchInterval: 20_000, queryFn: async () => { const { data, error } = await supabase.rpc(mine ? "my_ticket" : "support_ticket", { p_id: id }); if (error) throw error; return data as { id: string; subject: string; category: string; status: string; masked?: boolean; sla?: string; due_at: string; patient?: string; messages: Msg1[] }; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["ticket", id] }); void qc.invalidateQueries({ queryKey: ["my-tickets"] }); void qc.invalidateQueries({ queryKey: ["support-queue"] }); };
  const send = async (e: FormEvent) => { e.preventDefault(); if (!text.trim()) return;
    const r = mine ? await supabase.rpc("my_ticket_reply", { p_id: id, p_body: text, p_key: newKey("tm") }) : await supabase.rpc("support_reply", { p_id: id, p_body: text, p_internal: internal, p_key: newKey("sm") });
    if (r.error) return m.err(errText(r.error)); setText(""); setInternal(false); refresh(); };
  const call = async (fn: string, args: Record<string, unknown>) => { const { error } = await supabase.rpc(fn, args); if (error) return m.err(errText(error)); refresh(); };
  const d = q.data;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="ticket-sheet">
      <SheetHeader><SheetTitle>{d?.subject ?? "Chamado"}</SheetTitle><SheetDescription>{d ? `${CAT[d.category]}${d.patient ? ` · ${d.patient}` : ""}` : ""}</SheetDescription></SheetHeader>
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} />
      {d && <div className="mt-3 grid gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={(ST[d.status] ?? ["", "neutral"])[1] as Tone}>{(ST[d.status] ?? [d.status])[0]}</Badge>{d.sla && <Badge tone={(SLA[d.sla] ?? ["", "neutral"])[1] as Tone}>{(SLA[d.sla] ?? [d.sla])[0]}</Badge>}<span className="text-xs text-muted-foreground">prazo da 1ª resposta: {fmtDateTime(d.due_at)}</span></div>
        {d.masked ? <p className="hp-card p-3">Este é um chamado clínico: o conteúdo é visto apenas pelo fisioterapeuta responsável e pela administração.</p> : (<>
          <ul className="grid gap-2" data-testid="ticket-messages">{d.messages.map((x) => <li key={x.id} className={`rounded border p-2 ${x.internal ? "border-dashed bg-muted" : x.role === "patient" ? "border-border bg-card" : "border-primary/30 bg-primary/5"}`}><p className="text-xs text-muted-foreground">{x.who}{x.internal ? " · nota interna (o paciente não vê)" : ""} · {fmtDateTime(x.at)}</p><p className="whitespace-pre-line">{x.body}</p></li>)}</ul>
          <form onSubmit={send} className="grid gap-2"><label htmlFor="tk-r" className="text-xs">Responder</label><textarea id="tk-r" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
            {!mine && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Nota interna (só a equipe vê)</label>}
            <button className={btnPrimary + " justify-self-start"}>{internal ? "Salvar nota" : "Enviar"}</button></form>
          {!mine && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button className={btnGhost + " hp-btn-sm"} onClick={() => void call("support_set_status", { p_id: id, p_status: "in_progress" })}>Em atendimento</button>
            <button className={btnGhost + " hp-btn-sm"} onClick={() => void call("support_set_status", { p_id: id, p_status: "resolved" })}>Marcar como resolvido</button>
            <label htmlFor="tk-rc" className="ml-auto text-xs">Reclassificar</label><select id="tk-rc" className={inputCls + " w-auto"} value={d.category} onChange={(e) => void call("support_reclassify", { p_id: id, p_category: e.target.value })}>{Object.entries(CAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
        </>)}
      </div>}
    </SheetContent></Sheet>
  );
};

interface QRow { id: string; person_id: string; patient: string; category: string; subject: string; masked: boolean; status: string; created_at: string; due_at: string; sla: string; escalated: boolean; in_name_of: boolean }
interface Kpis { total: number; open: number; breached: number; responded: number; within_sla: number; avg_first_response_h: number | null; avg_resolution_h: number | null }
/** Fila de chamados (Suporte Humanizado da HP): equipe administrativa, gestor e fisio (só os clínicos dos pacientes dele). */
export const SupportQueue = () => {
  const { hasRole } = useAuth(); const [status, setStatus] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["support-queue", status], retry: false, refetchInterval: 30_000, queryFn: async () => { const { data, error } = await supabase.rpc("support_queue", { p_status: status || null }); if (error) throw error; return (data ?? []) as QRow[]; } });
  const k = useQuery({ queryKey: ["support-kpis"], retry: false, enabled: hasRole("manager", "ops_admin", "unit_manager"), queryFn: async () => { const { data, error } = await supabase.rpc("support_kpis"); if (error) throw error; return data as Kpis; } });
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><LifeBuoy size={16} aria-hidden />Primeira resposta em até 24 horas (clínico: corridas; demais: úteis). Chamado clínico só é lido pelo fisio vinculado e pelo gestor; aqui a equipe vê que ele existe.</p>
      {k.data && <div className="mb-4"><KpiGrid>
        <StatCard label="Abertos" value={k.data.open} basis={`${k.data.total} nos últimos 30 dias`} />
        <StatCard label="Fora do prazo" value={k.data.breached} tone={k.data.breached > 0 ? "danger" : undefined} basis="sem 1ª resposta e prazo vencido" />
        <StatCard label="Respondidos no prazo" value={k.data.responded ? `${Math.round((100 * k.data.within_sla) / k.data.responded)}%` : "—"} basis={`${k.data.within_sla} de ${k.data.responded} respondidos`} unavailable={!k.data.responded} />
        <StatCard label="Tempo médio da 1ª resposta" value={k.data.avg_first_response_h ?? "—"} unit={k.data.avg_first_response_h != null ? "h" : undefined} unavailable={k.data.avg_first_response_h == null} basis="calculado dos chamados respondidos" />
      </KpiGrid></div>}
      <div className="mb-3 flex items-center gap-2 text-sm"><label htmlFor="q-st" className="text-xs">Situação</label><select id="q-st" className={inputCls + " w-auto"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(ST).map(([k2, [l]]) => <option key={k2} value={k2}>{l}</option>)}</select></div>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum chamado." />
      {q.data && q.data.length > 0 && <Table head={["Paciente", "Assunto", "Tipo", "Situação", "Prazo", ""]}>{q.data.map((t) => { const [l, tone] = ST[t.status] ?? [t.status, "neutral" as Tone]; const [sl, st] = SLA[t.sla] ?? [t.sla, "neutral" as Tone];
        return <tr key={t.id} data-testid="queue-row"><Td><b>{t.patient}</b>{t.in_name_of && <span className="block text-xs text-muted-foreground">aberto por um responsável</span>}</Td><Td>{t.subject}{t.escalated && <span className="ml-2"><Badge tone="danger">Escalado</Badge></span>}</Td>
          <Td>{CAT[t.category]}</Td><Td><Badge tone={tone}>{l}</Badge></Td><Td><Badge tone={st}>{sl}</Badge><span className="block text-xs text-muted-foreground">{fmtDateTime(t.due_at)}</span></Td><Td><button className={btnGhost + " hp-btn-sm"} onClick={() => setOpen(t.id)}>Abrir</button></Td></tr>; })}</Table>}
      {open && <Thread id={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
