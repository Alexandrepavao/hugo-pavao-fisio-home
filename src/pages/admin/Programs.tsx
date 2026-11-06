import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Percent, Repeat, UserX } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate, fmtDateTime } from "@/lib/format";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, btnGhost, btnPrimary, errText, inputCls, KpiGrid, Msg, PageHead, State, StatCard, Table, Tabs, Td, useAsk, useMsg, type Tone } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface Program { id: string; title: string; summary: string | null; details: string | null; product_id: string | null; product: string | null; price_cents: number | null; criteria: { plan_status?: string; min_attended?: number; max_days_since_last?: number; specialty?: string }; active: boolean; offered: number; interested: number; accepted: number }
interface Cand { person_id: string; name: string; plan_status: string; attended: number; days_since_last: number | null; specialty: string | null; week_pct: number | null }
interface Offer { id: string; program: string; person_id: string; patient: string; status: "offered" | "interested" | "accepted" | "declined" | "withdrawn"; offered_at: string; responded_at: string | null; note: string | null }
interface Kpis { from: string; to: string; reassessments: { decisions: number; continuity: number; discharged: number; renewal_rate: number | null }; offers: { offered: number; interested: number; accepted: number; declined: number; conversion_rate: number | null }; cycles: { patients_with_2_plus_plans: number; patients_with_plans: number }; attendance: { avg_attended_per_patient: number | null; patients: number }; at_risk: number; checkin_rate: number | null }
const PLAN: Record<string, string> = { completed: "Plano concluído (alta)", maintenance: "Em manutenção", active: "Plano em andamento" };
const OST: Record<Offer["status"], [string, Tone]> = { offered: ["Oferecida", "info"], interested: ["Paciente tem interesse", "warning"], accepted: ["Aceita", "success"], declined: ["Recusada", "neutral"], withdrawn: ["Retirada", "neutral"] };
const pct = (v: number | null | undefined) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);

/** Gestão › Programas e ofertas: o ADMIN cria o programa, liga ao produto (preço), vê quem é sugerido pelos critérios e decide a quem oferecer. O paciente só recebe com consentimento comercial. */
const Programs = () => {
  const [tab, setTab] = useState("programas");
  return (
    <>
      <PageHead eyebrow="Retenção" title="Programas e ofertas" hint="Você decide o programa, o preço (pelo produto ligado) e a quem oferecer. Só recebem pacientes que aceitaram propostas. “Tenho interesse” apenas avisa a equipe: nenhuma venda ou cobrança é criada sozinha." />
      <Tabs tabs={[["programas", "Programas"], ["ofertas", "Ofertas"], ["indicadores", "Indicadores"]]} value={tab} onChange={setTab} />
      {tab === "programas" && <ProgramList />}{tab === "ofertas" && <Offers />}{tab === "indicadores" && <Indicators />}
    </>
  );
};

