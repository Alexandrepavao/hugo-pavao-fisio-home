import { useState } from "react";
import JSZip from "jszip";
import { AlertTriangle, FileArchive, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { download, fmtDateTime } from "@/lib/format";
import { Badge, errText, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";
import { docFileName, entriesCsv, manifestCsv, pendenciesCsv, readme, sha256Hex, STATUS_PT, summaryCsv, type ExportData } from "@/lib/accExport";
import AccScopeBar from "./AccScopeBar";
import { fmtMonth, NOT_OFFICIAL, useAccInvalidate, useAccQuery, useAccScope, type PeriodStatus } from "./accLib";

interface Hist { id: string; competence_month: string; format: string; row_count: number; doc_count: number; period_status: PeriodStatus; checksum: string | null; created_at: string; created_by: string | null }
const saveBlob = (name: string, blob: Blob) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); };

/** Exportação para o contador. O servidor decide o que o seu perfil pode ver (unidade, pseudônimos); os documentos são
 *  baixados um a um por URL assinada autorizada — quem não tem acesso a um arquivo não o recebe. Falhas viram aviso no LEIAME. */
const Exportacoes = () => {
  const { unit, month } = useAccScope(); const invalidate = useAccInvalidate(); const [msg, m] = useMsg();
  const [busy, setBusy] = useState<null | "csv" | "zip">(null); const [progress, setProgress] = useState("");
  const hist = useAccQuery<Hist[]>("acc_export_list", { p_unit: unit.id }, ["exports", unit.id]);
  const dash = useAccQuery<{ period: { status: PeriodStatus } }>("acc_dashboard", { p_unit: unit.id, p_month: month }, ["dashboard", unit.id, month]);
  const status = dash.data?.period.status ?? "open";
  const slug = `contabil-${unit.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${month.slice(0, 7)}`;

  const load = async (): Promise<ExportData | null> => {
    const { data, error } = await supabase.rpc("acc_export_data", { p_unit: unit.id, p_month: month });
    if (error) { m.err(errText(error)); return null; }
    return data as ExportData;
  };

  const exportCsv = async () => {
    setBusy("csv"); m.clear();
    const d = await load(); if (!d) return setBusy(null);
    download(`${slug}-lancamentos.csv`, entriesCsv(d, null));
    const { error } = await supabase.rpc("acc_export_log", { p_unit: unit.id, p_month: month, p_format: "csv", p_rows: d.entries.length, p_docs: 0, p_checksum: await sha256Hex(entriesCsv(d, null)) });
    setBusy(null); if (error) m.err(errText(error)); else m.ok(`CSV gerado com ${d.entries.length} linha(s)${d.provisional ? " — dados PROVISÓRIOS (competência não fechada)" : ""}.`);
    await invalidate();
  };

  const exportZip = async () => {
    setBusy("zip"); m.clear(); setProgress("Preparando dados…");
    const d = await load(); if (!d) { setBusy(null); return setProgress(""); }
    const zip = new JSZip(); const failed: { title: string; reason: string }[] = []; const files: { name: string; title: string; kind: string; size: number; sha256: string }[] = [];
    zip.file("lancamentos_competencia.csv", "﻿" + entriesCsv(d, "competencia")); zip.file("lancamentos_caixa.csv", "﻿" + entriesCsv(d, "caixa"));
    zip.file("pendencias.csv", "﻿" + pendenciesCsv(d)); zip.file("resumo.csv", "﻿" + summaryCsv(d));
    if (d.documents.length) {
      setProgress(`Autorizando ${d.documents.length} documento(s)…`);
      const acc = await supabase.rpc("acc_documents_access", { p_ids: d.documents.map((x) => x.id) });
      if (acc.error) { setBusy(null); setProgress(""); return m.err(errText(acc.error, "Sem permissão para os documentos desta competência.")); }
      const paths = new Map((acc.data as { id: string; path: string }[]).map((p) => [p.id, p.path]));
      for (let i = 0; i < d.documents.length; i++) {
        const doc = d.documents[i]; setProgress(`Baixando documento ${i + 1} de ${d.documents.length}…`);
        try {
          const path = paths.get(doc.id); if (!path) throw new Error("sem autorização");
          const s = await supabase.storage.from("accounting-private").createSignedUrl(path, 120); if (s.error || !s.data) throw new Error("link seguro indisponível");
          const r = await fetch(s.data.signedUrl); if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await r.arrayBuffer(); const name = docFileName(doc, i);
          zip.file(name, buf); files.push({ name, title: doc.title, kind: doc.kind, size: buf.byteLength, sha256: await sha256Hex(buf) });
        } catch (e) { failed.push({ title: doc.title, reason: e instanceof Error ? e.message : "falha" }); }
      }
    }
    const manifest = manifestCsv(files); zip.file("manifesto.csv", "﻿" + manifest); zip.file("LEIAME.txt", readme(d, failed));
    setProgress("Compactando…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    saveBlob(`${slug}.zip`, blob);
    const checksum = await sha256Hex(await blob.arrayBuffer());
    const { error } = await supabase.rpc("acc_export_log", { p_unit: unit.id, p_month: month, p_format: "zip", p_rows: d.entries.length, p_docs: files.length, p_checksum: checksum });
    setBusy(null); setProgress("");
    if (error) m.err(errText(error));
    else if (failed.length) m.err(`Pacote gerado, mas ${failed.length} documento(s) não puderam ser incluídos (listados no LEIAME.txt).`);
    else m.ok(`Pacote gerado: ${d.entries.length} lançamento(s) e ${files.length} documento(s)${d.provisional ? " — dados PROVISÓRIOS (competência não fechada)" : ""}.`);
    await invalidate();
  };

  return (
    <div>
      <PageHead eyebrow="Contábil" title="Exportações" hint="Pacote para o contador: lançamentos por competência e por caixa (arquivos separados), pendências, resumo e os documentos que você tem permissão de ver." />
      <AccScopeBar />
      <Msg m={msg} />
      {status !== "closed" && (
        <p role="status" className="hp-card p-3 mb-4 text-sm flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <span>A competência {fmtMonth(month)} está <b>{STATUS_PT[status].toLowerCase()}</b>: o pacote sai marcado como <b>provisório</b>. Para um pacote definitivo, feche a competência primeiro.</span></p>)}
      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        <div className="hp-card p-4"><h3 className="font-semibold flex items-center gap-2 mb-1"><FileSpreadsheet size={16} aria-hidden />Lançamentos (CSV)</h3>
          <p className="text-xs text-muted-foreground mb-3">Um arquivo com as duas bases identificadas na coluna “Base”. Abre direto no Excel.</p>
          <button className="hp-btn hp-btn-outline" onClick={() => void exportCsv()} disabled={busy !== null}>{busy === "csv" ? "Gerando…" : "Baixar CSV"}</button></div>
        <div className="hp-card p-4"><h3 className="font-semibold flex items-center gap-2 mb-1"><FileArchive size={16} aria-hidden />Pacote completo (ZIP)</h3>
          <p className="text-xs text-muted-foreground mb-3">CSVs por base, pendências, resumo, LEIAME, manifesto com SHA-256 e a pasta de documentos.</p>
          <button className="hp-btn hp-btn-primary" onClick={() => void exportZip()} disabled={busy !== null}>{busy === "zip" ? "Gerando…" : "Gerar pacote (ZIP)"}</button>
          {progress && <p role="status" className="text-xs text-muted-foreground mt-2">{progress}</p>}</div>
      </div>
      <p className="text-xs text-muted-foreground mb-6">{NOT_OFFICIAL} O envio ao contador é feito por você (nenhum e-mail é disparado automaticamente).</p>

      <h3 className="text-base font-semibold mb-2">Histórico de exportações desta unidade</h3>
      <State loading={hist.isLoading} error={hist.error} empty={hist.data?.length === 0} emptyText="Nenhuma exportação registrada ainda." />
      {hist.data && hist.data.length > 0 && (
        <Table head={["Quando", "Competência", "Formato", "Linhas", "Documentos", "Situação na época", "Por", "SHA-256"]} right={[3, 4]}>
          {hist.data.map((h) => (
            <tr key={h.id}><Td>{fmtDateTime(h.created_at)}</Td><Td>{fmtMonth(h.competence_month)}</Td><Td>{h.format.toUpperCase()}</Td><Td num>{h.row_count}</Td><Td num>{h.doc_count}</Td>
              <Td>{h.period_status === "closed" ? <Badge tone="success">Definitivo</Badge> : <Badge tone="warning">Provisório</Badge>}</Td><Td>{h.created_by}</Td>
              <Td><code className="text-[11px]" title={h.checksum ?? undefined}>{h.checksum ? h.checksum.slice(0, 12) + "…" : "—"}</code></Td></tr>))}
        </Table>)}
    </div>
  );
};
export default Exportacoes;
