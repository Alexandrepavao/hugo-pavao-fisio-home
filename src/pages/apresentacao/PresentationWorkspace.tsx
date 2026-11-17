import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CloudOff, Loader2, Plus, RefreshCw, Send, Smartphone, Trash2 } from "lucide-react";
import logo from "@/assets/hp-logo.png";
import { supabase } from "@/lib/supabase";
import { btnGhost, btnPrimary, confirmDialog, inputCls, Msg, State, useMsg } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { JourneyProvider, PatientDashboard } from "@/portal/journey/ui";
import { usePreviewJourney } from "@/portal/journey/live";
import type { EvolutionData } from "@/portal/Evolution";
import PresentationSteps from "./PresentationSteps";
import { AREAS, apiText, evidencePick, evidenceSave, evidenceSuggest, evidenceUnpick, isConflict, presentationOpen, presentationPublish, presentationSave, type LibraryItem, type PresentationDraft } from "./api";
import "./presentation.css";

type Tab = "dados" | "avaliacao" | "evidencias" | "apresentar" | "publicar";
const TABS: [Tab, string][] = [["dados", "1. Dados"], ["avaliacao", "2. Avaliação"], ["evidencias", "3. Evidências"], ["apresentar", "4. Apresentação"], ["publicar", "5. Publicar"]];
type Form = Pick<PresentationDraft, "area_keys" | "complaint" | "symptom_duration" | "limitations" | "activities" | "condition_kind" | "condition_text" | "goal_title" | "goal_target_date" | "freq_per_week" | "duration_weeks" | "routine_text" | "reassessment_on" | "reassessment_criteria" | "internal_notes">;
const FIELDS: (keyof Form)[] = ["area_keys", "complaint", "symptom_duration", "limitations", "activities", "condition_kind", "condition_text", "goal_title", "goal_target_date", "freq_per_week", "duration_weeks", "routine_text", "reassessment_on", "reassessment_criteria", "internal_notes"];
const pick = (d: PresentationDraft): Form => Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? (k === "area_keys" ? [] : null)])) as unknown as Form;

/** Quem escreveu cada informação: o texto da tela diz, e o paciente vê a mesma separação. */
const Tag = ({ k }: { k: "pac" | "prof" | "int" }) => <span className={`pw-tag is-${k}`}>{k === "pac" ? "Relatado pelo paciente" : k === "prof" ? "Avaliado/validado pelo profissional" : "Interno — nunca publicado"}</span>;

