import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, AlertTriangle, ArrowRight, ChevronRight, Gauge, Inbox } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ---- classes compartilhadas (definidas em src/styles/app.css) ----
export const inputCls = "hp-input";
export const btnPrimary = "hp-btn hp-btn-primary";
export const btnGhost = "hp-btn hp-btn-outline";
export const btnDanger = "hp-btn hp-btn-danger";
export const btnLink = "text-accent hover:underline text-sm font-medium";

export const PageHead = ({ eyebrow, title, hint, actions }: { eyebrow?: string; title: string; hint?: string; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-7">
    <div className="min-w-0">
      {eyebrow && <p className="eyebrow mb-1.5" style={{ color: "hsl(var(--app-accent))" }}>{eyebrow}</p>}
      <h2 className="!text-[1.75rem] !leading-9 font-extrabold text-foreground" style={{ letterSpacing: "-0.02em" }}>{title}</h2>
      {hint && <p className="text-muted-foreground text-[13.5px] mt-1 max-w-2xl">{hint}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const Tabs = ({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) => (
  <div role="tablist" className="flex gap-1 border-b border-border mb-5 overflow-x-auto">
    {tabs.map(([k, l]) => (
      <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
        className={`px-3 h-10 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${value === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>
    ))}
  </div>
);

/** Barra de filtros: controles alinhados pela base, mesma altura, com rótulos acima. */
export const FilterBar = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="hp-card flex flex-wrap items-end gap-3 p-3 mb-4">{children}{right && <div className="ml-auto flex items-center gap-2">{right}</div>}</div>
);
export const FilterField = ({ label, htmlFor, children, className = "" }: { label: string; htmlFor: string; children: ReactNode; className?: string }) => (
  <div className={`min-w-[9rem] ${className}`}><label htmlFor={htmlFor} className="block text-xs text-muted-foreground mb-1">{label}</label>{children}</div>
);

export const EmptyState = ({ icon: Icon = Inbox, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="hp-empty">
    <span aria-hidden className="hp-empty-ico"><Icon size={20} /></span>
    <p className="font-semibold text-foreground">{title}</p>
    {children && <p className="text-muted-foreground text-[13px] max-w-md">{children}</p>}
    {action}
  </div>
);

export const State = ({ loading, error, empty, emptyText }: { loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string }) => {
  if (loading) return <div role="status" aria-live="polite" className="hp-card p-4 text-muted-foreground text-sm">Carregando…</div>;
  if (error) return <div role="alert" className="rounded-lg border p-4 text-sm" style={{ borderColor: "hsl(var(--destructive) / .4)", background: "hsl(var(--destructive-soft))", color: "hsl(var(--destructive))" }}>Sem permissão ou falha ao carregar. Tente novamente; se persistir, verifique seu acesso.</div>;
  if (empty) return <EmptyState title={emptyText ?? "Nada por aqui ainda."} />;
  return null;
};

export const Table = ({ head, children, right = [] }: { head: string[]; children: ReactNode; right?: number[] }) => (
  <div className="hp-card overflow-x-auto">
    <table className="hp-table">
      <thead><tr className="text-left">
        {head.map((h, i) => <th key={h + i} scope="col" className={right.includes(i) ? "text-right" : "text-left"}>{h}</th>)}
      </tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
export const Td = ({ children, num, className = "" }: { children: ReactNode; num?: boolean; className?: string }) =>
  <td className={`align-middle ${num ? "text-right tabular whitespace-nowrap" : ""} ${className}`}>{children}</td>;

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "gold";
export const Badge = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => {
  const cls = { neutral: "", success: "hp-badge-success", warning: "hp-badge-warning", danger: "hp-badge-danger", info: "hp-badge-info", gold: "hp-badge-gold" }[tone];
  return <span className={`hp-badge ${cls}`}>{children}</span>;
};

/** Nível visual do cartão: "hero" (faixa prioritária, número grande e minigráfico), "attention" (pendências, atrasos, riscos — destaque), "summary" (totais e situação atual)
 *  ou "compact" (apoio, em linha). */
export type CardLevel = "hero" | "attention" | "summary" | "compact";
export interface CardDelta { dir: "up" | "down" | "flat"; text: string; /** true = variação boa (verde), false = ruim (vermelho), omitido = neutra */ good?: boolean }

/** Minigráfico de tendência — só com série real (2 ou mais pontos). */
export const Sparkline = ({ data }: { data: number[] }) => {
  if (data.length < 2) return null;
  const w = 112, h = 44, pad = 3; const min = Math.min(...data), max = Math.max(...data); const span = max - min || 1;
  const pts = data.map((v, i) => [pad + (i * (w - 2 * pad)) / (data.length - 1), h - pad - ((v - min) / span) * (h - 2 * pad)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className="hp-kpi-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden focusable="false">
      <path d={`${line} L${pts[pts.length - 1][0]} ${h} L${pts[0][0]} ${h} Z`} fill="currentColor" opacity=".12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

/** Cartão de indicador: nome, número principal, unidade, período analisado, comparação (só com base real), descrição curta, tendência (só com série real) e, se clicável,
 *  abre o detalhamento. O número fica num <p class="tabular"> dentro do botão (contrato usado pelos testes de aceite). */
export const StatCard = ({ label, value, unit, period, delta, basis, tone, unavailable, onClick, level = "summary", icon: Icon, spark, status }: {
  label: string; value: ReactNode; unit?: string; period?: string; delta?: CardDelta | null; basis?: string; tone?: Tone; unavailable?: boolean; onClick?: () => void;
  level?: CardLevel; icon?: LucideIcon; spark?: number[]; /** rótulo curto de situação (ex.: “Crítico”, “Em dia”) */ status?: string;
}) => {
  const dataTone = tone === "danger" || tone === "warning" || tone === "success" ? tone : undefined;
  const valueTone = unavailable ? "text-muted-foreground" : "";
  const Ico = Icon ?? (level === "attention" ? AlertTriangle : undefined);
  const deltaEl = delta && (
    <p className={`hp-kpi-delta ${delta.good === true ? "is-good" : delta.good === false ? "is-bad" : "is-flat"}`}>{delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "■"} {delta.text}</p>
  );
  const valueEl = (
    <div className="flex items-baseline gap-1.5 flex-wrap">
      <p className={`hp-kpi-value tabular ${valueTone}`}>{value}</p>
      {unit && !unavailable && <span className="hp-kpi-unit">{unit}</span>}
    </div>
  );
  const body = level === "compact" ? (<>
    {Ico && <span aria-hidden className="hp-kpi-ico"><Ico /></span>}
    <div className="hp-kpi-mid"><p className="hp-kpi-label">{label}</p>{deltaEl}</div>
    <div className="text-right">{valueEl}{period && <span className="hp-kpi-period">{period}</span>}</div>
  </>) : (<>
    <div className="hp-kpi-head">
      {Ico && <span aria-hidden className="hp-kpi-ico"><Ico /></span>}
      <p className="hp-kpi-label">{label}</p>
      {period ? <span className="hp-kpi-period">{period}</span> : onClick && <ChevronRight aria-hidden className="hp-kpi-more" size={16} />}
    </div>
    <div className="hp-kpi-valuerow">
      <div className="hp-kpi-valuecol">{valueEl}{deltaEl}</div>
      {spark && <Sparkline data={spark} />}
    </div>
    {status && <p><span className="hp-kpi-status">{status}</span></p>}
    {basis && <p className="hp-kpi-basis" title={basis}>{basis}</p>}
    {onClick && <span aria-hidden className="hp-kpi-cta">Ver detalhes <ArrowRight size={13} /></span>}
  </>);
  const cls = `hp-kpi hp-kpi-${level} hp-card`;
  if (!onClick) return <li className={`${cls} list-none`} data-tone={dataTone}>{body}</li>;
  return (
    <li className="list-none">
      <button type="button" onClick={onClick} data-tone={dataTone} title={level === "compact" ? basis : undefined}
        className={`${cls} group w-full text-left hover:border-[hsl(var(--kc)/.45)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all`}>
        {body}
      </button>
    </li>
  );
};

/** Grade de cartões: `hero` (faixa prioritária), `lg` (atenção), padrão (resumo) ou `compact` (apoio). */
export const KpiGrid = ({ kind = "default", children }: { kind?: "default" | "lg" | "hero" | "compact"; children: ReactNode }) => (
  <ul className={`hp-kpi-grid ${kind === "lg" ? "hp-kpi-grid-lg" : kind === "hero" ? "hp-kpi-grid-hero" : kind === "compact" ? "hp-kpi-grid-compact" : ""}`}>{children}</ul>
);

/** Seção de dashboard com nível: Atenção (o que exige ação), Resumo (situação atual) ou Análise (gráficos, evolução, comparações). */
export const LevelSection = ({ level, title, hint, children, label }: { level: "attention" | "summary" | "analysis"; title: string; hint?: string; children: ReactNode; label?: string }) => {
  const Icon = level === "attention" ? AlertTriangle : level === "summary" ? Gauge : Activity;
  return (
    <section aria-label={label ?? title} className={`hp-level hp-level-${level}`}>
      <div className="hp-level-head">
        <span aria-hidden className="hp-level-ico"><Icon /></span>
        <div className="hp-level-titles">
          <h2><span className="hp-level-tag">{level === "attention" ? "Atenção" : level === "summary" ? "Resumo" : "Análise"}</span>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
};

export const Msg = ({ m }: { m: { kind: "ok" | "err"; text: string } | null }) =>
  m ? (
    <p role={m.kind === "err" ? "alert" : "status"} className="mb-4 rounded-md border px-3 py-2 text-sm"
      style={m.kind === "err" ? { borderColor: "hsl(var(--destructive) / .4)", background: "hsl(var(--destructive-soft))", color: "hsl(var(--destructive))" } : { borderColor: "hsl(var(--success) / .35)", background: "hsl(var(--success-soft))", color: "hsl(var(--success))" }}>{m.text}</p>
  ) : null;

/** Mensagens de erro do banco (funções em português) chegam limpas; códigos técnicos viram texto genérico. */
export const errText = (e: { message: string; code?: string } | null | undefined, fallback = "Não foi possível concluir a operação."): string => {
  if (!e) return fallback;
  if (e.code === "42501") return "Você não tem permissão para esta ação.";
  if (e.code === "23505") return "Já existe um registro com estes dados.";
  if (e.code === "P0409") return "Horário indisponível: já existe agendamento neste período.";
  return /[a-záéíóúãõç]/i.test(e.message) && !/violates|relation|column|syntax/i.test(e.message) ? e.message : fallback;
};

export const useMsg = () => {
  const [m, setM] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  return [m, { ok: (text: string) => setM({ kind: "ok", text }), err: (text: string) => setM({ kind: "err", text }), clear: () => setM(null) }] as const;
};

// ---------------------------------------------------------------- diálogos (substituem window.prompt / window.confirm)
export interface AskOptions {
  title: string; description?: string; label?: string; confirmLabel?: string; danger?: boolean;
  /** "text" (padrão), "number", "select" ou "none" (apenas confirmar) */
  kind?: "text" | "number" | "select" | "none"; options?: { value: string; label: string }[]; defaultValue?: string; required?: boolean; multiline?: boolean;
}
type AskFn = (o: AskOptions) => Promise<string | null>;
const AskContext = createContext<AskFn | null>(null);
let globalAsk: AskFn | null = null;

/** Versões utilitárias (fora de componentes) que usam o mesmo diálogo acessível. Retornam null se cancelado. */
export const promptText = (title: string, label: string, o: Partial<AskOptions> = {}) => (globalAsk ? globalAsk({ title, label, ...o }) : Promise.resolve(null));
export const confirmDialog = async (title: string, description?: string, confirmLabel = "Confirmar", danger = false) =>
  globalAsk ? (await globalAsk({ title, description, kind: "none", confirmLabel, danger })) !== null : false;

export const AskProvider = ({ children }: { children: ReactNode }) => {
  const [opt, setOpt] = useState<AskOptions | null>(null); const [val, setVal] = useState(""); const [err, setErr] = useState<string | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const ask = useCallback<AskFn>((o) => new Promise((resolve) => { resolver.current = resolve; setVal(o.defaultValue ?? o.options?.[0]?.value ?? ""); setErr(null); setOpt(o); }), []);
  useEffect(() => { globalAsk = ask; return () => { globalAsk = null; }; }, [ask]);
  const close = (v: string | null) => { resolver.current?.(v); resolver.current = null; setOpt(null); };
  const submit = () => {
    if (opt && opt.kind !== "none" && (opt.required ?? true) && !val.trim()) return setErr("Preencha este campo.");
    if (opt?.kind === "number" && Number.isNaN(Number(val.replace(",", ".")))) return setErr("Informe um número válido.");
    close(opt?.kind === "none" ? "ok" : val.trim());
  };
  return (
    <AskContext.Provider value={ask}>
      {children}
      <Dialog open={!!opt} onOpenChange={(o) => { if (!o) close(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{opt?.title}</DialogTitle>{opt?.description && <DialogDescription>{opt.description}</DialogDescription>}</DialogHeader>
          {opt && opt.kind !== "none" && (
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} id="ask-form">
              <label htmlFor="ask-input" className="block text-sm mb-1">{opt.label ?? "Informe"}</label>
              {opt.kind === "select" ? (
                <select id="ask-input" autoFocus className="hp-input" value={val} onChange={(e) => setVal(e.target.value)}>{opt.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              ) : opt.multiline ? (
                <textarea id="ask-input" autoFocus rows={3} className="hp-input" value={val} onChange={(e) => setVal(e.target.value)} />
              ) : (
                <input id="ask-input" autoFocus inputMode={opt.kind === "number" ? "decimal" : undefined} className="hp-input" value={val} onChange={(e) => setVal(e.target.value)} />
              )}
              {err && <p role="alert" className="text-sm text-destructive mt-1">{err}</p>}
            </form>
          )}
          <DialogFooter>
            <button type="button" className={btnGhost} onClick={() => close(null)}>Cancelar</button>
            <button type={opt?.kind === "none" ? "button" : "submit"} form={opt?.kind === "none" ? undefined : "ask-form"} onClick={opt?.kind === "none" ? submit : undefined} className={opt?.danger ? "hp-btn hp-btn-primary" : btnPrimary} style={opt?.danger ? { background: "hsl(var(--destructive))", borderColor: "hsl(var(--destructive))" } : undefined}>{opt?.confirmLabel ?? "Confirmar"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AskContext.Provider>
  );
};

/** const ask = useAsk(); const motivo = await ask({ title: "Cancelar venda", label: "Motivo" }); if (!motivo) return; */
export const useAsk = (): AskFn => {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk deve ser usado dentro de AskProvider");
  return ctx;
};
export const useConfirm = () => { const ask = useAsk(); return useCallback(async (title: string, description?: string, confirmLabel = "Confirmar", danger = false) => (await ask({ title, description, kind: "none", confirmLabel, danger })) !== null, [ask]); };

/** Atalho: chama o callback ao pressionar Escape. */
export const useEscape = (fn: () => void, active = true) => { useEffect(() => { if (!active) return; const h = (e: KeyboardEvent) => e.key === "Escape" && fn(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [fn, active]); };
