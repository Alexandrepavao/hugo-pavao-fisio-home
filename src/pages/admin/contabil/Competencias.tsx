import { Link, useNavigate } from "react-router-dom";
import { Badge, PageHead, State, Table, Td } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import AccScopeBar from "./AccScopeBar";
import { StatusBadge } from "./accShared";
import { fmtMonth, useAccQuery, useAccScope, type PeriodStatus } from "./accLib";
import type { Metrics } from "./AccDashboard";

interface Row { month: string; status: PeriodStatus; in_progress: boolean; closed_at: string | null; closed_by: string | null; reopened_at: string | null; close_seq: number; metrics: Metrics; has_data: boolean }

/** Competências: os últimos 13 meses da unidade, com situação e pendências de cada um. Abrir leva ao fechamento. */
const Competencias = () => {
  const navigate = useNavigate();
  const { unit, month, setMonth, link } = useAccScope();
  const q = useAccQuery<Row[]>("acc_periods_overview", { p_unit: unit.id }, ["overview", unit.id]);
  const open = (m: string, path: string) => { setMonth(m); navigate(`${path}?u=${unit.id}&m=${m}`); };
  return (
    <div>
      <PageHead eyebrow="Contábil" title="Competências" hint="Cada mês da unidade tem sua própria situação: aberta, em revisão ou fechada. O mês em andamento não pode ser fechado." />
      <AccScopeBar />
      <State loading={q.isLoading} error={q.error} />
      {q.data && (
        <Table head={["Competência", "Situação", "Lançamentos", "Sem classificação", "Sem comprovante", "Alterações após fechar", "Documentos", "Fechamento", ""]} right={[2, 3, 4, 5, 6]}>
          {q.data.map((r) => (
            <tr key={r.month} className={r.month === month ? "bg-muted/40" : undefined} data-month={r.month}>
              <Td><button className="font-medium hover:underline" onClick={() => setMonth(r.month)} aria-label={`Selecionar competência ${fmtMonth(r.month)}`}>{fmtMonth(r.month)}</button>{r.in_progress && <> <Badge tone="warning">em andamento</Badge></>}</Td>
              <Td><StatusBadge status={r.status} />{r.reopened_at && r.status !== "closed" && <span className="text-xs text-muted-foreground ml-1" title={`Reaberta em ${fmtDateTime(r.reopened_at)}`}>reaberta</span>}</Td>
              <Td num>{r.has_data ? r.metrics.entries_comp : "—"}</Td>
              <Td num className={r.metrics.unclassified ? "text-destructive font-medium" : undefined}>{r.has_data ? r.metrics.unclassified : "—"}</Td>
              <Td num className={r.metrics.missing_receipt ? "text-destructive font-medium" : undefined}>{r.has_data ? r.metrics.missing_receipt : "—"}</Td>
              <Td num className={r.metrics.changes_after_close ? "text-destructive font-medium" : undefined}>{r.status === "closed" ? r.metrics.changes_after_close : "—"}</Td>
              <Td num>{r.metrics.documents || "—"}</Td>
              <Td>{r.status === "closed" ? `${fmtDateTime(r.closed_at)} · ${r.closed_by ?? "—"} (v${r.close_seq})` : "—"}</Td>
              <Td><div className="flex gap-2 justify-end"><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => open(r.month, "/admin/contabil/lancamentos")}>Lançamentos</button><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => open(r.month, "/admin/contabil/fechamentos")}>Fechamento</button></div></Td>
            </tr>))}
        </Table>)}
      <p className="text-xs text-muted-foreground mt-3">Meses sem lançamentos aparecem com “—”. <Link className="underline" to={link("/admin/contabil/fechamentos")}>Ir para o fechamento da competência selecionada</Link>.</p>
    </div>
  );
};
export default Competencias;
