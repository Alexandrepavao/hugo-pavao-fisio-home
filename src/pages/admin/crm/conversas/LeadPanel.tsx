import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ExternalLink, Phone, ShoppingCart } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, errText } from "@/lib/ui";
import { initials, isStale, type Stage, type Task } from "../types";
import { nicheOf } from "../niches";
import { fmtPhone, refreshConversations, useStaff } from "./api";

interface LeadOpp {
  id: string; title: string; value_cents: number; status: string; stage_id: string; owner_user_id: string | null; unit_id: string; person_id: string; pipeline_id: string;
  next_contact_at: string | null; last_contact_at: string | null; created_at: string; source: string | null; campaign: string | null; profile: Record<string, string>;
  pipeline: { id: string; name: string; kind: string } | null;
}

const startOf = (range: string) => { const m = /^[[(]?"?([^",]+)/.exec(range); if (!m) return null; const s = m[1].replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"); const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };
const APPT_LABEL: Record<string, string> = { scheduled: "Agendado", confirmed: "Confirmado", attended: "Realizado", no_show: "Faltou", cancelled_by_patient: "Cancelado pelo paciente", cancelled_by_clinic: "Cancelado pela clínica", rescheduled: "Remarcado" };

const Block = ({ title, children, testid }: { title: string; children: React.ReactNode; testid?: string }) => (
  <section className="px-4 py-3 border-b border-border" data-testid={testid}><h3 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">{title}</h3>{children}</section>
);

/** Coluna da direita: ficha contextual do lead. Cabeçalho e etapa valem para todos; os campos e o contexto mudam conforme o NICHO (tipo do funil). */
const LeadPanel = ({ personId, opportunityId, name, phone, conversationId, myId, isManager }: {
  personId: string; opportunityId: string | null; name: string; phone: string | null; conversationId: string; myId: string | null; isManager: boolean;
}) => {
  const qc = useQueryClient(); const staff = useStaff();
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null); const [form, setForm] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const opp = useQuery({ queryKey: ["crm-lead", opportunityId], enabled: !!opportunityId, queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("id, title, value_cents, status, stage_id, owner_user_id, unit_id, person_id, pipeline_id, next_contact_at, last_contact_at, created_at, source, campaign, profile, pipeline:pipelines(id, name, kind)").eq("id", opportunityId!).single();
    if (error) throw error; return data as unknown as LeadOpp;
  } });
  const o = opp.data; const niche = nicheOf(o?.pipeline?.kind);
  const stages = useQuery({ queryKey: ["stages", o?.pipeline_id], enabled: !!o?.pipeline_id, queryFn: async () => (await supabase.from("pipeline_stages").select("*").eq("pipeline_id", o!.pipeline_id).order("position")).data as Stage[] });
  const tasks = useQuery({ queryKey: ["opp-tasks", opportunityId], enabled: !!opportunityId, queryFn: async () => (await supabase.from("crm_tasks").select("*").eq("opportunity_id", opportunityId!).is("done_at", null).order("due_at")).data as Task[] });
  const appts = useQuery({ queryKey: ["crm-lead-appts", personId], enabled: o?.pipeline?.kind === "patients", queryFn: async () => (await supabase.from("appointments").select("id, period, status").eq("person_id", personId).order("created_at", { ascending: false }).limit(60)).data ?? [] });
  const sales = useQuery({ queryKey: ["crm-lead-sales", personId], queryFn: async () => (await supabase.from("sales").select("id, total_cents, status, sold_at").eq("person_id", personId).eq("status", "confirmed")).data ?? [] });

  useEffect(() => { setForm(o?.profile ?? {}); }, [o?.id, JSON.stringify(o?.profile)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFlash(null); }, [opportunityId]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["crm-lead", opportunityId] }); void qc.invalidateQueries({ queryKey: ["opp-tasks", opportunityId] }); void qc.invalidateQueries({ queryKey: ["opps"] }); refreshConversations(qc, conversationId); };
  const ownerName = staff.data?.find((u) => u.user_id === o?.owner_user_id)?.name ?? (o?.owner_user_id === myId ? "Você" : "Sem responsável");

  const patch = async (p: Record<string, unknown>, ok: string) => { const { error } = await supabase.from("opportunities").update(p).eq("id", o!.id); if (error) setFlash({ kind: "err", text: errText(error) }); else { setFlash({ kind: "ok", text: ok }); refresh(); } };
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.rpc("crm_lead_profile_save", { p_opportunity: o!.id, p_profile: form });
    setBusy(false); if (error) return setFlash({ kind: "err", text: errText(error) }); setFlash({ kind: "ok", text: "Ficha salva." }); refresh();
  };
  const finish = async (id: string) => { await supabase.from("crm_tasks").update({ done_at: new Date().toISOString() }).eq("id", id); refresh(); };

  const now = Date.now();
  const list = (appts.data ?? []).map((a) => ({ ...a, start: startOf(a.period as string) })).filter((a) => a.start);
  const next = list.filter((a) => a.start!.getTime() > now && ["scheduled", "confirmed"].includes(a.status)).sort((a, b) => a.start!.getTime() - b.start!.getTime())[0];
  const attended = list.filter((a) => a.status === "attended").length;
  const salesTotal = (sales.data ?? []).reduce((s, x) => s + Number(x.total_cents), 0);

  return (
    <div className="flex flex-col min-h-0 h-full overflow-y-auto bg-card" data-testid="lead-panel">
      <div className="px-4 py-4 border-b border-border text-center grid gap-1 justify-items-center">
        <span aria-hidden className="size-14 rounded-full bg-primary/10 text-primary grid place-items-center text-lg font-semibold">{initials(name)}</span>
        <p className="font-semibold">{name}</p>
        {phone ? <a className="text-sm text-accent hover:underline inline-flex items-center gap-1" href={`tel:+${phone.replace(/\D/g, "")}`}><Phone size={13} aria-hidden />{fmtPhone(phone)}</a> : <span className="text-xs text-muted-foreground">Sem telefone cadastrado</span>}
        <div className="flex flex-wrap justify-center gap-1.5 pt-1">
          {niche && <Badge tone="gold">{niche.label}</Badge>}
          {o && o.status === "won" && <Badge tone="success">Ganha</Badge>}{o && o.status === "lost" && <Badge tone="danger">Perdida</Badge>}
          {o && isStale({ ...o, person: null }) && <Badge tone="danger">Sem retorno há 48h+</Badge>}
        </div>
      </div>

      {flash && <p role={flash.kind === "err" ? "alert" : "status"} className={`mx-4 mt-3 text-sm ${flash.kind === "err" ? "text-destructive" : "text-success"}`}>{flash.text}</p>}

      {!opportunityId && (
        <Block title="Oportunidade">
          <p className="text-sm text-muted-foreground">Esta conversa não está ligada a uma oportunidade, então não há ficha por nicho. Crie ou abra uma oportunidade no <Link className="text-accent hover:underline" to="/admin/crm/oportunidades">Pipeline</Link> e abra a conversa por ela.</p>
          <Link className="hp-btn hp-btn-outline hp-btn-sm mt-2" to={`/admin/pessoas?q=${encodeURIComponent(name)}`}><ExternalLink size={13} aria-hidden />Cadastro da pessoa</Link>
        </Block>
      )}
      {opportunityId && opp.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando ficha…</p>}
      {opportunityId && opp.error && <p className="p-4 text-sm text-destructive" role="alert">Não foi possível carregar a oportunidade.</p>}

      {o && (<>
        <Block title="Oportunidade" testid="lead-opp">
          <p className="text-sm font-medium">{o.title}</p>
          <p className="text-xs text-muted-foreground">{o.pipeline?.name}</p>
          <div className="grid gap-3 pt-3">
            <div><label htmlFor="ld-stage" className="block mb-1 text-xs">Etapa</label>
              <select id="ld-stage" value={o.stage_id} disabled={o.status !== "open"} onChange={(e) => void patch({ stage_id: e.target.value }, "Etapa atualizada.")}>
                {(stages.data ?? []).filter((s) => s.kind !== "lost" || s.id === o.stage_id).map((s) => <option key={s.id} value={s.id}>{s.name}{s.kind === "won" ? " (ganha)" : s.kind === "lost" ? " (perdida)" : ""}</option>)}</select>
              <p className="text-[11px] text-muted-foreground pt-1">Para marcar como perdida (com motivo), use o <Link className="text-accent hover:underline" to="/admin/crm/oportunidades">Pipeline</Link>.</p></div>
            <div><label htmlFor="ld-next" className="block mb-1 text-xs">Próximo contato</label>
              <input id="ld-next" type="datetime-local" defaultValue={o.next_contact_at ? o.next_contact_at.slice(0, 16) : ""} key={o.next_contact_at ?? "none"} onBlur={(e) => e.target.value && patch({ next_contact_at: new Date(e.target.value).toISOString() }, "Próximo contato agendado.")} /></div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div><dt className="text-xs text-muted-foreground">Responsável</dt><dd data-testid="lead-owner">{ownerName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Valor</dt><dd className="tabular">{o.value_cents > 0 ? brl(o.value_cents) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Origem</dt><dd>{o.source ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Campanha</dt><dd>{o.campaign ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Criada em</dt><dd>{fmtDate(o.created_at)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Último contato</dt><dd>{o.last_contact_at ? fmtDateTime(o.last_contact_at) : "—"}</dd></div>
            </dl>
          </div>
        </Block>

        {niche && (
          <Block title={`Ficha · ${niche.short}`} testid="lead-niche">
            <form onSubmit={saveProfile} className="grid gap-3">
              {niche.note && <p className="text-[11px] text-muted-foreground rounded-md bg-muted px-2.5 py-1.5">{niche.note}</p>}
              {niche.fields.map((f) => (
                <div key={f.key}><label htmlFor={`pf-${f.key}`} className="block mb-1 text-xs">{f.label}</label>
                  {f.options
                    ? <select id={`pf-${f.key}`} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}><option value="">—</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    : <input id={`pf-${f.key}`} maxLength={200} placeholder={f.placeholder} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
                </div>
              ))}
              <button className="hp-btn hp-btn-outline w-fit" disabled={busy} data-testid="lead-save">{busy ? "Salvando…" : "Salvar ficha"}</button>
            </form>
          </Block>
        )}

        {o.pipeline?.kind === "patients" && (
          <Block title="Atendimentos (administrativo)" testid="lead-appts">
            <p className="text-sm flex items-start gap-2"><CalendarCheck size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden /><span>{next?.start ? <>Próximo: <strong>{fmtDateTime(next.start.toISOString())}</strong> <span className="text-muted-foreground">({APPT_LABEL[next.status]})</span></> : "Nenhum atendimento futuro agendado."}</span></p>
            <p className="text-xs text-muted-foreground pt-1">Atendimentos realizados: {attended}. Dados clínicos não aparecem aqui.</p>
          </Block>
        )}

        <Block title="Vendas confirmadas" testid="lead-sales">
          {(sales.data ?? []).length === 0
            ? <p className="text-sm text-muted-foreground">Nenhuma venda confirmada para esta pessoa.</p>
            : <p className="text-sm flex items-center gap-2"><ShoppingCart size={15} className="text-muted-foreground" aria-hidden /><span><strong>{sales.data!.length}</strong> venda{sales.data!.length > 1 ? "s" : ""} · <span className="tabular">{brl(salesTotal)}</span></span></p>}
          {o.status === "open" && <Link className="hp-btn hp-btn-outline hp-btn-sm mt-2" to={`/admin/financeiro/vendas?venda=${o.id}&pessoa=${o.person_id}&unidade=${o.unit_id}`}>Converter em venda</Link>}
        </Block>

        <Block title={`Tarefas${tasks.data?.length ? ` (${tasks.data.length})` : ""}`} testid="lead-tasks">
          {(tasks.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma tarefa pendente.</p>}
          <ul className="grid gap-2">{(tasks.data ?? []).map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-2 text-sm"><span>{t.title}<span className={`block text-xs ${new Date(t.due_at) < new Date() ? "text-destructive" : "text-muted-foreground"}`}>{fmtDateTime(t.due_at)}</span></span>
              <button className="text-accent text-sm font-medium" onClick={() => void finish(t.id)}>Concluir</button></li>))}</ul>
        </Block>

        <Block title="Atalhos">
          <div className="flex flex-wrap gap-2">
            <Link className="hp-btn hp-btn-outline hp-btn-sm" to="/admin/crm/oportunidades"><ExternalLink size={13} aria-hidden />Pipeline</Link>
            <Link className="hp-btn hp-btn-outline hp-btn-sm" to={`/admin/pessoas?q=${encodeURIComponent(name)}`}><ExternalLink size={13} aria-hidden />Cadastro</Link>
            {isManager && <Link className="hp-btn hp-btn-outline hp-btn-sm" to="/admin/crm/tarefas"><ExternalLink size={13} aria-hidden />Tarefas do CRM</Link>}
          </div>
        </Block>
      </>)}
    </div>
  );
};
export default LeadPanel;
