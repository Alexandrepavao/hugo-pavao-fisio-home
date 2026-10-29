import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { brl, newKey } from "@/lib/format";
import { parseCsv } from "@/lib/csv";
import { Badge, EmptyState, Msg, PageHead, State, Table, Tabs, Td, btnGhost, btnPrimary, errText, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtYmd, pfRpc, todayYmd } from "./pf";
import { CategorySelect, MoneyInput, centsToInput, useInvalidatePf, usePfRefs } from "./PfShared";

type DateFmt = "dmy" | "ymd"; type NumFmt = "br" | "us"; type SignMode = "signed" | "inverted" | "split";
/** "dd/mm/aaaa" ou "aaaa-mm-dd" → "AAAA-MM-DD" (sem fuso) ou null. */
export const parseDateCell = (s: string, f: DateFmt): string | null => {
  const t = s.trim(); let y = "", m = "", d = "";
  if (f === "ymd") { const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (!x) return null; [, y, m, d] = x; }
  else { const x = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t); if (!x) return null; d = x[1].padStart(2, "0"); m = x[2].padStart(2, "0"); y = x[3].length === 2 ? `20${x[3]}` : x[3]; }
  const dt = new Date(`${y}-${m}-${d}T12:00:00Z`); return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== `${y}-${m}-${d}` ? null : `${y}-${m}-${d}`;
};
/** Valor em texto → centavos inteiros COM sinal (parênteses e "-" no fim contam como negativo); nunca usa ponto flutuante. */
export const parseAmountCell = (s: string, f: NumFmt): number | null => {
  let t = s.trim().replace(/[R$\s]/g, ""); if (!t) return null; let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); } if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); } if (t.startsWith("-")) { neg = true; t = t.slice(1); } if (t.startsWith("+")) t = t.slice(1);
  t = f === "br" ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const x = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t); if (!x) return null;
  const c = Number(x[1]) * 100 + Number((x[2] ?? "").padEnd(2, "0") || 0); return neg ? -c : c;
};

interface PLine { id: string; row_no: number; line_date: string | null; description: string | null; amount_cents: number | null; status: "new" | "duplicate" | "invalid" | "matched" | "imported" | "ignored"; error: string | null; suggestion: { type: "entry" | "virtual"; description: string; due_date?: string; occurrence_date?: string } | null }
type Decision = "match" | "create" | "ignore" | "later";

const PfImport = () => {
  const [sp, setSp] = useSearchParams(); const tab = sp.get("aba") === "retiradas" ? "retiradas" : "extrato";
  const setTab = (v: string) => { const n = new URLSearchParams(sp); if (v === "retiradas") n.set("aba", v); else n.delete("aba"); setSp(n, { replace: true }); };
  return (
    <div>
      <PageHead eyebrow="Finanças pessoais" title="Importação e conciliação" hint="Importe o extrato de uma conta PESSOAL (nunca de conta da empresa), veja a prévia, decida linha a linha e confirme. Associar a linha a um lançamento previsto liquida esse lançamento — não cria despesa nova. Não há conexão bancária automática." />
      <Tabs tabs={[["extrato", "Extrato da conta"], ["retiradas", "Retiradas da empresa"]]} value={tab} onChange={setTab} />
      {tab === "extrato" ? <StatementImport /> : <Withdrawals />}
    </div>
  );
};

