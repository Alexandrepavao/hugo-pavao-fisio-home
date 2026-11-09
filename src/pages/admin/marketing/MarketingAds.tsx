import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ImageIcon, Tag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge, Msg, PageHead, State, Table, Td, Tabs, errText, promptText, btnGhost } from "@/lib/ui";
import { BarBlock } from "@/lib/IndicatorCharts";
import { MktAssistantButton, MktFilterBar } from "./MktParts";
import { MKT_COLORS, PLATFORM_LABEL, money, num, rpcArgs, useMktFilters, useMktInvalidate, useMktOptions, useMktRpc, useNote, type AdRow, type ManagerResp, type ManagerRow } from "./mktApi";

interface AdsResp { currency: string; level: string; rows: AdRow[]; note: string; breakdowns: { kind: string; value: string; spend: number; impressions: number | null; clicks: number | null }[] }
const BD_LABEL: Record<string, string> = { publisher_platform: "Plataforma de publicação", platform_position: "Posicionamento", device: "Dispositivo" };
const pretty = (v: string) => v.replace(/^facebook$/i, "Facebook").replace(/^instagram$/i, "Instagram").replace(/_/g, " ");
const LEVEL: Record<string, string> = { campaign: "Campanha", adset: "Conjunto / grupo", ad: "Anúncio", unidentified: "Sem anúncio identificado" };
const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR")}%`);
const x = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR")}x`);

type Col = { id: string; label: string; hint?: string; num?: boolean; cell: (r: ManagerRow, cur: string) => string };
const COLS: Col[] = [
  { id: "spend", label: "Investimento", cell: (r, c) => money(r.spend, c, 0) },
  { id: "impressions", label: "Impressões", cell: (r) => num(r.impressions) }, { id: "clicks", label: "Cliques", cell: (r) => num(r.clicks) }, { id: "ctr", label: "CTR", cell: (r) => pct(r.ctr) }, { id: "cpc", label: "CPC", cell: (r, c) => (r.cpc == null ? "—" : money(r.cpc, c)) },
  { id: "reported", label: "Resultados reportados", hint: "Reportado pela plataforma; não é conversão confirmada", cell: (r) => num(r.reported_results) },
  { id: "leads", label: "Leads", cell: (r) => num(r.leads) }, { id: "mql", label: "MQL", hint: "Lead qualificado", cell: (r) => num(r.mql) }, { id: "sal", label: "SAL", hint: "Oportunidade com agendamento", cell: (r) => num(r.sal) },
  { id: "attended", label: "Compareceram", cell: (r) => num(r.attended) }, { id: "sales", label: "Vendas", cell: (r) => num(r.sales) },
  { id: "cpl", label: "CPL", cell: (r, c) => (r.cpl == null ? "—" : money(r.cpl, c)) }, { id: "cpmql", label: "CPMQL", hint: "Custo por MQL", cell: (r, c) => (r.cpmql == null ? "—" : money(r.cpmql, c)) },
  { id: "cpsal", label: "CPSAL", hint: "Custo por SAL", cell: (r, c) => (r.cpsal == null ? "—" : money(r.cpsal, c)) }, { id: "cpa", label: "CPA", hint: "Custo por venda", cell: (r, c) => (r.cpa == null ? "—" : money(r.cpa, c)) },
  { id: "sold", label: "Vendido", cell: (r, c) => money(r.sold, c, 0) }, { id: "received", label: "Recebido", cell: (r, c) => money(r.received, c, 0) }, { id: "roas", label: "ROAS", cell: (r) => x(r.roas) },
  { id: "roas7", label: "ROAS 7d", hint: "Vendido ÷ gasto nos últimos 7 dias do período", cell: (r) => x(r.w.d7.roas) }, { id: "roas3", label: "ROAS 3d", cell: (r) => x(r.w.d3.roas) }, { id: "roas1", label: "ROAS do dia", cell: (r) => x(r.w.d1.roas) },
  { id: "cpmql7", label: "CPMQL 7d", cell: (r, c) => (r.w.d7.cpmql == null ? "—" : money(r.w.d7.cpmql, c)) }, { id: "cpmql3", label: "CPMQL 3d", cell: (r, c) => (r.w.d3.cpmql == null ? "—" : money(r.w.d3.cpmql, c)) }, { id: "cpmql1", label: "CPMQL do dia", cell: (r, c) => (r.w.d1.cpmql == null ? "—" : money(r.w.d1.cpmql, c)) },
];
const PRESETS: Record<string, { label: string; cols: string[] }> = {
  captacao: { label: "Captação (MQL · SAL · Venda)", cols: ["spend", "leads", "mql", "sal", "sales", "cpl", "cpmql", "cpsal"] },
  resultado: { label: "Resultado financeiro", cols: ["spend", "sales", "sold", "received", "cpa", "roas"] },
  midia: { label: "Mídia", cols: ["spend", "impressions", "clicks", "ctr", "cpc", "reported"] },
  d731: { label: "Janelas 7-3-1", cols: ["spend", "roas", "roas7", "roas3", "roas1", "cpmql", "cpmql7", "cpmql3", "cpmql1"] },
};

