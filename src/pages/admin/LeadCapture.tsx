import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, toExclusive, type RangePreset } from "@/lib/period";
import { Badge, PageHead, State, StatCard, Table, Td, btnGhost, type Tone } from "@/lib/ui";

interface LeadRow {
  id: string; journey: "atendimento" | "parceria"; status: "started" | "partial" | "completed";
  full_name: string; email: string; phone: string; city: string | null; state_uf: string | null;
  origin_path: string | null; page_slug: string | null; started_at: string; completed_at: string | null; last_activity_at: string;
  owner_user_id: string | null; stage_name: string | null; next_contact_at: string | null; needs_review: boolean; wants_academy: boolean;
  whatsapp_clicked_at: string | null; person_id: string; opportunity_id: string; has_health_answers: boolean; total_count: number;
}

interface LeadDetail {
  id: string; journey: string; status: string; full_name: string; email: string; phone: string; city: string | null; state_uf: string | null;
  answers: Record<string, { value: unknown; label: string; detalhe?: string }>; health_answers_restricted: boolean;
  contact_consent_version: string; contact_consent_at: string; health_consent_version: string | null; health_consent_at: string | null;
  marketing_consent: boolean; marketing_consent_version: string | null; marketing_consent_at: string | null;
  wants_academy: boolean; needs_review: boolean; origin_path: string | null; page_slug: string | null; referrer: string | null;
  owner_user_id: string | null; person_id: string; opportunity_id: string; stage_name: string | null; next_contact_at: string | null;
  started_at: string; completed_at: string | null; last_activity_at: string; whatsapp_clicked_at: string | null;
}

const statusTone: Record<string, Tone> = { started: "neutral", partial: "warning", completed: "success" };
const statusLabel: Record<string, string> = { started: "Iniciado", partial: "Em progresso", completed: "Concluído" };
const PAGE_SIZE = 25;

const LeadCapture = () => {
  const [journey, setJourney] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [needsReview, setNeedsReview] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [preset, setPreset] = useState<RangePreset>("mes"); const [custom, setCustom] = useState(presetRange("mes"));
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);

  const leads = useQuery({
    queryKey: ["quiz-leads", journey, status, needsReview, search, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_quiz_leads", {
        p_journey: journey || null, p_status: status || null,
        p_needs_review: needsReview === "" ? null : needsReview === "true",
        p_search: search || null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return data as LeadRow[];
    },
  });

  const metrics = useQuery({
    queryKey: ["quiz-lead-metrics", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("quiz_lead_metrics", { p_from: `${from}T00:00:00.000Z`, p_to: toExclusive(to) });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });

  const detail = useQuery({
    queryKey: ["quiz-lead-detail", sel],
    enabled: !!sel,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_quiz_lead_detail", { p_id: sel });
      if (error) throw error;
      return data as LeadDetail;
    },
  });

  const total = leads.data?.[0]?.total_count ?? 0;

  return (
    <div>
      <PageHead eyebrow="Comercial" title="Captação de leads" hint="Submissões dos quizzes de avaliação (atendimento) e parceria — integradas automaticamente ao CRM. Respostas sobre saúde só aparecem para quem tem permissão de gestão." />

      <MetricsPanel metrics={metrics.data} loading={metrics.isLoading} preset={preset} custom={custom} setPreset={setPreset} setCustom={setCustom} />

      <div className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end">
        <div><label htmlFor="lc-journey" className="block text-xs mb-1">Jornada</label>
          <select id="lc-journey" value={journey} onChange={(e) => { setJourney(e.target.value); setPage(0); }}>
            <option value="">Todas</option><option value="atendimento">Atendimento</option><option value="parceria">Parceria</option>
          </select></div>
        <div><label htmlFor="lc-status" className="block text-xs mb-1">Status</label>
          <select id="lc-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">Todos</option><option value="started">Iniciado</option><option value="partial">Em progresso</option><option value="completed">Concluído</option>
          </select></div>
        <div><label htmlFor="lc-review" className="block text-xs mb-1">Revisão</label>
          <select id="lc-review" value={needsReview} onChange={(e) => { setNeedsReview(e.target.value); setPage(0); }}>
            <option value="">Todas</option><option value="true">Precisa revisar</option><option value="false">Sem pendência</option>
          </select></div>
        <div className="sm:col-span-2"><label htmlFor="lc-search" className="block text-xs mb-1">Buscar (nome, e-mail, telefone)</label>
          <input id="lc-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
      </div>

      <State loading={leads.isLoading} error={leads.error} empty={leads.data?.length === 0} emptyText="Nenhuma captação encontrada com esses filtros." />
      {leads.data && leads.data.length > 0 && (
        <>
          <Table head={["Nome / contato", "Jornada", "Status", "Cidade/UF", "Origem", "Etapa comercial", "Próx. contato", "Última atividade", ""]}>
            {leads.data.map((l) => (
              <tr key={l.id}>
                <Td>{l.full_name}{l.needs_review && <Badge tone="warning">Revisar</Badge>}{l.wants_academy && <Badge tone="gold">Academy</Badge>}
                  <div className="text-xs text-muted-foreground">{l.email} · {l.phone}</div></Td>
                <Td>{l.journey === "atendimento" ? "Atendimento" : "Parceria"}</Td>
                <Td><Badge tone={statusTone[l.status]}>{statusLabel[l.status]}</Badge></Td>
                <Td>{l.city ? `${l.city}/${l.state_uf ?? "—"}` : "—"}</Td>
                <Td>{l.origin_path ?? "—"}</Td>
                <Td>{l.stage_name ?? "—"}</Td>
                <Td>{l.next_contact_at ? fmtDateTime(l.next_contact_at) : "—"}</Td>
                <Td>{fmtDateTime(l.last_activity_at)}</Td>
                <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(l.id === sel ? null : l.id)}>{l.id === sel ? "Fechar" : "Detalhes"}</button></Td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
            <span>{total} captação(ões) no total</span>
            <div className="flex gap-2">
              <button className={btnGhost + " hp-btn-sm"} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button className={btnGhost + " hp-btn-sm"} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        </>
      )}

      {sel && <DetailPanel detail={detail.data} loading={detail.isLoading} />}
    </div>
  );
};

const MetricsPanel = ({ metrics, loading, preset, custom, setPreset, setCustom }: {
  metrics: Record<string, unknown> | undefined; loading: boolean; preset: RangePreset; custom: { from: string; to: string };
  setPreset: (p: RangePreset) => void; setCustom: (c: { from: string; to: string }) => void;
}) => (
  <div className="mb-6">
    <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit="" units={[]} compare={false}
      onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }}
      onFrom={(v) => setCustom({ ...custom, from: v })} onTo={(v) => setCustom({ ...custom, to: v })}
      onUnit={() => {}} onCompare={() => {}} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); }} />
    <State loading={loading} error={undefined} />
    {metrics && (
      <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 mt-3">
        <StatCard label="Captados — atendimento" value={(metrics.captured_by_journey as Record<string, number>)?.atendimento ?? 0} />
        <StatCard label="Captados — parceria" value={(metrics.captured_by_journey as Record<string, number>)?.parceria ?? 0} />
        <StatCard label="Taxa de conclusão" value={metrics.completion_rate_pct != null ? `${metrics.completion_rate_pct}%` : "—"} basis="Concluídos / total iniciado no período" />
        <StatCard label="Aguardando 1º contato" value={metrics.awaiting_contact as number} basis="Concluídos sem interação comercial registrada" />
        <StatCard label="Tempo médio até 1º contato" value={metrics.avg_minutes_to_first_contact != null ? `${metrics.avg_minutes_to_first_contact} min` : "—"} />
        <StatCard label="Convertidos em avaliação agendada" value={metrics.converted_to_scheduled_evaluation as number} />
        <StatCard label="Convertidos em parceiro aprovado" value={metrics.converted_to_approved_partner as number} />
        <StatCard label="Segmento Potencial Academy" value={metrics.academy_segment_count as number} />
        <StatCard label="Cliques no WhatsApp" value={metrics.whatsapp_clicks as number} basis="Clique registrado — não confirma envio nem atendimento" />
      </ul>
    )}
  </div>
);