const StatementImport = () => {
  const refs = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg();
  const [acc, setAcc] = useState(""); const [text, setText] = useState(""); const [fileName, setFileName] = useState("");
  const [cDate, setCDate] = useState(-1); const [cDesc, setCDesc] = useState(-1); const [cAmt, setCAmt] = useState(-1); const [cDebit, setCDebit] = useState(-1); const [dfmt, setDfmt] = useState<DateFmt>("dmy"); const [nfmt, setNfmt] = useState<NumFmt>("br"); const [sign, setSign] = useState<SignMode>("signed");
  const [prev, setPrev] = useState<{ import_id: string; counts: Record<string, number>; lines: PLine[] } | null>(null); const [dec, setDec] = useState<Record<string, Decision>>({}); const [cat, setCat] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState<Record<string, number> | null>(null);
  const matrix = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]); const header = matrix[0] ?? []; const body = matrix.slice(1);
  const autoMap = (h: string[]) => { const f = (...k: string[]) => h.findIndex((x) => k.some((kk) => x.trim().toLowerCase().includes(kk))); setCDate(f("data", "date")); setCDesc(f("descri", "hist", "memo", "lançamento", "lancamento")); setCAmt(f("valor", "amount")); setCDebit(f("débito", "debito")); };
  const onFile = async (f: File | undefined) => { if (!f) return; if (f.size > 2 * 1024 * 1024) return m.err("O arquivo passa de 2 MB."); const t = await f.text(); setFileName(f.name); setText(t); setPrev(null); setDone(null); const mx = parseCsv(t); if (mx[0]) autoMap(mx[0]); };
  const rows = useMemo(() => body.map((r, i) => {
    const date = cDate >= 0 ? parseDateCell(r[cDate] ?? "", dfmt) : null; const desc = cDesc >= 0 ? (r[cDesc] ?? "").trim() : "";
    let cents: number | null = null;
    if (sign === "split") { const deb = cDebit >= 0 ? parseAmountCell(r[cDebit] ?? "", nfmt) : null; const cre = cAmt >= 0 ? parseAmountCell(r[cAmt] ?? "", nfmt) : null; cents = deb ? -Math.abs(deb) : cre ? Math.abs(cre) : null; }
    else { const v = cAmt >= 0 ? parseAmountCell(r[cAmt] ?? "", nfmt) : null; cents = v == null ? null : sign === "inverted" ? -v : v; }
    return { row: i + 2, date, desc, cents };
  }), [body, cDate, cDesc, cAmt, cDebit, dfmt, nfmt, sign]);
  const invalid = rows.filter((r) => !r.date || !r.desc || r.cents == null || r.cents === 0).length;

  const preview = async () => {
    if (!acc) return m.err("Escolha a conta pessoal que recebe o extrato."); if (cDate < 0 || cDesc < 0 || cAmt < 0) return m.err("Indique as colunas de data, descrição e valor.");
    setBusy(true); setDone(null);
    try {
      const p = await pfRpc<{ import_id: string; counts: Record<string, number>; lines: PLine[] }>("pf_import_preview", { p_account: acc, p_filename: fileName || "colado", p_rows: rows.map((r) => ({ date: r.date ?? "invalido", description: r.desc, amount_cents: r.cents ?? 0 })) });
      setPrev(p); setDec(Object.fromEntries(p.lines.filter((l) => l.status === "new").map((l) => [l.id, (l.suggestion ? "match" : "later") as Decision])));
    } catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!prev) return; const decisions = Object.entries(dec).filter(([, d]) => d !== "later").map(([line_id, action]) => ({ line_id, action, ...(action === "create" && cat ? { category_id: cat } : {}) }));
    if (decisions.length === 0) return m.err("Nenhuma linha foi decidida (todas estão em “deixar para depois”).");
    setBusy(true);
    try { const r = await pfRpc<Record<string, number>>("pf_import_confirm", { p_import: prev.import_id, p_decisions: decisions }); setDone(r); setPrev(null); setText(""); invalidate(); }
    catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  const lines = prev?.lines ?? []; const sel = (id: string) => dec[id] ?? "later";
  const acts = Object.values(dec).reduce<Record<string, number>>((a, d) => ({ ...a, [d]: (a[d] ?? 0) + 1 }), {});

  return (<>
    <Msg m={msg} />
    {done && <p className="mb-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm" role="status" data-testid="pf-import-resultado">Importação confirmada: {done.matched} conciliada(s), {done.created} criada(s), {done.ignored} ignorada(s), {done.pending} ainda pendente(s).</p>}
    {!prev && (
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="im-acc" className="block text-xs mb-1">Conta pessoal do extrato</label><select id="im-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Escolha…</option>{refs.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label htmlFor="im-file" className="block text-xs mb-1">Arquivo CSV do extrato (até 2 MB)</label><input id="im-file" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} /></div>
        </div>
        <div><label htmlFor="im-text" className="block text-xs mb-1">…ou cole o conteúdo do CSV (com a linha de cabeçalho)</label><textarea id="im-text" rows={4} value={text} onChange={(e) => { setText(e.target.value); setPrev(null); if (e.target.value) { const mx = parseCsv(e.target.value); if (mx[0]) autoMap(mx[0]); } }} className="font-mono text-xs" placeholder={"Data;Descrição;Valor\n05/10/2026;PIX INTERNET;-129,90"} /></div>
        {header.length > 0 && (
          <section className="hp-card p-4 grid gap-3" data-testid="pf-import-mapeamento"><h3 className="text-sm font-medium">Mapeamento das colunas</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {([["Data", cDate, setCDate, "im-c-date"], ["Descrição", cDesc, setCDesc, "im-c-desc"], [sign === "split" ? "Crédito (entrada)" : "Valor", cAmt, setCAmt, "im-c-amt"]] as const).map(([l, v, set, id]) => (
                <div key={id}><label htmlFor={id} className="block text-xs mb-1">{l}</label><select id={id} value={v} onChange={(e) => set(Number(e.target.value))}><option value={-1}>Escolha…</option>{header.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}</select></div>))}
              {sign === "split" && <div><label htmlFor="im-c-deb" className="block text-xs mb-1">Débito (saída)</label><select id="im-c-deb" value={cDebit} onChange={(e) => setCDebit(Number(e.target.value))}><option value={-1}>Escolha…</option>{header.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}</select></div>}
              <div><label htmlFor="im-dfmt" className="block text-xs mb-1">Formato da data</label><select id="im-dfmt" value={dfmt} onChange={(e) => setDfmt(e.target.value as DateFmt)}><option value="dmy">dd/mm/aaaa</option><option value="ymd">aaaa-mm-dd</option></select></div>
              <div><label htmlFor="im-nfmt" className="block text-xs mb-1">Formato do número</label><select id="im-nfmt" value={nfmt} onChange={(e) => setNfmt(e.target.value as NumFmt)}><option value="br">1.234,56 (Brasil)</option><option value="us">1,234.56</option></select></div>
              <div><label htmlFor="im-sign" className="block text-xs mb-1">Sinal do valor</label><select id="im-sign" value={sign} onChange={(e) => setSign(e.target.value as SignMode)}><option value="signed">Negativo = saída</option><option value="inverted">Positivo = saída</option><option value="split">Colunas separadas de débito e crédito</option></select></div>
            </div>
            <div><p className="text-xs text-muted-foreground mb-1">Como o sistema entendeu as primeiras linhas ({rows.length} no arquivo{invalid ? `, ${invalid} com problema` : ""}):</p>
              <Table head={["Linha", "Data", "Descrição", "Valor"]} right={[3]}>{rows.slice(0, 6).map((r) => <tr key={r.row}><Td>{r.row}</Td><Td>{r.date ? fmtYmd(r.date) : <span className="text-destructive">inválida</span>}</Td><Td>{r.desc || <span className="text-destructive">vazia</span>}</Td><Td num>{r.cents != null ? brl(r.cents) : <span className="text-destructive">inválido</span>}</Td></tr>)}</Table></div>
            <div><button type="button" className={btnPrimary} onClick={() => void preview()} disabled={busy || rows.length === 0}>{busy ? "Analisando…" : "Gerar prévia (nada é gravado ainda)"}</button></div>
          </section>)}
      </div>)}

    {prev && (<>
      <p className="text-sm mb-2" data-testid="pf-import-contagem">Prévia: <strong>{prev.counts.new ?? 0}</strong> nova(s) · <strong>{prev.counts.duplicate ?? 0}</strong> já importada(s) (duplicadas) · <strong>{prev.counts.invalid ?? 0}</strong> inválida(s). Nada foi gravado: escolha o que fazer com cada linha e confirme.</p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => setDec(Object.fromEntries(lines.filter((l) => l.status === "new").map((l) => [l.id, (l.suggestion ? "match" : sel(l.id)) as Decision])))}>Associar todas as sugeridas</button>
        <div><label htmlFor="im-cat" className="sr-only">Categoria para as linhas novas</label><CategorySelect id="im-cat" kind="expense" cats={refs.cats} value={cat} onChange={setCat} label="Categoria das linhas criadas (despesas)" /></div>
      </div>
      <Table head={["#", "Data", "Descrição", "Valor", "Situação / sugestão", "O que fazer"]} right={[3]}>
        {lines.map((l) => (
          <tr key={l.id} data-testid="pf-import-linha" data-status={l.status}><Td>{l.row_no}</Td><Td>{l.line_date ? fmtYmd(l.line_date) : "—"}</Td><Td>{l.description ?? "—"}</Td><Td num><span className={(l.amount_cents ?? 0) > 0 ? "text-success" : ""}>{l.amount_cents != null ? brl(l.amount_cents) : "—"}</span></Td>
            <Td>{l.status === "invalid" ? <Badge tone="danger">{l.error ?? "Inválida"}</Badge> : l.status === "duplicate" ? <Badge tone="warning">Já importada</Badge> : l.suggestion ? <span className="text-xs"><Badge tone="success">Sugestão</Badge> {l.suggestion.description}{l.suggestion.type === "virtual" ? " (recorrência)" : ""}</span> : <span className="text-xs text-muted-foreground">sem correspondência</span>}</Td>
            <Td>{l.status === "new" ? <select aria-label={`Ação da linha ${l.row_no}`} value={sel(l.id)} onChange={(e) => setDec({ ...dec, [l.id]: e.target.value as Decision })} className="!h-8 text-xs"><option value="later">Deixar para depois</option>{l.suggestion && <option value="match">Associar e liquidar</option>}<option value="create">Criar lançamento já liquidado</option><option value="ignore">Ignorar</option></select> : "—"}</Td></tr>))}
      </Table>
      <div className="flex flex-wrap items-center gap-3 mt-4"><button type="button" className={btnPrimary} onClick={() => void confirm()} disabled={busy}>{busy ? "Aplicando…" : "Confirmar decisões"}</button><button type="button" className={btnGhost} onClick={() => { void pfRpc("pf_import_cancel", { p_import: prev.import_id }).catch(() => undefined); setPrev(null); }}>Cancelar importação</button>
        <span className="text-xs text-muted-foreground">{acts.match ?? 0} associar · {acts.create ?? 0} criar · {acts.ignore ?? 0} ignorar · tudo ou nada: se uma linha falhar, nada é aplicado.</span></div>
    </>)}
  </>);
};

