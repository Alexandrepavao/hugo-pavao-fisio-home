import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ---- classes compartilhadas (definidas em src/styles/app.css) ----
export const inputCls = "hp-input";
export const btnPrimary = "hp-btn hp-btn-primary";
export const btnGhost = "hp-btn hp-btn-outline";
export const btnDanger = "hp-btn hp-btn-danger";
export const btnLink = "text-accent hover:underline text-sm font-medium";

export const PageHead = ({ eyebrow, title, hint, actions }: { eyebrow?: string; title: string; hint?: string; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
    <div className="min-w-0">
      {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
      <h2 className="!text-[1.375rem] !leading-7 font-bold text-foreground" style={{ letterSpacing: "-0.01em" }}>{title}</h2>
      {hint && <p className="text-muted-foreground text-[13px] mt-1 max-w-2xl">{hint}</p>}
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
  <div className="hp-card flex flex-col items-center text-center gap-2 py-10 px-6">
    <span aria-hidden className="grid place-items-center rounded-full bg-muted text-muted-foreground" style={{ width: "2.5rem", height: "2.5rem" }}><Icon size={18} /></span>
    <p className="font-medium text-foreground">{title}</p>
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
    <table className="w-full">
      <thead><tr className="text-left text-xs font-semibold text-muted-foreground bg-muted/60 border-b border-border">
        {head.map((h, i) => <th key={h + i} scope="col" className={`px-3 py-2.5 ${right.includes(i) ? "text-right" : ""}`}>{h}</th>)}
      </tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
export const Td = ({ children, num, className = "" }: { children: ReactNode; num?: boolean; className?: string }) =>
  <td className={`px-3 py-2.5 border-b border-border last:border-0 align-middle ${num ? "text-right tabular" : ""} ${className}`}>{children}</td>;

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "gold";
export const Badge = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => {
  const cls = { neutral: "", success: "hp-badge-success", warning: "hp-badge-warning", danger: "hp-badge-danger", info: "hp-badge-info", gold: "hp-badge-gold" }[tone];
  return <span className={`hp-badge ${cls}`}>{children}</span>;
};

export const StatCard = ({ label, value, basis, tone, unavailable, onClick }: { label: string; value: ReactNode; basis?: string; tone?: Tone; unavailable?: boolean; onClick?: () => void }) => {
  const body = (<>
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {onClick && <span aria-hidden className="text-[11px] text-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">Ver detalhes</span>}
    </div>
    <p className={`mt-1 text-[1.5rem] leading-8 font-bold tabular ${unavailable ? "text-muted-foreground" : tone === "danger" ? "text-destructive" : "text-foreground"}`} style={{ fontFamily: "Inter, system-ui, sans-serif" }}>{value}</p>
    {basis && <p className="text-[11px] leading-4 text-muted-foreground mt-2">{basis}</p>}
  </>);
  if (!onClick) return <li className="hp-card p-4 list-none">{body}</li>;
  return (
    <li className="list-none">
      <button type="button" onClick={onClick} className="group hp-card p-4 w-full text-left hover:border-accent/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all">
        {body}
      </button>
    </li>
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