const MeasuresPanel = ({ person, onChanged }: { person: string; onChanged: () => void }) => {
  const [msg, m] = useMsg(); const [inst, setInst] = useState("nprs"); const [label, setLabel] = useState(""); const [value, setValue] = useState("");
  const q = useQuery({ queryKey: ["pw-measures", person], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_patient_evolution", { p_person: person }); if (error) throw error; return data as EvolutionData; } });
  const series = (q.data?.series ?? []).filter((s) => s.points.length > 0);
  const add = async () => {
    const v = Number(value.replace(",", ".")); if (!Number.isFinite(v) || v < 0 || v > 10) return m.err("Informe um valor de 0 a 10.");
    if (inst === "psfs" && label.trim().length < 2) return m.err("Diga qual atividade o paciente quer retomar.");
    const { error } = await supabase.rpc("prof_measurement_add", { p_person: person, p_instrument: inst, p_label: inst === "psfs" ? label.trim() : null, p_side: null, p_value: v });
    if (error) return m.err(apiText(error)); m.ok("Medida registrada."); setValue(""); setLabel(""); void q.refetch(); onChanged();
  };
  return (
    <div className="pw-card" data-testid="pw-measures">
      <h3 className="font-semibold">Medidas iniciais <Tag k="prof" /></h3>
      <p className="pw-help">Só entram aqui as medidas que você realmente coletou. Sem medida não há “zero”: a apresentação diz que ainda não há registro.</p>
      <State loading={q.isLoading} />
      {series.length === 0 && !q.isLoading ? <p className="pw-help" data-testid="pw-measures-empty">Nenhuma medida registrada ainda.</p> : <ul className="grid gap-1 text-sm">{series.map((s) => <li key={`${s.instrument}-${s.label ?? s.name}`}>{s.label ?? s.name}: primeiro registro <b>{s.first}</b>{s.count > 1 ? <> · mais recente <b>{s.last}</b> ({s.count} registros)</> : " (ponto de partida)"}</li>)}</ul>}
      <Msg m={msg} />
      <div className="pw-grid">
        <div className="pw-field"><label htmlFor="ms-inst">Escala</label><select id="ms-inst" className={inputCls} value={inst} onChange={(e) => setInst(e.target.value)}><option value="nprs">Dor (0 a 10)</option><option value="psfs">Atividade que quer retomar (0 a 10)</option></select></div>
        {inst === "psfs" && <div className="pw-field"><label htmlFor="ms-lbl">Atividade</label><input id="ms-lbl" className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></div>}
        <div className="pw-field"><label htmlFor="ms-val">Valor (0 a 10)</label><input id="ms-val" className={inputCls} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      </div>
      <div><button type="button" className={btnGhost} onClick={() => void add()} data-testid="pw-measure-add"><Plus size={14} className="mr-1 inline" aria-hidden />Registrar medida</button></div>
    </div>
  );
};

const EvidencePanel = ({ d, onDraft }: { d: PresentationDraft; onDraft: (x: PresentationDraft) => void }) => {
  const [msg, m] = useMsg(); const [sug, setSug] = useState<LibraryItem[] | null>(null); const [busy, setBusy] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const [rat, setRat] = useState(""); const [diff, setDiff] = useState(""); const [form, setForm] = useState(false);
  const load = useCallback(async () => { try { setSug(await evidenceSuggest(d.id)); } catch (e) { m.err(apiText(e)); } }, [d.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, d.rev]);
  const picked = new Set(d.evidence_picked.map((p) => p.evidence.id));
  const pickIt = async (id: string) => { setBusy(true); try { onDraft(await evidencePick(d.id, id, rat, diff || null)); m.ok("Estudo incluído na apresentação."); setOpenId(null); setRat(""); setDiff(""); } catch (e) { m.err(apiText(e)); } finally { setBusy(false); } };
  const unpick = async (id: string) => { try { onDraft(await evidenceUnpick(d.id, id)); m.ok("Estudo removido."); } catch (e) { m.err(apiText(e)); } };
  return (
    <div className="grid gap-3" data-testid="pw-evidence-panel">
      <div className="pw-card">
        <h3 className="font-semibold">Estudos desta apresentação ({d.evidence_picked.length} de no máximo 3)</h3>
        <p className="pw-help">Só fichas <b>aprovadas pela revisão clínica</b> podem ser usadas com o paciente. Você confirma a pertinência de cada uma ao caso — nada é escolhido automaticamente nem gerado por IA.</p>
        <Msg m={msg} />
        {d.evidence_picked.length === 0 ? <p className="pw-help" data-testid="pw-evidence-none">Nenhum estudo escolhido. A etapa 6 da apresentação dirá que ainda não há estudo aprovado selecionado.</p> : d.evidence_picked.map((p) => (
          <div key={p.evidence.id} className="pw-ev is-picked" data-testid="pw-evidence-picked">
            <b>{p.evidence.title}</b><span className="pw-help">{[p.evidence.authors, p.evidence.journal, p.evidence.year].filter(Boolean).join(" · ")}</span>
            <p className="text-sm"><b>Relação com o caso (o paciente lê):</b> {p.rationale}</p>
            <div><button type="button" className={btnGhost} onClick={() => void unpick(p.evidence.id)}><Trash2 size={14} className="mr-1 inline" aria-hidden />Remover</button></div>
          </div>))}
      </div>
      <div className="pw-card">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Sugestões para este caso</h3><button type="button" className={btnGhost} onClick={() => void load()}><RefreshCw size={14} className="mr-1 inline" aria-hidden />Atualizar</button></div>
        <p className="pw-help">A busca usa a <b>biblioteca aprovada da própria clínica</b> e compara área e condição citadas. Nenhum dado do paciente é enviado a serviços externos.</p>
        {sug === null ? <State loading /> : sug.length === 0 ? <p className="pw-help" data-testid="pw-evidence-nolib">Não há ficha aprovada compatível. A biblioteca começa vazia: proponha uma referência verificável abaixo (fonte original obrigatória) — ela segue para a revisão clínica e <b>não</b> é publicada ao paciente antes disso.</p> : sug.map((s) => (
          <div key={s.id} className={`pw-ev${picked.has(s.id) ? " is-picked" : ""}`} data-testid="pw-evidence-suggestion">
            <b>{s.title}</b><span className="pw-help">{[s.authors, s.journal, s.year, s.design].filter(Boolean).join(" · ")}</span>
            <div className="pw-why">{(s.why ?? []).map((w) => <span key={w}>{w}</span>)}</div>
            {s.population && <p className="text-sm"><b>População:</b> {s.population}</p>}{s.benefits && <p className="text-sm"><b>Benefícios:</b> {s.benefits}</p>}{s.limitations && <p className="text-sm"><b>Limitações:</b> {s.limitations}</p>}
            <a className="text-sm underline" href={s.url ?? `https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer">Fonte original</a>
            {!picked.has(s.id) && openId !== s.id && <div><button type="button" className={btnPrimary} onClick={() => { setOpenId(s.id); setRat(""); setDiff(""); }} data-testid="pw-evidence-use">Usar neste caso</button></div>}
            {openId === s.id && (
              <div className="grid gap-2">
                <div className="pw-field"><label htmlFor="ev-rat">Por que serve a ESTE paciente (em linguagem simples — ele lê)</label><textarea id="ev-rat" className={inputCls} rows={3} value={rat} onChange={(e) => setRat(e.target.value)} maxLength={800} /></div>
                <div className="pw-field"><label htmlFor="ev-diff">Diferenças relevantes entre o estudo e o caso (opcional)</label><textarea id="ev-diff" className={inputCls} rows={2} value={diff} onChange={(e) => setDiff(e.target.value)} maxLength={800} /></div>
                <div className="flex gap-2"><button type="button" className={btnPrimary} disabled={busy || rat.trim().length < 5} onClick={() => void pickIt(s.id)} data-testid="pw-evidence-confirm">Confirmar pertinência</button><button type="button" className={btnGhost} onClick={() => setOpenId(null)}>Cancelar</button></div>
              </div>)}
          </div>))}
      </div>
      <div className="pw-card">
        <button type="button" className={btnGhost} onClick={() => setForm((v) => !v)} aria-expanded={form} data-testid="pw-evidence-propose-toggle"><Plus size={14} className="mr-1 inline" aria-hidden />Propor nova referência para revisão clínica</button>
        {form && <ProposeForm onDone={() => { setForm(false); m.ok("Referência enviada para revisão clínica. Ela só pode ser usada com pacientes depois de aprovada."); }} />}
      </div>
    </div>
  );
};

const ProposeForm = ({ onDone }: { onDone: () => void }) => {
  const [msg, m] = useMsg(); const [v, setV] = useState<Record<string, string>>({}); const [areas, setAreas] = useState<string[]>([]);
  const set = (k: string) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    try { await evidenceSave(null, { ...v, year: v.year ? Number(v.year) : null, area_keys: areas, conditions: (v.conditions ?? "").split(",").map((s) => s.trim()).filter(Boolean) }); onDone(); } catch (e) { m.err(apiText(e)); }
  };
  const F = ({ k, label, area }: { k: string; label: string; area?: boolean }) => <div className="pw-field"><label htmlFor={`pr-${k}`}>{label}</label>{area ? <textarea id={`pr-${k}`} className={inputCls} rows={2} value={v[k] ?? ""} onChange={set(k)} /> : <input id={`pr-${k}`} className={inputCls} value={v[k] ?? ""} onChange={set(k)} />}</div>;
  return (
    <div className="grid gap-3 mt-3" data-testid="pw-propose-form">
      <p className="pw-help">Preencha só com o que consta na fonte original. Não copie PDFs nem figuras (licença). Informe o DOI <b>ou</b> o link da fonte.</p><Msg m={msg} />
      <div className="pw-grid"><F k="title" label="Título do estudo" /><F k="authors" label="Autores" /><F k="journal" label="Revista" /><F k="year" label="Ano" /><F k="doi" label="DOI (ex.: 10.xxxx/yyyy)" /><F k="url" label="Link da fonte original" /><F k="study_design" label="Tipo de estudo" /></div>
      <div className="pw-grid"><F k="population" label="Quem participou" area /><F k="comparison" label="O que foi comparado" area /><F k="benefits" label="Benefícios encontrados" area /><F k="duration" label="Duração do tratamento" /><F k="follow_up" label="Período de seguimento" /><F k="limitations" label="Limitações" area /><F k="conditions" label="Condições (separe por vírgula)" /></div>
      <div className="pw-areas" role="group" aria-label="Áreas">{AREAS.map((a) => <button key={a.key} type="button" className="pw-area" data-on={areas.includes(a.key)} aria-pressed={areas.includes(a.key)} onClick={() => setAreas((x) => (x.includes(a.key) ? x.filter((y) => y !== a.key) : [...x, a.key]))}>{a.label}</button>)}</div>
      <div><button type="button" className={btnPrimary} onClick={() => void save()} data-testid="pw-propose-send">Enviar para revisão clínica</button></div>
    </div>
  );
};

type PreviewState = ReturnType<typeof usePreviewJourney>;
const PortalPreview = ({ d, pv, onRefresh }: { d: PresentationDraft; pv: PreviewState; onRefresh: () => void }) => {
  const { model, loading, error } = pv;
  return (
    <div data-testid="portal-preview">
      <div className="pv-banner" data-testid="pv-banner"><Smartphone size={18} aria-hidden />Prévia da área do paciente — {d.published_version > 0 && !d.unpublished_changes ? `versão ${d.published_version} publicada` : d.published_version > 0 ? `há alterações ainda não publicadas (versão publicada: ${d.published_version})` : "ainda não publicada"}. É a mesma tela do portal /paciente; ações exclusivas do paciente ficam desativadas.
        <button type="button" className="jr-btn is-soft" style={{ marginLeft: "auto" }} onClick={onRefresh}><RefreshCw size={14} aria-hidden />Atualizar prévia</button></div>
      <State loading={loading && !model} error={error} />
      {model && <div className="pv-frame"><JourneyProvider value={{ go: () => undefined }}><PatientDashboard m={model} /></JourneyProvider></div>}
    </div>
  );
};

const PresentationWorkspace = () => {
  const { enrollmentId = "" } = useParams(); const qc = useQueryClient(); const [msg, m] = useMsg();
  const [tab, setTab] = useState<Tab>("avaliacao"); const [form, setForm] = useState<Form | null>(null); const [draft, setDraft] = useState<PresentationDraft | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle"); const [savedAt, setSavedAt] = useState<string | null>(null); const [saveErr, setSaveErr] = useState<string | null>(null);
  const rev = useRef(0); const pending = useRef<Record<string, unknown>>({}); const timer = useRef<number | undefined>(undefined); const [publishing, setPublishing] = useState(false);

  const q = useQuery({ queryKey: ["presentation", enrollmentId], retry: false, refetchOnWindowFocus: false, queryFn: () => presentationOpen(enrollmentId) });
  useEffect(() => { if (q.data) { setDraft(q.data); rev.current = q.data.rev; setForm((f) => f ?? pick(q.data)); } }, [q.data]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current); const patch = pending.current; if (!draft || Object.keys(patch).length === 0) return; pending.current = {}; setSave("saving");
    try { const r = await presentationSave(draft.id, rev.current, patch); rev.current = r.rev; setSavedAt(r.saved_at); setSave("saved"); setSaveErr(null); }
    catch (e) { pending.current = { ...patch, ...pending.current }; setSave(isConflict(e) ? "conflict" : "error"); setSaveErr(apiText(e)); }
  }, [draft]);
  const change = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => (f ? { ...f, [k]: v } : f)); pending.current[k] = v === "" ? null : v; setSave("idle"); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void flush(), 800); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const reload = async () => { pending.current = {}; setForm(null); setSave("idle"); await qc.invalidateQueries({ queryKey: ["presentation", enrollmentId] }); };
  const refreshMeta = useCallback(async () => { await flush(); const r = await q.refetch(); if (r.data) { setDraft(r.data); rev.current = r.data.rev; } }, [flush, q]);
  const goTab = async (t: Tab) => { await flush(); if (t !== tab && (t === "apresentar" || t === "publicar" || t === "evidencias")) { const r = await q.refetch(); if (r.data) { setDraft(r.data); rev.current = r.data.rev; } } setTab(t); };

  const publish = async () => {
    if (!draft) return; await flush();
    if (!(await confirmDialog("Publicar para o paciente?", "O paciente verá a apresentação (sem as suas anotações internas) na área dele. Você pode publicar uma nova versão depois; o histórico fica guardado.", "Publicar"))) return;
    setPublishing(true);
    try { const r = await presentationPublish(draft.id); m.ok(r.created ? `Versão ${r.version} publicada.${r.goal_created ? " O objetivo virou a meta ativa do paciente." : ""}` : `Nada mudou desde a versão ${r.version}: nenhuma nova versão foi criada.`); const x = await q.refetch(); if (x.data) { setDraft(x.data); rev.current = x.data.rev; } }
    catch (e) { m.err(apiText(e)); } finally { setPublishing(false); }
  };

  const [pvVer, setPvVer] = useState(0);
  const pv = usePreviewJourney(tab === "apresentar" ? draft?.person_id : undefined, { evidence: draft?.patient_payload.evidence ?? [], preview: { kind: draft && draft.published_version > 0 && !draft.unpublished_changes ? "published" : "draft", version: draft?.published_version || null, unpublished: !!draft?.unpublished_changes } }, pvVer);
  const firstName = (draft?.person_name ?? "").split(" ")[0];
  const stepsContent = useMemo(() => draft?.patient_payload, [draft]);

  return (
    <div className="pw" data-testid="presentation-workspace">
      <header className="pw-head">
        <div className="flex items-center gap-3"><img src={logo} alt="HP Fisioterapia" /><div><p className="text-xs text-muted-foreground">Avaliação e apresentação personalizada</p><h1 className="text-lg font-semibold">{draft?.person_name ?? "…"}</h1></div></div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="pw-save" role="status" aria-live="polite" data-testid="pw-save-state" data-state={save}>{save === "saving" ? <><Loader2 size={12} className="inline animate-spin" aria-hidden /> Salvando…</> : save === "saved" && savedAt ? <><CheckCircle2 size={12} className="inline" aria-hidden /> Salvo às {fmtDateTime(savedAt).split(" ").pop()}</> : save === "error" ? <><CloudOff size={12} className="inline" aria-hidden /> Não salvo</> : save === "conflict" ? "Conflito de edição" : "Salvamento automático"}</span>
          <Link to="/fisio/pacientes" className={btnGhost}><ArrowLeft size={14} className="mr-1 inline" aria-hidden />Voltar</Link>
        </div>
      </header>
      <State loading={q.isLoading} error={q.error ? new Error(apiText(q.error)) : undefined} />
      {draft && form && (<>
        {save === "conflict" && <div className="pw-conflict" role="alert" data-testid="pw-conflict"><span>{saveErr}</span><button type="button" className={btnPrimary} onClick={() => void reload()}>Recarregar a versão mais recente</button></div>}
        {save === "error" && <div className="pw-warn" role="alert">Não foi possível salvar agora: {saveErr} Suas alterações continuam na tela; tente de novo em instantes.</div>}
        <div className="pw-tabs" role="tablist" aria-label="Etapas">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className="pw-tab" onClick={() => void goTab(k)} data-testid={`pw-tab-${k}`}>{l}</button>)}</div>
        <Msg m={msg} />

        {tab === "dados" && (
          <div className="pw-card" data-testid="pw-dados">
            <h2 className="font-semibold">Dados do paciente</h2>
            <p className="pw-help">Vêm do cadastro central (uma única pessoa). Nada é copiado para outra tabela.</p>
            <dl className="grid gap-1 text-sm"><div><dt className="inline font-semibold">Nome: </dt><dd className="inline">{draft.person_name}</dd></div><div><dt className="inline font-semibold">Profissional responsável: </dt><dd className="inline">{draft.professional ?? "—"}</dd></div>
              <div><dt className="inline font-semibold">Avaliação: </dt><dd className="inline">{draft.evaluation_at ? fmtDateTime(draft.evaluation_at) : "—"}</dd></div>
              <div><dt className="inline font-semibold">Estado: </dt><dd className="inline" data-testid="pw-enrollment-status">{draft.enrollment_status === "pending" ? "Paciente pendente (antes do pagamento confirmado)" : "Paciente ativo"}</dd></div></dl>
            <div><button type="button" className={btnPrimary} onClick={() => void goTab("avaliacao")}>Continuar para a avaliação</button></div>
          </div>)}

        {tab === "avaliacao" && (
          <div className="grid gap-3" data-testid="pw-avaliacao">
            <div className="pw-card">
              <h2 className="font-semibold">Áreas da fisioterapia</h2>
              <p className="pw-help">Categorias de organização. Uma área <b>não é um diagnóstico</b> e não define tratamento nem quantidade de sessões.</p>
              <div className="pw-areas" role="group" aria-label="Áreas da fisioterapia">{AREAS.map((a) => { const on = form.area_keys.includes(a.key); return <button key={a.key} type="button" className="pw-area" data-on={on} aria-pressed={on} onClick={() => change("area_keys", on ? form.area_keys.filter((x) => x !== a.key) : [...form.area_keys, a.key])}>{a.label}</button>; })}</div>
            </div>
            <div className="pw-card">
              <h2 className="font-semibold">Relato do paciente <Tag k="pac" /></h2>
              <div className="pw-field"><label htmlFor="f-complaint">Queixa principal</label><textarea id="f-complaint" className={inputCls} rows={3} maxLength={2000} value={form.complaint ?? ""} onChange={(e) => change("complaint", e.target.value)} /></div>
              <div className="pw-grid">
                <div className="pw-field"><label htmlFor="f-dur">Há quanto tempo</label><input id="f-dur" className={inputCls} maxLength={200} value={form.symptom_duration ?? ""} onChange={(e) => change("symptom_duration", e.target.value)} /></div>
                <div className="pw-field"><label htmlFor="f-act">Atividades que quer retomar</label><input id="f-act" className={inputCls} maxLength={1000} value={form.activities ?? ""} onChange={(e) => change("activities", e.target.value)} /></div>
              </div>
              <div className="pw-field"><label htmlFor="f-lim">Limitações funcionais</label><textarea id="f-lim" className={inputCls} rows={2} maxLength={2000} value={form.limitations ?? ""} onChange={(e) => change("limitations", e.target.value)} /></div>
            </div>
            <div className="pw-card">
              <h2 className="font-semibold">Avaliação do profissional <Tag k="prof" /></h2>
              <div className="pw-grid">
                <div className="pw-field"><label htmlFor="f-ck">A condição é…</label><select id="f-ck" className={inputCls} value={form.condition_kind ?? ""} onChange={(e) => change("condition_kind", (e.target.value || null) as Form["condition_kind"])}><option value="">—</option><option value="assessed">Condição avaliada</option><option value="hypothesis">Hipótese (ainda a confirmar)</option></select></div>
                <div className="pw-field"><label htmlFor="f-ct">Descrição</label><input id="f-ct" className={inputCls} maxLength={500} value={form.condition_text ?? ""} onChange={(e) => change("condition_text", e.target.value)} /></div>
              </div>
              <p className="pw-help">Condição avaliada e hipótese são coisas diferentes: o paciente vê qual é qual. O paciente não aprova diagnóstico, prescrição nem plano.</p>
              <div className="pw-grid">
                <div className="pw-field"><label htmlFor="f-goal">Objetivo do paciente</label><input id="f-goal" className={inputCls} maxLength={200} value={form.goal_title ?? ""} onChange={(e) => change("goal_title", e.target.value)} /></div>
                <div className="pw-field"><label htmlFor="f-gd">Meta de data (opcional)</label><input id="f-gd" type="date" className={inputCls} value={form.goal_target_date ?? ""} onChange={(e) => change("goal_target_date", e.target.value)} /></div>
              </div>
            </div>
            <MeasuresPanel person={draft.person_id} onChanged={() => void refreshMeta()} />
            <div className="pw-card">
              <h2 className="font-semibold">Plano proposto <Tag k="prof" /></h2>
              <p className="pw-help">Só o que você registrar aparece ao paciente. Não há número padrão de sessões: o que ficar em branco aparece como “A definir com seu fisioterapeuta”.</p>
              <div className="pw-grid">
                <div className="pw-field"><label htmlFor="f-fq">Frequência (vezes por semana)</label><input id="f-fq" type="number" min={1} max={14} className={inputCls} value={form.freq_per_week ?? ""} onChange={(e) => change("freq_per_week", (e.target.value === "" ? null : Number(e.target.value)) as Form["freq_per_week"])} /></div>
                <div className="pw-field"><label htmlFor="f-wk">Duração prevista (semanas)</label><input id="f-wk" type="number" min={1} max={104} className={inputCls} value={form.duration_weeks ?? ""} onChange={(e) => change("duration_weeks", (e.target.value === "" ? null : Number(e.target.value)) as Form["duration_weeks"])} /></div>
                <div className="pw-field"><label htmlFor="f-ra">Próxima reavaliação</label><input id="f-ra" type="date" className={inputCls} value={form.reassessment_on ?? ""} onChange={(e) => change("reassessment_on", e.target.value)} /></div>
              </div>
              <div className="pw-field"><label htmlFor="f-rt">Rotina orientada</label><textarea id="f-rt" className={inputCls} rows={2} maxLength={2000} value={form.routine_text ?? ""} onChange={(e) => change("routine_text", e.target.value)} /></div>
              <div className="pw-field"><label htmlFor="f-rc">O que será reavaliado (critérios)</label><input id="f-rc" className={inputCls} maxLength={1000} value={form.reassessment_criteria ?? ""} onChange={(e) => change("reassessment_criteria", e.target.value)} /></div>
            </div>
            <div className="pw-card">
              <h2 className="font-semibold">Anotações internas <Tag k="int" /></h2>
              <div className="pw-field"><label htmlFor="f-int">Visível só para você; nunca vai ao paciente</label><textarea id="f-int" className={inputCls} rows={3} maxLength={4000} value={form.internal_notes ?? ""} onChange={(e) => change("internal_notes", e.target.value)} data-testid="pw-internal" /></div>
            </div>
            <div className="flex gap-2"><button type="button" className={btnPrimary} onClick={() => void goTab("evidencias")}>Continuar para as evidências</button></div>
          </div>)}

        {tab === "evidencias" && <EvidencePanel d={draft} onDraft={(x) => { setDraft(x); rev.current = x.rev; }} />}

        {tab === "apresentar" && stepsContent && (
          <PresentationSteps content={stepsContent} model={pv.model} firstName={firstName} final={<PortalPreview d={draft} pv={pv} onRefresh={() => setPvVer((v) => v + 1)} />} />
        )}

        {tab === "publicar" && (
          <div className="pw-card" data-testid="pw-publicar">
            <h2 className="font-semibold">Publicar para o paciente</h2>
            {draft.missing.length > 0 ? <div className="pw-warn" data-testid="pw-missing"><b>Falta preencher:</b><ul className="list-disc pl-5">{draft.missing.map((x) => <li key={x}>{x}</li>)}</ul></div>
              : <p className="text-sm">Tudo certo para publicar. O paciente verá <b>somente</b> o que está na apresentação (as anotações internas não saem daqui).</p>}
            <p className="text-sm" data-testid="pw-version">{draft.published_version > 0 ? <>Versão publicada: <b>{draft.published_version}</b>{draft.published_at ? ` em ${fmtDateTime(draft.published_at)}` : ""}.{draft.unpublished_changes ? " Há alterações ainda não publicadas." : " Nada novo para publicar."}</> : "Ainda não publicada."}</p>
            <p className="pw-help">Publicar não altera plano ativo nem cria consultas, convites ou cobranças. O objetivo vira a meta do paciente apenas se ele ainda não tiver uma meta ativa.</p>
            <div><button type="button" className={btnPrimary} disabled={!draft.can_publish || publishing || (draft.published_version > 0 && !draft.unpublished_changes)} onClick={() => void publish()} data-testid="pw-publish"><Send size={14} className="mr-1 inline" aria-hidden />Publicar apresentação</button></div>
          </div>)}
      </>)}
    </div>
  );
};
export default PresentationWorkspace;
