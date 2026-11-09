import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AreaTrend } from "@/lib/IndicatorCharts";
import { Badge, Msg, PageHead, State, Table, Td, btnGhost, btnPrimary, confirmDialog, errText } from "@/lib/ui";
import { CoverageBanner, MktAssistantButton, MktFilterBar, MktKpi, SevBadge, useDetail } from "./MktParts";
import { FunnelView, useFunnels } from "./MktFunnelVisual";
import { MKT_COLORS, PLATFORM_LABEL, fmtDay, kpiOf, money, num, prevOf, rpcArgs, useMktFilters, useMktInvalidate, useMktOptions, useMktRpc, useNote, type CampaignRow, type Dashboard, type FunnelRun, type KpisResp, type MktFilters, type QualityItem, type Reconciliation, type SeriesResp, type Widget } from "./mktApi";

const WIDGET_LABEL: Record<Widget["type"], string> = { kpi: "Indicador", series: "Evolução no tempo", funnel: "Funil", campaigns: "Ranking de campanhas", quality: "Qualidade dos dados", reconciliation: "Conferência do gasto", note: "Anotação" };
const SERIES_LABEL: Record<string, string> = { spend: "Investimento", leads: "Leads", qualified: "Qualificados (MQL)", sales: "Vendas", received: "Recebido" };
const SORT_LABEL: Record<string, string> = { spend: "Investimento", leads: "Leads", roas: "ROAS", cpl: "CPL" };
const uid = () => Math.random().toString(36).slice(2, 10);

interface Ctx { f: MktFilters; kp?: KpisResp; se?: SeriesResp; ct?: { rows: CampaignRow[]; currency: string }; ql?: { items: QualityItem[] }; rc?: Reconciliation; open: (kind: string, title: string) => void }

const FunnelWidget = ({ f, id }: { f: MktFilters; id: string }) => {
  const r = useMktRpc<FunnelRun>("mkt_funnel_run", rpcArgs(f, { p_funnel: id, p_view: f.view }));
  if (r.isLoading) return <p className="text-sm text-muted-foreground">Carregando funil…</p>;
  if (r.error || !r.data) return <p className="text-sm text-muted-foreground">Funil não encontrado (pode ter sido excluído). Edite o painel para escolher outro.</p>;
  return <><p className="text-sm font-semibold mb-2">{r.data.funnel.name}</p><FunnelView run={r.data} /></>;
};

