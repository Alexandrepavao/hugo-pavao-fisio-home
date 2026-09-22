import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { btnPrimary, errText, Msg, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Entry {
  id: number; action: string; entity_type: string; entity_id: string | null;
  changed_columns: string[] | null; created_at: string;
}
interface Ev { id: string; type: string; status: string; attempts: number; next_attempt_at: string; claimed_by: string | null; last_error: string | null; permanent_failure: boolean; created_at: string }
const EV_STATUS: Record<string, string> = { pending: "Pendente", processed: "Processado", failed: "Falhou (temporário)", dead: "Esgotado/definitivo" };

const Audit = () => {
  const [tab, setTab] = useState("auditoria");
  return (
    <div>
      <p className="eyebrow mb-2">Segurança</p>
      <h1 className="text-3xl text-foreground mb-2">Auditoria</h1>
      <Tabs tabs={[["auditoria", "Ações administrativas"], ["automacoes", "Automações (eventos)"]]} value={tab} onChange={setTab} />
      {tab === "auditoria" && <AuditLog />}
      {tab === "automacoes" && <Automations />}
    </div>
  );
};

const AuditLog = () => {
  const q = useQuery({ queryKey: ["audit-log"], queryFn: async () => (await supabase.from("audit_log").select("id, action, entity_type, entity_id, changed_columns, created_at").order("created_at", { ascending: false }).limit(100)).data as Entry[] });
  return (<>
    <p className="text-muted-foreground mb-6 max-w-2xl">Últimas 100 ações. O registro guarda apenas os nomes dos campos alterados, nunca senhas, tokens ou conteúdo clínico.</p>
    <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum registro ainda." />
    {q.data && q.data.length > 0 && (
      <div className="overflow-x-auto hp-card">
        <table className="w-full text-[14px]">
          <thead><tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="p-3">Quando</th><th className="p-3">Ação</th><th className="p-3">Entidade</th><th className="p-3">Campos alterados</th>
          </tr></thead>
          <tbody>{q.data.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
              <td className="p-3">{r.action}</td><td className="p-3">{r.entity_type}</td>
              <td className="p-3 text-muted-foreground">{r.changed_columns?.join(", ") ?? "—"}</td>
            </tr>))}</tbody>
        </table>
      </div>
    )}
  </>);
};

/** Fila de eventos (domain_events): processada automaticamente a cada minuto por um job agendado no banco
 * (pg_cron) — reservando cada evento (evita duas execuções concorrentes) e com intervalo progressivo entre
 * tentativas. O botão abaixo é só para reprocessar AGORA sem esperar o próximo ciclo; fica registrado na auditoria. */
const Automations = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const events = useQuery({ queryKey: ["domain-events"], queryFn: async () => (await supabase.from("domain_events").select("id, type, status, attempts, next_attempt_at, claimed_by, last_error, permanent_failure, created_at").order("created_at", { ascending: false }).limit(100)).data as Ev[] });
  const pending = events.data?.filter((e) => e.status === "pending" || e.status === "failed").length ?? 0;
  const retry = async () => {
    setBusy(true); const { data, error } = await supabase.rpc("retry_failed_events"); setBusy(false);
    if (error) return m.err(errText(error));
    m.ok(`${data} evento(s) reprocessado(s) agora.`); void qc.invalidateQueries({ queryKey: ["domain-events"] });
  };
  return (<>
    <p className="text-muted-foreground mb-4 max-w-2xl">Eventos internos (confirmação de venda, comissão, etc.) processados de forma assíncrona e resiliente: reserva contra execução duplicada, recuperação automática se um worker cair no meio, intervalo progressivo entre tentativas (até 8, depois viram "esgotado") e distinção entre falha temporária e definitiva.</p>
    <Msg m={msg} />
    <div className="flex items-center gap-3 mb-4">
      <button className={btnPrimary} onClick={retry} disabled={busy || pending === 0}>{busy ? "Reprocessando…" : `Reprocessar agora (${pending} pendente${pending === 1 ? "" : "s"})`}</button>
      <p className="text-xs text-muted-foreground">O reprocessamento automático já roda a cada minuto — este botão só antecipa o próximo ciclo.</p>
    </div>
    <State loading={events.isLoading} error={events.error} empty={events.data?.length === 0} emptyText="Nenhum evento registrado ainda." />
    {events.data && events.data.length > 0 && <Table head={["Quando", "Tipo", "Estado", "Tentativas", "Próxima tentativa", "Reservado por", "Erro"]}>
      {events.data.map((e) => <tr key={e.id}><Td>{fmtDateTime(e.created_at)}</Td><Td>{e.type}</Td>
        <Td>{EV_STATUS[e.status]}{e.status === "dead" && (e.permanent_failure ? " (definitiva)" : " (tentativas esgotadas)")}</Td>
        <Td num>{e.attempts}</Td><Td>{e.status === "failed" ? fmtDateTime(e.next_attempt_at) : "—"}</Td><Td>{e.claimed_by ?? "—"}</Td>
        <Td className="text-muted-foreground">{e.last_error ?? "—"}</Td></tr>)}
    </Table>}
  </>);
};

export default Audit;
