import { Search } from "lucide-react";
import { initials } from "../types";
import { nicheOf, STATUS_LABEL } from "../niches";
import type { InboxItem } from "./api";

export type Scope = "mine" | "queue" | "all";
const SCOPES: [Scope, string][] = [["mine", "Minhas"], ["queue", "Fila"], ["all", "Todas"]];
const TZ = "America/Sao_Paulo";

/** Horário da última interação: hora no dia de hoje, “Ontem”, ou a data. */
const shortTime = (iso: string | null) => {
  if (!iso) return ""; const d = new Date(iso); const day = (x: Date) => x.toLocaleDateString("sv-SE", { timeZone: TZ });
  const today = new Date(); const yest = new Date(Date.now() - 864e5);
  if (day(d) === day(today)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  if (day(d) === day(yest)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ });
};
const previewOf = (c: InboxItem) => {
  if (!c.last_message_preview) return "Sem mensagens ainda";
  const p = c.last_message_direction === "outbound" ? "WhatsApp aberto: " : c.last_message_direction === "note" ? "Nota: " : "";
  return p + c.last_message_preview;
};

/** Coluna da esquerda (padrão “Chats” do shadcn Admin): título, busca, escopo e a lista — avatar, nome, última interação e horário. */
const ConversationList = ({ items, loading, error, scope, onScope, status, onStatus, q, onQ, selected, onSelect, counts }: {
  items: InboxItem[]; loading: boolean; error: boolean; scope: Scope; onScope: (s: Scope) => void; status: string; onStatus: (s: string) => void; q: string; onQ: (s: string) => void;
  selected: string | null; onSelect: (id: string) => void; counts: { unread: number };
}) => (
  <section aria-label="Lista de conversas" className="flex flex-col min-h-0 h-full border-r border-border bg-card">
    <div className="px-4 pt-4 pb-3 grid gap-3">
      <h2 className="text-lg font-semibold leading-6 flex items-center gap-2">Conversas{counts.unread > 0 && <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-medium" aria-label={`${counts.unread} não lidas`}>{counts.unread}</span>}</h2>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="conv-q" className="sr-only">Buscar conversa</label>
          <input id="conv-q" type="search" placeholder="Buscar conversa" value={q} onChange={(e) => onQ(e.target.value)} style={{ paddingLeft: "2rem" }} />
        </div>
        <div className="shrink-0"><label htmlFor="conv-status" className="sr-only">Estado</label>
          <select id="conv-status" value={status} onChange={(e) => onStatus(e.target.value)} className="!w-[6.75rem]">
            <option value="">Estado</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
      </div>
      <div role="tablist" aria-label="Escopo das conversas" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {SCOPES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={scope === k} data-testid={`conv-scope-${k}`} onClick={() => onScope(k)}
            className={`h-7 rounded-md text-[13px] font-medium transition-colors ${scope === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
      </div>
    </div>
    <ul className="flex-1 overflow-y-auto border-t border-border" data-testid="conv-list">
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
        const meta = [n?.short, c.stage, scope !== "mine" ? (owner ? owner.name : "Sem atendente") : null, c.status !== "open" ? STATUS_LABEL[c.status] : null].filter(Boolean).join(" · ");
        return (
          <li key={c.id}>
            <button onClick={() => onSelect(c.id)} aria-current={selected === c.id ? "true" : undefined} data-testid="conv-item" data-unread={c.unread ? "1" : "0"}
              className={`w-full text-left flex gap-3 px-4 py-3 border-b border-border/60 transition-colors hover:bg-muted/60 ${selected === c.id ? "bg-muted" : ""}`}>
              <span aria-hidden className="shrink-0 size-11 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-semibold">{initials(c.full_name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.full_name}</span>
                  <span className={`shrink-0 text-[11px] ${c.unread ? "text-primary font-medium" : "text-muted-foreground"}`}>{shortTime(c.last_message_at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`block truncate text-[13px] flex-1 ${c.unread ? "text-foreground" : "text-muted-foreground"}`}>{previewOf(c)}</span>
                  {c.unread && <span className="shrink-0 size-2.5 rounded-full bg-primary" role="img" aria-label="Não lida" />}
                </span>
                {meta && <span className="block truncate text-[11px] text-muted-foreground/80 pt-0.5">{meta}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  </section>
);
export default ConversationList;