const ProgramList = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { hasRole } = useAuth(); const [cand, setCand] = useState<Program | null>(null);
  const q = useQuery({ queryKey: ["programs"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("programs_list"); if (error) throw error; return (data ?? []) as Program[]; } });
  const prods = useQuery({ queryKey: ["products-active"], queryFn: async () => (await supabase.from("products").select("id, name, price_cents").eq("active", true).order("name")).data ?? [] });
  const specs = useQuery({ queryKey: ["specialties"], staleTime: 10 * 60_000, queryFn: async () => ((await supabase.from("specialties").select("key, label").order("sort")).data ?? []) as { key: string; label: string }[] });
  const [f, setF] = useState({ title: "", summary: "", details: "", product: "", plan_status: "", min_attended: "", max_days: "", specialty: "" });
  const save = async (e: FormEvent) => {
    e.preventDefault(); const criteria: Record<string, unknown> = {}; if (f.plan_status) criteria.plan_status = f.plan_status; if (f.min_attended) criteria.min_attended = Number(f.min_attended); if (f.max_days) criteria.max_days_since_last = Number(f.max_days); if (f.specialty) criteria.specialty = f.specialty;
    const { error } = await supabase.rpc("program_save", { p_id: null, p_title: f.title, p_summary: f.summary || null, p_details: f.details || null, p_product: f.product || null, p_criteria: criteria, p_active: true });
    if (error) return m.err(errText(error)); m.ok("Programa criado."); setF({ title: "", summary: "", details: "", product: "", plan_status: "", min_attended: "", max_days: "", specialty: "" }); void qc.invalidateQueries({ queryKey: ["programs"] });
  };
  return (
    <>
      <Msg m={msg} />
      <form onSubmit={save} className="hp-card mb-5 grid gap-3 p-4 text-sm md:grid-cols-2" aria-label="Novo programa">
        <h3 className="text-base font-semibold md:col-span-2">Novo programa</h3>
        <div><label htmlFor="pg-t" className="mb-1 block text-xs">Nome</label><input id="pg-t" className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} /></div>
        <div><label htmlFor="pg-p" className="mb-1 block text-xs">Produto ligado (define o preço)</label><select id="pg-p" className={inputCls} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}><option value="">— sem produto —</option>{(prods.data as { id: string; name: string; price_cents: number }[] | undefined)?.map((p) => <option key={p.id} value={p.id}>{p.name} · {brl(p.price_cents)}</option>)}</select></div>
        <div className="md:col-span-2"><label htmlFor="pg-s" className="mb-1 block text-xs">Resumo (o paciente vê)</label><input id="pg-s" className={inputCls} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} maxLength={300} /></div>
        <div className="md:col-span-2"><label htmlFor="pg-d" className="mb-1 block text-xs">Detalhes (o paciente vê; descreva, sem prometer resultado clínico)</label><textarea id="pg-d" rows={3} className={inputCls} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={3000} /></div>
        <fieldset className="grid gap-2 sm:grid-cols-4 md:col-span-2"><legend className="mb-1 text-xs">Critérios para sugerir candidatos (opcional)</legend>
          <select aria-label="Situação do plano" className={inputCls} value={f.plan_status} onChange={(e) => setF({ ...f, plan_status: e.target.value })}><option value="">Qualquer situação</option>{Object.entries(PLAN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input aria-label="Mínimo de sessões realizadas" className={inputCls} inputMode="numeric" placeholder="Mín. de sessões" value={f.min_attended} onChange={(e) => setF({ ...f, min_attended: e.target.value })} />
          <input aria-label="Máximo de dias desde a última sessão" className={inputCls} inputMode="numeric" placeholder="Máx. dias sem vir" value={f.max_days} onChange={(e) => setF({ ...f, max_days: e.target.value })} />
          <select aria-label="Especialidade" className={inputCls} value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })}><option value="">Qualquer especialidade</option>{specs.data?.map((s) => <option key={s.key} value={s.key}>{s.label.replace("Fisioterapia ", "")}</option>)}</select></fieldset>
        <div className="md:col-span-2"><button className={btnPrimary}>Criar programa</button></div>
      </form>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum programa criado." />
      {q.data && q.data.length > 0 && <Table head={["Programa", "Preço", "Critérios", "Ofertas", ""]}>{q.data.map((g) => (
        <tr key={g.id} data-testid="program-row"><Td><b>{g.title}</b>{g.summary && <span className="block text-xs text-muted-foreground">{g.summary}</span>}</Td><Td>{g.price_cents != null ? <>{brl(g.price_cents)}<span className="block text-xs text-muted-foreground">{g.product}</span></> : "—"}</Td>
          <Td className="text-xs">{[g.criteria.plan_status && PLAN[g.criteria.plan_status], g.criteria.min_attended != null && `${g.criteria.min_attended}+ sessões`, g.criteria.max_days_since_last != null && `até ${g.criteria.max_days_since_last} dias sem vir`, g.criteria.specialty].filter(Boolean).join(" · ") || "—"}</Td>
          <Td>{g.offered} oferecida(s) · {g.interested} com interesse · {g.accepted} aceita(s)</Td>
          <Td>{hasRole("manager") ? <button className={btnGhost + " hp-btn-sm"} onClick={() => setCand(g)}>Ver candidatos</button> : <span className="text-xs text-muted-foreground">candidatos: só o gestor</span>}</Td></tr>))}</Table>}
      {cand && <Candidates program={cand} onClose={() => setCand(null)} />}
    </>
  );
};

const Candidates = ({ program, onClose }: { program: Program; onClose: () => void }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const ask = useAsk();
  const q = useQuery({ queryKey: ["candidates", program.id], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("program_candidates", { p_program: program.id }); if (error) throw error; return (data ?? []) as Cand[]; } });
  const offer = async (c: Cand) => { const note = await ask({ title: `Oferecer “${program.title}” a ${c.name}`, label: "Anotação interna (opcional)", required: false }); if (note === null) return;
    const { error } = await supabase.rpc("program_offer_create", { p_program: program.id, p_person: c.person_id, p_note: note || null, p_expires_on: null }); if (error) return m.err(errText(error)); m.ok(`Oferta enviada a ${c.name}.`); void qc.invalidateQueries({ queryKey: ["candidates", program.id] }); void qc.invalidateQueries({ queryKey: ["programs"] }); void qc.invalidateQueries({ queryKey: ["offers"] }); };
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="candidates">
      <SheetHeader><SheetTitle>Candidatos — {program.title}</SheetTitle><SheetDescription>Sugestão pelos critérios do programa, só entre quem aceitou receber propostas e não recusou nos últimos 90 dias. Você decide a quem oferecer.</SheetDescription></SheetHeader>
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Ninguém atende aos critérios agora." />
      <ul className="mt-3 grid gap-2">{q.data?.map((c) => <li key={c.person_id} className="hp-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span><b>{c.name}</b><span className="block text-xs text-muted-foreground">{PLAN[c.plan_status] ?? c.plan_status} · {c.attended} sessões{c.days_since_last != null ? ` · última há ${c.days_since_last} dia(s)` : ""}{c.week_pct != null ? ` · adesão da semana ${c.week_pct}%` : ""}</span></span><button className={btnPrimary + " hp-btn-sm"} onClick={() => void offer(c)}>Oferecer</button></li>)}</ul>
    </SheetContent></Sheet>
  );
};

