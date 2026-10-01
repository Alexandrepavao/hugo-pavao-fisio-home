import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errText } from "@/lib/ui";
import type { StaffUser } from "../types";

export interface Participant { user_id: string; name: string; role: "owner" | "collaborator" }
export interface InboxItem {
  id: string; person_id: string; full_name: string; opportunity_id: string | null; opportunity_title: string | null; niche: string | null; stage: string | null;
  status: "open" | "pending" | "resolved"; channel: "whatsapp" | "phone" | "email"; unit_id: string;
  last_message_at: string | null; last_message_preview: string | null; last_message_direction: "inbound" | "outbound" | "note" | "system" | null;
  unread: boolean; phone: string | null; participants: Participant[]; scheduled_pending: number;
}
export interface ConvMessage { id: string; direction: "inbound" | "outbound" | "note" | "system"; body: string; delivery: "registered" | "whatsapp_opened"; author_user_id: string | null; created_at: string }
export interface ScheduledRow {
  id: string; conversation_id: string; person_id: string; body: string; scheduled_for: string; status: "scheduled" | "sent" | "cancelled"; assignee_user_id: string | null;
  sent_at: string | null; cancelled_at: string | null; person: { full_name: string; person_contacts: { type: string; normalized: string }[] } | null;
}

/** wa.me só com dígitos; abrir o link NÃO prova envio nem entrega — o HP registra "WhatsApp aberto". */
export const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
export const phoneOf = (contacts: { type: string; normalized: string; is_primary?: boolean }[] | undefined) =>
  [...(contacts ?? [])].filter((c) => c.type === "phone").sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))[0]?.normalized ?? null;
export const fmtPhone = (p: string | null) => {
  if (!p) return "—"; const d = p.replace(/\D/g, ""); const n = d.startsWith("55") ? d.slice(2) : d;
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : n.length === 10 ? `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}` : p;
};

const CRM_ROLES = ["manager", "ops_admin", "unit_manager", "sales"];
/** Quem pode atender conversas do CRM (o servidor valida de novo: papel do CRM na unidade da conversa). */
export const useStaff = () => useQuery({ queryKey: ["assignable-crm"], queryFn: async () =>
  (((await supabase.rpc("list_assignable_users", {})).data ?? []) as (StaffUser & { roles: string[] })[]).filter((u) => u.roles.some((r) => CRM_ROLES.includes(r))) });

export const useMediaQuery = (q: string) => {
  const [on, setOn] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : false));
  useEffect(() => { const mql = window.matchMedia(q); const fn = () => setOn(mql.matches); fn(); mql.addEventListener("change", fn); return () => mql.removeEventListener("change", fn); }, [q]);
  return on;
};

export const refreshConversations = (qc: QueryClient, id?: string | null) => {
  void qc.invalidateQueries({ queryKey: ["crm-inbox"] });
  void qc.invalidateQueries({ queryKey: ["crm-unread"] });
  void qc.invalidateQueries({ queryKey: ["crm-scheduled"] });
  if (id) { void qc.invalidateQueries({ queryKey: ["crm-conv", id] }); void qc.invalidateQueries({ queryKey: ["crm-msgs", id] }); void qc.invalidateQueries({ queryKey: ["crm-conv-sched", id] }); }
  void qc.invalidateQueries({ queryKey: ["opp-hist"] }); void qc.invalidateQueries({ queryKey: ["opp-tasks"] }); void qc.invalidateQueries({ queryKey: ["crm-tasks-page"] });
};

/** Ações da mensagem agendada (usadas na conversa e na página "Mensagens agendadas"). O envio é SEMPRE manual: abre o WhatsApp e registra. */
export const useScheduledActions = (onMsg: { ok: (t: string) => void; err: (t: string) => void }) => {
  const qc = useQueryClient();
  const done = (id?: string | null) => refreshConversations(qc, id);
  return {
    cancel: async (s: { id: string; conversation_id: string }) => { const { error } = await supabase.rpc("crm_scheduled_cancel", { p_id: s.id }); if (error) return onMsg.err(errText(error)); onMsg.ok("Mensagem agendada cancelada."); done(s.conversation_id); },
    reschedule: async (s: { id: string; conversation_id: string }, when: string) => {
      const { error } = await supabase.rpc("crm_scheduled_reschedule", { p_id: s.id, p_when: new Date(when).toISOString() }); if (error) return onMsg.err(errText(error)); onMsg.ok("Mensagem remarcada."); done(s.conversation_id);
    },
    /** abre o WhatsApp (se houver telefone) e registra o envio; o pop-up é aberto antes do await para não ser bloqueado */
    sendNow: async (s: { id: string; conversation_id: string; body: string }, phone: string | null) => {
      if (!phone) return onMsg.err("Esta pessoa não tem telefone cadastrado: não há para onde abrir o WhatsApp.");
      window.open(waLink(phone, s.body), "_blank", "noopener,noreferrer");
      const { error } = await supabase.rpc("crm_scheduled_mark_sent", { p_id: s.id });
      if (error) return onMsg.err(`O WhatsApp foi aberto, mas o registro falhou: ${errText(error)}`);
      onMsg.ok("WhatsApp aberto e envio registrado (o HP não confirma a entrega)."); done(s.conversation_id);
    },
  };
};
