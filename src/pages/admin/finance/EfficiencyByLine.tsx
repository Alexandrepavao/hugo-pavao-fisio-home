import type { UseQueryResult } from "@tanstack/react-query";
import { brl } from "@/lib/format";
import { State, StatCard, Table, Td } from "@/lib/ui";
import LineConference from "./LineConference";
import type { EffByLine, EffLine } from "./lineReports";
import { BUCKET_LABEL, lineFilterLabel, type LineFilter } from "./lineFilter";

const dash = (v: number | null, f: (n: number) => string) => (v == null ? "indisponível" : f(v));
const pct = (n: number) => `${String(n).replace(".", ",")}%`;
const COLS = [{ key: "physio", label: "HP Fisioterapia" }, { key: "academy", label: "HP Academy" }, { key: "unclassified", label: "Não classificado" }] as const;

const BASIS = {
  net: "recebido no período (caixa), com estornos descontados. Cada pagamento é dividido pela linha dos itens da venda, em centavos exatos — a soma das linhas é o total do Geral",
  patients: "pessoas com venda confirmada no período que contém item da linha. Quem comprou nas duas linhas conta em cada uma; o Geral conta a pessoa uma vez — por isso a soma das linhas pode passar do Geral",
  sessions: "atendimentos realizados no período, pela linha do produto do pacote que a sessão consumiu. Atendimento sem pacote (avulso) fica em “Não classificado”",
  perPatient: "recebido líquido da linha ÷ pacientes pagantes da linha",
  perSession: "recebido líquido da linha ÷ atendimentos realizados da linha. Recebido e sessões do período podem se referir a pacotes diferentes — leia como referência, não como preço de sessão",
  repurchase: "pessoas com mais de uma venda confirmada contendo a linha (histórico) ÷ compradores da linha (%)",
};

/** Eficiência por linha de negócio: cartões da linha escolhida, quadro das linhas lado a lado, concentração por produto e conferência com o Geral. */
const EfficiencyLineSection = ({ q, line }: { q: UseQueryResult<EffByLine>; line: LineFilter }) => {
  const d = q.data;
  const row: EffLine | undefined = d && line !== "geral" ? d.lines.find((l) => l.key === line) : undefined;
  const cur = line === "geral" ? d?.general : row;
  const conc = (d?.concentration ?? []).filter((c) => line === "geral" || c.business_line === line);
  return (
    <section aria-label="Eficiência por linha de negócio" className="mb-8 grid gap-4">
      <h2 className="text-xl">Por linha de negócio — {lineFilterLabel(line)}</h2>
      <State loading={q.isLoading} error={q.error} />
      {d && cur && (<>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Recebido líquido (caixa)" value={brl(cur.net_received_cents)} basis={BASIS.net} />
          <StatCard label="Pacientes pagantes" value={cur.paying_patients.toLocaleString("pt-BR")} basis={BASIS.patients} />
          <StatCard label="Atendimentos realizados" value={cur.attended_sessions.toLocaleString("pt-BR")} basis={BASIS.sessions} />
          <StatCard label="Receita por paciente pagante" value={dash(cur.revenue_per_patient_cents, brl)} basis={BASIS.perPatient} />
          <StatCard label="Receita por sessão realizada" value={dash(cur.revenue_per_session_cents, brl)} basis={BASIS.perSession} />
          <StatCard label="Taxa de recompra" value={dash(cur.repurchase_pct, pct)} basis={BASIS.repurchase} />
        </ul>
        <div className="overflow-x-auto hp-card">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border"><th className="p-3 font-medium">Indicador</th>
              {COLS.map((c) => <th key={c.key} className={`p-3 font-medium text-right whitespace-nowrap ${c.key === line ? "text-foreground" : ""}`}>{c.label}</th>)}
              <th className={`p-3 font-medium text-right ${line === "geral" ? "text-foreground" : ""}`}>Geral</th></tr></thead>
            <tbody>
              {([
                ["Recebido líquido", (r: { net_received_cents: number }) => brl(r.net_received_cents), BASIS.net],
                ["Pacientes pagantes", (r: { paying_patients: number }) => r.paying_patients.toLocaleString("pt-BR"), BASIS.patients],
                ["Atendimentos realizados", (r: { attended_sessions: number }) => r.attended_sessions.toLocaleString("pt-BR"), BASIS.sessions],
                ["Receita por paciente pagante", (r: { revenue_per_patient_cents: number | null }) => dash(r.revenue_per_patient_cents, brl), BASIS.perPatient],
                ["Receita por sessão realizada", (r: { revenue_per_session_cents: number | null }) => dash(r.revenue_per_session_cents, brl), BASIS.perSession],
                ["Taxa de recompra", (r: { repurchase_pct: number | null }) => dash(r.repurchase_pct, pct), BASIS.repurchase],
              ] as [string, (r: EffLine & EffByLine["general"]) => string, string][]).map(([label, fmt, basis]) => (
                <tr key={label} className="border-b border-border last:border-0" title={basis}>
                  <td className="p-3">{label}</td>
                  {COLS.map((c) => { const l = d.lines.find((x) => x.key === c.key); return <td key={c.key} className={`p-3 text-right tabular ${c.key === line ? "font-semibold" : ""}`}>{l ? fmt(l as EffLine & EffByLine["general"]) : "—"}</td>; })}
                  <td className={`p-3 text-right tabular ${line === "geral" ? "font-semibold" : ""}`}>{fmt(d.general as EffLine & EffByLine["general"])}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <section><h3 className="text-lg mb-2">Concentração de receita por produto — {lineFilterLabel(line)}</h3>
          <State empty={conc.length === 0} emptyText="Sem recebimentos de produtos desta linha no período." />
          {conc.length > 0 && <Table head={["Produto", "Linha", "Recebido", "Participação na linha"]} right={[2, 3]}>
            {conc.map((c) => <tr key={c.product_name + c.business_line}><Td>{c.product_name}</Td><Td>{BUCKET_LABEL[c.business_line] ?? c.business_line}</Td><Td num>{brl(c.received_cents)}</Td><Td num>{c.share_pct_of_line == null ? "—" : `${c.share_pct_of_line}%`}</Td></tr>)}</Table>}
        </section>
        <p className="text-[11px] leading-4 text-muted-foreground">A linha só atribui os valores: recebido é caixa, sessões são atendimentos realizados, recompra usa o histórico completo. Só o que é somável (recebido e atendimentos) é conferido contra o Geral; pessoas não somam porque um paciente pode estar nas duas linhas. CAC, LTV e prazo de recuperação continuam indisponíveis (sem dados de investimento em mídia) e não são divididos por linha.</p>
        <LineConference conference={d.reconciliation} label="Conferência com o Geral" okText="Conferido: o total das linhas bate com o Geral" badText="Divergência entre o total das linhas e o Geral — não use estes números até revisar" countMetrics={["Atendimentos realizados (quantidade)"]} />
      </>)}
    </section>
  );
};

export default EfficiencyLineSection;
