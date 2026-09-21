import { useState, type ReactNode } from "react";

export const inputCls = "w-full border border-input bg-card px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring";
export const btnGhost = "px-4 py-2 border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 transition-colors";
export const btnDanger = "px-4 py-2 border border-destructive text-destructive disabled:opacity-40";

export const PageHead = ({ eyebrow, title, hint, actions }: { eyebrow: string; title: string; hint?: string; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
    <div><p className="eyebrow mb-2">{eyebrow}</p><h1 className="text-3xl text-navy-900">{title}</h1>{hint && <p className="text-navy-400 text-sm mt-1 max-w-2xl">{hint}</p>}</div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Tabs = ({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) => (
  <div role="tablist" className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
    {tabs.map(([k, l]) => (
      <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
        className={`px-4 py-2 -mb-px border-b-2 whitespace-nowrap ${value === k ? "border-primary text-navy-900" : "border-transparent text-navy-400"}`}>{l}</button>
    ))}
  </div>
);

export const State = ({ loading, error, empty, emptyText }: { loading?: boolean; error?: unknown; empty?: boolean; emptyText?: string }) => {
  if (loading) return <p role="status" className="text-navy-400">Carregando…</p>;
  if (error) return <p role="alert" className="text-destructive">Sem permissão ou falha ao carregar.</p>;
  if (empty) return <p className="bg-card border border-border p-6 text-navy-400">{emptyText ?? "Nada por aqui ainda."}</p>;
  return null;
};

export const Table = ({ head, children, right = [] }: { head: string[]; children: ReactNode; right?: number[] }) => (
  <div className="overflow-x-auto bg-card border border-border">
    <table className="w-full text-[15px]">
      <thead><tr className="text-left text-xs uppercase tracking-wider text-navy-400 border-b border-border">
        {head.map((h, i) => <th key={h} className={`p-3 ${right.includes(i) ? "text-right" : ""}`}>{h}</th>)}
      </tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
export const Td = ({ children, num, className = "" }: { children: ReactNode; num?: boolean; className?: string }) =>
  <td className={`p-3 border-b border-border last:border-0 align-top ${num ? "text-right tabular" : ""} ${className}`}>{children}</td>;

export const Msg = ({ m }: { m: { kind: "ok" | "err"; text: string } | null }) =>
  m ? <p role={m.kind === "err" ? "alert" : "status"} className={`mb-4 text-sm ${m.kind === "err" ? "text-destructive" : "text-navy-700"}`}>{m.text}</p> : null;

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
