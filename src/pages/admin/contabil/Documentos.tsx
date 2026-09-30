import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, errText, Msg, PageHead, State, Table, Td, promptText, useMsg } from "@/lib/ui";
import AccScopeBar from "./AccScopeBar";
import AttachDialog, { type AttachTarget } from "./AttachDialog";
import { DOC_KINDS, fmtMonth, openAccDocument, useAccInvalidate, useAccQuery, useAccScope, type PeriodStatus } from "./accLib";

interface Doc { id: string; kind: string; title: string; source_type: string; source_id: string | null; mime: string | null; size_bytes: number | null; uploaded_at: string; uploaded_by: string | null; source_label: string }
interface Pend { rows: { type: string; source_type: "receivable" | "payable" | "payment"; source_id: string; description: string; counterparty: string; signed_cents: number }[] }
const kb = (n: number | null) => (n == null ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Documentos e comprovantes da competência. Arquivos ficam em bucket privado; abrir gera URL assinada curta, só depois
 *  de checar permissão na unidade, e registra o acesso na auditoria. */
const Documentos = () => {
  const { unit, month, link } = useAccScope(); const invalidate = useAccInvalidate();
  const [attach, setAttach] = useState<AttachTarget | null>(null); const [msg, m] = useMsg(); const [kindF, setKindF] = useState("");
  const docs = useAccQuery<Doc[]>("acc_document_list", { p_unit: unit.id, p_month: month }, ["docs", unit.id, month]);
  const dash = useAccQuery<{ period: { status: PeriodStatus } }>("acc_dashboard", { p_unit: unit.id, p_month: month }, ["dashboard", unit.id, month]);
  const missing = useAccQuery<Pend>("acc_pendencies", { p_unit: unit.id, p_month: month, p_type: "missing_receipt" }, ["pend", unit.id, month, "missing_receipt"]);
  const closed = dash.data?.period.status === "closed";
  const list = (docs.data ?? []).filter((d) => !kindF || d.kind === kindF);

  const open = async (d: Doc) => { const e = await openAccDocument(d.id); if (e) m.err(e); };
  const remove = async (d: Doc) => {
    const reason = await promptText("Remover documento", `Motivo da remoção de “${d.title}” (fica registrado; o arquivo permanece arquivado)`, { multiline: true, confirmLabel: "Remover", danger: true });
    if (!reason) return;
    const { error } = await supabase.rpc("acc_document_remove", { p_id: d.id, p_reason: reason });
    if (error) return m.err(errText(error));
    m.ok("Documento removido da competência."); await invalidate();
  };

  return (
    <div>
      <PageHead eyebrow="Contábil" title="Documentos e comprovantes" hint="Comprovantes e arquivos da competência, em armazenamento privado. O acesso é por permissão na unidade e fica registrado."
        actions={<button className="hp-btn hp-btn-primary" disabled={closed} onClick={() => setAttach({ type: "period", id: null, label: `Competência ${fmtMonth(month)}` })}>Anexar documento da competência</button>} />
      <AccScopeBar />
      <Msg m={msg} />
      {closed && <p role="status" className="hp-card p-3 mb-4 text-sm">Competência fechada: só leitura. Reabra em <Link className="underline" to={link("/admin/contabil/fechamentos")}>Fechamentos</Link> para anexar ou remover.</p>}

      {(missing.data?.rows.length ?? 0) > 0 && (
        <section className="mb-6" aria-labelledby="sem-comp">
          <h3 id="sem-comp" className="text-base font-semibold mb-2">Despesas pagas sem comprovante ({missing.data!.rows.length})</h3>
          <Table head={["Despesa", "Fornecedor", ""]}>
            {missing.data!.rows.map((r) => (
              <tr key={r.source_id}><Td>{r.description}</Td><Td>{r.counterparty}</Td>
                <Td><div className="flex justify-end"><button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed} onClick={() => setAttach({ type: r.source_type, id: r.source_id, label: r.description })}>Anexar comprovante</button></div></Td></tr>))}
          </Table>
        </section>)}

      <div className="flex items-end gap-3 mb-3">
        <div><label htmlFor="d-kind" className="block text-xs text-muted-foreground mb-1">Tipo</label>
          <select id="d-kind" value={kindF} onChange={(e) => setKindF(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Todos</option>{Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <State loading={docs.isLoading} error={docs.error} empty={docs.data?.length === 0} emptyText="Nenhum documento anexado a esta competência." />
      {list.length > 0 && (
        <Table head={["Documento", "Tipo", "Vinculado a", "Enviado", "Tamanho", ""]}>
          {list.map((d) => (
            <tr key={d.id} data-doc={d.id}>
              <Td><span className="font-medium">{d.title}</span></Td>
              <Td><Badge>{DOC_KINDS[d.kind] ?? d.kind}</Badge></Td>
              <Td>{d.source_label}</Td>
              <Td>{fmtDateTime(d.uploaded_at)}<span className="block text-xs text-muted-foreground">{d.uploaded_by}</span></Td>
              <Td>{kb(d.size_bytes)}</Td>
              <Td><div className="flex gap-1.5 justify-end">
                <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => void open(d)}><ExternalLink size={13} aria-hidden />Abrir</button>
                <button className="hp-btn hp-btn-ghost hp-btn-sm" disabled={closed} onClick={() => void remove(d)} aria-label={`Remover ${d.title}`}><Trash2 size={13} aria-hidden /></button>
              </div></Td>
            </tr>))}
        </Table>)}
      <AttachDialog target={attach} onClose={() => setAttach(null)} />
    </div>
  );
};
export default Documentos;
