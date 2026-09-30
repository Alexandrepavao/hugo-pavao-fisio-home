import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { brl } from "@/lib/format";
import { FilterBar, FilterField, State } from "@/lib/ui";
import LineConference from "./LineConference";
import { useBankByLine } from "./lineReports";
import { iso, monthStart, type Account } from "./shared";

/** Movimentos bancários por linha de negócio (data do extrato). Não substitui o Financeiro por linha (competência/caixa de vendas e contas):
 *  aqui é o que passou pela conta, com a linha vinda do lançamento conciliado ou da alocação manual. Entradas e saídas ficam separadas. */
const BankByLine = ({ accounts }: { accounts: Account[] | undefined }) => {
  const today = new Date();
  const [from, setFrom] = useState(iso(monthStart(today)));
  const [to, setTo] = useState(iso(today));
  const [account, setAccount] = useState("");
  const toExclusive = (() => { const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const q = useBankByLine(from, toExclusive, "", account);
  const d = q.data;

  return (
    <section aria-label="Movimentos bancários por linha de negócio" className="mb-8">
      <h2 className="text-xl mb-1">Movimentos bancários por linha de negócio</h2>
      <p className="text-sm text-muted-foreground mb-3">O extrato importado continua exatamente como veio do banco. A linha de negócio é uma camada separada: movimento conciliado herda a linha do recebimento ou da conta paga; pendente ou ignorado pode receber alocação manual; sem nenhuma das duas fica em “Não classificado”.</p>
      <FilterBar>
        <FilterField label="De" htmlFor="bbl-from"><input id="bbl-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></FilterField>
        <FilterField label="Até" htmlFor="bbl-to"><input id="bbl-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></FilterField>
        <FilterField label="Conta bancária" htmlFor="bbl-acc"><select id="bbl-acc" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Todas</option>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></FilterField>
      </FilterBar>
      <State loading={q.isLoading} error={q.error} />
      {d && (<div className="grid gap-4">
        <div className="hp-card p-3 text-sm" role="status" aria-label="Situação do extrato no período">
          <p><b>{d.statement.movements}</b> movimento(s) no período: <b>{d.statement.matched}</b> conciliado(s), <b>{d.statement.ignored}</b> ignorado(s), <b>{d.statement.unmatched}</b> pendente(s).</p>
          {d.unallocated_movements > 0 && <p className="mt-1 flex gap-2 items-start text-muted-foreground"><AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" style={{ color: "hsl(var(--warning, 38 90% 45%))" }} />{d.unallocated_movements} movimento(s) sem linha de negócio (nem conciliado nem alocado) — aparecem em “Não classificado”.</p>}
        </div>
        <div className="overflow-x-auto hp-card">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="p-3 font-medium">Linha</th><th className="p-3 font-medium text-right">Entradas</th><th className="p-3 font-medium text-right">Saídas</th><th className="p-3 font-medium text-right">Saldo líquido</th>
              <th className="p-3 font-medium text-right">Movimentos</th><th className="p-3 font-medium text-right" title="Movimentos cuja linha vem de um recebimento ou conta paga conciliados">Via lançamento</th><th className="p-3 font-medium text-right">Alocação manual</th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.key} className="border-b border-border">
                  <td className="p-3">{l.label}</td>
                  <td className="p-3 text-right tabular text-[hsl(var(--success))]">{brl(l.inflow_cents)}</td>
                  <td className="p-3 text-right tabular text-destructive">{brl(l.outflow_cents)}</td>
                  <td className={`p-3 text-right tabular ${l.net_cents < 0 ? "text-destructive" : ""}`}>{brl(l.net_cents)}</td>
                  <td className="p-3 text-right tabular">{l.movements}</td><td className="p-3 text-right tabular">{l.from_entries}</td><td className="p-3 text-right tabular">{l.manual_allocations}</td>
                </tr>))}
              <tr className="font-semibold">
                <td className="p-3">Geral (extrato)</td>
                <td className="p-3 text-right tabular">{brl(d.total.inflow_cents)}</td><td className="p-3 text-right tabular">{brl(d.total.outflow_cents)}</td><td className={`p-3 text-right tabular ${d.total.net_cents < 0 ? "text-destructive" : ""}`}>{brl(d.total.net_cents)}</td>
                <td className="p-3 text-right tabular">{d.statement.movements}</td><td /><td />
              </tr>
            </tbody>
          </table>
        </div>
        <LineConference conference={d.reconciliation} label="Conferência com o extrato original" okText="Conferido: a soma das linhas bate com o extrato importado" badText="Divergência entre a soma das linhas e o extrato importado — não use estes números até revisar" />
      </div>)}
    </section>
  );
};

export default BankByLine;
