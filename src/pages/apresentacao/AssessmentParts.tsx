import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2, Sparkles, ClipboardList } from "lucide-react";
import { btnGhost, btnPrimary, inputCls, useMsg, Msg } from "@/lib/ui";
import {
  apiText, AREAS, BODY_REGIONS, CONTEXT_TAGS, caseSuggest, casePick, caseUnpick, conditionsCatalog, leadInfo, planTemplateArchive, planTemplateSave, planTemplates,
  type CaseItem, type CatalogCondition, type ConditionRow, type ConditionStatus, type PlanTemplate, type PresentationDraft,
} from "./api";

/** Peças da avaliação: queixa do cadastro, condições por área (catálogo N:N), contexto, modelos de plano e casos educativos. Estilos: presentation.css (pw-*). */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const STATUS_LABEL: Record<ConditionStatus, string> = { documented: "Diagnóstico documentado", assessed: "Avaliado pelo fisioterapeuta", hypothesis: "Hipótese", investigating: "Em investigação", not_informed: "Não informado" };
const LAT: [string, string][] = [["right", "Direita"], ["left", "Esquerda"], ["bilateral", "Bilateral"], ["na", "Não se aplica"]];
const QUIZ_Q: Record<string, string> = {
  dor_intensidade: "De 0 a 10, quanto a dor ou desconforto incomoda hoje?", motivacao_melhora: "De 0 a 10, quanto deseja melhorar esse problema?",
  impacto_qualidade_vida: "Se o desconforto diminuísse, quanto a qualidade de vida melhoraria? (0 a 10)", atividade_desejada: "Atividade que mais gostaria de voltar a fazer com conforto",
};

/** O que o paciente respondeu ao se cadastrar. É relato (não diagnóstico) e só a fisioterapeuta com vínculo lê. */
export const LeadCard = ({ enrollmentId }: { enrollmentId: string }) => {
  const q = useQuery({ queryKey: ["pw-lead", enrollmentId], retry: false, refetchOnWindowFocus: false, queryFn: () => leadInfo(enrollmentId) });
  return (
    <div className="pw-card" data-testid="pw-lead">
      <h2 className="font-semibold">Queixa informada no cadastro <span className="pw-tag is-pac">Relatado pelo paciente</span></h2>
      {q.isLoading ? <p className="pw-help">Carregando…</p> : !q.data?.found ? <p className="pw-help" data-testid="pw-lead-none">Este paciente não respondeu ao questionário de atendimento. Registre a queixa abaixo, com as palavras dele.</p> : (
        <>
          <ul className="grid gap-1 text-sm">{(q.data.answers ?? []).map((a) => <li key={a.key} data-testid="pw-lead-item"><span className="text-muted-foreground">{QUIZ_Q[a.key] ?? a.key}: </span><b>{a.label}</b></li>)}</ul>
          <p className="pw-help">São respostas do próprio paciente ao se cadastrar. Servem de apoio à conversa e <b>não são diagnóstico</b>: nada aqui vira condição sem a sua avaliação.</p>
        </>
      )}
    </div>
  );
};

const emptyRow = (over: Partial<ConditionRow>): ConditionRow => ({ condition_key: null, free_text: null, role: "associated", status: "assessed", subtype_key: null, body_region: null, laterality: null, onset_text: null, ...over });

