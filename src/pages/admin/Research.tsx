import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, toExclusive, useUnits, type RangePreset } from "@/lib/period";
import { btnDanger, btnGhost, btnPrimary, errText, inputCls, Msg, PageHead, State, StatCard, Table, Tabs, Td, useMsg } from "@/lib/ui";

type Kind = "single_choice" | "multi_choice" | "text";
interface Survey { id: string; title: string; description: string | null; status: string; audience: string[]; is_anonymous: boolean; unit_id: string | null; published_at: string | null; closed_at: string | null }
interface Question { id: string; prompt: string; kind: Kind; options: string[] | null; required: boolean; position: number }
const AUDIENCE_LABEL: Record<string, string> = { patient: "Pacientes", partner: "Parceiros", student: "Alunos" };
const KIND_LABEL: Record<Kind, string> = { single_choice: "Escolha única", multi_choice: "Múltipla escolha", text: "Texto livre" };
const STATUS_LABEL: Record<string, string> = { draft: "Rascunho", published: "Publicada", closed: "Encerrada" };

/** Pesquisas: criar/editar/publicar/encerrar, perguntas com opções, público-alvo, identificada ou anônima,
 * dashboard com participação e resultados (k-anonimato: quebra por pergunta só com 5+ respostas no recorte). */
const Research = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<string[]>(["patient"]); const [anonymous, setAnonymous] = useState(false); const [unit, setUnit] = useState("");
  const units = useUnits();
  const surveys = useQuery({ queryKey: ["research-surveys"], queryFn: async () => (await supabase.from("research_surveys").select("id, title, description, status, audience, is_anonymous, unit_id, published_at, closed_at").order("created_at", { ascending: false })).data as Survey[] });

  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!title.trim()) return m.err("Informe o título."); if (audience.length === 0) return m.err("Selecione ao menos um público-alvo.");
    const { error } = await supabase.rpc("research_survey_create", { p_title: title.trim(), p_description: description || null, p_audience: audience, p_is_anonymous: anonymous, p_unit: unit || null });
    if (error) return m.err(errText(error));
    m.ok("Pesquisa criada como rascunho."); setTitle(""); setDescription(""); setAudience(["patient"]); setAnonymous(false); setUnit("");
    void qc.invalidateQueries({ queryKey: ["research-surveys"] });
  };
  const toggleAudience = (k: string) => setAudience((a) => a.includes(k) ? a.filter((x) => x !== k) : [...a, k]);

  const survey = surveys.data?.find((s) => s.id === sel);
  return (<div>
    <PageHead eyebrow="Pesquisas" title="Pesquisas" hint="Perguntas próprias, público-alvo (pacientes/parceiros/alunos), identificada ou anônima. Editar uma pergunta depois de publicada nunca muda o significado das respostas já registradas — uma nova versão é congelada automaticamente." />
    <Msg m={msg} />
    <form onSubmit={create} className="hp-card p-5 mb-6 grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="rs-title" className="block text-xs mb-1">Título</label><input id="rs-title"   value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label htmlFor="rs-desc" className="block text-xs mb-1">Descrição (opcional)</label><input id="rs-desc"   value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset><legend className="block text-xs mb-1">Público-alvo</legend>
          <div className="flex gap-3">{Object.entries(AUDIENCE_LABEL).map(([k, l]) => <label key={k} className="flex items-center gap-1.5 text-sm !font-normal"><input type="checkbox" checked={audience.includes(k)} onChange={() => toggleAudience(k)} />{l}</label>)}</div>
        </fieldset>
        <div><label htmlFor="rs-unit" className="block text-xs mb-1">Unidade (opcional — vazio = toda a organização)</label><select id="rs-unit"   value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Todas as unidades</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <label className="flex items-center gap-1.5 text-sm !font-normal pb-1.5"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />Anônima (nunca grava quem respondeu)</label>
      </div>
      <button className={btnPrimary + " w-fit"}>Criar pesquisa</button>
    </form>
    <State loading={surveys.isLoading} error={surveys.error} empty={surveys.data?.length === 0} emptyText="Nenhuma pesquisa criada." />
    {surveys.data && surveys.data.length > 0 && <Table head={["Título", "Público-alvo", "Tipo", "Estado", ""]}>
      {surveys.data.map((s) => <tr key={s.id}><Td>{s.title}</Td><Td>{s.audience.map((a) => AUDIENCE_LABEL[a]).join(", ")}</Td><Td>{s.is_anonymous ? "Anônima" : "Identificada"}</Td><Td>{STATUS_LABEL[s.status]}</Td>
        <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(s.id === sel ? null : s.id)}>{s.id === sel ? "Fechar" : "Gerenciar"}</button></Td></tr>)}
    </Table>}
    {survey && <SurveyManager survey={survey} onChanged={() => qc.invalidateQueries({ queryKey: ["research-surveys"] })} />}
  </div>);
};

