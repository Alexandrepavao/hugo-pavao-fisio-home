import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import BrazilMap from "@/components/hp/BrazilMap";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, toExclusive, type RangePreset } from "@/lib/period";
import { Badge, PageHead, State, StatCard, Table, Td, Tabs, btnGhost, type Tone } from "@/lib/ui";
import CaptureAnalytics from "./CaptureAnalytics";

interface LeadRow {
  id: string; journey: "atendimento" | "parceria"; status: "started" | "partial" | "completed";
  full_name: string; email: string; phone: string; city: string | null; state_uf: string | null;
  origin_path: string | null; page_slug: string | null; started_at: string; completed_at: string | null; last_activity_at: string;
  owner_user_id: string | null; stage_name: string | null; next_contact_at: string | null; needs_review: boolean; wants_academy: boolean;
  whatsapp_clicked_at: string | null; person_id: string; opportunity_id: string; has_health_answers: boolean; academy_interest: boolean; total_count: number;
}

interface LeadGeo { total: number; sem_localizacao: number; by_state: { uf: string; count: number; pct: number }[]; by_city: { city: string; uf: string; count: number }[] }

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
/** Segmentos = tipo de lead (mesma lógica do CRM). Parceiro inclui quem também é Academy: a Academy é a parceria com interesse no programa de clínica própria. */
const SEGMENTS: [string, string][] = [["", "Todos"], ["patient", "Pacientes"], ["partner", "Parceiros"], ["academy", "HP Academy"]];
const SEG_NOUN: Record<string, string> = { "": "lead(s)", patient: "paciente(s)", partner: "parceiro(s)", academy: "interessado(s) na Academy" };