const Offers = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["offers", status], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("offers_admin_list", { p_status: status || null }); if (error) throw error; return (data ?? []) as Offer[]; } });
  const set = async (id: string, s: string) => { const { error } = await supabase.rpc("program_offer_set_status", { p_id: id, p_status: s }); if (error) return m.err(errText(error)); m.ok("Oferta atualizada."); void qc.invalidateQueries({ queryKey: ["offers"] }); void qc.invalidateQueries({ queryKey: ["programs"] }); };
  return (
    <>
      <Msg m={msg} /><div className="mb-3 flex items-center gap-2 text-sm"><label htmlFor="of-st" className="text-xs">Situação</label><select id="of-st" className={inputCls + " w-auto"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(OST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhuma oferta." />
      {q.data && q.data.length > 0 && <Table head={["Paciente", "Programa", "Situação", "Quando", ""]}>{q.data.map((o) => { const [l, tone] = OST[o.status];
        return <tr key={o.id} data-testid="offer-row"><Td><b>{o.patient}</b>{o.note && <span className="block text-xs text-muted-foreground">{o.note}</span>}</Td><Td>{o.program}</Td><Td><Badge tone={tone}>{l}</Badge></Td><Td>{fmtDateTime(o.offered_at)}{o.responded_at && <span className="block text-xs text-muted-foreground">resposta em {fmtDate(o.responded_at)}</span>}</Td>
          <Td>{(o.status === "offered" || o.status === "interested") && <span className="flex flex-wrap gap-1"><button className={btnPrimary + " hp-btn-sm"} onClick={() => void set(o.id, "accepted")}>Marcar como aceita</button><button className={btnGhost + " hp-btn-sm"} onClick={() => void set(o.id, "withdrawn")}>Retirar</button></span>}</Td></tr>; })}</Table>}
    </>
  );
};

const Indicators = () => {
  const q = useQuery({ queryKey: ["retention-kpis"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("retention_kpis"); if (error) throw error; return data as Kpis; } });
  const d = q.data;
  return (
    <>
      <State loading={q.isLoading} error={q.error} />
      {d && <div data-testid="retention-kpis"><p className="mb-3 text-xs text-muted-foreground">Últimos 90 dias ({fmtDate(d.from + "T12:00:00Z")} a {fmtDate(d.to + "T12:00:00Z")}). Números agregados; nenhum dado de prontuário individual.</p>
        <KpiGrid>
          <StatCard label="Renovação / continuidade" value={pct(d.reassessments.renewal_rate)} icon={Repeat} unavailable={d.reassessments.renewal_rate == null} basis={`${d.reassessments.continuity} de ${d.reassessments.decisions} reavaliações; ${d.reassessments.discharged} alta(s)`} />
          <StatCard label="Conversão das ofertas" value={pct(d.offers.conversion_rate)} icon={Handshake} unavailable={d.offers.conversion_rate == null} basis={`${d.offers.accepted} aceita(s) de ${d.offers.offered}; ${d.offers.interested} com interesse`} />
          <StatCard label="Pacientes em risco" value={d.at_risk} icon={UserX} tone={d.at_risk > 0 ? "warning" : undefined} basis="plano ativo, sem consulta marcada e sem vir há mais de 21 dias" />
          <StatCard label="Check-in da semana" value={pct(d.checkin_rate)} icon={Percent} unavailable={d.checkin_rate == null} basis="pacientes com plano ativo que já responderam" />
          <StatCard label="Segundo ciclo" value={`${d.cycles.patients_with_2_plus_plans} de ${d.cycles.patients_with_plans}`} icon={Repeat} basis="pacientes com 2 ou mais planos" />
          <StatCard label="Sessões por paciente" value={d.attendance.avg_attended_per_patient == null ? "—" : String(d.attendance.avg_attended_per_patient).replace(".", ",")} icon={Repeat} unavailable={d.attendance.avg_attended_per_patient == null} basis={`${d.attendance.patients} paciente(s) atendidos no período`} />
        </KpiGrid></div>}
    </>
  );
};
export default Programs;
