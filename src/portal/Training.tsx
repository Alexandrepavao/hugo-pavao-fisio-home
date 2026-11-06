import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Flame, Dumbbell, CalendarCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDate, newKey } from "@/lib/format";
import { Badge, btnGhost, btnPrimary, confirmDialog, errText, inputCls, KpiGrid, Msg, State, StatCard, useMsg } from "@/lib/ui";
import { useActing } from "./acting";

export interface TItem { id: string; workout: string; position: number; exercise_id: string; title: string; instructions: string | null; level: string | null; equipment: string | null; sets: number; reps: number | null; duration_s: number | null; load_text: string | null; rest_s: number | null; notes: string | null; contraindications?: string | null }
export interface TPrescription { id: string; title: string; status: "active" | "finished" | "cancelled"; weekly_target: number; starts_on: string; ends_on: string | null; notes: string | null; professional: string; items: TItem[] }
export interface TLog { id: string; done_on: string; workout: string; effort: number | null; pain_during: number | null; note: string | null; skipped: boolean; in_name_of: boolean; prescription_id: string }
export interface TSummary { prescription_id: string; title: string; weekly_target: number; today: { workout: string; total: number; done: number; completed: boolean }; streak: number; week_days: number; week_pct: number }
export interface TData { summary: TSummary | null; prescriptions: TPrescription[]; logs: TLog[] }
export interface Exercise { id: string; title: string; instructions: string | null; region: string | null; level: string | null; equipment: string | null; contraindications: string | null; specialties: string[]; has_video: boolean }

const dose = (i: TItem) => `${i.sets} × ${i.reps != null ? `${i.reps} repetições` : `${i.duration_s} s`}${i.load_text ? ` · ${i.load_text}` : ""}${i.rest_s ? ` · descanso ${i.rest_s} s` : ""}`;
const LEVEL: Record<string, string> = { iniciante: "Iniciante", intermediario: "Intermediário", avancado: "Avançado" };