const LeadCapture = () => {
  const [segment, setSegment] = useState<string>("");
  const [uf, setUf] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [needsReview, setNeedsReview] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"leads" | "indicadores">("leads");
  const [preset, setPreset] = useState<RangePreset>("mes"); const [custom, setCustom] = useState(presetRange("mes"));
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const review = needsReview === "" ? null : needsReview === "true";

  const leads = useQuery({
    queryKey: ["quiz-leads", segment, status, needsReview, search, uf, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_quiz_leads", {
        p_segment: segment || null, p_status: status || null, p_needs_review: review,
        p_search: search || null, p_uf: uf, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return data as LeadRow[];
    },
  });

  // o mapa usa os mesmos filtros da lista, menos o estado (senão o estado clicado apagaria o resto do mapa)
  const geo = useQuery({
    queryKey: ["quiz-lead-geo", segment, status, needsReview, search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("quiz_lead_geo", { p_segment: segment || null, p_status: status || null, p_needs_review: review, p_search: search || null });
      if (error) throw error;
      return data as LeadGeo;
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
  const extraCount = (status ? 1 : 0) + (needsReview ? 1 : 0) + (search ? 1 : 0);
  const extraSummary = [status && statusLabel[status], needsReview === "true" && "Revisar", search && `"${search}"`].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHead eyebrow="Comercial" title="Captação de leads" hint="Submissões dos quizzes de avaliação (paciente) e parceria (parceiro e HP Academy) — integradas automaticamente ao CRM. Respostas sobre saúde só aparecem para quem tem permissão de gestão."
        actions={
          <PeriodFilter preset={preset} from={custom.from} to={custom.to} unit="" units={[]} compare={false}
            onPreset={(p) => { setPreset(p); if (p !== "personalizado") setCustom(presetRange(p)); }}
            onFrom={(v) => setCustom({ ...custom, from: v })} onTo={(v) => setCustom({ ...custom, to: v })}
            onUnit={() => {}} onCompare={() => {}} onClear={() => { setPreset("mes"); setCustom(presetRange("mes")); setSegment(""); setUf(null); setStatus(""); setNeedsReview(""); setSearch(""); setPage(0); }}
            extraCount={extraCount} extraSummary={extraSummary || undefined}
            extra={
              <div className="grid gap-3">
                <div><label htmlFor="lc-status" className="block text-xs mb-1">Status</label>
                  <select id="lc-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
                    <option value="">Todos</option><option value="started">Iniciado</option><option value="partial">Em progresso</option><option value="completed">Concluído</option>
                  </select></div>
                <div><label htmlFor="lc-review" className="block text-xs mb-1">Revisão</label>
                  <select id="lc-review" value={needsReview} onChange={(e) => { setNeedsReview(e.target.value); setPage(0); }}>
                    <option value="">Todas</option><option value="true">Precisa revisar</option><option value="false">Sem pendência</option>
                  </select></div>
                <div><label htmlFor="lc-search" className="block text-xs mb-1">Buscar (nome, e-mail, telefone)</label>
                  <input id="lc-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
              </div>
            } />
        } />

      <Tabs tabs={[["leads", "Captações"], ["indicadores", "Indicadores"]]} value={tab} onChange={(v) => setTab(v as "leads" | "indicadores")} />
      {tab === "indicadores" ? <CaptureAnalytics from={from} to={to} fromIso={`${from}T00:00:00.000Z`} toIso={toExclusive(to)} unit="" /> : (<>
      <LeadMap geo={geo.data} loading={geo.isLoading} error={geo.error} segment={segment} uf={uf}
        onSegment={(v) => { setSegment(v); setUf(null); setPage(0); }} onUf={(v) => { setUf(v); setPage(0); }} />
      <MetricsPanel metrics={metrics.data} loading={metrics.isLoading} />

      <h2 className="text-base font-medium mb-2">{uf ? `Captações em ${uf}` : "Todas as captações"}</h2>
      <State loading={leads.isLoading} error={leads.error} empty={leads.data?.length === 0} emptyText="Nenhuma captação encontrada com esses filtros." />
      {leads.data && leads.data.length > 0 && (
        <>
          <Table head={["Nome / contato", "Segmento", "Status", "Cidade/UF", "Origem", "Etapa comercial", "Próx. contato", "Última atividade"]}>
            {leads.data.map((l) => (
              <tr key={l.id}>
                <Td><button type="button" className="text-accent hover:underline font-medium text-left" aria-label={`Ver o que ${l.full_name} preencheu`} onClick={() => setSel(l.id)}>{l.full_name}</button>
                  {l.needs_review && <Badge tone="warning">Revisar</Badge>}
                  <div className="text-xs text-muted-foreground">{l.email} · {l.phone}</div></Td>
                <Td>{l.journey === "atendimento" ? "Paciente" : "Parceiro"}{l.academy_interest && <Badge tone="gold">Academy</Badge>}</Td>
                <Td><Badge tone={statusTone[l.status]}>{statusLabel[l.status]}</Badge></Td>
                <Td>{l.city || l.state_uf ? `${l.city ?? "—"}/${l.state_uf ?? "—"}` : <span className="text-muted-foreground">não informado</span>}</Td>
                <Td>{l.origin_path ?? "—"}</Td>
                <Td>{l.stage_name ?? "—"}</Td>
                <Td>{l.next_contact_at ? fmtDateTime(l.next_contact_at) : "—"}</Td>
                <Td>{fmtDateTime(l.last_activity_at)}</Td>
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

      <Sheet open={!!sel} onOpenChange={(o) => { if (!o) setSel(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0" data-testid="lead-detail">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{detail.data?.full_name ?? "Carregando…"}</SheetTitle>
            <SheetDescription>O que a pessoa preencheu no formulário</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {detail.error ? <State loading={false} error={detail.error} /> : <DetailPanel detail={detail.data} loading={detail.isLoading} />}
          </div>
        </SheetContent>
      </Sheet>
      </>)}
    </div>
  );
};

/** Mapa do Brasil com os leads por estado + os segmentos da lista. Clicar num estado filtra a lista logo abaixo. Localização = cidade/UF que a própria pessoa preencheu no quiz. */
const LeadMap = ({ geo, loading, error, segment, uf, onSegment, onUf }: {
  geo: LeadGeo | undefined; loading: boolean; error: unknown; segment: string; uf: string | null; onSegment: (v: string) => void; onUf: (v: string | null) => void;
}) => {
  const cities = (geo?.by_city ?? []).filter((c) => !uf || c.uf === uf).slice(0, 8);
  return (
    <section className="mb-6" aria-label="Mapa dos leads" data-testid="lead-map">
      <Tabs tabs={SEGMENTS} value={segment} onChange={onSegment} />
      <State loading={loading} error={error} />
      {geo && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="hp-card p-4">
            <h2 className="text-base font-medium mb-1">Onde estão os leads</h2>
            <p className="text-xs text-muted-foreground mb-3">Estado e cidade informados pela própria pessoa no formulário. Clique num estado para ver só os leads de lá.</p>
            {geo.by_state.length > 0
              ? <BrazilMap data={geo.by_state} selected={uf} onSelect={onUf} noun={SEG_NOUN[segment]} />
              : <p className="text-sm text-muted-foreground py-8 text-center">Nenhum lead com estado informado ainda{segment ? " neste segmento" : ""}.</p>}
          </div>
          <div className="hp-card p-4 self-start">
            <p className="text-sm"><strong className="tabular text-lg">{geo.total}</strong> no total</p>
            <p className="text-sm text-muted-foreground mt-1">
              <strong className="tabular">{geo.total - geo.sem_localizacao}</strong> com cidade e estado · <strong className="tabular">{geo.sem_localizacao}</strong> ainda sem local
              <span className="block text-xs">(pararam o formulário antes dessa etapa)</span>
            </p>
            {uf && <p className="mt-3 text-sm"><span className="font-semibold">Filtrando: {uf}</span> <button type="button" className="text-accent hover:underline ml-2" onClick={() => onUf(null)}>limpar</button></p>}
            {geo.by_state.length > 0 && (
              <ul className="mt-3 text-sm space-y-1" aria-label="Leads por estado">
                {geo.by_state.slice(0, 8).map((s) => (
                  <li key={s.uf}><button type="button" className={`flex justify-between w-full text-left ${uf === s.uf ? "font-semibold text-accent" : ""}`} aria-pressed={uf === s.uf} onClick={() => onUf(uf === s.uf ? null : s.uf)}>
                    <span>{s.uf}</span><span className="tabular text-muted-foreground">{s.count} ({String(s.pct).replace(".", ",")}%)</span></button></li>
                ))}
              </ul>
            )}
            {cities.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">{uf ? `Cidades em ${uf}` : "Cidades com mais leads"}</p>
                <ul className="text-sm space-y-1">{cities.map((c) => <li key={c.city + c.uf} className="flex justify-between"><span>{c.city}/{c.uf}</span><span className="tabular text-muted-foreground">{c.count}</span></li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

const MetricsPanel = ({ metrics, loading }: { metrics: Record<string, unknown> | undefined; loading: boolean }) => (
  <div className="mb-6">
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
  const programa = String((detail.answers.interesse_programa_clinica as { value?: unknown } | undefined)?.value ?? "");
  const academy = detail.journey === "parceria" && (programa === "sim" || programa === "quero_entender");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{detail.journey === "atendimento" ? "Paciente" : "Parceiro"}</Badge>
        {academy && <Badge tone="gold">HP Academy</Badge>}
        <Badge tone={statusTone[detail.status]}>{statusLabel[detail.status]}</Badge>
        <span className="flex-1" />
        <Link className={btnGhost + " hp-btn-sm"} to={`/admin/pessoas?person=${detail.person_id}`}>Ver pessoa</Link>
        <Link className={btnGhost + " hp-btn-sm"} to={`/admin/crm?opportunity=${detail.opportunity_id}`}>Ver oportunidade</Link>
      </div>

      <section className="hp-card p-4 mt-4 border-l-4 border-l-accent" data-testid="lead-location" aria-label="Localização informada">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Localização informada no formulário</p>
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-xs text-muted-foreground">Cidade</p><p className="text-lg font-semibold" data-testid="lead-city">{detail.city ?? <span className="text-muted-foreground font-normal">Não informada</span>}</p></div>
          <div><p className="text-xs text-muted-foreground">Estado (UF)</p><p className="text-lg font-semibold" data-testid="lead-uf">{detail.state_uf ?? <span className="text-muted-foreground font-normal">Não informado</span>}</p></div>
        </div>
        {(!detail.city || !detail.state_uf) && <p className="text-xs text-muted-foreground mt-2">Esta pessoa parou o formulário antes da etapa de cidade e estado (os dois são obrigatórios para concluir).</p>}
      </section>

      <section className="hp-card p-4 mt-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">Contato</p>
        <ul className="text-sm space-y-1">
          <li><span className="text-muted-foreground">Nome:</span> {detail.full_name}</li>
          <li><span className="text-muted-foreground">E-mail:</span> {detail.email}</li>
          <li><span className="text-muted-foreground">Telefone:</span> {detail.phone}</li>
          <li><span className="text-muted-foreground">Origem:</span> {detail.origin_path ?? "—"}{detail.page_slug ? ` (página ${detail.page_slug})` : ""}</li>
          <li><span className="text-muted-foreground">Etapa comercial:</span> {detail.stage_name ?? "—"}</li>
        </ul>
      </section>

      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mt-6 mb-2">
        Respostas do formulário {detail.health_answers_restricted && <span className="normal-case text-warning">(respostas sobre saúde ocultas — permissão de gestão necessária)</span>}
      </p>
      {Object.keys(detail.answers).length === 0
        ? <p className="text-sm text-muted-foreground">Ainda não respondeu às perguntas.</p>
        : (
          <ul className="text-sm grid gap-1.5">
            {Object.entries(detail.answers).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-4 border-b border-border/60 py-1.5">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-right">{v.label}{v.detalhe ? ` — ${v.detalhe}` : ""}</span>
              </li>
            ))}
          </ul>
        )}

      <div className="grid sm:grid-cols-2 gap-6 mt-6">
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
    </div>
  );
};

export default LeadCapture;