/** Condições da avaliação: Área → Condição → Subtipo. Busca por nome e sinônimos, várias condições (principal + associadas), "não informado" e "em investigação". */
export const ConditionsEditor = ({ areas, complaint, rows, onChange }: { areas: string[]; complaint: string | null; rows: ConditionRow[]; onChange: (r: ConditionRow[]) => void }) => {
  const cat = useQuery({ queryKey: ["pw-cond-catalog"], retry: false, refetchOnWindowFocus: false, staleTime: 3_600_000, queryFn: conditionsCatalog });
  const [term, setTerm] = useState(""); const [onlyAreas, setOnlyAreas] = useState(true); const [free, setFree] = useState("");
  const byKey = useMemo(() => new Map((cat.data ?? []).map((c) => [c.key, c])), [cat.data]);
  const used = new Set(rows.map((r) => r.condition_key).filter(Boolean));
  const scoped = useMemo(() => (cat.data ?? []).filter((c) => !onlyAreas || areas.length === 0 || c.areas.some((a) => areas.includes(a))), [cat.data, areas, onlyAreas]);
  const results = useMemo(() => {
    const t = norm(term.trim()); const base = scoped.filter((c) => !used.has(c.key));
    if (!t) return base.slice(0, 12);
    return base.filter((c) => norm(c.label).includes(t) || c.synonyms.some((s) => norm(s).includes(t))).slice(0, 12);
  }, [scoped, term, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  // sugestões a partir da queixa: só OPÇÕES para a profissional conferir (nunca gravadas sozinhas)
  const fromComplaint = useMemo(() => {
    const t = norm(complaint ?? ""); if (t.length < 3) return [] as CatalogCondition[];
    return (cat.data ?? []).filter((c) => !used.has(c.key) && [c.label, ...c.synonyms].some((s) => { const w = norm(s).replace(/\(.*?\)/g, "").trim(); return w.length >= 4 && t.includes(w); })).slice(0, 5);
  }, [cat.data, complaint, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (r: ConditionRow) => onChange([...rows.map((x) => x), { ...r, role: rows.some((x) => x.role === "principal") ? "associated" : "principal" }]);
  const set = (i: number, patch: Partial<ConditionRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const makePrincipal = (i: number) => onChange(rows.map((r, k) => ({ ...r, role: k === i ? "principal" : "associated" })));
  const remove = (i: number) => { const next = rows.filter((_, k) => k !== i); if (next.length && !next.some((r) => r.role === "principal")) next[0] = { ...next[0], role: "principal" }; onChange(next); };
  return (
    <div className="grid gap-3" data-testid="pw-conditions">
      <div>
        <h3 className="font-semibold">Condições <span className="pw-tag is-prof">Avaliado/validado pelo profissional</span></h3>
        <p className="pw-help">Escolha a condição dentro da(s) área(s). Uma condição pode aparecer em mais de uma área. “Idoso”, “acamado” e “pós-operatório” são <b>contexto</b>, não diagnóstico. A lista é uma base inicial, em revisão clínica.</p>
      </div>
      {rows.length === 0 && <p className="pw-help" data-testid="pw-cond-empty">Nenhuma condição registrada. Você pode publicar sem condição; a apresentação então não traz explicação sobre o quadro.</p>}
      {rows.map((r, i) => {
        const c = r.condition_key ? byKey.get(r.condition_key) : undefined;
        return (
          <div key={`${r.condition_key ?? r.free_text ?? "x"}-${i}`} className="pw-ev" data-testid="pw-cond-row" data-key={r.condition_key ?? "livre"}>
            <div className="flex flex-wrap items-center gap-2"><b>{c?.label ?? r.free_text ?? "Condição não informada"}</b>{r.role === "principal" ? <span className="pw-tag is-prof">Principal</span> : <button type="button" className="text-xs underline" onClick={() => makePrincipal(i)} data-testid="pw-cond-principal">Tornar principal</button>}
              <button type="button" className={`${btnGhost} ml-auto`} onClick={() => remove(i)} aria-label="Remover condição" data-testid="pw-cond-remove"><Trash2 size={14} aria-hidden /></button></div>
            <div className="pw-grid">
              <div className="pw-field"><label htmlFor={`cs-${i}`}>Situação</label><select id={`cs-${i}`} className={inputCls} value={r.status} onChange={(e) => set(i, { status: e.target.value as ConditionStatus })} data-testid="pw-cond-status">{(Object.keys(STATUS_LABEL) as ConditionStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select></div>
              {c && c.subtypes.length > 0 && <div className="pw-field"><label htmlFor={`cst-${i}`}>Subtipo</label><select id={`cst-${i}`} className={inputCls} value={r.subtype_key ?? ""} onChange={(e) => set(i, { subtype_key: e.target.value || null })} data-testid="pw-cond-subtype"><option value="">Não informado</option>{c.subtypes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>}
              {(c?.uses_region || !c) && <div className="pw-field"><label htmlFor={`cr-${i}`}>Região do corpo</label><select id={`cr-${i}`} className={inputCls} value={r.body_region ?? ""} onChange={(e) => set(i, { body_region: e.target.value || null })} data-testid="pw-cond-region"><option value="">—</option>{BODY_REGIONS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>}
              {(c?.uses_laterality || !c) && <div className="pw-field"><label htmlFor={`cl-${i}`}>Lado</label><select id={`cl-${i}`} className={inputCls} value={r.laterality ?? ""} onChange={(e) => set(i, { laterality: (e.target.value || null) as ConditionRow["laterality"] })} data-testid="pw-cond-lat"><option value="">—</option>{LAT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
              <div className="pw-field"><label htmlFor={`co-${i}`}>Tempo desde o evento</label><input id={`co-${i}`} className={inputCls} maxLength={120} placeholder="ex.: 3 meses" value={r.onset_text ?? ""} onChange={(e) => set(i, { onset_text: e.target.value || null })} data-testid="pw-cond-onset" /></div>
            </div>
          </div>
        );
      })}
      <div className="pw-card" style={{ background: "transparent" }}>
        <div className="pw-field"><label htmlFor="cond-search"><Search size={14} className="mr-1 inline" aria-hidden />Buscar condição (nome ou sinônimo)</label><input id="cond-search" className={inputCls} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="ex.: derrame, lombar, artrose…" data-testid="pw-cond-search" /></div>
        {areas.length > 0 && <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={onlyAreas} onChange={(e) => setOnlyAreas(e.target.checked)} data-testid="pw-cond-onlyareas" />Só condições da(s) área(s) escolhida(s) ({areas.map((a) => AREAS.find((x) => x.key === a)?.label).join(", ")})</label>}
        {cat.isLoading ? <p className="pw-help">Carregando o cadastro de condições…</p> : <div className="flex flex-wrap gap-2" role="list" aria-label="Condições encontradas">{results.map((c) => <button key={c.key} role="listitem" type="button" className={btnGhost} onClick={() => add(emptyRow({ condition_key: c.key }))} data-testid={`pw-cond-option-${c.key}`}><Plus size={12} className="mr-1 inline" aria-hidden />{c.label}</button>)}{results.length === 0 && <span className="pw-help">Nada encontrado nesta busca. Use “outra condição” abaixo.</span>}</div>}
        {fromComplaint.length > 0 && <div className="grid gap-1" data-testid="pw-cond-suggest"><p className="pw-help"><Sparkles size={14} className="mr-1 inline" aria-hidden />A queixa menciona termos parecidos com estas opções — confira; <b>não é diagnóstico</b> e nada é gravado sozinho:</p>
          <div className="flex flex-wrap gap-2">{fromComplaint.map((c) => <button key={c.key} type="button" className={btnGhost} onClick={() => add(emptyRow({ condition_key: c.key, status: "hypothesis" }))} data-testid={`pw-cond-suggest-${c.key}`}>{c.label}</button>)}</div></div>}
        <div className="flex flex-wrap items-end gap-2"><div className="pw-field" style={{ flex: 1, minWidth: 220 }}><label htmlFor="cond-free">Outra condição (texto livre)</label><input id="cond-free" className={inputCls} maxLength={200} value={free} onChange={(e) => setFree(e.target.value)} data-testid="pw-cond-free" /></div>
          <button type="button" className={btnGhost} disabled={free.trim().length < 2} onClick={() => { add(emptyRow({ free_text: free.trim() })); setFree(""); }} data-testid="pw-cond-free-add">Adicionar</button>
          <button type="button" className={btnGhost} onClick={() => add(emptyRow({ status: "not_informed" }))} data-testid="pw-cond-notinformed">Condição não informada</button></div>
      </div>
    </div>
  );
};

export const ContextTags = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
  <fieldset className="grid gap-1" data-testid="pw-context">
    <legend className="font-semibold text-sm">Contexto do paciente <span className="pw-help">(não é diagnóstico)</span></legend>
    <div className="flex flex-wrap gap-3">{CONTEXT_TAGS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={value.includes(k)} onChange={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])} data-testid={`pw-ctx-${k}`} />{l}</label>)}</div>
  </fieldset>
);

type PlanFields = { freq_per_week: number | null; duration_weeks: number | null; initial_sessions: number | null; session_minutes: number | null; routine_text: string | null; approach_text: string | null; reassessment_criteria: string | null };
/** Modelos de plano: atalhos EDITÁVEIS da clínica. Aplicar só preenche os campos para a profissional revisar; nenhum modelo impõe quantidade mínima de sessões. */
export const PlanTemplatesBar = ({ current, onApply }: { current: PlanFields; onApply: (t: PlanTemplate) => void }) => {
  const q = useQuery({ queryKey: ["pw-plan-templates"], retry: false, refetchOnWindowFocus: false, queryFn: planTemplates });
  const [sel, setSel] = useState(""); const [name, setName] = useState(""); const [msg, m] = useMsg();
  const save = async () => { try { await planTemplateSave(null, { name, ...current }); m.ok("Modelo salvo para a clínica."); setName(""); await q.refetch(); } catch (e) { m.err(apiText(e)); } };
  const archive = async () => { if (!sel) return; try { await planTemplateArchive(sel); setSel(""); await q.refetch(); } catch (e) { m.err(apiText(e)); } };
  const t = q.data?.find((x) => x.id === sel);
  return (
    <div className="grid gap-2" data-testid="pw-templates">
      <div className="flex flex-wrap items-end gap-2">
        <div className="pw-field" style={{ minWidth: 240 }}><label htmlFor="pt-sel"><ClipboardList size={14} className="mr-1 inline" aria-hidden />Modelo de plano (opcional)</label>
          <select id="pt-sel" className={inputCls} value={sel} onChange={(e) => setSel(e.target.value)} data-testid="pw-template-select"><option value="">— sem modelo —</option>{(q.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <button type="button" className={btnGhost} disabled={!t} onClick={() => t && onApply(t)} data-testid="pw-template-apply">Preencher a partir do modelo</button>
        {t?.mine && <button type="button" className={btnGhost} onClick={() => void archive()}>Arquivar modelo</button>}
      </div>
      <p className="pw-help">O modelo só <b>preenche os campos</b> abaixo; revise e ajuste para este paciente. Nenhum modelo define número mínimo de sessões.</p>
      <div className="flex flex-wrap items-end gap-2"><div className="pw-field" style={{ minWidth: 240 }}><label htmlFor="pt-name">Salvar o plano abaixo como modelo</label><input id="pt-name" className={inputCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="nome do modelo" data-testid="pw-template-name" /></div>
        <button type="button" className={btnGhost} disabled={name.trim().length < 3} onClick={() => void save()} data-testid="pw-template-save">Salvar modelo</button></div>
      <Msg m={msg} />
    </div>
  );
};

const num = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
/** Casos educativos autorizados: só os APROVADOS (com autorização específica registrada) aparecem; nada de prontuário de outro paciente. */
export const CasesPanel = ({ d, onDraft }: { d: PresentationDraft; onDraft: (x: PresentationDraft) => void }) => {
  const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["pw-case-suggest", d.id, d.rev], retry: false, refetchOnWindowFocus: false, queryFn: () => caseSuggest(d.id) });
  const picked = new Set(d.cases_picked.map((c) => c.id));
  const pick = async (c: CaseItem) => { try { onDraft(await casePick(d.id, c.id)); m.ok("Caso educativo incluído."); } catch (e) { m.err(apiText(e)); } };
  const unpick = async (id: string) => { try { onDraft(await caseUnpick(d.id, id)); m.ok("Caso removido."); } catch (e) { m.err(apiText(e)); } };
  return (
    <div className="pw-card" data-testid="pw-cases-panel">
      <h3 className="font-semibold">Casos educativos autorizados ({d.cases_picked.length} de no máximo 2)</h3>
      <p className="pw-help">São exemplos <b>preparados para esta finalidade</b>, com autorização específica registrada pela gestão e sem dados que identifiquem a pessoa. Nunca são prometidos como resultado para este paciente, e nenhum prontuário é aberto durante a apresentação.</p>
      <Msg m={msg} />
      {d.cases_picked.length === 0 ? <p className="pw-help" data-testid="pw-cases-none">Nenhum caso escolhido. A apresentação segue normalmente, sem a página de casos.</p> : d.cases_picked.map((c) => (
        <div key={c.id} className="pw-ev is-picked" data-testid="pw-case-picked"><b>{c.title}</b>{c.status === "revoked" && <span className="pw-warn">Autorização revogada: este caso não aparece mais.</span>}
          <div><button type="button" className={btnGhost} onClick={() => void unpick(c.id)}><Trash2 size={14} className="mr-1 inline" aria-hidden />Remover</button></div></div>))}
      {q.isLoading ? <p className="pw-help">Buscando casos…</p> : (q.data ?? []).length === 0 ? <p className="pw-help" data-testid="pw-cases-nolib">Não há caso autorizado compatível com a condição e a área deste paciente. A gestão cadastra e aprova os casos em Configurações ▸ Casos educativos.</p> : (q.data ?? []).map((c) => (
        <div key={c.id} className={`pw-ev${picked.has(c.id) ? " is-picked" : ""}`} data-testid="pw-case-suggestion">
          <b>{c.title}</b>
          <div className="pw-why">{(c.why ?? []).map((w) => <span key={w}>{w}</span>)}</div>
          <p className="text-sm"><b>Situação inicial:</b> {c.situation}</p><p className="text-sm"><b>Objetivo:</b> {c.objective}</p>
          <p className="text-sm"><b>{c.measure_label}:</b> de {num(c.baseline)} para {num(c.observed)}{c.measure_unit ? ` ${c.measure_unit}` : ""} em {c.interval_text}{c.sessions_done != null ? ` · ${c.sessions_done} sessões realizadas` : ""}</p>
          <p className="text-sm"><b>Limites da comparação:</b> {c.limitations}</p>
          {!picked.has(c.id) && <div><button type="button" className={btnPrimary} onClick={() => void pick(c)} data-testid="pw-case-use">Usar neste caso</button></div>}
        </div>))}
    </div>
  );
};
