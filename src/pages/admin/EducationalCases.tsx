import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, BookOpenCheck, Ban } from "lucide-react";
import { Badge, btnGhost, btnPrimary, EmptyState, inputCls, Msg, PageHead, State, Tabs, useMsg } from "@/lib/ui";
import { fmtDate } from "@/lib/format";
import { apiText, AREAS, caseList, caseReview, caseSave, conditionsCatalog, type CaseItem } from "@/pages/apresentacao/api";
import "@/pages/apresentacao/presentation.css";

const LABEL: Record<string, string> = { draft: "Para aprovar", approved: "Aprovado", revoked: "Revogado" };
const num = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
const EMPTY: Record<string, string> = { title: "", initial_situation: "", objective: "", measure_label: "", measure_unit: "", baseline_value: "", observed_value: "", interval_text: "", sessions_done: "", limitations: "Resultado de um caso isolado, com condições próprias; não permite prever o resultado de outra pessoa." };

/** Casos educativos autorizados (gestão). Dados minimizados e sem identificação; só entram nas apresentações depois de aprovados com a AUTORIZAÇÃO ESPECÍFICA registrada; podem ser revogados a qualquer momento. */
const EducationalCases = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [tab, setTab] = useState("draft"); const [form, setForm] = useState<Record<string, string> | null>(null); const [areas, setAreas] = useState<string[]>([]); const [conds, setConds] = useState<string[]>([]);
  const [auth, setAuth] = useState<Record<string, { ref: string; on: string; ok: boolean; reason: string }>>({});
  const q = useQuery({ queryKey: ["case-list"], retry: false, queryFn: () => caseList() });
  const cat = useQuery({ queryKey: ["pw-cond-catalog"], retry: false, staleTime: 3_600_000, queryFn: conditionsCatalog });
  const rows = (q.data ?? []).filter((r) => r.status === tab);
  const a = (id: string) => auth[id] ?? { ref: "", on: "", ok: false, reason: "" };
  const setA = (id: string, p: Partial<{ ref: string; on: string; ok: boolean; reason: string }>) => setAuth((x) => ({ ...x, [id]: { ...a(id), ...p } }));
  const refresh = () => qc.invalidateQueries({ queryKey: ["case-list"] });
  const save = async () => {
    if (!form) return;
    try {
      await caseSave(null, { ...form, baseline_value: Number(form.baseline_value.replace(",", ".")), observed_value: Number(form.observed_value.replace(",", ".")), sessions_done: form.sessions_done || null, area_keys: areas, condition_keys: conds });
      m.ok("Caso salvo para aprovação."); setForm(null); setAreas([]); setConds([]); setTab("draft"); await refresh();
    } catch (e) { m.err(apiText(e)); }
  };
  const review = async (r: CaseItem, d: "approve" | "revoke" | "reject") => {
    try { await caseReview(r.id, d, { ref: a(r.id).ref, on: a(r.id).on, identifiersRemoved: a(r.id).ok, note: a(r.id).reason }); m.ok(d === "approve" ? "Caso aprovado: já pode ser usado nas apresentações." : d === "revoke" ? "Autorização revogada: o caso deixa de aparecer." : "Caso devolvido."); await refresh(); }
    catch (e) { m.err(apiText(e)); }
  };
  const field = (k: string, label: string, area?: boolean, type?: string) => (
    <div className="pw-field" key={k}><label htmlFor={`ec-${k}`}>{label}</label>{area ? <textarea id={`ec-${k}`} className={inputCls} rows={2} value={form?.[k] ?? ""} onChange={(e) => setForm((f) => ({ ...(f ?? EMPTY), [k]: e.target.value }))} /> : <input id={`ec-${k}`} type={type ?? "text"} className={inputCls} value={form?.[k] ?? ""} onChange={(e) => setForm((f) => ({ ...(f ?? EMPTY), [k]: e.target.value }))} />}</div>
  );
  return (
    <div className="grid gap-4" data-testid="cases-admin">
      <PageHead eyebrow="Gestão" title="Casos educativos" hint="Exemplos preparados para a apresentação, com autorização específica e sem dados que identifiquem a pessoa. Nada é compartilhado entre organizações e nenhum prontuário é aberto." />
      <Msg m={msg} />
      <div><button type="button" className={btnPrimary} onClick={() => setForm({ ...EMPTY })} data-testid="case-new">Cadastrar caso educativo</button></div>
      {form && (
        <div className="pw-card grid gap-3" data-testid="case-form">
          <p className="pw-help">Escreva sem nome, idade exata, endereço, foto ou qualquer dado que identifique a pessoa. Informe só a medida e o intervalo reais; não calcule percentuais de recuperação.</p>
          <div className="pw-grid">{field("title", "Título do caso")}{field("interval_text", "Intervalo de acompanhamento (ex.: 8 semanas)")}</div>
          <div className="pw-grid">{field("initial_situation", "Situação inicial", true)}{field("objective", "Objetivo", true)}</div>
          <div className="pw-grid">{field("measure_label", "Medida utilizada (ex.: dor de 0 a 10)")}{field("measure_unit", "Unidade (opcional)")}{field("baseline_value", "Valor inicial")}{field("observed_value", "Valor observado depois")}{field("sessions_done", "Sessões realizadas (opcional)", undefined, "number")}</div>
          {field("limitations", "Limites da comparação (obrigatório)", true)}
          <div className="pw-areas" role="group" aria-label="Áreas do caso">{AREAS.map((x) => <button key={x.key} type="button" className="pw-area" data-on={areas.includes(x.key)} aria-pressed={areas.includes(x.key)} onClick={() => setAreas((v) => (v.includes(x.key) ? v.filter((k) => k !== x.key) : [...v, x.key]))}>{x.label}</button>)}</div>
          <div className="pw-field"><label htmlFor="ec-cond">Condições do caso</label><select id="ec-cond" className={inputCls} multiple size={6} value={conds} onChange={(e) => setConds(Array.from(e.target.selectedOptions).map((o) => o.value))} data-testid="case-conditions">{(cat.data ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
          <div className="flex gap-2"><button type="button" className={btnPrimary} onClick={() => void save()} data-testid="case-save">Salvar para aprovação</button><button type="button" className={btnGhost} onClick={() => setForm(null)}>Cancelar</button></div>
        </div>)}
      <Tabs tabs={[["draft", `Para aprovar (${(q.data ?? []).filter((r) => r.status === "draft").length})`], ["approved", "Aprovados"], ["revoked", "Revogados"]]} value={tab} onChange={setTab} />
      <State loading={q.isLoading} error={q.error ? new Error(apiText(q.error)) : undefined} />
      {!q.isLoading && rows.length === 0 && <EmptyState icon={BookOpenCheck} title="Nenhum caso aqui">Cadastre um caso e registre a autorização para ele poder aparecer nas apresentações.</EmptyState>}
      {rows.map((r) => (
        <article key={r.id} className="pw-card" data-testid="case-row">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{r.title}</h2><Badge tone={r.status === "approved" ? "info" : r.status === "revoked" ? "neutral" : "warning"}>{LABEL[r.status ?? "draft"]}</Badge></div>
          <p className="text-sm"><b>Situação inicial:</b> {r.situation}</p><p className="text-sm"><b>Objetivo:</b> {r.objective}</p>
          <p className="text-sm"><b>{r.measure_label}:</b> de {num(r.baseline)} para {num(r.observed)}{r.measure_unit ? ` ${r.measure_unit}` : ""} em {r.interval_text}{r.sessions_done != null ? ` · ${r.sessions_done} sessões` : ""}</p>
          <p className="text-sm"><b>Limites:</b> {r.limitations}</p>
          {r.condition_labels.length > 0 && <p className="pw-help">Condições: {r.condition_labels.join(", ")}</p>}
          {r.status === "approved" && <p className="pw-help" data-testid="case-auth">Autorização: {r.authorization_ref}{r.authorized_on ? ` (${fmtDate(r.authorized_on)})` : ""}</p>}
          {r.status === "revoked" && <p className="pw-help">Revogado: {r.revoke_reason}</p>}
          {r.status === "draft" && (
            <div className="grid gap-2">
              <div className="pw-grid"><div className="pw-field"><label htmlFor={`ca-ref-${r.id}`}>Autorização específica (documento)</label><input id={`ca-ref-${r.id}`} className={inputCls} value={a(r.id).ref} onChange={(e) => setA(r.id, { ref: e.target.value })} data-testid="case-auth-ref" /></div>
                <div className="pw-field"><label htmlFor={`ca-on-${r.id}`}>Data da autorização</label><input id={`ca-on-${r.id}`} type="date" className={inputCls} value={a(r.id).on} onChange={(e) => setA(r.id, { on: e.target.value })} data-testid="case-auth-on" /></div></div>
              <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={a(r.id).ok} onChange={(e) => setA(r.id, { ok: e.target.checked })} data-testid="case-auth-ok" />Confirmo que o caso não traz dados que identifiquem a pessoa e que a autorização cobre o uso em apresentações educativas</label>
              <div><button type="button" className={btnPrimary} onClick={() => void review(r, "approve")} data-testid="case-approve"><Check size={14} className="mr-1 inline" aria-hidden />Aprovar</button></div>
            </div>)}
          {r.status === "approved" && (
            <div className="grid gap-2"><div className="pw-field"><label htmlFor={`ca-rv-${r.id}`}>Motivo da revogação</label><input id={`ca-rv-${r.id}`} className={inputCls} value={a(r.id).reason} onChange={(e) => setA(r.id, { reason: e.target.value })} data-testid="case-revoke-reason" /></div>
              <div><button type="button" className={btnGhost} onClick={() => void review(r, "revoke")} data-testid="case-revoke"><Ban size={14} className="mr-1 inline" aria-hidden />Revogar autorização</button></div></div>)}
        </article>))}
    </div>
  );
};
export default EducationalCases;
