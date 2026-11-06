import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtDateTime, newKey } from "@/lib/format";
import { Badge, btnGhost, btnPrimary, errText, inputCls, Msg, State, useMsg, type Tone } from "@/lib/ui";
import { useActing } from "./acting";

export interface Point { id: string; at: string; value: number; by: string; author: string; phase: string; appointment_id: string | null }
export interface Series { instrument: string; name: string; label: string | null; side: string | null; unit: string | null; better: "higher" | "lower" | "none"; points: Point[]; first: number; last: number; count: number }
export interface TimelineItem { appointment_id: string; at: string; status: string; service: string; professional: string; session_no: number | null; pain_before: number | null; pain_after: number | null; summary: string | null; next_step: string | null; clinical_note?: string | null }
export interface EvolutionData { specialty: string | null; specialty_label: string | null; plan: { planned_sessions: number; attended: number; status: string; started_on: string } | null; series: Series[]; timeline: TimelineItem[]; recordable?: { appointment_id: string; at: string; status: string; service: string; has_note: boolean }[] }
export interface Instrument { key: string; label: string; unit: string | null; min: number; max: number; better: string; needs_side: boolean; needs_label: boolean; applied_by: string; specialties: string[]; source: string }

const num = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
const SIDE: Record<string, string> = { D: "direito", E: "esquerdo", bilateral: "ambos os lados" };
const STATUS: Record<string, [string, Tone]> = { attended: ["Realizada", "success"], no_show: ["Falta", "danger"], professional_no_show: ["Ausência do profissional", "warning"], cancelled_by_patient: ["Cancelada", "neutral"], cancelled_by_clinic: ["Cancelada pela clínica", "neutral"] };
const title = (s: Series) => `${s.name}${s.label ? ` — ${s.label}` : ""}${s.side ? ` (${SIDE[s.side] ?? s.side})` : ""}`;