const Manager = ({ d, cur }: { d: ManagerResp; cur: string }) => {
  const [preset, setPreset] = useState("captacao"); const [open, setOpen] = useState<Set<string>>(new Set()); const cols = PRESETS[preset].cols.map((id) => COLS.find((c) => c.id === id)!);
  const camps = d.rows.filter((r) => r.level === "campaign"); const kids = (id: string) => d.rows.filter((r) => r.campaign_id === id && r.level !== "campaign");
  const tot = useMemo(() => camps.reduce((a, r) => ({ spend: a.spend + (r.spend ?? 0), leads: a.leads + r.leads, mql: a.mql + r.mql, sal: a.sal + r.sal, sales: a.sales + r.sales, sold: a.sold + r.sold, received: a.received + r.received }), { spend: 0, leads: 0, mql: 0, sal: 0, sales: 0, sold: 0, received: 0 }), [camps]);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const closes = (id: string) => { const c = camps.find((r) => r.campaign_id === id)!; const k = kids(id).filter((r) => r.level === "adset" || r.level === "unidentified"); return k.length === 0 || (k.reduce((s, r) => s + r.leads, 0) === c.leads && k.reduce((s, r) => s + r.sales, 0) === c.sales); };
  return (
    <div data-testid="mkt-manager">
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Colunas">{Object.entries(PRESETS).map(([k, p]) => <button key={k} type="button" className="hp-chip" aria-pressed={preset === k} data-active={preset === k} onClick={() => setPreset(k)} style={{ padding: "0.3rem 0.8rem", borderRadius: 999, border: "1px solid hsl(var(--border))", background: preset === k ? "hsl(var(--primary))" : "transparent", color: preset === k ? "hsl(var(--primary-foreground))" : "inherit", fontSize: 13 }}>{p.label}</button>)}</div>
      <div className="hp-card overflow-x-auto">
        <table className="hp-table">
          <thead><tr><th scope="col">Campanha / conjunto / anúncio</th><th scope="col">Plataforma</th>{cols.map((c) => <th key={c.id} scope="col" className="text-right" title={c.hint}>{c.label}</th>)}</tr></thead>
          <tbody>
            {camps.length === 0 && <tr><Td className="text-muted-foreground">Nenhuma campanha neste escopo.</Td><Td>{""}</Td>{cols.map((c) => <Td key={c.id}>{""}</Td>)}</tr>}
            {camps.map((c) => (
              <Fragment key={c.campaign_id}>
                <tr data-testid="mgr-campaign" className="font-medium">
                  <Td><button type="button" className="flex items-center gap-1 text-left" aria-expanded={open.has(c.campaign_id)} onClick={() => toggle(c.campaign_id)}>{open.has(c.campaign_id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="font-semibold break-words">{c.name}</span></button>
                    <span className="block text-xs text-muted-foreground pl-5">{c.status ?? "—"}{c.class_state === "pending" ? " · aguardando classificação" : c.front ? ` · ${c.front}` : ""}</span></Td>
                  <Td className="text-[13px]">{PLATFORM_LABEL[c.platform]}</Td>{cols.map((col) => <Td key={col.id} num>{col.cell(c, cur)}</Td>)}
                </tr>
                {open.has(c.campaign_id) && kids(c.campaign_id).map((r, i) => (
                  <tr key={`${c.campaign_id}-${i}`} data-testid={`mgr-${r.level}`} className="text-[13px] bg-muted/30">
                    <Td className="pl-8"><Badge tone={r.level === "unidentified" ? "gold" : "neutral"}>{LEVEL[r.level]}</Badge> <span className="break-words">{r.level === "unidentified" ? "" : r.name}</span>{r.creative && <span className="block text-xs text-muted-foreground">{r.creative}</span>}</Td>
                    <Td>{""}</Td>{cols.map((col) => <Td key={col.id} num>{col.cell(r, cur)}</Td>)}
                  </tr>))}
                {open.has(c.campaign_id) && !closes(c.campaign_id) && <tr><Td className="pl-8 text-xs text-muted-foreground">Atenção: conjuntos + “sem anúncio identificado” não fecham com a campanha.</Td><Td>{""}</Td>{cols.map((col) => <Td key={col.id}>{""}</Td>)}</tr>}
              </Fragment>))}
            {camps.length > 0 && <tr className="font-bold border-t-2" data-testid="mgr-total"><Td>Total das campanhas</Td><Td>{""}</Td>{cols.map((col) => <Td key={col.id} num>{({ spend: money(tot.spend, cur, 0), leads: num(tot.leads), mql: num(tot.mql), sal: num(tot.sal), sales: num(tot.sales), sold: money(tot.sold, cur, 0), received: money(tot.received, cur, 0), cpl: tot.leads > 0 ? money(tot.spend / tot.leads, cur) : "—", cpmql: tot.mql > 0 ? money(tot.spend / tot.mql, cur) : "—", cpsal: tot.sal > 0 ? money(tot.spend / tot.sal, cur) : "—", cpa: tot.sales > 0 ? money(tot.spend / tot.sales, cur) : "—", roas: tot.spend > 0 ? x(Math.round((100 * tot.sold) / tot.spend) / 100) : "—" } as Record<string, string>)[col.id] ?? ""}</Td>)}</tr>}
          </tbody>
        </table>
      </div>
      <ul className="text-xs text-muted-foreground mt-2 grid gap-0.5">{d.notes.map((n) => <li key={n}>• {n}</li>)}<li>• Janelas 7-3-1 do período: 7d {d.windows.d7?.[0]?.split("-").reverse().slice(0, 2).join("/")} a {d.windows.d7?.[1]?.split("-").reverse().slice(0, 2).join("/")}; 3d desde {d.windows.d3?.[0]?.split("-").reverse().slice(0, 2).join("/")}; dia {d.windows.d1?.[0]?.split("-").reverse().slice(0, 2).join("/")}.</li></ul>
    </div>
  );
};

const SORTS: Record<string, [string, (r: ManagerRow) => number]> = { roas: ["ROAS", (r) => r.roas ?? -1], leads: ["Leads", (r) => r.leads], mql: ["MQL", (r) => r.mql], sales: ["Vendas", (r) => r.sales], spend: ["Investimento", (r) => r.spend ?? -1], cpmql: ["Menor CPMQL", (r) => (r.cpmql == null ? -1e9 : -r.cpmql)] };
const Creatives = ({ d, cur, admin, reload }: { d: ManagerResp; cur: string; admin: boolean; reload: () => void }) => {
  const [sort, setSort] = useState("roas"); const [tag, setTag] = useState(""); const { msg, setMsg } = useNote();
  const ads = d.rows.filter((r) => r.level === "ad"); const tags = [...new Set(ads.flatMap((a) => a.tags ?? []))].sort();
  const list = ads.filter((a) => !tag || (a.tags ?? []).includes(tag)).sort((a, b) => SORTS[sort][1](b) - SORTS[sort][1](a));
  const edit = async (a: ManagerRow) => { const v = await promptText("Etiquetas do criativo", "Separe por vírgula (ex.: vídeo, depoimento)", { defaultValue: (a.tags ?? []).join(", ") }); if (v == null) return;
    const { error } = await supabase.rpc("mkt_ad_tags_set", { p_ad: a.ad_id, p_tags: v.split(",").map((s) => s.trim()).filter(Boolean) }); if (error) return setMsg({ kind: "err", text: errText(error) }); setMsg({ kind: "ok", text: "Etiquetas salvas." }); reload(); };
  return (
    <div data-testid="mkt-creatives">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Ordenar por<select className="hp-input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar criativos">{Object.entries(SORTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Etiqueta<select className="hp-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filtrar por etiqueta"><option value="">Todas</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      </div>
      <Msg m={msg} />
      {list.length === 0 && <div className="hp-card p-5 text-sm text-muted-foreground">Nenhum anúncio com dados neste escopo. Os criativos vêm da sincronização com a plataforma; o resultado do Hub chega ao anúncio quando o link traz o id (<code>hp_ad_id</code>).</div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((a, i) => (
          <article key={a.ad_id!} className="hp-card p-4 grid gap-3" data-testid="creative-card" aria-label={a.name}>
            <div className="flex items-start gap-3"><span aria-hidden className="grid place-items-center w-12 h-12 rounded-lg bg-muted text-muted-foreground shrink-0"><ImageIcon size={20} /></span>
              <div className="min-w-0"><p className="font-semibold break-words">{a.name}</p><p className="text-xs text-muted-foreground break-words">{a.creative ?? "Criativo sem nome"} · {a.status ?? "—"}</p></div>
              {i < 3 && sort === "roas" && (a.roas ?? 0) > 0 && <Badge tone="gold">Top {i + 1}</Badge>}</div>
            <div className="flex flex-wrap gap-1.5 items-center">{(a.tags ?? []).map((t) => <Badge key={t}>{t}</Badge>)}{admin && <button type="button" className="text-accent text-xs inline-flex items-center gap-1" onClick={() => edit(a)}><Tag size={12} /> etiquetas</button>}</div>
            <dl className="grid grid-cols-3 gap-2 text-center text-[13px]">
              {([["Investimento", money(a.spend, cur, 0)], ["CTR", pct(a.ctr)], ["Leads", num(a.leads)], ["MQL", num(a.mql)], ["Vendas", num(a.sales)], ["ROAS", x(a.roas)], ["CPL", a.cpl == null ? "—" : money(a.cpl, cur)], ["CPMQL", a.cpmql == null ? "—" : money(a.cpmql, cur)], ["Vendido", money(a.sold, cur, 0)]] as const).map(([l, v]) => <div key={l} className="rounded-lg bg-muted/40 p-2"><dt className="text-[11px] text-muted-foreground">{l}</dt><dd className="font-bold tabular">{v}</dd></div>)}
            </dl>
          </article>))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">Leads, MQL e vendas por criativo só existem quando o link do anúncio carregou o id do anúncio. Análise de transcrição e de copy por IA não faz parte desta fase.</p>
    </div>
  );
};

/** Anúncios e criativos: gerenciador hierárquico (campanha → conjunto → anúncio) com resultados confirmados no Hub, cards de criativos e detalhamentos da plataforma. */
const MarketingAds = () => {
  const f = useMktFilters("event", "reports"); const inv = useMktInvalidate(); const [tab, setTab] = useState<"manager" | "creatives" | "details">("manager"); const [level, setLevel] = useState<"ad" | "adset">("ad");
  const admin = !!useMktOptions().data?.is_admin;
  const mg = useMktRpc<ManagerResp>("mkt_manager", rpcArgs(f, { p_view: f.view }));
  const q = useMktRpc<AdsResp>("mkt_ads_table", { p_from: f.range.from, p_to: f.range.to, p_filters: f.filters, p_level: level }, tab === "details"); const d = q.data; const cur = mg.data?.currency ?? d?.currency ?? "BRL";
  const kinds = [...new Set((d?.breakdowns ?? []).map((b) => b.kind))];
  return (
    <div data-testid="mkt-ads">
      <PageHead eyebrow="Marketing" title="Anúncios e criativos" hint="Gerenciador de anúncios: a mídia da plataforma ao lado do que o Hub confirmou — leads, MQL, SAL, vendas e valores — em cada nível, com custos por etapa e janelas 7-3-1." actions={<MktAssistantButton f={f} />} />
      <MktFilterBar f={f} />
      <Tabs tabs={[["manager", "Gerenciador"], ["creatives", "Criativos"], ["details", "Detalhamentos da plataforma"]]} value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab !== "details" && <State loading={mg.isLoading} error={mg.error} />}
      {tab === "manager" && mg.data && <Manager d={mg.data} cur={cur} />}
      {tab === "creatives" && mg.data && <Creatives d={mg.data} cur={cur} admin={admin} reload={inv} />}
      {tab === "details" && (<>
        <div className="mb-3 flex gap-2" role="group" aria-label="Nível">{(["ad", "adset"] as const).map((l) => <button key={l} type="button" aria-pressed={level === l} className={btnGhost} onClick={() => setLevel(l)} style={level === l ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" } : undefined}>{l === "ad" ? "Anúncios" : "Conjuntos / grupos"}</button>)}</div>
        <State loading={q.isLoading} error={q.error} />
        {d && (<>
          <Table head={[level === "ad" ? "Anúncio" : "Conjunto / grupo", "Criativo", "Campanha", "Status (plataforma)", "Investimento", "Impressões", "Cliques", "CTR", "CPC", "Resultados reportados"]} right={[4, 5, 6, 7, 8, 9]}>
            {d.rows.length === 0 && <tr><Td className="text-muted-foreground">Sem anúncios com mídia no período/escopo.</Td>{Array.from({ length: 9 }, (_, i) => <Td key={i}>{""}</Td>)}</tr>}
            {d.rows.map((r) => <tr key={r.id}><Td><b>{r.name}</b></Td><Td>{r.creative ?? "—"}</Td><Td>{r.campaign}</Td><Td>{r.status ?? "—"}</Td><Td num>{money(r.spend, cur, 0)}</Td><Td num>{num(r.impressions)}</Td><Td num>{num(r.clicks)}</Td><Td num>{pct(r.ctr)}</Td><Td num>{r.cpc == null ? "—" : money(r.cpc, cur)}</Td><Td num>{num(r.reported_results)}</Td></tr>)}
          </Table>
          <p className="text-xs text-muted-foreground mt-2 mb-6">{d.note}</p>
          {kinds.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{kinds.map((k) => <BarBlock key={k} title={BD_LABEL[k] ?? k} hint="Investimento por valor do detalhamento. Fora do total canônico." data={d.breakdowns.filter((b) => b.kind === k).map((b) => ({ item: pretty(b.value), Investimento: Math.round(b.spend * 100) / 100 }))} xKey="item" series={[{ key: "Investimento", label: "Investimento", color: MKT_COLORS[0] }]} />)}</div>}
        </>)}
      </>)}
    </div>
  );
};
export default MarketingAds;
