import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Eye, Info, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDay, when, type Coverage, type KpisResp } from "./mktApi";

/** Dica de fórmula/fonte: ícone de informação que abre uma explicação curta (teclado, toque e leitor de tela). Mantém o cartão limpo. */
export const InfoTip = ({ title, children }: { title: string; children: ReactNode }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`Como é calculado: ${title}`} className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Info size={14} aria-hidden />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-72 text-xs leading-relaxed text-foreground">
      <p className="font-semibold mb-1">{title}</p>{children}
    </PopoverContent>
  </Popover>
);

/** Minigráfico só com série real: precisa de ao menos 3 pontos com valor; dias sem base quebram a linha. Sem série, não reserva espaço. */
export const Sparkline = ({ values, width = 84, height = 30 }: { values: (number | null)[]; width?: number; height?: number }) => {
  const real = values.filter((v): v is number => v != null);
  if (real.length < 3) return null;
  const min = Math.min(...real); const max = Math.max(...real); const span = max - min || 1; const n = values.length;
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2); const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  let d = ""; let pen = false;
  values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0 overflow-visible"><path d={d} fill="none" stroke="hsl(var(--chart-1))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
};

export interface MetricCardProps {
  testId: string; label: string; shortLabel?: string; icon: LucideIcon; value: string; noBase?: boolean; reason?: string | null; info: ReactNode;
  delta?: { text: string; dir: "up" | "down" | "flat" } | null; spark?: (number | null)[] | null; selected?: boolean; onSelect?: () => void; onOpen?: () => void; period?: string | null; warning?: string | null;
}
/** Cartão de indicador compacto (≈ 110–125 px): ícone discreto, título curto, valor em destaque, variação contra o período anterior (sem “bom/ruim” em cor) e minigráfico real.
 *  Clicar escolhe a métrica do gráfico; “Registros” abre os registros por trás do número. Fórmula e fonte ficam na dica (ícone de informação). */
