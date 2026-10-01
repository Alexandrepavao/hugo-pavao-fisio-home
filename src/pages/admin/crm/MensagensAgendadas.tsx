import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { fmtDateTime } from "@/lib/format";
import { Badge, Msg, PageHead, State, Table, Td, Tabs, useMsg } from "@/lib/ui";
import { phoneOf, useScheduledActions, useStaff, type ScheduledRow } from "./conversas/api";

type Tab = "due" | "scheduled" | "sent" | "cancelled";

/** Lembretes de envio: o HP NÃO envia sozinho (não há provedor de WhatsApp conectado). No horário o responsável recebe uma tarefa; ele abre o WhatsApp com o texto e a
 *  ABERTURA é registrada na conversa e no histórico do lead (sem confirmação de envio). Esta tela lista, remarca, cancela e abre o WhatsApp. */
const MensagensAgendadas = () => {
  const { user } = useAuth(); const [msg, m] = useMsg(); const staff = useStaff(); const act = useScheduledActions(m);
  const [tab, setTab] = useState<Tab>("due"); const [mineOnly, setMineOnly] = useState(true); const [resched, setResched] = useState<{ id: string; at: string } | null>(null);
  const rows = useQuery({ queryKey: ["crm-scheduled", mineOnly, user?.id], refetchInterval: 30000, queryFn: async () => {
    let qy = supabase.from("crm_scheduled_messages").select("id, conversation_id, person_id, body, scheduled_for, status, assignee_user_id, sent_at, cancelled_at, person:people(full_name, person_contacts(type, normalized))").order("scheduled_for", { ascending: true }).limit(300);
    if (mineOnly && user?.id) qy = qy.eq("assignee_user_id", user.id);
    const { data, error } = await qy; if (error) throw error; return data as unknown as ScheduledRow[];
  } });
  const now = Date.now(); const all = rows.data ?? [];
  const isDue = (r: ScheduledRow) => r.status === "scheduled" && new Date(r.scheduled_for).getTime() <= now;
  const buckets: Record<Tab, ScheduledRow[]> = {
    due: all.filter(isDue), scheduled: all.filter((r) => r.status === "scheduled" && !isDue(r)),
    sent: all.filter((r) => r.status === "sent").reverse(), cancelled: all.filter((r) => r.status === "cancelled").reverse(),
  };
  const list = buckets[tab]; const nameOf = (id: string | null) => (id === user?.id ? "Você" : staff.data?.find((u) => u.user_id === id)?.name ?? "Equipe");

  return (
    <div>
      <PageHead eyebrow="CRM · Comunicação" title="Lembretes de envio" hint="O HP não envia sozinho. No horário, o responsável abre o WhatsApp com o texto; o HP registra a abertura, sem confirmação de envio nem de entrega." />
      <Msg m={msg} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <Tabs tabs={[["due", `Vencidos (${buckets.due.length})`], ["scheduled", `Agendados (${buckets.scheduled.length})`], ["sent", `WhatsApp aberto (${buckets.sent.length})`], ["cancelled", `Cancelados (${buckets.cancelled.length})`]]} value={tab} onChange={(v) => setTab(v as Tab)} />
        <label className="flex items-center gap-2 text-sm font-normal"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />Só as minhas</label>
      </div>
      <State loading={rows.isLoading} error={rows.error} empty={!rows.isLoading && list.length === 0} emptyText={tab === "due" ? "Nenhum lembrete vencido." : "Nenhum lembrete nesta lista."} />
      {list.length > 0 && (
        <Table head={["Contato", "Texto", "Quando", "Responsável", "Estado", ""]}>
          {list.map((r) => (
            <tr key={r.id} data-testid="sched-row">
              <Td><Link className="text-accent hover:underline" to={`/admin/crm/conversas?c=${r.conversation_id}`}>{r.person?.full_name ?? "—"}</Link></Td>
              <Td className="max-w-[22rem]"><span className="line-clamp-2" title={r.body}>{r.body}</span></Td>
              <Td>{fmtDateTime(r.scheduled_for)}</Td>
              <Td>{nameOf(r.assignee_user_id)}</Td>
              <Td>{r.status === "sent" ? <Badge tone="success">WhatsApp aberto · {fmtDateTime(r.sent_at)}</Badge> : r.status === "cancelled" ? <Badge>Cancelado</Badge> : isDue(r) ? <Badge tone="warning">Vencido</Badge> : <Badge tone="info">Agendado</Badge>}</Td>
              <Td>
                {r.status === "scheduled" && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button className="hp-btn hp-btn-primary hp-btn-sm" data-testid="sched-send" onClick={() => void act.sendNow(r, phoneOf(r.person?.person_contacts))}><MessageCircle size={13} aria-hidden />Abrir WhatsApp</button>
                    <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setResched(resched?.id === r.id ? null : { id: r.id, at: "" })}>Remarcar</button>
                    <button className="hp-btn hp-btn-outline hp-btn-sm" data-testid="sched-cancel" onClick={() => void act.cancel(r)}>Cancelar</button>
                    {resched?.id === r.id && (<><label htmlFor={`rs-${r.id}`} className="sr-only">Novo horário</label><input id={`rs-${r.id}`} type="datetime-local" className="!w-auto" value={resched.at} onChange={(e) => setResched({ id: r.id, at: e.target.value })} />
                      <button className="hp-btn hp-btn-outline hp-btn-sm" disabled={!resched.at} onClick={() => { void act.reschedule(r, resched.at).then(() => setResched(null)); }}>Salvar</button></>)}
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

export default MensagensAgendadas;