/** Um gráfico por medida, SEM interpolar nem estimar: cada ponto é um registro real com data e autoria. “Início → agora” descreve a variação; não diz se é melhora clínica. */
export const SeriesCard = ({ s }: { s: Series }) => {
  const d = s.last - s.first; const good = s.better === "none" || d === 0 ? undefined : (s.better === "lower") === (d < 0);
  const rows = s.points.map((p) => ({ t: new Date(p.at).getTime(), v: p.value, _p: p }));
  const unit = s.unit && s.unit !== "pts" ? ` ${s.unit}` : "";
  return (
    <div className="hp-card p-3" data-testid="series-card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title(s)}</p>
      <p className="mt-1 text-lg font-semibold tabular">{num(s.first)} → {num(s.last)}{unit}
        {s.count > 1 && <span className={`ml-2 text-xs font-normal ${good === undefined ? "text-muted-foreground" : good ? "text-success" : "text-destructive"}`}>{d > 0 ? "+" : d < 0 ? "−" : ""}{num(Math.abs(d))}{unit} desde o início</span>}</p>
      <div style={{ height: 120 }} role="img" aria-label={`Gráfico de ${title(s)}: ${s.count} registro(s), de ${num(s.first)} para ${num(s.last)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} fontSize={10} tickFormatter={(v) => new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} />
            <YAxis fontSize={10} domain={["auto", "auto"]} allowDecimals />
            <Tooltip content={({ active, payload }) => { const p = (payload?.[0]?.payload as { _p?: Point } | undefined)?._p; if (!active || !p) return null;
              return <div className="hp-card p-2 text-xs"><p className="font-medium">{num(p.value)}{unit}</p><p>{fmtDateTime(p.at)}</p><p className="text-muted-foreground">Registrado por {p.author}{p.phase === "before" ? " · antes da sessão" : p.phase === "after" ? " · depois da sessão" : ""}</p></div>; }} />
            <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const TimelineList = ({ items, clinical }: { items: TimelineItem[]; clinical?: boolean }) => {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">As consultas realizadas aparecem aqui, com o que foi feito em cada uma.</p>;
  return (
    <ol className="grid gap-2" data-testid="timeline">{items.map((t) => { const [label, tone] = STATUS[t.status] ?? [t.status, "neutral" as Tone];
      return (
        <li key={t.appointment_id} className="hp-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{t.session_no ? `Sessão ${t.session_no}` : label}</b> <span className="text-muted-foreground">· {fmtDate(t.at)} · {t.professional}</span></span><Badge tone={tone}>{label}</Badge></div>
          {(t.pain_before != null || t.pain_after != null) && <p className="mt-1 text-xs text-muted-foreground">Dor: {t.pain_before != null ? num(t.pain_before) : "—"} antes → {t.pain_after != null ? num(t.pain_after) : "—"} depois</p>}
          {t.summary && <p className="mt-1">{t.summary}</p>}{t.next_step && <p className="mt-1 text-muted-foreground">Próxima conduta: {t.next_step}</p>}
          {clinical && t.clinical_note && <p className="mt-1 rounded bg-muted p-2 text-xs">Nota clínica (restrita): {t.clinical_note}</p>}
        </li>); })}</ol>
  );
};

/** Visão comum (paciente e fisio): plano, medidas “início → agora” e linha do tempo por consulta. */
export const EvolutionView = ({ d, clinical }: { d: EvolutionData; clinical?: boolean }) => {
  const goals = d.series.filter((s) => s.instrument === "psfs"); const rest = d.series.filter((s) => s.instrument !== "psfs");
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {d.specialty_label && <Badge tone="info">{d.specialty_label}</Badge>}
        {d.plan ? <span>Sessão <b className="tabular">{d.plan.attended}</b> de <b className="tabular">{d.plan.planned_sessions}</b> do plano</span> : <span className="text-muted-foreground">O plano de sessões ainda não foi definido pelo fisioterapeuta.</span>}
      </div>
      {d.series.length === 0 ? <p className="text-sm text-muted-foreground">As medidas aparecem aqui assim que forem registradas (dor, amplitude, força, testes funcionais).</p> : (<>
        {rest.length > 0 && <div><h3 className="mb-2 text-base font-semibold">Início × agora</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rest.map((s) => <SeriesCard key={s.instrument + s.label + s.side} s={s} />)}</div></div>}
        {goals.length > 0 && <div data-testid="goals"><h3 className="mb-2 text-base font-semibold">O que eu quero voltar a fazer</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{goals.map((s) => <SeriesCard key={s.label ?? "" + s.side} s={s} />)}</div></div>}
      </>)}
      <div><h3 className="mb-2 text-base font-semibold">Linha do tempo das consultas</h3><TimelineList items={d.timeline} clinical={clinical} /></div>
    </div>
  );
};

/** Paciente: evolução (my_evolution) + registrar como está hoje e a meta de atividade. */
export const PatientEvolutionPanel = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { acting } = useActing();
  const q = useQuery({ queryKey: ["my-evolution", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_evolution"); if (error) throw error; return data as EvolutionData; } });
  const [act, setAct] = useState(""); const [score, setScore] = useState("5"); const [pain, setPain] = useState("");
  const add = async (instrument: string, label: string | null, value: string, ok: string) => {
    const v = Number(value.replace(",", ".")); if (!Number.isFinite(v) || v < 0 || v > 10) return m.err("Informe uma nota de 0 a 10.");
    const { error } = await supabase.rpc("my_measurement_add", { p_instrument: instrument, p_label: label, p_value: v, p_note: null, p_key: newKey("m") }); if (error) return m.err(errText(error));
    m.ok(ok); void qc.invalidateQueries({ queryKey: ["my-evolution"] }); void qc.invalidateQueries({ queryKey: ["my-home"] });
  };
  if (q.error) return <section className="mb-8"><h2 className="mb-2 text-xl">Minha evolução</h2><p className="text-sm text-muted-foreground">A evolução ainda não está disponível para este acesso.</p></section>;
  return (
    <section className="mb-10" aria-label="Minha evolução">
      <h2 className="mb-1 text-xl">Minha evolução</h2>
      <p className="mb-4 text-sm text-muted-foreground">Cada ponto é um registro real, com data e autoria. Os números descrevem o que mudou desde o início — quem interpreta é o seu fisioterapeuta.</p>
      <Msg m={msg} /><State loading={q.isLoading} error={undefined} />
      {q.data && <EvolutionView d={q.data} />}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void add("nprs", null, pain, "Dor registrada."); setPain(""); }} className="hp-card grid gap-2 p-3 text-sm" aria-label="Registrar minha dor">
          <label htmlFor="pe-dor" className="font-medium">Como está a sua dor hoje? (0 a 10)</label><input id="pe-dor" className={inputCls} inputMode="decimal" value={pain} onChange={(e) => setPain(e.target.value)} placeholder="0 = sem dor · 10 = pior dor" required />
          <button className={btnGhost + " justify-self-start"}>Registrar dor</button>
        </form>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (act.trim().length < 2) return m.err("Diga qual atividade você quer voltar a fazer."); void add("psfs", act.trim(), score, "Atividade registrada."); }} className="hp-card grid gap-2 p-3 text-sm" aria-label="Registrar atividade que quero voltar a fazer">
          <label htmlFor="pe-act" className="font-medium">Uma atividade que quero voltar a fazer</label><input id="pe-act" className={inputCls} value={act} onChange={(e) => setAct(e.target.value)} placeholder="Ex.: subir escada, correr 5 km" maxLength={80} />
          <label htmlFor="pe-sc" className="text-xs">Hoje, o quanto consigo? (0 = não consigo · 10 = como antes)</label><input id="pe-sc" className={inputCls} inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} />
          <button className={btnPrimary + " justify-self-start"}>Registrar atividade</button>
        </form>
      </div>
    </section>
  );
};

const MEAS_INIT = { instrument: "nprs", label: "", side: "D", value: "", phase: "before" };
type Meas = typeof MEAS_INIT;
/** Fisio: evolução do paciente + REGISTRO RÁPIDO pós-sessão (resumo ao paciente, conduta, nota clínica restrita e medidas do dia). */
export const PhysioEvolution = ({ person }: { person: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["prof-evolution", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_patient_evolution", { p_person: person }); if (error) throw error; return data as EvolutionData; } });
  const inst = useQuery({ queryKey: ["instruments"], staleTime: 10 * 60_000, queryFn: async () => ((await supabase.rpc("instruments_list")).data ?? []) as Instrument[] });
  const specs = useQuery({ queryKey: ["specialties"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("specialties").select("key, label").order("sort")).data ?? [] });
  const [appt, setAppt] = useState(""); const [summary, setSummary] = useState(""); const [next, setNext] = useState(""); const [clin, setClin] = useState(""); const [painB, setPainB] = useState(""); const [painA, setPainA] = useState(""); const [meas, setMeas] = useState<Meas[]>([]);
  const d = q.data; const list = useMemo(() => inst.data ?? [], [inst.data]);
  const ordered = useMemo(() => [...list].sort((a, b) => Number(b.specialties.includes(d?.specialty ?? "")) - Number(a.specialties.includes(d?.specialty ?? ""))), [list, d?.specialty]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["prof-evolution", person] }); void qc.invalidateQueries({ queryKey: ["pro-journey", person] }); };
  const setSpec = async (key: string) => { const { error } = await supabase.rpc("patient_plan_specialty_set", { p_person: person, p_specialty: key || null }); if (error) return m.err(errText(error)); m.ok("Especialidade do plano atualizada."); refresh(); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!appt) return m.err("Escolha o atendimento.");
    const measures: Record<string, unknown>[] = [];
    for (const [v, phase] of [[painB, "before"], [painA, "after"]] as const) if (v.trim() !== "") { const n = Number(v.replace(",", ".")); if (!Number.isFinite(n) || n < 0 || n > 10) return m.err("Dor de 0 a 10."); measures.push({ instrument: "nprs", value: n, phase }); }
    for (const x of meas) { if (x.value.trim() === "") continue; const n = Number(x.value.replace(",", ".")); if (!Number.isFinite(n)) return m.err("Confira os valores das medidas."); const i = list.find((k) => k.key === x.instrument);
      measures.push({ instrument: x.instrument, label: i?.needs_label ? x.label : null, side: i?.needs_side ? x.side : null, value: n, phase: "assessment" }); }
    const { error } = await supabase.rpc("prof_session_record", { p_person: person, p_appointment: appt, p_summary: summary || null, p_next_step: next || null, p_clinical_note: clin || null, p_measures: measures, p_key: newKey("sr") });
    if (error) return m.err(errText(error));
    m.ok("Registro salvo."); setSummary(""); setNext(""); setClin(""); setPainB(""); setPainA(""); setMeas([]); setAppt(""); refresh();
  };
  if (q.error) return null;
  return (
    <section className="grid gap-5" aria-label="Evolução do paciente">
      <div><h3 className="text-lg">Evolução e registro da sessão</h3><p className="text-xs text-muted-foreground">Registros são imutáveis (corrigir = novo registro). O resumo e a próxima conduta o paciente vê; a nota clínica é restrita a você e à administração (acesso registrado).</p></div>
      <Msg m={msg} /><State loading={q.isLoading} error={undefined} />
      {d && (<>
        <div className="flex flex-wrap items-center gap-2 text-sm"><label htmlFor="sp" className="text-xs">Especialidade do plano</label>
          <select id="sp" className={inputCls + " w-auto"} value={d.specialty ?? ""} onChange={(e) => void setSpec(e.target.value)} disabled={!d.plan}><option value="">—</option>{(specs.data as { key: string; label: string }[] | undefined)?.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          {!d.plan && <span className="text-xs text-muted-foreground">defina o plano de sessões primeiro</span>}</div>
        <form onSubmit={submit} className="hp-card grid gap-3 p-4 text-sm" aria-label="Registro rápido da sessão">
          <h4 className="font-medium">Registro rápido pós-sessão</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3"><label htmlFor="rs-ap" className="mb-1 block text-xs">Atendimento</label><select id="rs-ap" className={inputCls} value={appt} onChange={(e) => setAppt(e.target.value)}><option value="">Escolha…</option>{d.recordable?.map((a) => <option key={a.appointment_id} value={a.appointment_id}>{fmtDateTime(a.at)} — {a.service}{a.has_note ? " (já tem registro)" : ""}</option>)}</select></div>
            <div><label htmlFor="rs-pb" className="mb-1 block text-xs">Dor antes (0–10)</label><input id="rs-pb" className={inputCls} inputMode="decimal" value={painB} onChange={(e) => setPainB(e.target.value)} /></div>
            <div><label htmlFor="rs-pa" className="mb-1 block text-xs">Dor depois (0–10)</label><input id="rs-pa" className={inputCls} inputMode="decimal" value={painA} onChange={(e) => setPainA(e.target.value)} /></div>
          </div>
          <div><label htmlFor="rs-su" className="mb-1 block text-xs">O que foi feito (o paciente vê)</label><textarea id="rs-su" rows={2} className={inputCls} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1000} /></div>
          <div><label htmlFor="rs-nx" className="mb-1 block text-xs">Próxima conduta (o paciente vê)</label><input id="rs-nx" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} maxLength={500} /></div>
          <div><label htmlFor="rs-cl" className="mb-1 block text-xs">Nota clínica (restrita)</label><textarea id="rs-cl" rows={2} className={inputCls} value={clin} onChange={(e) => setClin(e.target.value)} maxLength={4000} /></div>
          {meas.map((x, i) => { const k = list.find((y) => y.key === x.instrument); return (
            <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_5rem_6rem_auto] items-end">
              <div><label className="mb-1 block text-xs" htmlFor={`m-i-${i}`}>Medida</label><select id={`m-i-${i}`} className={inputCls} value={x.instrument} onChange={(e) => setMeas(meas.map((y, j) => j === i ? { ...y, instrument: e.target.value } : y))}>{ordered.filter((y) => y.applied_by !== "patient").map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}</select></div>
              <div>{k?.needs_label ? <><label className="mb-1 block text-xs" htmlFor={`m-l-${i}`}>Movimento / atividade</label><input id={`m-l-${i}`} className={inputCls} value={x.label} onChange={(e) => setMeas(meas.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} /></> : null}</div>
              <div>{k?.needs_side ? <><label className="mb-1 block text-xs" htmlFor={`m-s-${i}`}>Lado</label><select id={`m-s-${i}`} className={inputCls} value={x.side} onChange={(e) => setMeas(meas.map((y, j) => j === i ? { ...y, side: e.target.value } : y))}><option value="D">D</option><option value="E">E</option><option value="bilateral">Ambos</option></select></> : null}</div>
              <div><label className="mb-1 block text-xs" htmlFor={`m-v-${i}`}>Valor{k?.unit ? ` (${k.unit})` : ""}</label><input id={`m-v-${i}`} className={inputCls} inputMode="decimal" value={x.value} onChange={(e) => setMeas(meas.map((y, j) => j === i ? { ...y, value: e.target.value } : y))} /></div>
              <button type="button" className="text-xs text-accent" onClick={() => setMeas(meas.filter((_, j) => j !== i))}>remover</button>
            </div>); })}
          <div className="flex flex-wrap gap-2"><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setMeas([...meas, { ...MEAS_INIT, instrument: ordered.find((y) => y.applied_by !== "patient" && y.key !== "nprs")?.key ?? "goniometria", phase: "assessment" }])}>+ Adicionar medida</button><button className={btnPrimary}>Salvar registro</button></div>
          {list.length > 0 && <p className="text-[11px] text-muted-foreground">As medidas sugeridas seguem a especialidade do plano. Escalas e questionários licenciados só entram depois de conferida a licença de uso.</p>}
        </form>
        <EvolutionView d={d} clinical />
      </>)}
    </section>
  );
};