export const MetricCard = ({ testId, label, shortLabel, icon: Icon, value, noBase, reason, info, delta, spark, selected, onSelect, onOpen, period, warning }: MetricCardProps) => (
  <div className={`relative rounded-xl border bg-card p-4 min-h-[110px] transition-colors ${selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40"}`} data-testid={testId} data-selected={selected ? "true" : "false"}>
    {onSelect && <button type="button" onClick={onSelect} aria-pressed={!!selected} aria-label={`Mostrar ${label} no gráfico`} className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
    <div className="relative pointer-events-none flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
        <Icon size={14} aria-hidden className="shrink-0" /><span className="text-[12.5px] font-medium truncate" title={label}>{shortLabel ?? label}</span>
        {period && <span className="text-[10.5px] rounded bg-muted px-1.5 py-px shrink-0">{period}</span>}
        <span className="ml-auto pointer-events-auto flex items-center gap-1">{warning && <span title={warning}><AlertTriangle size={13} aria-label={`Atenção: ${warning}`} style={{ color: "hsl(var(--warning))" }} /></span>}<InfoTip title={label}>{info}</InfoTip></span>
      </div>
      <div className="flex items-end justify-between gap-2 min-w-0">
        <p className={`tabular tracking-tight truncate ${noBase ? "text-[17px] leading-8 font-semibold text-muted-foreground" : "text-[24px] sm:text-[28px] leading-8 font-bold"}`} title={value}>{value}</p>
        {!noBase && spark ? <span className="hidden sm:block"><Sparkline values={spark} /></span> : null}
      </div>
      <div className="flex items-center justify-between gap-2 min-h-[18px] text-[11.5px] text-muted-foreground">
        <span className="truncate" title={noBase ? (reason ?? undefined) : undefined}>{noBase ? (reason ?? "Sem dado no período") : delta ? `${delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "■"} ${delta.text}` : ""}</span>
        {onOpen && <button type="button" onClick={onOpen} className="pointer-events-auto inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded shrink-0" aria-label={`Ver registros: ${label}`}><Eye size={12} aria-hidden />Registros</button>}
      </div>
    </div>
  </div>
);

/** Moldura de bloco (gráfico, funil, canais): título, subtítulo curto e ação à direita. Sem cartão dentro de cartão decorativo. */
export const Panel = ({ title, hint, right, children, testId, className = "" }: { title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode; testId?: string; className?: string }) => (
  <section className={`rounded-xl border border-border bg-card p-4 ${className}`} aria-label={title} data-testid={testId}>
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">
      <div className="min-w-[13rem] flex-1"><h3 className="text-[14.5px] font-bold leading-5">{title}</h3>{hint && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{hint}</p>}</div>
      {right && <div className="flex items-center gap-2 flex-wrap ml-auto">{right}</div>}
    </div>
    {children}
  </section>
);

/** Estado compacto (sem dado, conexão pendente, falha): uma linha com o motivo e a ação possível — nunca “Indisponível” em fonte grande. */
export const StateLine = ({ tone = "neutral", icon: Icon = Info, children, action, testId, role }: { tone?: "neutral" | "warning" | "danger"; icon?: LucideIcon; children: ReactNode; action?: ReactNode; testId?: string; role?: "status" | "alert" }) => (
  <div role={role} data-testid={testId} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-[13px]"
    style={tone === "warning" ? { borderColor: "hsl(var(--warning) / .5)", background: "hsl(var(--warning-soft))" } : tone === "danger" ? { borderColor: "hsl(var(--destructive) / .5)" } : undefined}>
    <Icon size={15} aria-hidden className="shrink-0 text-muted-foreground" /><span className="min-w-0">{children}</span>{action && <span className="ml-auto shrink-0">{action}</span>}
  </div>
);

const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // dia em São Paulo (UTC−3)
/** Faixa de sincronização: última coleta, cobertura do gasto, período em andamento (dados parciais) e falhas — com o caminho para resolver. */
export const SyncStrip = ({ c, model, view, to }: { c?: Coverage; model?: KpisResp["model"]; view: string; to: string }) => {
  if (!c) return null;
  const partial = to >= today();
  if (c.accounts === 0) {
    return <StateLine testId="mkt-coverage" role="status" action={<Link to="/admin/marketing/integracoes" className="text-primary font-medium hover:underline">Conectar conta</Link>}>
      Nenhuma conta de anúncios acompanhada neste escopo — o investimento aparece como “Sem base”, não como zero.</StateLine>;
  }
  const failed = c.failed_days > 0; const stale = c.stale_accounts > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground" data-testid="mkt-coverage" role="status">
      <span>Gasto coletado em <b className="text-foreground">{c.ok_days}</b> de <b className="text-foreground">{c.expected_days}</b> dias/conta{c.missing_days > 0 ? ` · ${c.missing_days} sem coleta` : ""}</span>
      <span>{c.last_ok_at ? <>Última sincronização: <b className="text-foreground">{when(c.last_ok_at)}</b></> : "Sem coleta pela API (só lançamento manual)"}</span>
      {partial && <span className="rounded bg-muted px-1.5 py-0.5" title="O período inclui hoje: valores do dia ainda podem mudar.">Período em andamento · dados parciais</span>}
      {(failed || stale) && <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5" style={{ background: "hsl(var(--warning-soft))", color: "hsl(var(--warning))" }}><AlertTriangle size={12} aria-hidden />
        {failed ? `Falha na atualização em ${c.failed_days} dia(s)` : `${c.stale_accounts} conta(s) desatualizada(s)`} · <Link to="/admin/marketing/integracoes" className="underline font-medium">ver integrações</Link></span>}
      {model && <span>Atribuição: {model.name} · {model.window_days} dias · {view === "cohort" ? "por coorte" : "por data do evento"}</span>}
    </div>
  );
};
export const rangeLabel = (from: string, to: string) => `${fmtDay(from)} a ${fmtDay(to)}`;