const SurveyManager = ({ survey, onChanged }: { survey: Survey; onChanged: () => void }) => {
  const [tab, setTab] = useState("perguntas"); const [msg, m] = useMsg();
  const publish = async () => { const { error } = await supabase.rpc("research_survey_publish", { p_survey: survey.id }); if (error) m.err(errText(error)); else { m.ok("Pesquisa publicada."); onChanged(); } };
  const close = async () => { const { error } = await supabase.rpc("research_survey_close", { p_survey: survey.id }); if (error) m.err(errText(error)); else { m.ok("Pesquisa encerrada."); onChanged(); } };
  return (<section className="mt-8 border-t border-border pt-6">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-1"><h2 className="text-2xl">{survey.title}</h2>
      <div className="flex gap-2">
        {survey.status === "draft" && <button className={btnPrimary} onClick={publish}>Publicar</button>}
        {survey.status === "published" && <button className={btnDanger} onClick={close}>Encerrar pesquisa</button>}
      </div>
    </div>
    {survey.description && <p className="text-sm text-muted-foreground mb-3">{survey.description}</p>}
    <Msg m={msg} />
    <Tabs tabs={[["perguntas", "Perguntas"], ["dashboard", "Dashboard"], ...(survey.is_anonymous ? [] : [["respostas", "Respostas individuais"] as [string, string]])]} value={tab} onChange={setTab} />
    {tab === "perguntas" && <Questions survey={survey} />}
    {tab === "dashboard" && <Dashboard survey={survey} />}
    {tab === "respostas" && !survey.is_anonymous && <ResponsesList survey={survey} />}
  </section>);
};