/** Renderiza um widget do painel com os MESMOS números das demais páginas (mesmas funções do banco, mesmos filtros). */
const WidgetView = ({ w, c }: { w: Widget; c: Ctx }) => {
  const cur = c.kp?.currency ?? "BRL";
  if (w.type === "kpi") { const k = kpiOf(c.kp, w.key ?? ""); return k ? <MktKpi k={k} prev={prevOf(c.kp, w.key ?? "")} currency={cur} onOpen={c.open} short /> : <p className="text-sm text-muted-foreground">Indicador “{w.key}” não existe mais.</p>; }
  if (w.type === "series") {
    const m = (w.metric ?? "spend") as keyof SeriesResp["points"][number]; const label = SERIES_LABEL[w.metric ?? "spend"] ?? "Série";
    return <AreaTrend title={`${label} por ${c.se?.granularity === "week" ? "semana" : "dia"}`} data={(c.se?.points ?? []).map((p) => ({ dia: fmtDay(p.day), [label]: p[m] as number | null }))} xKey="dia" series={[{ key: label, label, color: MKT_COLORS[0] }]}
      format={w.metric === "spend" || w.metric === "received" ? (v) => money(v, cur, 0) : undefined} isEmpty={!(c.se?.points ?? []).some((p) => p[m] != null)} empty="Sem dados no período." />;
  }
  if (w.type === "funnel") return <FunnelWidget f={c.f} id={w.funnel_id ?? ""} />;
  if (w.type === "campaigns") {
    const sort = (w.sort ?? "spend") as "spend" | "leads" | "roas" | "cpl"; const top = Number(w.top ?? 5);
    const rows = [...(c.ct?.rows ?? [])].filter((r) => r[sort] != null).sort((a, b) => (sort === "cpl" ? (a.cpl ?? 0) - (b.cpl ?? 0) : (b[sort] ?? 0) - (a[sort] ?? 0))).slice(0, top);
    return <><p className="text-sm font-semibold mb-2">Campanhas por {SORT_LABEL[sort]}{sort === "cpl" ? " (menor primeiro)" : ""}</p>
      <Table head={["Campanha", "Plataforma", "Investimento", "Leads", "CPL", "ROAS"]} right={[2, 3, 4, 5]}>{rows.length === 0 ? <tr><Td className="text-muted-foreground">Nenhuma campanha com esse dado.</Td></tr> : rows.map((r) => <tr key={r.campaign_id}><Td>{r.name}</Td><Td>{PLATFORM_LABEL[r.platform]}</Td><Td num>{money(r.spend, cur, 0)}</Td><Td num>{num(r.leads)}</Td><Td num>{r.cpl == null ? "—" : money(r.cpl, cur)}</Td><Td num>{r.roas == null ? "—" : `${r.roas.toLocaleString("pt-BR")}x`}</Td></tr>)}</Table></>;
  }
  if (w.type === "quality") return <><p className="text-sm font-semibold mb-2">Qualidade dos dados</p><ul className="grid gap-1.5">{(c.ql?.items ?? []).map((i) => <li key={i.key} className="flex items-center justify-between gap-2 text-sm"><span>{i.label}</span><span className="flex items-center gap-2"><b className="tabular">{i.count}</b><SevBadge s={i.severity} /></span></li>)}</ul></>;
  if (w.type === "reconciliation") return c.rc ? <><p className="text-sm font-semibold mb-2">Conferência do gasto</p><p className="text-2xl font-extrabold tabular">{money(c.rc.total, c.rc.currency, 0)}</p><p className="text-xs text-muted-foreground mt-1">{c.rc.reconciles ? "A soma das partes confere com o total." : "A soma das partes NÃO confere com o total — revise."}</p><ul className="mt-2 grid gap-1 text-sm">{c.rc.parts.map((p) => <li key={p.key} className="flex justify-between"><span>{p.label}</span><span className="tabular">{money(p.spend, c.rc!.currency, 0)}</span></li>)}</ul></> : null;
  return <p className="text-sm whitespace-pre-wrap">{w.text}</p>;
};

const widgetNeeds = (ws: Widget[], t: Widget["type"]) => ws.some((w) => w.type === t);