interface WRow { payable_id: string; description: string; supplier: string | null; amount_cents: number; paid_at: string | null; unit: string; category: string | null; link_id: string | null; link_status: "pending" | "linked" | null; looks_like_withdrawal: boolean }
const Withdrawals = () => {
  const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [dlg, setDlg] = useState<WRow | null>(null);
  const q = useQuery({ queryKey: ["pf", "withdrawals"], queryFn: () => pfRpc<{ payables: WRow[] }>("pf_business_withdrawals") });
  const links = useQuery({ queryKey: ["pf", "links"], queryFn: () => pfRpc<{ links: { id: string; status: string; payable_id: string; entry_description: string | null }[] }>("pf_business_links_list") });
  const mark = async (r: WRow) => { try { await pfRpc("pf_link_business_withdrawal", { p_payable: r.payable_id, p_entry: null, p_create: null, p_key: `pf-pend-${r.payable_id}` }); invalidate(); m.ok("Pendência registrada: falta apontar a entrada pessoal."); } catch (err) { m.err(errText(err as { message: string })); } };
  return (<>
    <Msg m={msg} />
    <p className="text-sm text-muted-foreground mb-3">Vincule uma retirada JÁ PAGA no financeiro da empresa a uma entrada pessoal. Exige acesso nos dois contextos. O lado empresarial não é alterado nem reclassificado; cada lado mantém os próprios lançamentos, com rastreabilidade do vínculo. Repetir a operação não duplica nada.</p>
    <State loading={q.isLoading} error={q.error} />
    {q.data && q.data.payables.length === 0 && <EmptyState title="Nenhuma retirada paga encontrada">Aparecem aqui contas pagas do financeiro da empresa com categoria ou descrição de retirada, pró-labore, distribuição ou reembolso (e só as unidades em que você tem acesso financeiro).</EmptyState>}
    {q.data && q.data.payables.length > 0 && (
      <Table head={["Retirada (empresa)", "Unidade", "Valor", "Paga em", "Vínculo pessoal", ""]} right={[2]}>
        {q.data.payables.map((r) => (
          <tr key={r.payable_id} data-testid="pf-retirada"><Td><strong>{r.description}</strong><div className="text-xs text-muted-foreground">{r.category ?? "sem categoria"}</div></Td><Td>{r.unit}</Td><Td num>{brl(r.amount_cents)}</Td><Td>{r.paid_at ? fmtYmd(r.paid_at.slice(0, 10)) : "—"}</Td>
            <Td>{r.link_status === "linked" ? <Badge tone="success">Vinculada</Badge> : r.link_status === "pending" ? <Badge tone="warning">Pendente</Badge> : <Badge>Sem vínculo</Badge>}</Td>
            <Td>{r.link_status !== "linked" && <span className="flex gap-1 flex-wrap"><button type="button" className={btnPrimary + " hp-btn-sm"} onClick={() => setDlg(r)}>Registrar entrada pessoal</button>{!r.link_status && <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void mark(r)}>Marcar como pendente</button>}</span>}</Td></tr>))}
      </Table>)}
    {links.data && links.data.links.length > 0 && <p className="text-xs text-muted-foreground mt-3">{links.data.links.length} vínculo(s) no histórico ({links.data.links.filter((l) => l.status === "pending").length} pendente(s)).</p>}
    {dlg && <WithdrawalDialog row={dlg} onClose={() => setDlg(null)} />}
  </>);
};

