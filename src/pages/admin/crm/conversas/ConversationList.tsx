import { Search } from "lucide-react";
import { Badge } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { initials } from "../types";
import { nicheOf, STATUS_LABEL } from "../niches";
import type { InboxItem } from "./api";

export type Scope = "mine" | "queue" | "all";
const SCOPES: [Scope, string][] = [["mine", "Minhas"], ["queue", "Fila"], ["all", "Todas"]];

const shortTime = (iso: string | null) => {
  if (!iso) return ""; const d = new Date(iso); const now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
};
const previewOf = (c: InboxItem) => {
  if (!c.last_message_preview) return "Sem mensagens ainda";
  const p = c.last_message_direction === "outbound" ? "Você: " : c.last_message_direction === "note" ? "Nota: " : "";
  return p + c.last_message_preview;
};

/** Coluna da esquerda: escopo (minhas/fila/todas), estado, busca e a lista de conversas. */
const ConversationList = ({ items, loading, error, scope, onScope, status, onStatus, q, onQ, selected, onSelect, counts }: {
  items: InboxItem[]; loading: boolean; error: boolean; scope: Scope; onScope: (s: Scope) => void; status: string; onStatus: (s: string) => void; q: string; onQ: (s: string) => void;
  selected: string | null; onSelect: (id: string) => void; counts: { unread: number };
}) => (
  <section aria-label="Lista de conversas" className="flex flex-col min-h-0 h-full border-r border-border bg-card">
    <div className="p-3 grid gap-2 border-b border-border">
      <div role="tablist" aria-label="Escopo das conversas" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {SCOPES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={scope === k} data-testid={`conv-scope-${k}`} onClick={() => onScope(k)}
            className={`h-8 rounded-md text-sm font-medium transition-colors ${scope === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {l}{k === "mine" && counts.unread > 0 && <span className="ml-1.5 inline-flex min-w-5 h-5 px-1 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px]" aria-label={`${counts.unread} não lidas`}>{counts.unread}</span>}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="conv-q" className="sr-only">Buscar conversa</label>
        <input id="conv-q" type="search" placeholder="Buscar por nome ou mensagem" value={q} onChange={(e) => onQ(e.target.value)} style={{ paddingLeft: "2rem" }} />
      </div>
      <div><label htmlFor="conv-status" className="sr-only">Estado</label>
        <select id="conv-status" value={status} onChange={(e) => onStatus(e.target.value)}>
          <option value="">Todos os estados</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></div>
    </div>
    <ul className="flex-1 overflow-y-auto" data-testid="conv-list">
      {loading && <li className="p-4 text-sm text-muted-foreground">Carregando conversas…</li>}
      {error && <li className="p-4 text-sm text-destructive" role="alert">Não foi possível carregar as conversas.</li>}
      {!loading && !error && items.length === 0 && (
        <li className="p-6 text-sm text-muted-foreground text-center">
          {scope === "mine" ? "Você não está em nenhuma conversa." : scope === "queue" ? "Nenhuma conversa aguardando atendente." : "Nenhuma conversa encontrada."}
          <span className="block pt-2">Abra uma conversa a partir de uma oportunidade no Pipeline ou na Gestão de leads.</span>
        </li>
      )}
      {items.map((c) => {
        const n = nicheOf(c.niche); const owner = c.participants.find((p) => p.role === "owner");
        return (
          <li key={c.id}>
            <button onClick={() => onSelect(c.id)} aria-current={selected === c.id ? "true" : undefined} data-testid="conv-item" data-unread={c.unread ? "1" : "0"}
              className={`w-full text-left flex gap-3 px-3 py-3 border-b border-border/60 transition-colors hover:bg-muted/60 ${selected === c.id ? "bg-primary/[.07]" : ""}`}>
              <span aria-hidden className="shrink-0 size-10 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-semibold">{initials(c.full_name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.full_name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground" title={fmtDateTime(c.last_message_at)}>{shortTime(c.last_message_at)}</span>
                </span>
                <span className={`block truncate text-[13px] ${c.unread ? "text-foreground" : "text-muted-foreground"}`}>{previewOf(c)}</span>
                <span className="flex flex-wrap items-center gap-1 pt-1">
                  {n && <Badge tone="gold">{n.short}</Badge>}
                  {c.stage && <Badge tone="info">{c.stage}</Badge>}
                  {c.status !== "open" && <Badge tone={c.status === "resolved" ? "success" : "warning"}>{STATUS_LABEL[c.status]}</Badge>}
                  {c.scheduled_pending > 0 && <Badge>{c.scheduled_pending} agendada{c.scheduled_pending > 1 ? "s" : ""}</Badge>}
                  {c.participants.length > 1 && <Badge>{c.participants.length} atendentes</Badge>}
                  {scope !== "mine" && <span className="text-[11px] text-muted-foreground">{owner ? owner.name : "Sem atendente"}</span>}
                  {c.unread && <span className="ml-auto size-2.5 rounded-full bg-primary" role="img" aria-label="Não lida" />}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  </section>
);
export default ConversationList;