/** Construtor: lista os widgets do painel com tipo, parâmetros e ordem; só combinações validadas pelo banco. */
const Builder = ({ dash, kpiOptions, onClose, onSaved, isAdmin }: { dash: Dashboard | null; kpiOptions: { key: string; label: string }[]; onClose: () => void; onSaved: (id: string) => void; isAdmin: boolean }) => {
  const funnels = useFunnels().data?.funnels ?? []; const { msg, setMsg } = useNote(); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(dash?.name ?? ""); const [shared, setShared] = useState(dash?.shared ?? false);
  const [ws, setWs] = useState<Widget[]>(dash?.widgets ?? [{ id: uid(), type: "kpi", key: "spend" }, { id: uid(), type: "kpi", key: "leads" }]);
  const patch = (id: string, p: Partial<Widget>) => setWs((a) => a.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const move = (i: number, d: number) => setWs((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const add = (type: Widget["type"]) => setWs((a) => (a.length >= 24 ? a : [...a, { id: uid(), type, ...(type === "kpi" ? { key: "spend" } : type === "series" ? { metric: "spend", span: "2" as const } : type === "funnel" ? { funnel_id: funnels[0]?.id, span: "2" as const } : type === "campaigns" ? { top: "5", sort: "spend", span: "2" as const } : type === "note" ? { text: "", span: "2" as const } : {}) }]));
  const save = async () => {
    setBusy(true);
    const clean = ws.map((w) => { const o: Record<string, unknown> = { id: w.id, type: w.type }; if (w.span === "2") o.span = "2"; if (w.type === "kpi") o.key = w.key; if (w.type === "series") o.metric = w.metric; if (w.type === "funnel") o.funnel_id = w.funnel_id; if (w.type === "campaigns") { o.top = w.top; o.sort = w.sort; } if (w.type === "note") o.text = w.text ?? ""; return o; });
    const { data, error } = await supabase.rpc("mkt_dashboard_save", { p_id: dash?.id ?? null, p_name: name, p_widgets: clean, p_shared: isAdmin ? shared : false }); setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) }); onSaved(String(data));
  };
  return (
    <section className="hp-card p-4 mb-4 grid gap-3" aria-label="Construtor de painel" data-testid="mkt-dash-builder">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Nome do painel<input className="hp-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="mkt-dash-name" /></label>
        {isAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Compartilhar com a equipe</label>}
      </div>
      <ol className="grid gap-2">
        {ws.map((w, i) => (<li key={w.id} className="hp-card p-3 grid gap-2 sm:grid-cols-[1fr_auto] items-center" data-testid="mkt-dash-widget-edit">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{WIDGET_LABEL[w.type]}</Badge>
            {w.type === "kpi" && <select className="hp-input" aria-label="Indicador" value={w.key} onChange={(e) => patch(w.id, { key: e.target.value })}>{kpiOptions.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>}
            {w.type === "series" && <select className="hp-input" aria-label="Métrica" value={w.metric} onChange={(e) => patch(w.id, { metric: e.target.value })}>{Object.entries(SERIES_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
            {w.type === "funnel" && <select className="hp-input" aria-label="Funil" value={w.funnel_id} onChange={(e) => patch(w.id, { funnel_id: e.target.value })}>{funnels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            {w.type === "campaigns" && <><select className="hp-input" aria-label="Ordenar por" value={w.sort} onChange={(e) => patch(w.id, { sort: e.target.value })}>{Object.entries(SORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <select className="hp-input" aria-label="Quantidade" value={w.top} onChange={(e) => patch(w.id, { top: e.target.value })}>{["3", "5", "8", "10"].map((n) => <option key={n} value={n}>Top {n}</option>)}</select></>}
            {w.type === "note" && <textarea className="hp-input w-full" rows={2} maxLength={500} aria-label="Texto da anotação" value={w.text ?? ""} onChange={(e) => patch(w.id, { text: e.target.value })} />}
            {w.type !== "kpi" && w.type !== "note" && <label className="text-xs text-muted-foreground flex items-center gap-1"><input type="checkbox" checked={w.span === "2"} onChange={(e) => patch(w.id, { span: e.target.checked ? "2" : "1" })} /> largura dupla</label>}
          </div>
          <div className="flex gap-1">
            <button type="button" className={btnGhost} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir"><ChevronUp size={14} /></button>
            <button type="button" className={btnGhost} onClick={() => move(i, 1)} disabled={i === ws.length - 1} aria-label="Descer"><ChevronDown size={14} /></button>
            <button type="button" className={btnGhost} onClick={() => setWs((a) => a.filter((x) => x.id !== w.id))} aria-label="Remover"><Trash2 size={14} /></button>
          </div>
        </li>))}
      </ol>
      <div className="flex flex-wrap gap-2" aria-label="Adicionar bloco">{(Object.keys(WIDGET_LABEL) as Widget["type"][]).map((t) => <button key={t} type="button" className={btnGhost} onClick={() => add(t)} disabled={ws.length >= 24 || (t === "funnel" && funnels.length === 0)} data-testid={`mkt-dash-add-${t}`}><Plus size={13} aria-hidden /> {WIDGET_LABEL[t]}</button>)}</div>
      <Msg m={msg} />
      <div className="flex gap-2"><button type="button" className={btnPrimary} onClick={save} disabled={busy || name.trim().length < 2 || ws.length === 0} data-testid="mkt-dash-save">Salvar painel</button><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button></div>
    </section>
  );
};

/** Painéis personalizáveis: cada pessoa monta os seus (indicadores, evolução, funil, ranking, qualidade); a administração compartilha painéis com a equipe. */
const MarketingDashboards = () => {
  const f = useMktFilters("event", "hub"); const d = useDetail(f); const inv = useMktInvalidate(); const { msg, setMsg } = useNote();
  const list = useMktRpc<Dashboard[]>("mkt_dashboards_list", {}); const dashes = useMemo(() => list.data ?? [], [list.data]);
  const [sel, setSel] = useState(""); const [mode, setMode] = useState<"view" | "new" | "edit">("view");
  const cur = useMemo(() => dashes.find((x) => x.id === sel) ?? dashes[0], [dashes, sel]); useEffect(() => { if (!sel && dashes[0]) setSel(dashes[0].id); }, [dashes, sel]);
  const ws = cur?.widgets ?? []; const a = rpcArgs(f, { p_view: f.view });
  const kp = useMktRpc<KpisResp>("mkt_kpis", a); const se = useMktRpc<SeriesResp>("mkt_series", a, widgetNeeds(ws, "series"));
  const ct = useMktRpc<{ rows: CampaignRow[]; currency: string }>("mkt_campaign_table", a, widgetNeeds(ws, "campaigns")); const ql = useMktRpc<{ items: QualityItem[] }>("mkt_quality", rpcArgs(f), widgetNeeds(ws, "quality")); const rc = useMktRpc<Reconciliation>("mkt_reconciliation", rpcArgs(f), widgetNeeds(ws, "reconciliation"));
  const isAdmin = !!useMktOptions().data?.is_admin;
  const ctx: Ctx = { f, kp: kp.data, se: se.data, ct: ct.data, ql: ql.data, rc: rc.data, open: (kind, t) => d.open(kind, t) };
  const after = (text: string, id?: string) => { inv(); if (id) setSel(id); setMode("view"); setMsg({ kind: "ok", text }); };
  const del = async () => { if (!cur || !(await confirmDialog("Excluir o painel?", `“${cur.name}” será removido${cur.shared ? " para toda a equipe" : ""}. Os dados não são afetados.`, "Excluir", true))) return; const { error } = await supabase.rpc("mkt_dashboard_delete", { p_id: cur.id }); if (error) return setMsg({ kind: "err", text: errText(error) }); setSel(""); after("Painel excluído."); };
  const dup = async () => { if (!cur) return; const { data, error } = await supabase.rpc("mkt_dashboard_duplicate", { p_id: cur.id }); if (error) return setMsg({ kind: "err", text: errText(error) }); after("Cópia criada (só sua).", String(data)); };
  const kpiOptions = (kp.data?.kpis ?? []).map((k) => ({ key: k.key, label: k.label }));
  return (
    <div data-testid="mkt-dashboards-page">
      <PageHead eyebrow="Marketing" title="Painéis" hint="Monte painéis com os indicadores que importam para você. Os números são os mesmos das outras páginas, com o mesmo período e filtros."
        actions={<><MktAssistantButton f={f} /><button type="button" className={btnPrimary} onClick={() => setMode("new")} data-testid="mkt-dash-new"><Plus size={14} aria-hidden /> Novo painel</button></>} />
      <MktFilterBar f={f} />
      <State loading={list.isLoading} error={list.error} />
      {dashes.length > 0 && <div role="tablist" aria-label="Painéis" className="flex flex-wrap items-center gap-2 mb-3">
        {dashes.map((x) => <button key={x.id} role="tab" type="button" aria-selected={cur?.id === x.id} onClick={() => { setSel(x.id); setMode("view"); }} className={`px-3 h-9 rounded-lg border text-sm font-medium ${cur?.id === x.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{x.name}{x.shared ? " · equipe" : ""}</button>)}</div>}
      <Msg m={msg} />
      {mode === "new" && <Builder key="new" dash={null} kpiOptions={kpiOptions} isAdmin={isAdmin} onClose={() => setMode("view")} onSaved={(id) => after("Painel criado.", id)} />}
      {mode === "edit" && cur && <Builder key={cur.id} dash={cur} kpiOptions={kpiOptions} isAdmin={isAdmin} onClose={() => setMode("view")} onSaved={(id) => after("Painel salvo.", id)} />}
      {cur && mode === "view" && (<>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm text-muted-foreground">{cur.shared ? <Badge tone="info">Compartilhado com a equipe</Badge> : <Badge>Só seu</Badge>} {cur.owner ? `Criado por ${cur.owner}` : ""}</p>
          <div className="flex gap-2"><button type="button" className={btnGhost} onClick={dup}><Copy size={14} aria-hidden /> Duplicar</button>
            {cur.can_edit && <><button type="button" className={btnGhost} onClick={() => setMode("edit")} data-testid="mkt-dash-edit"><Pencil size={14} aria-hidden /> Editar</button><button type="button" className={btnGhost} onClick={del}><Trash2 size={14} aria-hidden /> Excluir</button></>}</div>
        </div>
        <CoverageBanner c={kp.data?.coverage} model={kp.data?.model} view={f.view} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="mkt-dash-grid">
          {ws.map((w) => <div key={w.id} className={w.type === "kpi" ? "" : w.span === "2" ? "sm:col-span-2 lg:col-span-4" : "sm:col-span-2 lg:col-span-2"} data-testid={`mkt-dash-widget-${w.type}`}><WidgetView w={w} c={ctx} /></div>)}
        </div>
      </>)}
      {d.sheet}
    </div>
  );
};
export default MarketingDashboards;
