import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseCsvWithLines } from "@/lib/csv";
import { download, toCsv } from "@/lib/format";
import { applyMapping, autoMap, duplicateMapped, missingRequired, OUTCOME_LABEL, PJ_FIELDS, templateCsv, type PjMapping, type PjOutcome, type PjRowInput } from "@/lib/pjImport";
import { Badge, errText, type Tone } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Unit { id: string; name: string }
interface Diff { field: string; label: string; current: string | null; incoming: string; kind: "fill" | "overwrite" }
interface Check { idx: number; line: number; cnpj: string | null; legal_name: string | null; status: "new" | "unchanged" | "conflict" | "archived" | "invalid" | "duplicate_in_file"; messages: string[]; existing_name: string | null; diffs: Diff[] }
interface ReportLine { idx: number; line: number; cnpj: string | null; legal_name: string | null; outcome: PjOutcome; message: string | null }
interface CommitResult { batch_id: string; totals: Record<PjOutcome, number>; report: ReportLine[] }

const STATUS: Record<Check["status"], { label: string; tone: Tone }> = {
  new: { label: "Nova", tone: "success" }, unchanged: { label: "Já cadastrada, sem alteração", tone: "neutral" },
  conflict: { label: "CNPJ já cadastrado, dados diferentes", tone: "warning" }, archived: { label: "Cadastro arquivado", tone: "warning" },
  invalid: { label: "Erro", tone: "danger" }, duplicate_in_file: { label: "CNPJ repetido no arquivo", tone: "warning" },
};
const OUTCOME_TONE: Record<PjOutcome, Tone> = { created: "success", updated: "info", unchanged: "neutral", skipped: "warning", invalid: "danger" };
const fmtCnpj = (c: string | null) => (c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c ?? "—");

/** Importação de PJ em 4 passos: arquivo → mapeamento de colunas → prévia (validação e duplicidade por CNPJ feitas
 *  no servidor, nada gravado) → resultado com relatório por linha. Cadastros existentes só mudam por decisão
 *  explícita, campo a campo. Reimportar o mesmo arquivo não duplica. */
