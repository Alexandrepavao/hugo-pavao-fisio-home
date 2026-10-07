import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Msg, PageHead, errText, useMsg } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CRM_MANAGER_ROLES } from "./crmNav";
import ConversationList, { type Scope } from "./conversas/ConversationList";
import ConversationThread from "./conversas/ConversationThread";
import LeadPanel from "./conversas/LeadPanel";
import { refreshConversations, useMediaQuery, type InboxItem } from "./conversas/api";

const PANEL_KEY = "hp-conv-panel-v2";

/** Central de Conversas (CRM): lista à esquerda, mensagens no centro e ficha contextual do lead à direita (recolhível; no celular vira tela cheia + gaveta).
 *  A ficha fica RECOLHIDA por padrao e abre ao clicar no nome do lead. Sem provedor de WhatsApp: "Abrir WhatsApp" apenas abre o wa.me e REGISTRA a abertura (nunca "enviada"); respostas sao registradas a mao; "Lembrete de envio" vira tarefa (nada e enviado sozinho). Abrir por link: ?pessoa=<id>[&oportunidade=<id>] cria/abre a conversa. */
const Conversas = () => {
  const qc = useQueryClient(); const { user, hasRole } = useAuth(); const [sp, setSp] = useSearchParams(); const [msg, m] = useMsg();
  const [scope, setScope] = useState<Scope>("mine"); const [status, setStatus] = useState(""); const [q, setQ] = useState("");
  const selected = sp.get("c"); const wide = useMediaQuery("(min-width: 1280px)");
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === "1"; } catch { return false; } });
  const [sheet, setSheet] = useState(false);
  const myId = user?.id ?? null; const isManager = hasRole(...CRM_MANAGER_ROLES);
  const opening = useRef<string | null>(null);

  const inbox = useQuery({ queryKey: ["crm-inbox", scope, status, q], refetchInterval: 20000, queryFn: async () => {
    const { data, error } = await supabase.rpc("crm_conversations_inbox", { p_scope: scope, p_status: status || null, p_search: q || null, p_limit: 150 }); if (error) throw error; return (data ?? []) as InboxItem[];
  } });
  const unread = useQuery({ queryKey: ["crm-unread"], refetchInterval: 30000, queryFn: async () => { const { data, error } = await supabase.rpc("crm_conversations_unread"); if (error) throw error; return Number(data ?? 0); } });

  // link de outras telas: cria (ou reaproveita) a conversa da pessoa e abre
  useEffect(() => {
    const pessoa = sp.get("pessoa"); if (!pessoa || opening.current === pessoa) return; opening.current = pessoa;
    void (async () => {
      const { data, error } = await supabase.rpc("crm_conversation_open", { p_person: pessoa, p_opportunity: sp.get("oportunidade") || null, p_channel: "whatsapp" });
      const next = new URLSearchParams(sp); next.delete("pessoa"); next.delete("oportunidade");
      if (error) { m.err(`Não foi possível abrir a conversa: ${errText(error)}`); setSp(next, { replace: true }); return; }
      next.set("c", data as string); setSp(next, { replace: true }); refreshConversations(qc, data as string);
    })();
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string | null) => { const next = new URLSearchParams(sp); if (id) next.set("c", id); else next.delete("c"); setSp(next); };
  const togglePanel = () => { if (wide) { const v = !panelOpen; setPanelOpen(v); try { localStorage.setItem(PANEL_KEY, v ? "1" : "0"); } catch { /* sem storage */ } } else setSheet((v) => !v); };
  const items = inbox.data ?? [];
  const sel = selected ? items.find((c) => c.id === selected) : undefined;
  // a ficha precisa de pessoa/oportunidade; se a conversa aberta não está na lista filtrada, busca os dados dela
  const conv = useQuery({ queryKey: ["crm-conv-lite", selected], enabled: !!selected, queryFn: async () => {
    const { data, error } = await supabase.from("crm_conversations").select("id, person_id, opportunity_id, unit_id, person:people(full_name, person_contacts(type, normalized, is_primary))").eq("id", selected!).single(); if (error) throw error;
    return data as unknown as { id: string; person_id: string; opportunity_id: string | null; unit_id: string; person: { full_name: string; person_contacts: { type: string; normalized: string; is_primary: boolean }[] } | null };
  } });
  const phone = sel?.phone ?? [...(conv.data?.person?.person_contacts ?? [])].filter((c) => c.type === "phone").sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0]?.normalized ?? null;
  const showPanel = !!selected && !!conv.data && wide && panelOpen;

  const panel = conv.data && selected ? (
    <LeadPanel personId={conv.data.person_id} opportunityId={conv.data.opportunity_id} name={conv.data.person?.full_name ?? "—"} phone={phone} conversationId={selected} myId={myId} isManager={isManager} />
  ) : null;

  return (
    <div>
      <div className={selected ? "hidden lg:block" : ""}><PageHead eyebrow="CRM · Comunicação" title="Conversas" /></div>
      <Msg m={msg} />
      <div className={`hp-card overflow-hidden grid h-[calc(100dvh-8.5rem)] lg:h-[calc(100dvh-15rem)] min-h-[30rem] ${showPanel ? "lg:grid-cols-[20rem_minmax(0,1fr)_20rem]" : "lg:grid-cols-[20rem_minmax(0,1fr)]"}`} data-testid="conversas">
        <div className={`${selected ? "hidden lg:block" : "block"} min-h-0 h-full`}>
          <ConversationList items={items} loading={inbox.isLoading} error={!!inbox.error} scope={scope} onScope={setScope} status={status} onStatus={setStatus} q={q} onQ={setQ} selected={selected} onSelect={select} counts={{ unread: unread.data ?? 0 }} />
        </div>
        <div className={`${selected ? "block" : "hidden lg:block"} min-h-0 h-full min-w-0`}>
          {selected
            ? <ConversationThread key={selected} id={selected} myId={myId} isManager={isManager} onBack={() => select(null)} panelOpen={wide ? panelOpen : sheet} onTogglePanel={togglePanel} onMsg={m} />
            : <div className="h-full grid place-items-center p-6 text-center bg-background"><div className="max-w-xs grid gap-2 justify-items-center"><MessageCircle size={32} className="text-muted-foreground" aria-hidden /><p className="font-medium">Escolha uma conversa</p><p className="text-sm text-muted-foreground">Clique no nome do lead, no topo da conversa, para abrir a ficha com os campos do nicho.</p></div></div>}
        </div>
        {showPanel && <aside aria-label="Ficha do lead" className="hidden xl:block min-h-0 h-full border-l border-border">{panel}</aside>}
      </div>

      {!wide && (
        <Sheet open={sheet && !!panel} onOpenChange={setSheet}>
          <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
            <SheetHeader className="px-4 pt-4 pb-2 border-b border-border text-left"><SheetTitle>Ficha do lead</SheetTitle><SheetDescription>Dados administrativos e do nicho desta conversa.</SheetDescription></SheetHeader>
            <div className="flex-1 min-h-0 overflow-hidden">{panel}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};

export default Conversas;
