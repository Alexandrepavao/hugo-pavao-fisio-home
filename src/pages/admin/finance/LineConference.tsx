import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { brl } from "@/lib/format";
import type { Conference } from "./lineReports";

/** Caixa "Conferido": a soma das linhas bate com o total direto da base original (mesma apresentação de Visão geral/DRE). `countMetrics` lista as métricas que são contagens (não R$). */
const LineConference = ({ conference, label, okText, badText, countMetrics = [] }: { conference: Conference; label: string; okText: string; badText: string; countMetrics?: string[] }) => (
  <div className="hp-card p-3" role="status" aria-label={label}>
    <p className="text-sm font-medium flex items-center gap-2">
      {conference.ok ? <><CheckCircle2 size={16} aria-hidden style={{ color: "hsl(var(--success))" }} />{okText}</>
        : <><AlertTriangle size={16} aria-hidden style={{ color: "hsl(var(--destructive))" }} />{badText}</>}
    </p>
    <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
      {conference.checks.map((c) => { const fmt = (v: number) => (countMetrics.includes(c.metric) ? String(v) : brl(Number(v)));
        return <li key={c.metric} className="flex justify-between gap-2"><span>{c.ok ? "✓" : "✗"} {c.metric}</span><span className="tabular">{fmt(c.lines_total_cents)} {c.ok ? "=" : "≠"} {fmt(c.direct_cents)}</span></li>; })}
    </ul>
  </div>
);

export default LineConference;