/** Treino em casa do paciente: o fisio prescreve; aqui ele vê o treino de hoje, marca o que fez e conta como se sentiu (esforço e dor). Sem vídeo por enquanto: instruções escritas. */
export const PatientTrainingPanel = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const { acting } = useActing();
  const q = useQuery({ queryKey: ["my-training", acting], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_training"); if (error) throw error; return data as TData; } });
  const [done, setDone] = useState<Record<string, boolean>>({}); const [effort, setEffort] = useState("5"); const [pain, setPain] = useState("0"); const [note, setNote] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const d = q.data; const s = d?.summary; const pres = d?.prescriptions.find((p) => p.id === s?.prescription_id);
  const items = useMemo(() => (pres?.items ?? []).filter((i) => i.workout === s?.today.workout), [pres, s?.today.workout]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["my-training"] }); void qc.invalidateQueries({ queryKey: ["my-home"] }); };
  const log = async (skipped: boolean) => {
    if (!pres || !s) return; const ids = skipped ? [] : items.filter((i) => done[i.id]).map((i) => i.id);
    if (!skipped && ids.length === 0) return m.err("Marque ao menos um exercício que você fez.");
    const { error } = await supabase.rpc("my_workout_log", { p_prescription: pres.id, p_workout: s.today.workout, p_items_done: ids, p_effort: skipped ? null : Number(effort), p_pain: skipped ? null : Number(pain), p_note: note || null, p_skipped: skipped, p_key: newKey("wl") });
    if (error) return m.err(errText(error)); m.ok(skipped ? "Tudo bem. Registramos que hoje você não treinou." : "Treino registrado. Parabéns!"); setDone({}); setNote(""); refresh();
  };
  if (q.error) return <section className="mb-8"><h2 className="mb-2 text-xl">Treino em casa</h2><p className="text-sm text-muted-foreground">Os treinos não estão disponíveis para este acesso.</p></section>;
  return (
    <section className="mb-10" aria-label="Treino em casa">
      <h2 className="mb-1 text-xl">Treino em casa</h2>
      <p className="mb-4 text-sm text-muted-foreground">Os exercícios são definidos pelo seu fisioterapeuta. Se sentir dor forte, pare e fale com ele — este espaço não substitui uma avaliação.</p>
      <Msg m={msg} /><State loading={q.isLoading} error={undefined} />
      {d && !s && <p className="hp-card p-4 text-sm" data-testid="no-training">Seu fisioterapeuta ainda não liberou um treino para fazer em casa.</p>}
      {d && s && pres && (<div className="grid gap-4" data-testid="training-today">
        <KpiGrid>
          <StatCard label={`Treino de hoje · ${s.today.workout}`} value={s.today.completed ? "Feito" : `${s.today.total} exercícios`} icon={Dumbbell} basis={pres.title} tone={s.today.completed ? "success" : undefined} />
          <StatCard label="Sequência" value={s.streak} unit={s.streak === 1 ? "dia" : "dias"} icon={Flame} basis="dias seguidos treinando" />
          <StatCard label="Esta semana" value={`${s.week_days} de ${s.weekly_target}`} icon={CalendarCheck} basis={`${s.week_pct}% da meta de treinos`} />
        </KpiGrid>
        {s.today.completed ? <p className="hp-card flex items-center gap-2 p-4 text-sm"><CheckCircle2 size={18} aria-hidden className="text-success" />Você já registrou o treino de hoje. Descanse e hidrate-se!</p> : (<>
          <ul className="grid gap-2">{items.map((i) => (
            <li key={i.id} className="hp-card p-3 text-sm" data-testid="training-item">
              <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={!!done[i.id]} onChange={(e) => setDone({ ...done, [i.id]: e.target.checked })} aria-label={`Fiz: ${i.title}`} />
                <span className="flex-1"><b>{i.title}</b> {i.level && <Badge>{LEVEL[i.level] ?? i.level}</Badge>}<span className="block text-muted-foreground">{dose(i)}</span></span></label>
              {(i.instructions || i.notes || i.equipment) && <button className="mt-1 text-xs text-accent" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "Ocultar como fazer" : "Como fazer"}</button>}
              {open === i.id && <div className="mt-2 rounded bg-muted p-2 text-xs">{i.equipment && <p>Material: {i.equipment}</p>}{i.instructions && <p className="whitespace-pre-line">{i.instructions}</p>}{i.notes && <p>Observação do fisio: {i.notes}</p>}</div>}
            </li>))}</ul>
          <div className="hp-card grid gap-3 p-4 text-sm sm:grid-cols-3">
            <div><label htmlFor="tr-ef" className="mb-1 block text-xs">Esforço (0 = leve, 10 = máximo)</label><input id="tr-ef" className={inputCls} inputMode="numeric" value={effort} onChange={(e) => setEffort(e.target.value)} /></div>
            <div><label htmlFor="tr-pa" className="mb-1 block text-xs">Dor durante o treino (0 a 10)</label><input id="tr-pa" className={inputCls} inputMode="numeric" value={pain} onChange={(e) => setPain(e.target.value)} /></div>
            <div><label htmlFor="tr-no" className="mb-1 block text-xs">Como foi? (opcional)</label><input id="tr-no" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
            <div className="flex flex-wrap gap-2 sm:col-span-3"><button className={btnPrimary} onClick={() => void log(false)}>Concluir treino</button><button className={btnGhost} onClick={() => void log(true)}>Hoje não consegui treinar</button></div>
          </div></>)}
        {d.logs.length > 0 && <div><h3 className="mb-2 text-base font-semibold">Últimos treinos</h3>
          <ul className="grid gap-1 text-sm">{d.logs.slice(0, 8).map((l) => <li key={l.id} className="hp-card flex flex-wrap justify-between gap-2 px-3 py-2"><span>{fmtDate(l.done_on + "T12:00:00Z")} · treino {l.workout}{l.skipped ? " · não treinou" : ""}{l.in_name_of ? " · registrado por um responsável" : ""}</span>
            <span className="text-muted-foreground">{!l.skipped && l.effort != null ? `esforço ${l.effort}` : ""}{!l.skipped && l.pain_during != null ? ` · dor ${l.pain_during}` : ""}</span></li>)}</ul></div>}
      </div>)}
    </section>
  );
};

