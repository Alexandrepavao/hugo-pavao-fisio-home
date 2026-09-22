import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { parseCsv } from "@/lib/csv";
import { btnDanger, btnGhost, errText, Msg, PageHead, promptText, State, Table, Td, useMsg } from "@/lib/ui";
import type { Account } from "./shared";

interface Line { id: string; txn_date: string; description: string; amount_cents: number; external_ref: string | null; status: string }
interface Import { id: string; filename: string | null; row_count: number; imported_at: string }
interface Suggestion { payment_id?: string; payable_id?: string; amount_cents: number; paid_at: string; method?: string; person?: string; description?: string }

const HEADERS: Record<string, "date" | "description" | "amount" | "ref"> = {
  data: "date", date: "date", descrição: "description", descricao: "description", description: "description", histórico: "description", historico: "description",
  valor: "amount", amount: "amount", "valor (r$)": "amount", referência: "ref", referencia: "ref", ref: "ref", documento: "ref",
};

/** Conciliação bancária: importa o extrato (CSV) e CASA cada linha com um pagamento/conta a pagar já existente — nunca cria lançamento novo. */
const FinanceReconciliation = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const fileRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState(""); const [busy, setBusy] = useState(false); const [report, setReport] = useState<{ ok: number; bad: string[] } | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ["accounts-rec"], queryFn: async () => (await supabase.from("financial_accounts").select("id, name").eq("active", true)).data as Account[] });
  const imports = useQuery({ queryKey: ["bsi"], queryFn: async () => (await supabase.from("bank_statement_imports").select("id, filename, row_count, imported_at").order("imported_at", { ascending: false }).limit(20)).data as Import[] });
  const lines = useQuery({ queryKey: ["bsl"], queryFn: async () => (await supabase.from("bank_statement_lines").select("id, txn_date, description, amount_cents, external_ref, status").order("txn_date", { ascending: false }).limit(300)).data as Line[] });
  const suggestions = useQuery({ queryKey: ["bsl-sug", openLine], enabled: !!openLine, queryFn: async () => { const { data, error } = await supabase.rpc("bank_reconcile_suggestions", { p_line: openLine }); if (error) throw error; return data as Suggestion[]; } });

  const parseAmount = (raw: string): number | null => {
    const cleaned = raw.trim().replace(/[R$\s]/g, "");
    const norm = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
    const n = Number(norm); return Number.isFinite(n) ? Math.round(n * 100) : null;
  };

  const onFile = async (file: File) => {
    if (!account) { m.err("Selecione a conta antes de enviar o arquivo."); return; }
    setBusy(true); setReport(null);
    const text = await file.text(); const matrix = parseCsv(text);
    if (matrix.length < 2) { setBusy(false); return m.err("Arquivo vazio ou sem cabeçalho."); }
    const map = matrix[0].map((h) => HEADERS[h.trim().toLowerCase()]);
    if (!map.includes("date") || !map.includes("amount")) { setBusy(false); return m.err("Colunas obrigatórias ausentes. Use: data, descrição, valor (e opcionalmente referência)."); }
    const rows: { date: string; description: string; amount_cents: number; ref: string | null }[] = []; const bad: string[] = [];
    matrix.slice(1).forEach((cells, i) => {
      const line = i + 2; const r: Record<string, string> = {};
      map.forEach((k, ci) => { if (k) r[k] = (cells[ci] ?? "").trim(); });
      const d = new Date(r.date); const cents = parseAmount(r.amount ?? "");
      if (Number.isNaN(d.getTime())) return void bad.push(`Linha ${line}: data inválida (${r.date}).`);
      if (cents == null || cents === 0) return void bad.push(`Linha ${line}: valor inválido (${r.amount}).`);
      rows.push({ date: r.date.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : d.toISOString().slice(0, 10), description: r.description || "(sem descrição)", amount_cents: cents, ref: r.ref || null });
    });
    if (rows.length === 0) { setBusy(false); setReport({ ok: 0, bad }); return; }
    const { error } = await supabase.rpc("bank_statement_import", { p_account: account, p_lines: rows });
    setBusy(false);
    if (error) { m.err(errText(error)); return; }
    setReport({ ok: rows.length, bad }); m.ok(`Extrato importado: ${rows.length} linha(s).`);
    void qc.invalidateQueries({ queryKey: ["bsi"] }); void qc.invalidateQueries({ queryKey: ["bsl"] });
    if (fileRef.current) fileRef.current.value = "";
  };

  const confirm = async (line: string, s: Suggestion) => {
    const { error } = await supabase.rpc("bank_reconcile_confirm", { p_line: line, p_payment_id: s.payment_id ?? null, p_payable_id: s.payable_id ?? null });
    if (error) return m.err(errText(error));
    m.ok("Conciliado."); setOpenLine(null); void qc.invalidateQueries({ queryKey: ["bsl"] });
  };
  const ignore = async (line: string) => {
    const reason = await promptText("Ignorar linha do extrato", "Motivo (ex.: transferência entre contas próprias, tarifa)", { confirmLabel: "Ignorar" });
    if (!reason) return;
    const { error } = await supabase.rpc("bank_reconcile_ignore", { p_line: line, p_reason: reason });
    if (error) m.err(errText(error)); else { m.ok("Linha ignorada."); void qc.invalidateQueries({ queryKey: ["bsl"] }); }
  };
  const undo = async (line: string) => {
    const { error } = await supabase.rpc("bank_reconcile_undo", { p_line: line });
    if (error) m.err(errText(error)); else { m.ok("Desfeito."); void qc.invalidateQueries({ queryKey: ["bsl"] }); }
  };

  const unmatched = (lines.data ?? []).filter((l) => l.status === "unmatched");

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Conciliação" hint="Importe o extrato e associe cada linha a um recebimento ou conta a pagar já lançado. A conciliação nunca cria um lançamento novo — só confirma o que já existe no sistema." />
      <Msg m={msg} />
      <div className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-3 items-end">
        <div><label htmlFor="rec-acc" className="block text-xs mb-1">Conta bancária</label><select id="rec-acc" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Selecione…</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label htmlFor="rec-file" className="block text-xs mb-1">Extrato (CSV — colunas: data, descrição, valor, referência opcional)</label>
          <input id="rec-file" ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} /></div>
      </div>
      {report && (
        <div className="hp-card p-3 mb-6 text-sm">
          <p>{report.ok} linha(s) importada(s).</p>
          {report.bad.length > 0 && <ul className="mt-2 text-destructive text-xs list-disc pl-4">{report.bad.slice(0, 20).map((b, i) => <li key={i}>{b}</li>)}</ul>}
        </div>
      )}

      <section className="mb-8"><h2 className="text-xl mb-3">Pendentes de conciliação ({unmatched.length})</h2>
        <State loading={lines.isLoading} error={lines.error} empty={unmatched.length === 0} emptyText="Nada pendente — todas as linhas importadas já foram conciliadas ou ignoradas." />
        {unmatched.length > 0 && <ul className="grid gap-2">
          {unmatched.map((l) => (
            <li key={l.id} className="hp-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{fmtDate(l.txn_date + "T12:00:00Z")} — {l.description} {l.external_ref && <span className="text-muted-foreground">({l.external_ref})</span>}</span>
                <div className="flex items-center gap-2">
                  <span className={`tabular font-medium ${l.amount_cents > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>{brl(l.amount_cents)}</span>
                  <button className={btnGhost + " hp-btn-sm"} onClick={() => setOpenLine(openLine === l.id ? null : l.id)}>{openLine === l.id ? "Fechar" : "Conciliar"}</button>
                  <button className={btnDanger + " hp-btn-sm"} onClick={() => ignore(l.id)}>Ignorar</button>
                </div>
              </div>
              {openLine === l.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <State loading={suggestions.isLoading} error={suggestions.error} empty={suggestions.data?.length === 0} emptyText="Nenhum lançamento com o mesmo valor em ±3 dias. Confira o valor ou registre o recebimento/pagamento primeiro." />
                  {suggestions.data && suggestions.data.length > 0 && <ul className="grid gap-1.5">
                    {suggestions.data.map((s) => (
                      <li key={s.payment_id ?? s.payable_id} className="flex items-center justify-between text-sm bg-muted/50 px-3 py-2">
                        <span>{s.person ?? s.description} — {fmtDate(s.paid_at)} {s.method && `· ${s.method}`}</span>
                        <span className="flex items-center gap-2"><span className="tabular">{brl(s.amount_cents)}</span><button className={btnGhost + " hp-btn-sm"} onClick={() => confirm(l.id, s)}>Confirmar</button></span>
                      </li>
                    ))}
                  </ul>}
                </div>
              )}
            </li>
          ))}
        </ul>}
      </section>

      <section className="mb-8"><h2 className="text-xl mb-3">Conciliadas e ignoradas (últimas)</h2>
        {lines.data && lines.data.filter((l) => l.status !== "unmatched").length > 0 ? (
          <Table head={["Data", "Descrição", "Valor", "Estado", ""]} right={[2]}>
            {lines.data.filter((l) => l.status !== "unmatched").slice(0, 30).map((l) => <tr key={l.id}><Td>{fmtDate(l.txn_date + "T12:00:00Z")}</Td><Td>{l.description}</Td><Td num>{brl(l.amount_cents)}</Td><Td>{l.status === "matched" ? "Conciliada" : "Ignorada"}</Td>
              <Td><button className="text-accent text-sm" onClick={() => undo(l.id)}>Desfazer</button></Td></tr>)}
          </Table>
        ) : <p className="text-sm text-muted-foreground">Nenhuma ainda.</p>}
      </section>

      <section><h2 className="text-xl mb-3">Importações</h2>
        {imports.data && imports.data.length > 0 ? <Table head={["Quando", "Linhas"]} right={[1]}>{imports.data.map((i) => <tr key={i.id}><Td>{fmtDate(i.imported_at)}</Td><Td num>{i.row_count}</Td></tr>)}</Table> : <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>}
      </section>
    </div>
  );
};

export default FinanceReconciliation;