const WithdrawalDialog = ({ row, onClose }: { row: WRow; onClose: () => void }) => {
  const refs = usePfRefs(); const invalidate = useInvalidatePf(); const [msg, m] = useMsg(); const [acc, setAcc] = useState(""); const [cat, setCat] = useState(""); const [date, setDate] = useState(row.paid_at?.slice(0, 10) ?? todayYmd()); const [key] = useState(() => newKey("pfw")); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!acc) return m.err("Escolha a conta que recebeu.");
    setBusy(true);
    try { await pfRpc("pf_link_business_withdrawal", { p_payable: row.payable_id, p_entry: null, p_create: { account_id: acc, category_id: cat || null, date }, p_key: key }); invalidate(); onClose(); }
    catch (err) { m.err(errText(err as { message: string })); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="sm:max-w-md" data-testid="pf-retirada-dialog">
      <DialogHeader><DialogTitle>Registrar entrada pessoal</DialogTitle><DialogDescription>Cria uma receita pessoal de {brl(row.amount_cents)} (já recebida) e a vincula a “{row.description}”. O lado da empresa não muda.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3" noValidate><Msg m={msg} />
        <div className="grid grid-cols-2 gap-3"><div><label htmlFor="wd-acc" className="block text-xs mb-1">Conta que recebeu</label><select id="wd-acc" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Escolha…</option>{refs.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div><label htmlFor="wd-date" className="block text-xs mb-1">Data do recebimento</label><input id="wd-date" type="date" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
        <CategorySelect id="wd-cat" kind="income" cats={refs.cats} value={cat} onChange={setCat} />
        <MoneyInput id="wd-val" value={centsToInput(row.amount_cents)} onChange={() => undefined} label="Valor (igual ao da retirada)" />
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy ? "Vinculando…" : "Criar entrada e vincular"}</button></DialogFooter></form>
    </DialogContent></Dialog>
  );
};
export default PfImport;