interface Row { workout: string; exercise_id: string; sets: string; reps: string; duration_s: string; load_text: string; rest_s: string }
const ROW0: Row = { workout: "A", exercise_id: "", sets: "3", reps: "10", duration_s: "", load_text: "", rest_s: "" };
/** Fisio: prescrições do paciente (criar, encerrar) com adesão e registros; usa a biblioteca de exercícios. */
export const PrescriptionManager = ({ person }: { person: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const t = useQuery({ queryKey: ["prof-training", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_training", { p_person: person }); if (error) throw error; return data as TData; } });
  const lib = useQuery({ queryKey: ["exercise-lib"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("exercise_list"); if (error) throw error; return (data ?? []) as Exercise[]; } });
  const [title, setTitle] = useState(""); const [weekly, setWeekly] = useState("3"); const [notes, setNotes] = useState(""); const [rows, setRows] = useState<Row[]>([{ ...ROW0 }]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["prof-training", person] });
  const upd = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async (e: FormEvent) => {
    e.preventDefault(); const items: Record<string, unknown>[] = [];
    for (const [i, r] of rows.entries()) { if (!r.exercise_id) return m.err(`Escolha o exercício da linha ${i + 1}.`);
      if (!r.reps && !r.duration_s) return m.err(`Informe repetições ou tempo na linha ${i + 1}.`);
      items.push({ workout: r.workout, exercise_id: r.exercise_id, sets: Number(r.sets), reps: r.reps ? Number(r.reps) : null, duration_s: r.duration_s ? Number(r.duration_s) : null, load_text: r.load_text || null, rest_s: r.rest_s ? Number(r.rest_s) : null }); }
    const { error } = await supabase.rpc("prescription_save", { p_person: person, p_id: null, p_title: title, p_weekly_target: Number(weekly), p_ends_on: null, p_notes: notes || null, p_items: items });
    if (error) return m.err(errText(error)); m.ok("Prescrição salva e liberada ao paciente."); setTitle(""); setNotes(""); setRows([{ ...ROW0 }]); refresh();
  };
  const end = async (id: string) => { if (!(await confirmDialog("Encerrar esta prescrição?", "O paciente deixa de vê-la e de registrar treinos nela. Os registros ficam guardados.", "Encerrar", true))) return; const { error } = await supabase.rpc("prescription_set_status", { p_id: id, p_status: "finished" }); if (error) return m.err(errText(error)); refresh(); };
  if (t.error) return null;
  const d = t.data; const s = d?.summary;
  return (
    <section className="grid gap-4" aria-label="Treinos em casa do paciente">
      <div><h3 className="text-lg">Treinos em casa</h3><p className="text-xs text-muted-foreground">Prescrição individual. O paciente vê os exercícios e registra esforço e dor; dor 7 ou mais durante o treino avisa você no seu Início.</p></div>
      <Msg m={msg} /><State loading={t.isLoading} error={undefined} />
      {s && <p className="text-sm" data-testid="adherence-line">Adesão: <b className="tabular">{s.week_days} de {s.weekly_target}</b> treinos nesta semana ({s.week_pct}%) · sequência de {s.streak} dia(s).</p>}
      {d?.prescriptions.map((p) => (
        <div key={p.id} className="hp-card p-3 text-sm" data-testid="prescription"><div className="flex flex-wrap items-center justify-between gap-2"><b>{p.title}</b><span className="flex items-center gap-2"><Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Ativa" : "Encerrada"}</Badge>{p.status === "active" && <button className={btnGhost + " hp-btn-sm"} onClick={() => void end(p.id)}>Encerrar</button>}</span></div>
          <p className="text-xs text-muted-foreground">Meta: {p.weekly_target} treinos por semana · desde {fmtDate(p.starts_on + "T12:00:00Z")}</p>
          <ul className="mt-2 grid gap-1">{p.items.map((i) => <li key={i.id}><b>{i.workout}</b> · {i.title} <span className="text-muted-foreground">— {dose(i)}</span></li>)}</ul></div>))}
      {d && d.logs.length > 0 && <div><h4 className="mb-1 text-sm font-medium">Registros do paciente</h4><ul className="grid gap-1 text-sm">{d.logs.slice(0, 10).map((l) => <li key={l.id} className={`rounded border px-3 py-1.5 ${(l.pain_during ?? 0) >= 7 ? "border-destructive" : "border-border"}`}>{fmtDate(l.done_on + "T12:00:00Z")} · treino {l.workout}{l.skipped ? " · não treinou" : ` · esforço ${l.effort ?? "—"} · dor ${l.pain_during ?? "—"}`}{l.note ? ` · “${l.note}”` : ""}</li>)}</ul></div>}
      <form onSubmit={save} className="hp-card grid gap-3 p-4 text-sm" aria-label="Nova prescrição">
        <h4 className="font-medium">Nova prescrição</h4>
        <div className="grid gap-3 sm:grid-cols-3"><div className="sm:col-span-2"><label htmlFor="pr-t" className="mb-1 block text-xs">Nome</label><input id="pr-t" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></div>
          <div><label htmlFor="pr-w" className="mb-1 block text-xs">Meta (treinos por semana)</label><input id="pr-w" className={inputCls} inputMode="numeric" value={weekly} onChange={(e) => setWeekly(e.target.value)} /></div></div>
        {rows.map((r, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[4rem_1.6fr_4rem_5rem_5rem_1fr_auto]">
            <div><label className="mb-1 block text-xs" htmlFor={`pr-wk-${i}`}>Treino</label><select id={`pr-wk-${i}`} className={inputCls} value={r.workout} onChange={(e) => upd(i, "workout", e.target.value)}>{["A", "B", "C", "D"].map((w) => <option key={w}>{w}</option>)}</select></div>
            <div><label className="mb-1 block text-xs" htmlFor={`pr-ex-${i}`}>Exercício</label><select id={`pr-ex-${i}`} className={inputCls} value={r.exercise_id} onChange={(e) => upd(i, "exercise_id", e.target.value)}><option value="">Escolha…</option>{lib.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></div>
            <div><label className="mb-1 block text-xs" htmlFor={`pr-se-${i}`}>Séries</label><input id={`pr-se-${i}`} className={inputCls} inputMode="numeric" value={r.sets} onChange={(e) => upd(i, "sets", e.target.value)} /></div>
            <div><label className="mb-1 block text-xs" htmlFor={`pr-re-${i}`}>Repetições</label><input id={`pr-re-${i}`} className={inputCls} inputMode="numeric" value={r.reps} onChange={(e) => upd(i, "reps", e.target.value)} /></div>
            <div><label className="mb-1 block text-xs" htmlFor={`pr-du-${i}`}>ou segundos</label><input id={`pr-du-${i}`} className={inputCls} inputMode="numeric" value={r.duration_s} onChange={(e) => upd(i, "duration_s", e.target.value)} /></div>
            <div><label className="mb-1 block text-xs" htmlFor={`pr-lo-${i}`}>Carga</label><input id={`pr-lo-${i}`} className={inputCls} value={r.load_text} onChange={(e) => upd(i, "load_text", e.target.value)} placeholder="peso do corpo" /></div>
            <button type="button" className="text-xs text-accent" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}>remover</button>
          </div>))}
        <div><label htmlFor="pr-n" className="mb-1 block text-xs">Orientações gerais (o paciente vê)</label><input id="pr-n" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></div>
        <div className="flex flex-wrap gap-2"><button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setRows([...rows, { ...ROW0, workout: rows[rows.length - 1]?.workout ?? "A" }])}>+ Adicionar exercício</button><button className={btnPrimary}>Salvar e liberar</button></div>
        {lib.data?.length === 0 && <p className="text-xs text-muted-foreground">A biblioteca está vazia: cadastre exercícios em Treinos (menu lateral).</p>}
      </form>
    </section>
  );
};

/** Biblioteca de exercícios da clínica (texto; foto e vídeo entram quando o Hugo gravar). */
export const ExerciseLibraryPage = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["exercise-lib"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("exercise_list"); if (error) throw error; return (data ?? []) as Exercise[]; } });
  const specs = useQuery({ queryKey: ["specialties"], staleTime: 10 * 60_000, queryFn: async () => ((await supabase.from("specialties").select("key, label").order("sort")).data ?? []) as { key: string; label: string }[] });
  const [edit, setEdit] = useState<string | null>(null); const [f, setF] = useState({ title: "", region: "", level: "", equipment: "", instructions: "", contra: "", specs: [] as string[] });
  const reset = () => { setEdit(null); setF({ title: "", region: "", level: "", equipment: "", instructions: "", contra: "", specs: [] }); };
  const save = async (e: FormEvent) => { e.preventDefault();
    const { error } = await supabase.rpc("exercise_save", { p_id: edit, p_title: f.title, p_instructions: f.instructions || null, p_region: f.region || null, p_level: f.level || null, p_equipment: f.equipment || null, p_contra: f.contra || null, p_specialties: f.specs });
    if (error) return m.err(errText(error)); m.ok(edit ? "Exercício atualizado." : "Exercício cadastrado."); reset(); void qc.invalidateQueries({ queryKey: ["exercise-lib"] }); };
  const archive = async (id: string) => { if (!(await confirmDialog("Arquivar exercício?", "Ele deixa de aparecer para novas prescrições; prescrições existentes continuam.", "Arquivar", true))) return; const { error } = await supabase.rpc("exercise_archive", { p_id: id }); if (error) return m.err(errText(error)); void qc.invalidateQueries({ queryKey: ["exercise-lib"] }); };
  return (
    <div className="grid gap-6">
      <div><h1 className="text-2xl">Biblioteca de exercícios</h1><p className="mt-1 text-[13px] text-muted-foreground">Exercícios da clínica para montar prescrições. Hoje com instruções escritas; foto e vídeo entram depois, sem refazer nada.</p></div>
      <Msg m={msg} />
      <form onSubmit={save} className="hp-card grid gap-3 p-4 text-sm sm:grid-cols-2" aria-label="Exercício">
        <h2 className="text-base font-semibold sm:col-span-2">{edit ? "Editar exercício" : "Novo exercício"}</h2>
        <div><label htmlFor="ex-t" className="mb-1 block text-xs">Nome</label><input id="ex-t" className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} /></div>
        <div><label htmlFor="ex-r" className="mb-1 block text-xs">Região do corpo</label><input id="ex-r" className={inputCls} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={60} /></div>
        <div><label htmlFor="ex-l" className="mb-1 block text-xs">Nível</label><select id="ex-l" className={inputCls} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">—</option>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="ex-e" className="mb-1 block text-xs">Material</label><input id="ex-e" className={inputCls} value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })} maxLength={120} /></div>
        <div className="sm:col-span-2"><label htmlFor="ex-i" className="mb-1 block text-xs">Como fazer (o paciente vê)</label><textarea id="ex-i" rows={3} className={inputCls} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} maxLength={3000} /></div>
        <div className="sm:col-span-2"><label htmlFor="ex-c" className="mb-1 block text-xs">Contraindicações (só o fisio vê)</label><input id="ex-c" className={inputCls} value={f.contra} onChange={(e) => setF({ ...f, contra: e.target.value })} maxLength={1000} /></div>
        <fieldset className="sm:col-span-2"><legend className="mb-1 text-xs">Especialidades</legend><div className="flex flex-wrap gap-3">{specs.data?.map((s) => <label key={s.key} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.specs.includes(s.key)} onChange={(e) => setF({ ...f, specs: e.target.checked ? [...f.specs, s.key] : f.specs.filter((x) => x !== s.key) })} />{s.label.replace("Fisioterapia ", "")}</label>)}</div></fieldset>
        <div className="flex gap-2 sm:col-span-2"><button className={btnPrimary}>{edit ? "Salvar" : "Cadastrar"}</button>{edit && <button type="button" className={btnGhost} onClick={reset}>Cancelar</button>}</div>
      </form>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="A biblioteca está vazia." />
      <ul className="grid gap-2">{q.data?.map((x) => <li key={x.id} className="hp-card flex flex-wrap items-start justify-between gap-2 p-3 text-sm" data-testid="exercise-row"><span><b>{x.title}</b> <span className="text-muted-foreground">{[x.region, x.level && LEVEL[x.level], x.equipment].filter(Boolean).join(" · ")}</span>{x.instructions && <span className="block text-muted-foreground">{x.instructions}</span>}</span>
        <span className="flex gap-2"><button className={btnGhost + " hp-btn-sm"} onClick={() => { setEdit(x.id); setF({ title: x.title, region: x.region ?? "", level: x.level ?? "", equipment: x.equipment ?? "", instructions: x.instructions ?? "", contra: x.contraindications ?? "", specs: x.specialties }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</button><button className={btnGhost + " hp-btn-sm"} onClick={() => void archive(x.id)}>Arquivar</button></span></li>)}</ul>
    </div>
  );
};