const PjImportDialog = ({ open, onOpenChange, units, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; units: Unit[]; onDone: () => void }) => {
  const [step, setStep] = useState<"arquivo" | "mapeamento" | "previa" | "resultado">("arquivo");
  const [records, setRecords] = useState<{ cells: string[]; line: number }[]>([]);
  const [mapping, setMapping] = useState<PjMapping>({});
  const [unit, setUnit] = useState(""); const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<PjRowInput[]>([]); const [checks, setChecks] = useState<Check[]>([]);
  const [picked, setPicked] = useState<Record<number, Set<string>>>({});
  const [result, setResult] = useState<CommitResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const reset = () => { setStep("arquivo"); setRecords([]); setMapping({}); setRows([]); setChecks([]); setPicked({}); setResult(null); setFatal(null); setFileName(""); };
  const headers = records[0]?.cells ?? [];
  const missing = useMemo(() => missingRequired(mapping), [mapping]);
  const dups = useMemo(() => duplicateMapped(mapping), [mapping]);

  const onFile = async (f: File | undefined) => {
    reset(); if (!f) return; setFileName(f.name);
    if (f.size > 1_000_000) return setFatal("Arquivo muito grande (limite 1 MB).");
    const recs = parseCsvWithLines(await f.text());
    if (recs.length < 2) return setFatal("O arquivo precisa ter um cabeçalho e ao menos uma linha de dados.");
    if (recs.length - 1 > 500) return setFatal("Limite de 500 linhas por importação. Divida o arquivo.");
    setRecords(recs); setMapping(autoMap(recs[0].cells)); setStep("mapeamento");
  };

  const analyze = async () => {
    setBusy(true); setFatal(null);
    const mapped = applyMapping(records, mapping);
    if (!mapped.length) { setBusy(false); return setFatal("Nenhuma linha com dados após o mapeamento."); }
    const { data, error } = await supabase.rpc("legal_entity_import_check", { p_rows: mapped });
    setBusy(false);
    if (error) return setFatal(errText(error, "Não foi possível analisar o arquivo."));
    setRows(mapped); setChecks(data as Check[]); setPicked({}); setStep("previa");
  };

  const counts = useMemo(() => {
    const c = { new: 0, unchanged: 0, conflict: 0, invalid: 0, other: 0 };
    for (const k of checks) { if (k.status === "new") c.new++; else if (k.status === "unchanged") c.unchanged++; else if (k.status === "conflict") c.conflict++; else if (k.status === "invalid") c.invalid++; else c.other++; }
    return c;
  }, [checks]);
  const updates = Object.values(picked).filter((s) => s.size > 0).length;

  const toggle = (idx: number, field: string, on: boolean) => setPicked((p) => { const s = new Set(p[idx] ?? []); on ? s.add(field) : s.delete(field); return { ...p, [idx]: s }; });

  const commit = async () => {
    if (!unit) return setFatal("Selecione a unidade de destino."); setBusy(true); setFatal(null);
    const decisions = Object.entries(picked).filter(([, s]) => s.size > 0).map(([idx, s]) => ({ idx: Number(idx), action: "update", fields: [...s] }));
    const { data, error } = await supabase.rpc("legal_entity_import_commit", { p_rows: rows, p_unit: unit, p_decisions: decisions, p_file_name: fileName });
    setBusy(false);
    if (error) return setFatal(errText(error, "Falha ao importar. Nada foi confirmado; tente novamente."));
    setResult(data as CommitResult); setStep("resultado"); onDone();
  };

  const report = () => {
    const src = result?.report ?? checks.map((k) => ({ idx: k.idx, line: k.line, cnpj: k.cnpj, legal_name: k.legal_name, outcome: (k.status === "invalid" ? "invalid" : "skipped") as PjOutcome, message: k.messages.join("; ") || STATUS[k.status].label }));
    download(`relatorio-importacao-pj-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(src.map((r) => ({ linha_arquivo: r.line, cnpj: fmtCnpj(r.cnpj), razao_social: r.legal_name ?? "", resultado: OUTCOME_LABEL[r.outcome], detalhe: r.message ?? "" }))));
  };

  const bad = checks.filter((k) => k.status === "invalid");

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar pessoas jurídicas (CSV)</DialogTitle>
          <DialogDescription>
            {step === "arquivo" && "O CNPJ identifica a empresa: um CNPJ já cadastrado nunca é duplicado nem sobrescrito sem a sua decisão. Até 500 linhas."}
            {step === "mapeamento" && "Confirme qual coluna do arquivo alimenta cada campo. CNPJ e razão social são obrigatórios."}
            {step === "previa" && "Nada foi gravado ainda. Revise, decida os conflitos e confirme."}
            {step === "resultado" && "Importação concluída. Baixe o relatório por linha."}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-2 text-xs" aria-label="Etapas">
          {(["arquivo", "mapeamento", "previa", "resultado"] as const).map((s, i) => (
            <li key={s} aria-current={step === s ? "step" : undefined} className={`px-2 py-1 rounded-full border ${step === s ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground"}`}>{i + 1}. {{ arquivo: "Arquivo", mapeamento: "Colunas", previa: "Prévia", resultado: "Resultado" }[s]}</li>
          ))}
        </ol>
        {fatal && <p role="alert" className="text-sm text-destructive">{fatal}</p>}

        {step === "arquivo" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pj-imp-f" className="block mb-1">Arquivo .csv</label>
              <input id="pj-imp-f" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
              <p className="text-xs text-muted-foreground mt-2">Separador vírgula ou ponto e vírgula; UTF-8.</p>
            </div>
            <div className="hp-card p-3 text-sm">
              <p className="font-medium mb-1">Modelo</p>
              <p className="text-muted-foreground text-xs mb-2">Baixe o modelo com todas as colunas aceitas. A linha de exemplo tem CNPJ inválido de propósito — apague-a antes de importar.</p>
              <button type="button" className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => download("modelo-importacao-pj.csv", templateCsv())}>Baixar modelo (CSV)</button>
            </div>
          </div>
        )}

        {step === "mapeamento" && (
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">Arquivo: {fileName} — {records.length - 1} linha(s) de dados.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PJ_FIELDS.map((f) => (
                <div key={f.key}>
                  <label htmlFor={`map-${f.key}`} className="block text-xs mb-1">{f.label}{f.required ? " *" : ""}</label>
                  <select id={`map-${f.key}`} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))}>
                    <option value="">— não importar —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1})`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {missing.length > 0 && <p role="alert" className="text-sm text-destructive">Faltam campos obrigatórios: {missing.join(", ")}.</p>}
            {dups.length > 0 && <p role="alert" className="text-sm text-destructive">A mesma coluna está mapeada duas vezes: {dups.join("; ")}.</p>}
            <div className="hp-card overflow-auto max-h-40"><table className="w-full text-xs"><thead><tr className="text-left bg-muted/60">{headers.map((h, i) => <th key={i} className="px-2 py-1">{h}</th>)}</tr></thead>
              <tbody>{records.slice(1, 4).map((r) => <tr key={r.line} className="border-t border-border">{headers.map((_, i) => <td key={i} className="px-2 py-1">{r.cells[i]}</td>)}</tr>)}</tbody></table></div>
            <p className="text-xs text-muted-foreground">Primeiras linhas do arquivo, para conferência.</p>
          </div>
        )}

        {step === "previa" && (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="pj-imp-u" className="block mb-1">Unidade de destino *</label>
                <select id="pj-imp-u" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Selecione…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            </div>
            <p className="text-sm flex flex-wrap gap-2 items-center" role="status">
              <Badge tone="success">{counts.new} novas</Badge><Badge>{counts.unchanged} sem alteração</Badge>
              <Badge tone="warning">{counts.conflict} com CNPJ já cadastrado e dados diferentes</Badge><Badge tone="warning">{counts.other} ignoradas</Badge><Badge tone="danger">{counts.invalid} com erro</Badge>
            </p>
            {bad.length > 0 && <ul className="text-sm rounded-md border border-border p-3 max-h-32 overflow-y-auto" aria-label="Erros de validação">{bad.map((k) => <li key={k.idx}>Linha {k.line}: {k.messages.join("; ")}</li>)}</ul>}
            <div className="hp-card overflow-auto max-h-80">
              <table className="w-full text-sm"><thead><tr className="text-left text-xs bg-muted/60"><th className="px-3 py-2">Linha</th><th className="px-3 py-2">CNPJ</th><th className="px-3 py-2">Razão social</th><th className="px-3 py-2">Situação</th></tr></thead>
                <tbody>{checks.map((k) => (
                  <tr key={k.idx} className="border-t border-border align-top">
                    <td className="px-3 py-1.5">{k.line}</td><td className="px-3 py-1.5 tabular">{fmtCnpj(k.cnpj)}</td><td className="px-3 py-1.5">{k.legal_name}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={STATUS[k.status].tone}>{STATUS[k.status].label}</Badge>
                      {k.status !== "conflict" && k.status !== "new" && k.messages.length > 0 && <p className="text-xs text-muted-foreground mt-1">{k.messages.join("; ")}</p>}
                      {k.status === "conflict" && (
                        <fieldset className="mt-2 grid gap-1"><legend className="text-xs text-muted-foreground">Cadastro existente: {k.existing_name}. Marque só o que deve ser atualizado (padrão: manter como está).</legend>
                          {k.diffs.map((d) => (
                            <label key={d.field} className="flex items-start gap-2 !font-normal text-xs">
                              <input type="checkbox" checked={picked[k.idx]?.has(d.field) ?? false} onChange={(e) => toggle(k.idx, d.field, e.target.checked)} />
                              <span><b>{d.label}</b>: {d.current ? <>“{d.current}” → “{d.incoming}”</> : <>vazio → “{d.incoming}”</>} <em className="text-muted-foreground">({d.kind === "fill" ? "preencher campo vazio" : "sobrescrever valor existente"})</em></span>
                            </label>))}
                        </fieldset>)}
                    </td>
                  </tr>))}</tbody></table>
            </div>
          </div>
        )}

        {step === "resultado" && result && (
          <div className="grid gap-3 text-sm">
            <p role="status" className="flex flex-wrap gap-2 items-center">
              <Badge tone="success">{result.totals.created} criadas</Badge><Badge tone="info">{result.totals.updated} atualizadas</Badge><Badge>{result.totals.unchanged} sem alteração</Badge>
              <Badge tone="warning">{result.totals.skipped} ignoradas</Badge><Badge tone="danger">{result.totals.invalid} com erro</Badge>
            </p>
            <div className="hp-card overflow-auto max-h-64"><table className="w-full text-sm"><thead><tr className="text-left text-xs bg-muted/60"><th className="px-3 py-2">Linha</th><th className="px-3 py-2">CNPJ</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2">Detalhe</th></tr></thead>
              <tbody>{result.report.map((r) => <tr key={r.idx} className="border-t border-border"><td className="px-3 py-1.5">{r.line}</td><td className="px-3 py-1.5 tabular">{fmtCnpj(r.cnpj)}</td><td className="px-3 py-1.5"><Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge></td><td className="px-3 py-1.5 text-muted-foreground">{r.message}</td></tr>)}</tbody></table></div>
            <p className="text-xs text-muted-foreground">Reimportar o mesmo arquivo é seguro: CNPJs já cadastrados aparecem como “sem alteração” e nada é duplicado.</p>
          </div>
        )}

        <DialogFooter>
          {step !== "arquivo" && step !== "resultado" && <button className="hp-btn hp-btn-outline" onClick={() => setStep(step === "previa" ? "mapeamento" : "arquivo")} disabled={busy}>Voltar</button>}
          {(step === "previa" || step === "resultado") && <button className="hp-btn hp-btn-outline" onClick={report}>Baixar relatório (CSV)</button>}
          <button className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>{step === "resultado" ? "Fechar" : "Cancelar"}</button>
          {step === "mapeamento" && <button className="hp-btn hp-btn-primary" disabled={busy || missing.length > 0 || dups.length > 0} onClick={analyze}>{busy ? "Analisando…" : "Ver prévia"}</button>}
          {step === "previa" && <button className="hp-btn hp-btn-primary" disabled={busy || !unit || counts.new + updates === 0} onClick={commit}>{busy ? "Importando…" : `Importar ${counts.new} nova(s)${updates ? ` e atualizar ${updates}` : ""}`}</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default PjImportDialog;
