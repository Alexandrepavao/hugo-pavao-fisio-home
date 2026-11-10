import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Banknote, Coins, MousePointer2, MousePointerClick, Percent, Radio, Receipt, Search, ShoppingCart, Target, TrendingUp, Users, Wallet, type LucideIcon } from "lucide-react";
import { Badge } from "@/lib/ui";
import { InfoTip, MetricCard, Panel, Sparkline, StateLine } from "./MktDashParts";
import { PLATFORM_LABEL, rpcArgs, useMktRpc, type CampaignRow, type FunnelDef, type FunnelRun, type KpisResp, type MktFilters, type SeriesResp } from "./mktApi";
import { METRICS, campaignResult, fmtValue, hasRealSeries, metricValue, pctChange, seriesOf, type MetricKey, type OverviewResp } from "./mktMetrics";

const ICONS: Record<MetricKey, LucideIcon> = { spend: Wallet, leads: Users, cpl: Target, sales: ShoppingCart, revenue: Banknote, roas: TrendingUp, impressions: Radio, cpm: Coins, clicks: MousePointerClick, ctr: Percent, cpc: MousePointer2, cps: Receipt };
const deltaOf = (cur: number | null, prev: number | null) => {
  const p = pctChange(cur, prev); if (p == null) return null;
  return { dir: (p > 0.05 ? "up" : p < -0.05 ? "down" : "flat") as "up" | "down" | "flat", text: `${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior` };
};

/** Até seis cartões compactos. Clique escolhe a métrica do gráfico; “Registros” abre os registros autorizados. Sem base → “Sem base” + motivo curto (nunca zero inventado). */
export const KpiGrid = ({ metrics, kp, ov, ovPrev, compare, points, selected, onSelect, onOpen, currency, loading }: {
  metrics: MetricKey[]; kp: KpisResp | undefined; ov: OverviewResp | undefined; ovPrev: OverviewResp | undefined; compare: boolean; points: SeriesResp["points"] | undefined; selected: MetricKey; onSelect: (m: MetricKey) => void;
  onOpen: (kind: string, title: string) => void; currency: string; loading: boolean;
}) => (
  <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3" data-testid="mkt-kpis">
    {loading && !kp ? metrics.map((m) => <div key={m} className="rounded-xl border border-border bg-card min-h-[110px] animate-pulse" aria-hidden />) : metrics.map((m) => {
      const def = METRICS[m]; const cur = metricValue(m, kp, ov); const prev = compare ? metricValue(m, kp, ovPrev, true) : null;
      const noBase = cur.value == null; const spark = !noBase && hasRealSeries(m, points) ? seriesOf(m, points) : null;
      const extra = cur.kpi ? [cur.kpi.source && `Fonte: ${cur.kpi.source}.`, cur.kpi.denominator && `Base: ${cur.kpi.denominator}.`].filter(Boolean).join(" ") : "";
      return (
        <MetricCard key={m} testId={`mkt-metric-${m}`} label={def.label} shortLabel={def.short} icon={ICONS[m]} value={fmtValue(m, cur.value, currency)} noBase={noBase} reason={cur.reason} warning={cur.kpi?.warning}
          info={<><p>{cur.kpi?.formula ?? def.info}</p>{cur.kpi?.formula && <p className="mt-1 text-muted-foreground">{def.info}</p>}{extra && <p className="mt-1 text-muted-foreground">{extra}</p>}</>}
          delta={!noBase && compare ? deltaOf(cur.value, prev?.value ?? null) : null} spark={spark} selected={selected === m} onSelect={() => onSelect(m)}
          onOpen={def.detail ? () => onOpen(def.detail!, def.label) : undefined} />);
    })}
  </div>
);