const Questions = ({ survey }: { survey: Survey }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [prompt, setPrompt] = useState(""); const [kind, setKind] = useState<Kind>("single_choice"); const [options, setOptions] = useState(""); const [required, setRequired] = useState(true);
  const questions = useQuery({ queryKey: ["research-questions", survey.id], queryFn: async () => (await supabase.from("research_questions").select("id, prompt, kind, options, required, position").eq("survey_id", survey.id).is("archived_at", null).order("position")).data as Question[] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!prompt.trim()) return m.err("Informe a pergunta.");
    const opts = kind === "text" ? null : options.split("\n").map((o) => o.trim()).filter(Boolean);
    if (kind !== "text" && (!opts || opts.length < 2)) return m.err("Informe ao menos 2 opções (uma por linha).");
    const { error } = await supabase.rpc("research_question_upsert", { p_survey: survey.id, p_id: null, p_prompt: prompt.trim(), p_kind: kind, p_options: opts, p_required: required, p_position: (questions.data?.length ?? 0) + 1 });
    if (error) return m.err(errText(error));
    m.ok(survey.status === "published" ? "Pergunta adicionada. Uma nova versão foi criada — respostas já registradas continuam com o texto anterior." : "Pergunta adicionada.");
    setPrompt(""); setOptions(""); void qc.invalidateQueries({ queryKey: ["research-questions", survey.id] });
  };
  const archive = async (id: string) => {
    const { error } = await supabase.rpc("research_question_archive", { p_id: id });
    if (error) m.err(errText(error)); else { m.ok("Pergunta removida."); void qc.invalidateQueries({ queryKey: ["research-questions", survey.id] }); }
  };
  return (<><Msg m={msg} />
    {survey.status === "closed" ? <p className="text-sm text-muted-foreground mb-3">Pesquisa encerrada — perguntas não podem mais ser editadas.</p> : (
      <form onSubmit={add} className="hp-card p-4 mb-4 grid gap-3" noValidate>
        <div><label htmlFor="rq-prompt" className="block text-xs mb-1">Pergunta</label><input id="rq-prompt"   value={prompt} onChange={(e) => setPrompt(e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-3 items-end">
          <div><label htmlFor="rq-kind" className="block text-xs mb-1">Tipo</label><select id="rq-kind"   value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <label className="flex items-center gap-1.5 text-sm !font-normal pb-1.5"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />Obrigatória</label>
        </div>
        {kind !== "text" && <div><label htmlFor="rq-opts" className="block text-xs mb-1">Opções (uma por linha, mínimo 2)</label><textarea id="rq-opts" rows={3}   value={options} onChange={(e) => setOptions(e.target.value)} /></div>}
        <button className={btnGhost + " w-fit"}>Adicionar pergunta</button>
      </form>
    )}
    <State loading={questions.isLoading} error={questions.error} empty={questions.data?.length === 0} emptyText="Nenhuma pergunta ainda." />
    {questions.data && questions.data.length > 0 && <ul className="grid gap-2">
      {questions.data.map((q) => <li key={q.id} className="hp-card p-3 flex items-start justify-between gap-3">
        <div><p className="font-medium">{q.prompt} {!q.required && <span className="text-xs text-muted-foreground">(opcional)</span>}</p>
          <p className="text-xs text-muted-foreground">{KIND_LABEL[q.kind]}{q.options && ` — ${q.options.join(", ")}`}</p></div>
        {survey.status !== "closed" && <button className="text-destructive text-sm shrink-0" onClick={() => archive(q.id)}>Remover</button>}
      </li>)}
    </ul>}
  </>);
};

interface Breakdown { question_id: string; prompt: string; kind: Kind; options: string[] | null; counts: Record<string, number>; text_count: number }
interface DashboardData { total: number; breakdown_available: boolean; breakdown: Breakdown[] }

const Dashboard = ({ survey }: { survey: Survey }) => {
  const [preset, setPreset] = useState<RangePreset>("ano"); const [custom, setCustom] = useState(presetRange("ano")); const [unit, setUnit] = useState(""); const [compare, setCompare] = useState(false);
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const units = useUnits();
  const dash = useQuery({ queryKey: ["research-dash", survey.id, from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("research_dashboard", { p_survey: survey.id, p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to), p_unit: unit || null }); if (error) throw error; return data as DashboardData;
  } });
  return (<>
    <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} compare={compare}
      onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
      onUnit={setUnit} onCompare={setCompare} onClear={() => { setPreset("ano"); setCustom(presetRange("ano")); setUnit(""); setCompare(false); }} />
    <State loading={dash.isLoading} error={dash.error} />
    {dash.data && (<>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard label="Participação no período" value={dash.data.total.toLocaleString("pt-BR")} basis="respostas registradas no recorte de período/unidade aplicado" />
      </ul>
      {!dash.data.breakdown_available ? (
        <p className="hp-card p-4 text-sm text-muted-foreground">Quebra por pergunta indisponível: menos de 5 respostas neste recorte. Isso evita expor uma resposta individual (inclusive de saúde) que poderia reidentificar alguém num grupo pequeno — amplie o período ou a unidade para liberar.</p>
      ) : (
        <div className="grid gap-6">
          {dash.data.breakdown.map((b) => (
            <section key={b.question_id} className="hp-card p-4">
              <h3 className="font-medium mb-3">{b.prompt}</h3>
              {b.kind === "text" ? <p className="text-sm text-muted-foreground">{b.text_count} resposta(s) de texto livre — ver em "Respostas individuais" quando a pesquisa é identificada.</p> : (
                <div style={{ height: Math.max(120, (b.options?.length ?? 1) * 44) }}><ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(b.options ?? []).map((o) => ({ opcao: o, Respostas: b.counts[o] ?? 0 }))} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis type="number" fontSize={12} allowDecimals={false} /><YAxis type="category" dataKey="opcao" fontSize={12} width={110} />
                    <Tooltip /><Bar dataKey="Respostas" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
              )}
            </section>
          ))}
        </div>
      )}
    </>)}
  </>);
};

const ResponsesList = ({ survey }: { survey: Survey }) => {
  const list = useQuery({ queryKey: ["research-responses-list", survey.id], queryFn: async () => { const { data, error } = await supabase.rpc("research_responses_list", { p_survey: survey.id }); if (error) throw error; return data as { response_id: string; person_name: string; submitted_at: string; answers: { question_id: string; answer_options: string[] | null; answer_text: string | null }[] }[]; } });
  const questions = useQuery({ queryKey: ["research-questions", survey.id], queryFn: async () => (await supabase.from("research_questions").select("id, prompt").eq("survey_id", survey.id)).data as { id: string; prompt: string }[] });
  const promptOf = (id: string) => questions.data?.find((q) => q.id === id)?.prompt ?? "—";
  return (<>
    <p className="text-xs text-muted-foreground mb-3">Lista individual — separada dos indicadores agregados do Dashboard, só existe porque esta pesquisa é identificada.</p>
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma resposta ainda." />
    {list.data && list.data.length > 0 && <ul className="grid gap-2">
      {list.data.map((r) => <li key={r.response_id} className="hp-card p-3">
        <p className="font-medium text-sm">{r.person_name} <span className="text-xs text-muted-foreground font-normal">· {fmtDateTime(r.submitted_at)}</span></p>
        <ul className="mt-1 text-sm">{r.answers.map((a, i) => <li key={i}><span className="text-muted-foreground">{promptOf(a.question_id)}:</span> {a.answer_options?.join(", ") ?? a.answer_text}</li>)}</ul>
      </li>)}
    </ul>}
  </>);
};

export default Research;