const DetailPanel = ({ detail, loading }: { detail: LeadDetail | undefined; loading: boolean }) => {
  if (loading || !detail) return <State loading={loading} error={undefined} />;
  return (
    <section className="mt-8 border-t border-border pt-6 hp-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">{detail.full_name}</h2>
        <div className="flex gap-2">
          <Link className={btnGhost + " hp-btn-sm"} to={`/admin/pessoas?person=${detail.person_id}`}>Ver pessoa</Link>
          <Link className={btnGhost + " hp-btn-sm"} to={`/admin/crm?opportunity=${detail.opportunity_id}`}>Ver oportunidade</Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-1">{detail.email} · {detail.phone} · {detail.city ? `${detail.city}/${detail.state_uf}` : "cidade não informada"}</p>

      <div className="grid sm:grid-cols-2 gap-6 mt-5">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Autorizações registradas</p>
          <ul className="text-sm space-y-1">
            <li>Contato: {detail.contact_consent_version} — {fmtDateTime(detail.contact_consent_at)}</li>
            <li>Dados de saúde: {detail.health_consent_version ? `${detail.health_consent_version} — ${fmtDateTime(detail.health_consent_at)}` : "não aplicável / não coletado"}</li>
            <li>Marketing: {detail.marketing_consent ? `Sim — ${detail.marketing_consent_version} (${fmtDateTime(detail.marketing_consent_at)})` : "Não autorizado"}</li>
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Linha do tempo</p>
          <ul className="text-sm space-y-1">
            <li>Iniciado: {fmtDateTime(detail.started_at)}</li>
            <li>Concluído: {detail.completed_at ? fmtDateTime(detail.completed_at) : "não concluído"}</li>
            <li>Última atividade: {fmtDateTime(detail.last_activity_at)}</li>
            <li>Clique no WhatsApp: {detail.whatsapp_clicked_at ? fmtDateTime(detail.whatsapp_clicked_at) : "não houve"}</li>
          </ul>
        </div>
      </div>

      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mt-6 mb-2">
        Respostas {detail.health_answers_restricted && <span className="normal-case text-warning">(respostas sobre saúde ocultas — permissão de gestão necessária)</span>}
      </p>
      <ul className="text-sm grid gap-1.5">
        {Object.entries(detail.answers).map(([k, v]) => (
          <li key={k} className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right">{v.label}{v.detalhe ? ` — ${v.detalhe}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default LeadCapture;