// ---------------------------------------------------------------- funil por coorte
const pct = (v: number | null) => (v == null ? "Sem base" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
export const pickFunnel = (funnels: FunnelDef[], frontLabel: string | null): FunnelDef | undefined => {
  const l = (frontLabel ?? "").toLowerCase();
  const want = l.includes("academy") ? "academy" : l.includes("fisio") || !l ? "pacientes" : "geral";
  return funnels.find((f) => f.name.toLowerCase().startsWith(want) && f.name.includes("(coorte)")) ?? funnels.find((f) => f.name.includes("(coorte)")) ?? funnels[0];
};
/** Funil por COORTE: leads captados no período e o que aconteceu com eles até hoje. Conversão = etapa ÷ etapa anterior dentro da coorte (nunca eventos independentes divididos). */
export const FunnelBlock = ({ f, funnels, frontLabel, onOpen, range }: { f: MktFilters; funnels: FunnelDef[]; frontLabel: string | null; onOpen: (kind: string, title: string, view?: "event" | "cohort") => void; range: string }) => {
  const [sel, setSel] = useState<string>(""); const auto = useMemo(() => pickFunnel(funnels, frontLabel), [funnels, frontLabel]);
  useEffect(() => { setSel(""); }, [frontLabel]);
  const cur = funnels.find((x) => x.id === sel) ?? auto;
  const run = useMktRpc<FunnelRun>("mkt_funnel_run", rpcArgs(f, { p_funnel: cur?.id, p_view: "cohort" }), !!cur);
  const d = run.data; const first = Math.max(1, ...(d?.steps ?? []).filter((s) => s.available && s.count != null).map((s) => s.count as number));
  return (
    <Panel title="Funil por coorte" testId="mkt-funnel-card" hint={<span className="inline-flex items-center gap-1">Leads captados em {range} e o que aconteceu com eles até hoje. <InfoTip title="Como ler o funil por coorte">Cada etapa conta quem a atingiu, dentro da coorte (leads captados no período). Conversão = etapa ÷ etapa anterior da mesma coorte — nunca eventos independentes divididos. O acompanhamento vai até hoje, sem corte; leads recentes ainda podem avançar. Clique numa etapa para ver os registros autorizados.</InfoTip></span>}
      right={funnels.length > 1 ? <select className="hp-input h-8 text-xs" style={{ width: "15rem", maxWidth: "100%" }} aria-label="Funil" value={cur?.id ?? ""} onChange={(e) => setSel(e.target.value)} data-testid="mkt-funnel-select">{funnels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : undefined}>
      {!cur ? <StateLine>Nenhum funil configurado. O administrador cria funis em Funil e atribuição.</StateLine>
        : run.isError ? <StateLine tone="danger" role="alert" action={<button type="button" className="text-primary font-medium hover:underline" onClick={() => void run.refetch()}>Tentar de novo</button>}>Falha ao carregar o funil.</StateLine>
        : !d ? <div className="h-40 rounded-lg bg-muted/40 animate-pulse" aria-hidden />
        : d.steps.every((s) => !s.available || !s.count) && (d.steps[0]?.count ?? 0) === 0 ? <StateLine>Nenhum lead captado neste período e escopo.</StateLine>
        : (
          <ol className="grid gap-1" data-testid="mkt-funnel">
            {d.steps.map((s, i) => (
              <li key={`${s.index}-${s.kind}`}>
                <button type="button" disabled={!s.available} onClick={() => onOpen(s.kind, s.label, "cohort")} data-testid={`mkt-funnel-step-${s.kind}`} aria-label={`${s.label}: ${s.available ? s.count : "sem base"}. Ver registros`}
                  title={s.available && s.rate_from_first != null && i > 0 ? `${pct(s.rate_from_first)} da coorte inicial${s.cost_per_step != null ? ` · custo por etapa ${fmtValue("spend", s.cost_per_step, d.currency)}` : ""}` : undefined}
                  className="w-full grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 disabled:opacity-100 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0"><span className="block text-[12.5px] font-medium truncate">{s.label}</span>
                    {s.available ? <span className="block mt-1 h-2 rounded-full bg-muted overflow-hidden"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, ((s.count ?? 0) / first) * 100)}%` }} /></span>
                      : <span className="block text-[11.5px] text-muted-foreground truncate" title={s.reason ?? undefined}>Sem base: {s.reason}</span>}</span>
                  <span className="text-right leading-tight"><span className="block tabular text-[17px] font-bold">{s.available ? (s.count ?? 0).toLocaleString("pt-BR") : "—"}</span>
                    {i > 0 && s.available && <span className="block text-[11px] text-muted-foreground tabular">{pct(s.rate_from_previous)} da anterior</span>}</span>
                </button>
              </li>))}
          </ol>)}
      {d && <p className="text-[11.5px] text-muted-foreground mt-2">Coorte: leads do período · janela: até hoje. Clique numa etapa para ver os registros.</p>}
    </Panel>
  );
};

// ---------------------------------------------------------------- campanhas em cartões
const STATUS: Record<string, string> = { active: "Ativa", enabled: "Ativa", paused: "Pausada", archived: "Arquivada", removed: "Removida", deleted: "Excluída", pending_review: "Em revisão", disapproved: "Reprovada" };
export const statusLabel = (c: Pick<CampaignRow, "platform_status" | "origin">) => (c.origin === "manual" ? "Lançamento manual" : c.platform_status ? (STATUS[c.platform_status.toLowerCase()] ?? c.platform_status) : "Status não informado");
type Sort = "spend" | "result" | "cost" | "name";
const SORTS: Record<Sort, string> = { spend: "Maior investimento", result: "Mais resultados", cost: "Menor custo por resultado", name: "Nome" };
const TREND: Record<string, MetricKey> = { lead: "leads", qualified_lead: "leads", sale: "sales", enrollment: "sales", awareness: "impressions" };

const CampaignCard = ({ c, f, currency }: { c: CampaignRow; f: MktFilters; currency: string }) => {
  const loc = useLocation(); const r = campaignResult(c); const metric = TREND[c.primary_result ?? ""] ?? "spend";
  const ser = useMktRpc<SeriesResp>("mkt_series", rpcArgs(f, { p_view: f.view, p_filters: { ...f.filters, campaign: c.campaign_id } }));
  const real = hasRealSeries(metric, ser.data?.points); const detail = new URLSearchParams(loc.search); detail.set("campanha", c.campaign_id);
  return (
    <article className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 min-w-0" data-testid="mkt-campaign-card" aria-label={c.name}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13.5px] font-semibold leading-snug line-clamp-2 break-words min-w-0" title={c.name}>{c.name}</h4>
        <span className="shrink-0 whitespace-nowrap"><Badge tone="info">{PLATFORM_LABEL[c.platform] ?? c.platform}</Badge></span>
      </div>
      <div className="grid gap-0.5 text-[12px] text-muted-foreground min-w-0">
        {c.class_state === "pending" ? <span><Badge tone="warning">Aguardando classificação</Badge></span> : <span className="truncate" title="Classificação definida pelo administrador (não é o objetivo original da plataforma)">{[c.front, c.purpose].filter(Boolean).join(" · ") || "Sem tipo definido"}</span>}
        <span className="truncate" title="Situação informada pela plataforma (somente leitura; o HP não altera campanhas)">Situação: {statusLabel(c)}</span>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">Investimento</dt><dd className="tabular text-[15px] font-bold truncate" title={c.spend != null ? fmtValue("spend", c.spend, currency) : undefined}>{c.spend == null ? <span className="text-[12.5px] font-semibold text-muted-foreground">Sem base</span> : fmtValue("spend", c.spend, currency)}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground truncate" title={`Resultado principal: ${r.def.label}`}>{r.def.short}</dt><dd className="tabular text-[15px] font-bold truncate">{r.count == null ? <span className="text-[12.5px] font-semibold text-muted-foreground">Sem base</span> : r.count.toLocaleString("pt-BR")}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-muted-foreground truncate">{r.def.cost === "cpm" ? "CPM" : `Custo/${r.def.unitLabel}`}</dt><dd className="tabular text-[15px] font-bold truncate" title={r.cost != null ? fmtValue("spend", r.cost, currency) : undefined}>{r.cost == null ? <span className="text-[12.5px] font-semibold text-muted-foreground">Sem base</span> : fmtValue("spend", r.cost, currency)}</dd></div>
      </dl>
      <div className="flex items-end justify-between gap-2 mt-auto min-h-[30px]">
        {real ? <span className="flex items-center gap-2 text-[11px] text-muted-foreground"><Sparkline values={seriesOf(metric, ser.data?.points)} width={96} height={28} />{METRICS[metric].label} por {ser.data?.granularity === "week" ? "semana" : "dia"}</span> : <span />}
        <Link to={`/admin/marketing/anuncios?${detail.toString()}`} className="text-[12.5px] font-medium text-primary hover:underline shrink-0">Detalhar</Link>
      </div>
    </article>
  );
};

/** Campanhas em cartões com busca, ordenação e “Carregar mais” (sem despejar dezenas de uma vez). A tendência só aparece com série real. */
export const CampaignCards = ({ rows, currency, f, loading, error, onRetry }: { rows: CampaignRow[] | undefined; currency: string; f: MktFilters; loading: boolean; error: boolean; onRetry: () => void }) => {
  const [q, setQ] = useState(""); const [sort, setSort] = useState<Sort>("spend"); const [shown, setShown] = useState(9);
  useEffect(() => { setShown(9); }, [q, sort, rows]);
  const list = useMemo(() => {
    const k = (c: CampaignRow) => campaignResult(c);
    const base = (rows ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
    const by: Record<Sort, (a: CampaignRow, b: CampaignRow) => number> = {
      spend: (a, b) => (b.spend ?? -1) - (a.spend ?? -1), result: (a, b) => (k(b).count ?? -1) - (k(a).count ?? -1),
      cost: (a, b) => (k(a).cost ?? Infinity) - (k(b).cost ?? Infinity), name: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
    };
    return [...base].sort(by[sort]);
  }, [rows, q, sort]);
  return (
    <Panel title="Campanhas" testId="mkt-campaign-cards" hint={rows ? `${rows.length} campanha(s) no escopo. Situação da plataforma é somente leitura — o HP não pausa nem altera anúncios.` : undefined}
      right={<>
        <label className="relative"><Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="hp-input h-8 text-xs pl-8" style={{ width: "11rem" }} placeholder="Buscar campanha" aria-label="Buscar campanha" value={q} onChange={(e) => setQ(e.target.value)} data-testid="mkt-campaign-search" /></label>
        <select className="hp-input h-8 text-xs" style={{ width: "12.5rem" }} aria-label="Ordenar campanhas" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{Object.entries(SORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <InfoTip title="Resultado principal e custo">Cada campanha mostra o resultado principal configurado pelo administrador (leads, vendas, avaliações, parceiros, impressões…). Custo = investimento ÷ resultado, pelos totais. Sem investimento ou sem resultado: sem base.</InfoTip></>}>
      {error ? <StateLine tone="danger" role="alert" action={<button type="button" className="text-primary font-medium hover:underline" onClick={onRetry}>Tentar de novo</button>}>Falha ao carregar as campanhas.</StateLine>
        : loading && !rows ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="h-40 rounded-xl bg-muted/40 animate-pulse" />)}</div>
        : !rows || rows.length === 0 ? <StateLine action={<Link to="/admin/marketing/integracoes" className="text-primary font-medium hover:underline">Conectar conta</Link>}>Nenhuma campanha neste escopo. Conecte uma conta de anúncios ou lance o gasto manualmente.</StateLine>
        : list.length === 0 ? <StateLine>Nenhuma campanha encontrada para “{q}”.</StateLine>
        : (<>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.slice(0, shown).map((c) => <CampaignCard key={c.campaign_id} c={c} f={f} currency={currency} />)}</div>
          {list.length > shown && <div className="mt-3 flex justify-center"><button type="button" className="hp-btn hp-btn-outline" onClick={() => setShown((n) => n + 9)} data-testid="mkt-campaign-more">Carregar mais ({list.length - shown})</button></div>}
        </>)}
    </Panel>
  );
};
