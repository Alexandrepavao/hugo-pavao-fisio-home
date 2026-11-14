import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Presentation } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { btnGhost, btnPrimary, errText, inputCls, Msg, State, useMsg } from "@/lib/ui";
import { DEFAULT_STAGES, EDU_TOPIC_LABEL, type EduTopic } from "./model";

interface PlanData { plan: { planned_sessions: number } | null; stages: string[] | null; current: number | null; set_at: string | null; goal: { title: string } | null; history: { stage_index: number; stage_name: string; set_at: string }[] }
interface Edu { id: string; topic: EduTopic; title: string; body: string; created_at: string }

/** Fisioterapeuta: define as etapas da jornada e a etapa atual (nada avança por número de sessões), publica conteúdos educativos para o paciente e abre a demonstração. */
const PhysioJourneyEditor = ({ person, firstName }: { person: string; firstName?: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const nav = useNavigate();
  const q = useQuery({ queryKey: ["prof-journey-plan", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_journey_plan", { p_person: person }); if (error) throw error; return data as PlanData; } });
  const edu = useQuery({ queryKey: ["prof-education", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_education", { p_person: person }); if (error) throw error; return (data ?? []) as Edu[]; } });
  const [stages, setStages] = useState<string[]>(DEFAULT_STAGES); const [cur, setCur] = useState(0);
  useEffect(() => { if (q.data?.stages?.length) { setStages(q.data.stages); setCur(q.data.current ?? 0); } else { setStages(DEFAULT_STAGES); setCur(0); } }, [q.data?.stages, q.data?.current, person]);
  const [topic, setTopic] = useState<EduTopic>("rotina"); const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const saveStages = async (e: FormEvent) => {
    e.preventDefault(); const clean = stages.map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.rpc("plan_journey_set", { p_person: person, p_stages: clean, p_current: Math.min(cur, clean.length - 1) });
    if (error) return m.err(errText(error)); m.ok("Jornada salva. O paciente já vê as etapas e a etapa atual."); void qc.invalidateQueries({ queryKey: ["prof-journey-plan", person] });
  };
  const publish = async (e: FormEvent) => {
    e.preventDefault(); const { error } = await supabase.rpc("education_publish", { p_person: person, p_topic: topic, p_title: title, p_body: body });
    if (error) return m.err(errText(error)); m.ok("Conteúdo publicado para o paciente."); setTitle(""); setBody(""); void qc.invalidateQueries({ queryKey: ["prof-education", person] });
  };
  const revoke = async (id: string) => { const { error } = await supabase.rpc("education_revoke", { p_id: id }); if (error) return m.err(errText(error)); void qc.invalidateQueries({ queryKey: ["prof-education", person] }); };
  const d = q.data;
  return (
    <section className="hp-card grid gap-5 p-4" aria-label="Jornada e conteúdos do paciente" data-testid="journey-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-lg">Jornada e conteúdos do paciente</h3><p className="text-xs text-muted-foreground">O que você define aqui aparece no app do paciente. Nada avança sozinho por número de sessões.</p></div>
        <button type="button" className={btnPrimary} onClick={() => nav("/fisio/apresentar", { state: { firstName, personId: person } })} data-testid="apresentar"><Presentation size={16} aria-hidden className="mr-2 inline" />Apresentar acompanhamento</button>
      </div>
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} />
      {d && (
        <form onSubmit={saveStages} className="grid gap-3" aria-label="Etapas da jornada">
          <h4 className="text-sm font-semibold">Etapas da jornada</h4>
          {!d.plan && <p className="text-sm text-muted-foreground">Defina primeiro o plano de sessões do paciente (na Jornada do paciente, acima) para poder definir as etapas.</p>}
          <ol className="grid gap-2">{stages.map((s, i) => (
            <li key={i} className="flex items-center gap-2"><input type="radio" name="etapa-atual" checked={cur === i} onChange={() => setCur(i)} aria-label={`Etapa atual: ${s || i + 1}`} />
              <input className={inputCls} value={s} onChange={(e) => setStages((a) => a.map((x, j) => (j === i ? e.target.value : x)))} maxLength={40} aria-label={`Nome da etapa ${i + 1}`} />
              <button type="button" className={btnGhost} onClick={() => { setStages((a) => a.filter((_, j) => j !== i)); setCur((c) => Math.max(0, c >= i ? c - 1 : c)); }} disabled={stages.length <= 3} aria-label={`Remover etapa ${i + 1}`}>Remover</button></li>))}</ol>
          <div className="flex flex-wrap gap-2"><button type="button" className={btnGhost} onClick={() => setStages((a) => [...a, ""])} disabled={stages.length >= 7}>Adicionar etapa</button><button type="button" className={btnGhost} onClick={() => { setStages(DEFAULT_STAGES); setCur(0); }}>Usar etapas sugeridas</button><button className={btnPrimary} disabled={!d.plan}>Salvar jornada</button></div>
          <p className="text-xs text-muted-foreground">A bolinha marca a etapa atual. {d.set_at ? `Última mudança: ${fmtDateTime(d.set_at)}.` : "O paciente só vê a jornada depois que você salvar."}</p>
          {d.history.length > 0 && <details className="text-xs"><summary className="cursor-pointer">Histórico de etapas</summary><ul className="mt-1 grid gap-1">{d.history.map((h, i) => <li key={i}>{fmtDateTime(h.set_at)} — {h.stage_name}</li>)}</ul></details>}
        </form>)}
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold">Conteúdos educativos para o paciente</h4>
        <form onSubmit={publish} className="grid gap-2 sm:grid-cols-2" aria-label="Novo conteúdo educativo">
          <div><label htmlFor="edu-topic" className="mb-1 block text-xs">Tema</label><select id="edu-topic" className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value as EduTopic)}>{(Object.keys(EDU_TOPIC_LABEL) as EduTopic[]).map((k) => <option key={k} value={k}>{EDU_TOPIC_LABEL[k]}</option>)}</select></div>
          <div><label htmlFor="edu-title" className="mb-1 block text-xs">Título</label><input id="edu-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></div>
          <div className="sm:col-span-2"><label htmlFor="edu-body" className="mb-1 block text-xs">Texto (você escreve e aprova; o sistema não gera conteúdo nem promete prazo)</label><textarea id="edu-body" className={inputCls} rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required /></div>
          <button className={btnPrimary + " justify-self-start"}>Publicar para o paciente</button>
        </form>
        <ul className="grid gap-2">{(edu.data ?? []).map((e) => <li key={e.id} className="hp-card flex items-start justify-between gap-2 p-3 text-sm"><span><b>{e.title}</b> <span className="text-xs text-muted-foreground">· {EDU_TOPIC_LABEL[e.topic]} · {fmtDateTime(e.created_at)}</span><span className="block whitespace-pre-line text-muted-foreground">{e.body}</span></span><button className={btnGhost} onClick={() => void revoke(e.id)}>Revogar</button></li>)}
          {edu.data?.length === 0 && <li className="text-xs text-muted-foreground">Nenhum conteúdo publicado para este paciente.</li>}</ul>
      </div>
    </section>
  );
};
export default PhysioJourneyEditor;
