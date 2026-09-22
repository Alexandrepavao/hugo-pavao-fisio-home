import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseCsv, validateImport, type ImportIssue, type ImportRow } from "@/lib/csv";
import { download, toCsv } from "@/lib/format";
import { Badge } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Unit { id: string; name: string }
type Check = { idx: number; duplicate: boolean; reason?: string; existing?: string | null };
type Result = { idx: number; status: "created" | "duplicate" | "error"; message?: string };

/** Importação em 3 passos: arquivo → prévia com validação/duplicidades → relatório. Nada é gravado antes da confirmação. */
const ImportDialog = ({ open, onOpenChange, units, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; units: Unit[]; onDone: () => void }) => {
  const [unit, setUnit] = useState(""); const [rows, setRows] = useState<ImportRow[]>([]); const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [checks, setChecks] = useState<Check[]>([]); const [force, setForce] = useState<Set<number>>(new Set()); const [results, setResults] = useState<Result[] | null>(null);
  const [fatal, setFatal] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [fileName, setFileName] = useState("");

  const reset = () => { setRows([]); setIssues([]); setChecks([]); setForce(new Set()); setResults(null); setFatal(null); setFileName(""); };
  const onFile = async (f: File | undefined) => {
    reset(); if (!f) return; setFileName(f.name);
    if (f.size > 1_000_000) return setFatal("Arquivo muito grande (limite 1 MB).");
    const v = validateImport(parseCsv(await f.text()));
    if (v.fatal) return setFatal(v.fatal);
    setRows(v.rows); setIssues(v.issues);
    if (v.rows.length) {
      setBusy(true);
      const { data, error } = await supabase.rpc("import_people_check", { p_rows: v.rows.map(({ name, email, phone, kind }) => ({ name, email, phone, kind })) });
      setBusy(false); if (error) return setFatal("Não foi possível verificar duplicidades (verifique sua permissão)."); setChecks(data as Check[]);
    }
  };
  const dupCount = checks.filter((c) => c.duplicate).length;
  const commit = async () => {
    if (!unit) return setFatal("Selecione a unidade de destino."); setBusy(true); setFatal(null);
    const { data, error } = await supabase.rpc("import_people_commit", { p_unit: unit, p_rows: rows.map(({ name, email, phone, kind }) => ({ name, email, phone, kind })), p_force_idx: [...force] });
    setBusy(false); if (error) return setFatal("Falha ao importar. Nada foi confirmado; tente novamente."); setResults(data as Result[]); onDone();
  };
  const report = () => {
    const out = [
      ...issues.map((i) => ({ linha: i.line, resultado: "erro de validação", detalhe: i.message })),
      ...(results ?? []).filter((r) => r.status !== "created").map((r) => ({ linha: rows[r.idx]?.line, resultado: r.status === "duplicate" ? "duplicada (não importada)" : "erro", detalhe: r.message ?? "possível cadastro existente" })),
    ]; download(`relatorio-importacao-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out.length ? out : [{ linha: "", resultado: "sem pendências", detalhe: "" }]));
  };
  const created = results?.filter((r) => r.status === "created").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar pessoas (CSV)</DialogTitle><DialogDescription>Colunas: <b>nome</b>, email, telefone, tipo (lead, paciente, aluno, parceiro, contato). Até 500 linhas. Duplicidades nunca são importadas sem sua decisão.</DialogDescription></DialogHeader>
        {!results && (<>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="imp-f" className="block mb-1">Arquivo .csv</label><input id="imp-f" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />{fileName && <p className="text-xs text-muted-foreground mt-1">{fileName}</p>}</div>
            <div><label htmlFor="imp-u" className="block mb-1">Unidade de destino *</label><select id="imp-u" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Selecione…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          </div>
          {fatal && <p role="alert" className="text-sm text-destructive">{fatal}</p>}
          {(rows.length > 0 || issues.length > 0) && (
            <div className="grid gap-3">
              <p className="text-sm flex flex-wrap gap-2 items-center"><Badge tone="success">{rows.length - dupCount} prontas</Badge><Badge tone="warning">{dupCount} possíveis duplicidades</Badge><Badge tone="danger">{issues.length} com erro</Badge></p>
              {issues.length > 0 && <ul className="text-sm rounded-md border border-border p-3 max-h-32 overflow-y-auto" aria-label="Erros de validação">{issues.map((i) => <li key={i.line}>Linha {i.line}: {i.message}</li>)}</ul>}
              <div className="hp-card overflow-auto max-h-64"><table className="w-full text-sm"><thead><tr className="text-left text-xs bg-muted/60"><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Contato</th><th className="px-3 py-2">Situação</th></tr></thead>
                <tbody>{rows.map((r, i) => { const c = checks[i]; return (
                  <tr key={r.line} className="border-t border-border"><td className="px-3 py-1.5">{r.line}</td><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-muted-foreground">{r.email || r.phone}</td>
                    <td className="px-3 py-1.5">{c?.duplicate ? <label className="flex items-center gap-2 !font-normal"><input type="checkbox" checked={force.has(i)} onChange={(e) => setForce((s) => { const n = new Set(s); e.target.checked ? n.add(i) : n.delete(i); return n; })} /><span>Possível duplicidade{c.existing ? ` de “${c.existing}”` : ""} — importar mesmo assim</span></label> : <Badge tone="success">OK</Badge>}</td></tr>); })}</tbody></table></div>
            </div>)}
        </>)}
        {results && (
          <div className="grid gap-2 text-sm"><p role="status"><b>{created}</b> pessoa(s) importada(s); <b>{results.filter((r) => r.status === "duplicate").length}</b> puladas por duplicidade; <b>{results.filter((r) => r.status === "error").length}</b> com erro no servidor; <b>{issues.length}</b> descartadas na validação.</p>
            <button className="hp-btn hp-btn-outline w-fit" onClick={report}>Baixar relatório (CSV)</button></div>)}
        <DialogFooter>
          <button className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>{results ? "Fechar" : "Cancelar"}</button>
          {!results && <button className="hp-btn hp-btn-primary" disabled={busy || rows.length === 0 || !unit} onClick={commit}>{busy ? "Processando…" : `Importar ${rows.length - dupCount + force.size} pessoa(s)`}</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default ImportDialog;
