import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Badge, errText, Msg, PageHead, State, Table, Td, promptText, useMsg } from "@/lib/ui";
import AccScopeBar from "./AccScopeBar";
import AttachDialog, { type AttachTarget } from "./AttachDialog";
import { fmtDay, signedBrl, useAccInvalidate, useAccQuery, useAccScope, BASIS_LABEL, type Basis, type PeriodStatus } from "./accLib";
import type { AccCfg } from "./Lancamentos";

type PType = "unclassified" | "missing_receipt" | "changed_after_close";
interface Pend { type: PType; source_type: "receivable" | "payable" | "payment"; source_id: string; basis: Basis; entry_date: string | null; description: string; counterparty: string; signed_cents: number; detail: string }
const TYPE_LABEL: Record<PType, string> = { unclassified: "Sem classificação", missing_receipt: "Sem comprovante", changed_after_close: "Alteração após o fechamento" };
const TYPE_TONE = { unclassified: "danger", missing_receipt: "danger", changed_after_close: "warning" } as const;

/** Pendências da competência, calculadas ao vivo a partir do Financeiro e das classificações/documentos — nunca uma lista
 *  paralela que possa ficar desatualizada. Cada pendência tem a ação que a resolve. */
const Pendencias = () => {
  const { unit, month, link } = useAccScope(); const invalidate = useAccInvalidate();
  const [sp, setSp] = useSearchParams(); const tipo = (sp.get("tipo") as PType | null) ?? null;
  const [attach, setAttach] = useState<AttachTarget | null>(null); const [msg, m] = useMsg();
  const q = useAccQuery<{ rows: Pend[]; period_status: PeriodStatus }>("acc_pendencies", { p_unit: unit.id, p_month: month, p_type: null }, ["pend", unit.id, month, "all"]);
  const cfg = useAccQuery<AccCfg>("acc_config", {}, ["config"]);
  const rows = (q.data?.rows ?? []).filter((r) => !tipo || r.type === tipo);
  const count = (t: PType) => (q.data?.rows ?? []).filter((r) => r.type === t).length;
  const closed = q.data?.period_status === "closed";
  const setTipo = (t: PType | null) => setSp((p) => { const n = new URLSearchParams(p); if (t) n.set("tipo", t); else n.delete("tipo"); return n; }, { replace: true });

  const done = async (fn: PromiseLike<{ error: { message: string; code?: string } | null }>, ok: string) => { const { error } = await fn; if (error) return m.err(errText(error)); m.ok(ok); await invalidate(); };
  const classify = async (r: Pend) => {
    const opts = (cfg.data?.accounts ?? []).filter((a) => a.active).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
    if (!opts.length) return m.err("Não há classificações ativas. Um gestor deve cadastrá-las em Configurações contábeis.");
    const v = await promptText("Classificar lançamento", r.description, { kind: "select", options: opts, confirmLabel: "Classificar" });
    if (v) await done(supabase.rpc("acc_classify", { p_unit: unit.id, p_items: [{ source_type: r.source_type === "payment" ? "receivable" : r.source_type, source_id: r.source_id }], p_account: v, p_note: null }), "Lançamento classificado.");
  };
  const waive = async (r: Pend, kind: "classification" | "receipt") => {
    const reason = await promptText("Justificativa da dispensa", `Por que “${r.description}” não precisa ${kind === "receipt" ? "de comprovante" : "de classificação"}?`, { multiline: true, confirmLabel: "Dispensar" });
    if (reason) await done(supabase.rpc("acc_waive", { p_unit: unit.id, p_source_type: r.source_type, p_source_id: r.source_id, p_kind: kind, p_reason: reason }), "Pendência dispensada com justificativa.");
  };
  const accept = async (r: Pend) => {
    const note = await promptText("Aceitar alteração", `Confirme que a alteração em “${r.description}” foi revisada e não exige reabrir a competência. Justificativa:`, { multiline: true, confirmLabel: "Aceitar" });
    if (note) await done(supabase.rpc("acc_change_accept", { p_unit: unit.id, p_month: month, p_source_type: r.source_type, p_source_id: r.source_id, p_basis: r.basis, p_note: note }), "Alteração revisada e aceita.");
  };

  return (
    <div>
      <PageHead eyebrow="Contábil" title="Pendências" hint="O que ainda impede o fechamento — e o que mudou no Financeiro depois dele." />
      <AccScopeBar />
      <Msg m={msg} />
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filtrar por tipo">
        <button className={`hp-btn hp-btn-sm ${!tipo ? "hp-btn-primary" : "hp-btn-outline"}`} aria-pressed={!tipo} onClick={() => setTipo(null)}>Todas ({q.data?.rows.length ?? 0})</button>
        {(Object.keys(TYPE_LABEL) as PType[]).map((t) => <button key={t} className={`hp-btn hp-btn-sm ${tipo === t ? "hp-btn-primary" : "hp-btn-outline"}`} aria-pressed={tipo === t} onClick={() => setTipo(t)}>{TYPE_LABEL[t]} ({count(t)})</button>)}
      </div>
      <State loading={q.isLoading} error={q.error} empty={q.data && rows.length === 0} emptyText="Nenhuma pendência para este filtro. 🎉" />
      {rows.length > 0 && (
        <Table head={["Tipo", "Lançamento", "Data", "Valor", "Detalhe", ""]} right={[3]}>
          {rows.map((r) => (
            <tr key={r.type + r.source_id + r.basis} data-pend={r.type}>
              <Td><Badge tone={TYPE_TONE[r.type]}>{TYPE_LABEL[r.type]}</Badge></Td>
              <Td><span className="font-medium">{r.description}</span><span className="block text-xs text-muted-foreground">{r.counterparty} · {BASIS_LABEL[r.basis]}</span></Td>
              <Td>{fmtDay(r.entry_date)}</Td>
              <Td num>{signedBrl(r.signed_cents)}</Td>
              <Td className="text-muted-foreground text-xs max-w-[18rem]">{r.detail}</Td>
              <Td><div className="flex gap-1.5 justify-end whitespace-nowrap">
                {r.type === "unclassified" && <><button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed} onClick={() => void classify(r)}>Classificar</button><button className="hp-btn hp-btn-ghost hp-btn-sm" disabled={closed} onClick={() => void waive(r, "classification")}>Dispensar</button></>}
                {r.type === "missing_receipt" && <><button className="hp-btn hp-btn-outline hp-btn-sm" disabled={closed} onClick={() => setAttach({ type: r.source_type, id: r.source_id, label: r.description })}>Anexar</button><button className="hp-btn hp-btn-ghost hp-btn-sm" disabled={closed} onClick={() => void waive(r, "receipt")}>Dispensar</button></>}
                {r.type === "changed_after_close" && <>
                  {unit.can_close && <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => void accept(r)}>Aceitar alteração</button>}
                  <Link className="hp-btn hp-btn-ghost hp-btn-sm" to={link("/admin/contabil/fechamentos")}>Reabrir…</Link></>}
              </div></Td>
            </tr>))}
        </Table>)}
      {tipo === "changed_after_close" && rows.length > 0 && <p className="text-xs text-muted-foreground mt-3">Aceitar registra que a mudança foi revisada, sem alterar o fechamento. Se a mudança precisar entrar na competência, reabra-a em Fechamentos (com permissão e justificativa) e feche de novo.</p>}
      <AttachDialog target={attach} onClose={() => setAttach(null)} />
    </div>
  );
};
export default Pendencias;
