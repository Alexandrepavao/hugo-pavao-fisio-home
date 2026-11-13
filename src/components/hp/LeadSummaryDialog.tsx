import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl, fmtDateTime } from "@/lib/format";
import { Badge, State, btnGhost, btnPrimary } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { capitalOf, zoneLabel } from "@/lib/capitals";
import PersonFormAnswers from "@/components/hp/PersonFormAnswers";

interface OppRow {
  id: string; title: string; status: string; value_cents: number; owner_user_id: string | null; person_id: string; created_at: string; last_contact_at: string | null; next_contact_at: string | null; closed_at: string | null;
  source: string | null; campaign: string | null;
  person: { full_name: string; city: string | null; state_uf: string | null; neighborhood: string | null; zone: string | null } | null;
  stage: { name: string; kind: string } | null; pipeline: { name: string } | null; lost_reason: { name: string } | null;
}
interface Contact { type: string; value: string; is_primary: boolean }
const STATUS: Record<string, [string, "info" | "success" | "danger" | "neutral"]> = { open: ["Em aberto", "info"], won: ["Ganha", "success"], lost: ["Perdida", "danger"] };
const CH: Record<string, string> = { note: "Nota", call: "Ligação", meeting: "Reunião", whatsapp: "WhatsApp", email: "E-mail", system: "Sistema" };
const STALE_H = 48;
const digits = (v: string) => v.replace(/\D/g, "");
const waLink = (v: string) => { const d = digits(v); return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`; };
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);

/** Resumo de um lead (oportunidade) em um modal: quem é, como chegou, em que etapa está, há quanto tempo sem contato, últimos registros e próximas tarefas. Só leitura — as mesmas regras de acesso
 *  do CRM (o servidor só devolve o que o usuário pode ver). Para agir (mover de etapa, registrar contato) o botão abre a lista de oportunidades. */
const LeadSummaryDialog = ({ opportunityId, onClose }: { opportunityId: string | null; onClose: () => void }) => {
  const id = opportunityId;
  const opp = useQuery({
    queryKey: ["lead-summary", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("opportunities")
        .select("id, title, status, value_cents, owner_user_id, person_id, created_at, last_contact_at, next_contact_at, closed_at, source, campaign, person:people(full_name, city, state_uf, neighborhood, zone), stage:pipeline_stages(name, kind), pipeline:pipelines(name), lost_reason:loss_reasons(name)")
        .eq("id", id!).maybeSingle();
      if (error) throw error; return data as unknown as OppRow | null;
    },
  });
  const o = opp.data; const pid = o?.person_id;
  const contacts = useQuery({ queryKey: ["lead-summary-contacts", pid], enabled: !!pid, queryFn: async () => ((await supabase.from("person_contacts").select("type, value, is_primary").eq("person_id", pid!).order("is_primary", { ascending: false })).data ?? []) as Contact[] });
  const history = useQuery({ queryKey: ["lead-summary-history", id], enabled: !!id, queryFn: async () => (await supabase.from("interactions").select("id, channel, summary, created_at").eq("opportunity_id", id!).order("created_at", { ascending: false }).limit(3)).data ?? [] });
  const tasks = useQuery({ queryKey: ["lead-summary-tasks", id], enabled: !!id, queryFn: async () => (await supabase.from("crm_tasks").select("id, title, due_at").eq("opportunity_id", id!).is("done_at", null).order("due_at").limit(3)).data ?? [] });
  const users = useQuery({ queryKey: ["assignable"], enabled: !!id, queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as { user_id: string; name: string }[] });

  const phone = contacts.data?.find((c) => c.type === "phone" || c.type === "whatsapp"); const email = contacts.data?.find((c) => c.type === "email");
  const last = o ? (o.last_contact_at ?? o.created_at) : null; const stale = !!o && o.status === "open" && !!last && Date.now() - new Date(last).getTime() > STALE_H * 36e5;
  const owner = o?.owner_user_id ? users.data?.find((u) => u.user_id === o.owner_user_id)?.name : null;
  const p = o?.person; const sp = !!capitalOf(p?.city, p?.state_uf);   // capital com zonas liberadas: mostra bairro e zona
  const place = p ? [sp && p.neighborhood ? p.neighborhood : null, p.city && p.state_uf ? `${p.city}/${p.state_uf}` : p.city].filter(Boolean).join(" · ") : "";
  const st = o ? STATUS[o.status] : null;

  return (
    <Dialog open={!!id} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto" data-testid="lead-resumo">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[1.0625rem]">{p?.full_name ?? "Resumo do lead"}</DialogTitle>
          <DialogDescription>{o ? o.title : "Resumo do lead"}</DialogDescription>
        </DialogHeader>
        <State loading={opp.isLoading} error={opp.error} empty={!!id && !opp.isLoading && !opp.error && !o} emptyText="Não encontrei este lead (ou você não tem acesso a ele)." />
        {o && (<div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            {st && <Badge tone={st[1]}>{st[0]}</Badge>}{o.stage && <Badge>{o.stage.name}</Badge>}{o.pipeline && <Badge tone="gold">{o.pipeline.name}</Badge>}
            {stale && last && <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "hsl(var(--warning))" }}><AlertTriangle size={13} aria-hidden />Sem contato há {daysSince(last)} dias</span>}
          </div>

          <div className="grid gap-1.5" data-testid="lead-resumo-contato">
            {phone && <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1.5"><Phone size={14} aria-hidden className="text-muted-foreground" /><a className="hover:underline" href={`tel:${digits(phone.value)}`}>{phone.value}</a></span>
              <a className="inline-flex items-center gap-1 text-accent hover:underline text-[13px]" href={waLink(phone.value)} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden />WhatsApp</a></div>}
            {email && <span className="inline-flex items-center gap-1.5 min-w-0"><Mail size={14} aria-hidden className="text-muted-foreground shrink-0" /><a className="hover:underline break-all" href={`mailto:${email.value}`}>{email.value}</a></span>}
            {!phone && !email && !contacts.isLoading && <p className="text-muted-foreground">Sem telefone nem e-mail cadastrados.</p>}
            {place && <span className="inline-flex items-center gap-1.5"><MapPin size={14} aria-hidden className="text-muted-foreground" />{place}{sp && p?.zone ? <Badge tone="info">{zoneLabel(p.zone)}</Badge> : null}</span>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border p-3" data-testid="lead-resumo-fatos">
            <div><dt className="text-xs text-muted-foreground">Chegou em</dt><dd>{fmtDateTime(o.created_at)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Último contato</dt><dd>{o.last_contact_at ? fmtDateTime(o.last_contact_at) : "Nenhum ainda"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Origem</dt><dd>{[o.source, o.campaign].filter(Boolean).join(" · ") || "Não informada"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Responsável</dt><dd>{owner ?? (o.owner_user_id ? "—" : "Sem responsável")}</dd></div>
            {o.value_cents > 0 && <div><dt className="text-xs text-muted-foreground">Valor</dt><dd className="tabular">{brl(o.value_cents)}</dd></div>}
            {o.next_contact_at && o.status === "open" && <div><dt className="text-xs text-muted-foreground">Próximo contato</dt><dd>{fmtDateTime(o.next_contact_at)}</dd></div>}
            {o.status === "lost" && <div><dt className="text-xs text-muted-foreground">Motivo da perda</dt><dd>{o.lost_reason?.name ?? "Não informado"}</dd></div>}
            {o.closed_at && <div><dt className="text-xs text-muted-foreground">Fechada em</dt><dd>{fmtDateTime(o.closed_at)}</dd></div>}
          </dl>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Últimos registros</p>
            {history.data && history.data.length > 0 ? <ul className="grid gap-1.5" data-testid="lead-resumo-historico">{history.data.map((h) => (
              <li key={h.id} className="rounded-lg border border-border px-3 py-2"><p className="text-xs text-muted-foreground">{CH[h.channel] ?? h.channel} · {fmtDateTime(h.created_at)}</p><p className="line-clamp-3">{h.summary}</p></li>))}</ul>
              : <p className="text-muted-foreground">{history.isLoading ? "Carregando…" : "Nenhum registro de contato nesta oportunidade."}</p>}
          </div>
          {tasks.data && tasks.data.length > 0 && (
            <div><p className="text-xs font-medium text-muted-foreground mb-1.5">Tarefas em aberto</p>
              <ul className="grid gap-1">{tasks.data.map((t) => <li key={t.id} className="flex justify-between gap-3"><span className="truncate">{t.title}</span><span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(t.due_at)}</span></li>)}</ul></div>)}

          {pid && <details className="rounded-lg border border-border px-3 py-2" data-testid="lead-resumo-formulario"><summary className="cursor-pointer text-[13px] font-medium">Respostas do formulário</summary><div className="mt-2"><PersonFormAnswers personId={pid} empty="Esta pessoa não preencheu formulário (quiz ou página): o contato veio por outro caminho." /></div></details>}

          <div className="flex flex-wrap justify-between gap-2 pt-1">
            <button type="button" className={btnGhost} onClick={onClose}>Fechar</button>
            <div className="flex flex-wrap gap-2">
              {p && <Link className={btnGhost} to={`/admin/pessoas?q=${encodeURIComponent(p.full_name)}`} onClick={onClose}>Ver cadastro</Link>}
              <Link className={btnPrimary} to="/admin/crm/oportunidades" onClick={onClose}>Abrir no CRM</Link>
            </div>
          </div>
        </div>)}
      </DialogContent>
    </Dialog>
  );
};
export default LeadSummaryDialog;
