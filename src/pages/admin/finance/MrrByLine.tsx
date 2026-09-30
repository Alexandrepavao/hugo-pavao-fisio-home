import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { brl } from "@/lib/format";
import { State } from "@/lib/ui";
import LineConference from "./LineConference";
import type { MrrByLine } from "./lineReports";
import type { LineFilter } from "./lineFilter";

const COLS = [{ key: "physio", label: "HP Fisioterapia" }, { key: "academy", label: "HP Academy" }, { key: "unclassified", label: "Não classificado" }, { key: "total", label: "Geral" }] as const;
type Field = "mrr_inicial_cents" | "novo_cents" | "expansao_cents" | "reativacao_cents" | "contracao_cents" | "cancelamento_cents" | "mrr_cents" | "arr_cents" | "contratos" | "clientes";
const ROWS: { field: Field; label: string; basis: string; count?: boolean; strong?: boolean }[] = [
  { field: "mrr_inicial_cents", label: "MRR inicial (mês anterior)", basis: "contratos ativos no fim do mês anterior" },
  { field: "novo_cents", label: "+ Novo", basis: "contrato que nunca esteve ativo antes" },
  { field: "expansao_cents", label: "+ Expansão", basis: "mesmo contrato, valor mensal maior" },
  { field: "reativacao_cents", label: "+ Reativação", basis: "esteve ativo antes, ficou pausado/cancelado e voltou" },
  { field: "contracao_cents", label: "− Contração", basis: "mesmo contrato, valor mensal menor" },
  { field: "cancelamento_cents", label: "− Cancelamento", basis: "estava ativo no mês anterior e não está mais (pausa ou cancelamento)" },
  { field: "mrr_cents", label: "MRR final", basis: "soma dos contratos recorrentes ativos no fim do mês", strong: true },
  { field: "arr_cents", label: "ARR", basis: "MRR do mês × 12 (anualizado, não é o recebido em 12 meses)" },
  { field: "contratos", label: "Contratos ativos", basis: "quantidade de contratos no MRR final", count: true },
  { field: "clientes", label: "Clientes recorrentes", basis: "pessoas distintas com contrato ativo. Quem tem contratos nas duas linhas conta em cada uma; o Geral conta a pessoa uma vez — por isso a soma das linhas pode passar do Geral", count: true },
];

/** Quadro do MRR/ARR por linha de negócio (linha do produto do contrato) + conferência contra o relatório consolidado. */
const MrrLineSection = ({ q, line }: { q: UseQueryResult<MrrByLine>; line: LineFilter }) => {
  const d = q.data;
  const cell = (k: string, f: Field) => { const row = k === "total" ? d?.total : d?.lines.find((l) => l.key === k); return row ? Number((row as unknown as Record<string, number>)[f]) : 0; };
  return (
    <section aria-label="Recorrência por linha de negócio" className="mb-8 grid gap-4">
      <h2 className="text-xl">Por linha de negócio</h2>
      <State loading={q.isLoading} error={q.error} />
      {d && (<>
        {d.unclassified_contracts > 0 && (
          <div className="hp-card p-3 text-sm flex gap-2 items-start" role="note">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" style={{ color: "hsl(var(--warning, 38 90% 45%))" }} />
            <p className="text-muted-foreground">{d.unclassified_contracts} contrato(s) ativo(s) sem produto ou com produto ainda <b>não classificado</b> — o MRR deles aparece em “Não classificado”. Classifique o produto em <Link className="text-accent underline" to="/admin/configuracoes">Configurações › Operação</Link>; reclassificar um produto reclassifica todo o histórico dele.</p>
          </div>)}
        <div className="overflow-x-auto hp-card">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border"><th className="p-3 font-medium">Indicador</th>
              {COLS.map((c) => <th key={c.key} className={`p-3 font-medium text-right whitespace-nowrap ${c.key === line ? "text-foreground" : ""}`}>{c.label}</th>)}</tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.field} className={`border-b border-border last:border-0 ${r.strong ? "font-semibold" : ""}`} title={r.basis}>
                  <td className="p-3">{r.label}</td>
                  {COLS.map((c) => { const v = cell(c.key, r.field);
                    return <td key={c.key} className={`p-3 text-right tabular ${c.key === line || (line === "geral" && c.key === "total") ? "font-semibold" : ""} ${!r.count && v < 0 ? "text-destructive" : ""}`}>{r.count ? v.toLocaleString("pt-BR") : brl(v)}</td>; })}
                </tr>))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">A linha do contrato é a do <b>produto</b> do contrato (um contrato tem um só produto, então não há divisão de centavos). MRR é compromisso contratual — não é caixa nem competência de venda. A ponte de cada linha fecha sozinha e a soma das linhas é conferida contra o relatório consolidado.</p>
        <LineConference conference={d.reconciliation} label="Conferência com o MRR consolidado" okText="Conferido: a soma das linhas bate com o MRR consolidado" badText="Divergência entre a soma das linhas e o MRR consolidado — não use estes números até revisar" />
      </>)}
    </section>
  );
};

export default MrrLineSection;
