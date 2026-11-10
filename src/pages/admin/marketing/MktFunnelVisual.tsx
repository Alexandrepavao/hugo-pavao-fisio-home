import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge, Msg, State, btnGhost, btnPrimary, confirmDialog, errText } from "@/lib/ui";
import { MktAssistantButton } from "./MktParts";
import { funnelName, money, num, rpcArgs, useMktInvalidate, useMktRpc, useNote, type FunnelDef, type FunnelRun, type MktFilters, type StepType } from "./mktApi";

interface ListResp { funnels: FunnelDef[]; step_types: StepType[] }
export const useFunnels = () => useMktRpc<ListResp>("mkt_funnels_list", {});
const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/** Funil visual: uma barra por etapa (largura proporcional à maior etapa disponível), conversão da etapa anterior entre elas, custo por etapa e o gargalo destacado.
 *  Etapas sem fonte aparecem como “Não disponível” com o motivo — nunca como zero. O gargalo só é apontado pelo banco quando há volume suficiente. */
export const FunnelView = ({ run }: { run: FunnelRun }) => {
  const base = Math.max(1, ...run.steps.filter((s) => s.available && s.count != null).map((s) => s.count as number));
  return (
    <ol className="grid gap-1" data-testid="mkt-funnel-visual" aria-label={`Funil ${funnelName(run.funnel.name)}`}>
      {run.steps.map((s, i) => {
        const w = s.available && s.count != null ? Math.max(4, Math.round((s.count / base) * 100)) : 0; const bottleneck = run.bottleneck_index === i;
        return (<li key={`${s.index}-${s.kind}`} className="grid gap-1">
          {i > 0 && <div className="flex items-center gap-2 pl-2 text-xs text-muted-foreground" aria-label={`Conversão da etapa anterior: ${pct(s.rate_from_previous)}`}><ArrowDown size={13} aria-hidden /><b className="tabular text-foreground">{pct(s.rate_from_previous)}</b> da etapa anterior{s.rate_from_first != null && <span> · {pct(s.rate_from_first)} do início</span>}</div>}
          <div className={`hp-card p-3 ${bottleneck ? "border-2" : ""}`} style={bottleneck ? { borderColor: "hsl(var(--warning, 38 80% 40%))" } : undefined} data-testid={`mkt-funnel-step-${s.kind}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{s.label} {s.source === "media" && <Badge tone="info">Plataforma</Badge>} {bottleneck && <Badge tone="warning">Maior perda</Badge>}</span>
              <span className="tabular text-lg font-bold">{s.available ? num(s.count) : "Não disponível"}</span>
            </div>
            {s.available ? <div className="mt-2 h-3 rounded-full bg-muted overflow-hidden" role="presentation"><div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} /></div>
              : <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>}
            {s.available && s.cost_per_step != null && <p className="text-xs text-muted-foreground mt-1">Custo por {s.label}: <b className="tabular text-foreground">{money(s.cost_per_step, run.currency)}</b></p>}
          </div>
        </li>);
      })}
    </ol>
  );
};

/** Editor do funil (só admin): nome + de 2 a 12 etapas escolhidas do catálogo, na ordem. */
const FunnelEditor = ({ def, types, onClose, onSaved }: { def: FunnelDef | null; types: StepType[]; onClose: () => void; onSaved: (id: string) => void }) => {
  const [name, setName] = useState(def?.name ?? ""); const [steps, setSteps] = useState<string[]>(def?.steps.map((s) => s.kind) ?? ["lead", "qualified", "sold"]);
  const { msg, setMsg } = useNote(); const [busy, setBusy] = useState(false);
  const move = (i: number, d: number) => setSteps((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const save = async () => {
    setBusy(true); const { data, error } = await supabase.rpc("mkt_funnel_save", { p_id: def?.id ?? null, p_name: name, p_steps: steps.map((kind) => ({ kind })) }); setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) }); onSaved(String(data));
  };
  return (
    <section className="hp-card p-4 mb-4 grid gap-3" aria-label="Editor de funil" data-testid="mkt-funnel-editor">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">Nome do funil<input className="hp-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="mkt-funnel-name" /></label>
      <ol className="grid gap-2">
        {steps.map((k, i) => (<li key={i} className="flex items-center gap-2">
          <span className="w-6 text-xs text-muted-foreground tabular">{i + 1}.</span>
          <select className="hp-input flex-1" value={k} aria-label={`Etapa ${i + 1}`} onChange={(e) => setSteps((a) => a.map((x, j) => (j === i ? e.target.value : x)))}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}{t.source === "media" ? " (plataforma)" : ""}</option>)}</select>
          <button type="button" className={btnGhost} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir etapa"><ChevronUp size={14} /></button>
          <button type="button" className={btnGhost} onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Descer etapa"><ChevronDown size={14} /></button>
          <button type="button" className={btnGhost} onClick={() => setSteps((a) => a.filter((_, j) => j !== i))} disabled={steps.length <= 2} aria-label="Remover etapa"><Trash2 size={14} /></button>
        </li>))}
      </ol>
      <p className="text-xs text-muted-foreground">{types.find((t) => t.key === steps[steps.length - 1])?.description}</p>
      <Msg m={msg} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => setSteps((a) => (a.length < 12 ? [...a, "lead"] : a))} disabled={steps.length >= 12}><Plus size={14} aria-hidden /> Adicionar etapa</button>
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || name.trim().length < 2} data-testid="mkt-funnel-save">Salvar funil</button>
        <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
      </div>
    </section>
  );
};

/** Seção “Funil visual”: escolhe um funil salvo, mostra o desenho com os filtros atuais e (admin) cria, edita e exclui. */
export const FunnelSection = ({ f, isAdmin }: { f: MktFilters; isAdmin: boolean }) => {
  const list = useFunnels(); const inv = useMktInvalidate(); const { msg, setMsg } = useNote();
  const [sel, setSel] = useState<string>(""); const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const funnels = useMemo(() => list.data?.funnels ?? [], [list.data]); const cur = useMemo(() => funnels.find((x) => x.id === sel) ?? funnels[0], [funnels, sel]);
  useEffect(() => { if (!sel && funnels[0]) setSel(funnels[0].id); }, [funnels, sel]);
  const run = useMktRpc<FunnelRun>("mkt_funnel_run", rpcArgs(f, { p_funnel: cur?.id, p_view: f.view }), !!cur);
  const del = async () => {
    if (!cur || !(await confirmDialog("Excluir o funil?", `“${cur.name}” deixa de aparecer aqui e nos painéis que o usam. Os dados não são afetados.`, "Excluir", true))) return;
    const { error } = await supabase.rpc("mkt_funnel_delete", { p_id: cur.id }); if (error) return setMsg({ kind: "err", text: errText(error) }); setSel(""); inv(); setMsg({ kind: "ok", text: "Funil excluído." });
  };
  return (
    <section className="mb-8" aria-label="Funil visual" data-testid="mkt-funnel-section">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-[0.9375rem] font-bold">Funil visual</h3>
        <div className="flex flex-wrap gap-2"><MktAssistantButton f={f} funnelId={cur?.id} />
          {isAdmin && <><button type="button" className={btnGhost} onClick={() => setEditor("new")} data-testid="mkt-funnel-new"><Plus size={14} aria-hidden /> Novo funil</button>
            {cur && <><button type="button" className={btnGhost} onClick={() => setEditor("edit")}>Editar</button><button type="button" className={btnGhost} onClick={del}>Excluir</button></>}</>}</div>
      </div>
      <State loading={list.isLoading} error={list.error} />
      {funnels.length > 0 && <div role="tablist" aria-label="Funis" className="flex flex-wrap gap-2 mb-3">{funnels.map((x) => <button key={x.id} role="tab" type="button" aria-selected={cur?.id === x.id} onClick={() => { setSel(x.id); setEditor(null); }} className={`px-3 h-9 rounded-lg border text-sm font-medium ${cur?.id === x.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{funnelName(x.name)}</button>)}</div>}
      <Msg m={msg} />
      {editor && list.data && <FunnelEditor key={editor + (cur?.id ?? "")} def={editor === "edit" ? cur ?? null : null} types={list.data.step_types} onClose={() => setEditor(null)} onSaved={(id) => { setSel(id); setEditor(null); inv(); setMsg({ kind: "ok", text: "Funil salvo." }); }} />}
      <State loading={run.isLoading} error={run.error} />
      {run.data && <><FunnelView run={run.data} />
        <p className="text-[13px] text-muted-foreground mt-3">{run.data.basis}</p>
        {run.data.notes.map((n) => <p key={n} className="text-[13px] text-muted-foreground mt-1">• {n}</p>)}</>}
    </section>
  );
};
