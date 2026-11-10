import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, Msg, PageHead, State, Table, Td, btnGhost, btnPrimary, errText } from "@/lib/ui";
import { MktFilterBar, useDetail } from "./MktParts";
import { PLATFORM_LABEL, money, num, rpcArgs, useMktFilters, useMktInvalidate, useMktOptions, useMktRpc, when, type CampaignRow, type Reconciliation, useNote } from "./mktApi";

interface AdminCampaign { id: string; name: string; platform: string; account: string; origin: string; external_id: string; platform_objective: string | null; platform_status: string | null; first_seen_at: string; state: string;
  include_in_hub: boolean; include_in_reports: boolean; front_id: string | null; purpose_id: string | null; product_id: string | null; pipeline_id: string | null; unit_id: string | null; primary_result: string | null; spend_90d: number | null }
interface Config { fronts: { id: string; label: string }[]; purposes: { id: string; label: string; default_result: string | null }[]; event_types: { key: string; label: string }[]; products: { id: string; name: string }[]; pipelines: { id: string; name: string }[]; units: { id: string; name: string }[] }
interface HistoryRow { at: string; by: string | null; effect: string; after: Record<string, unknown> }
const sel = "hp-input w-full";

const ClassifyDialog = ({ camp, cfg, onClose }: { camp: AdminCampaign; cfg: Config; onClose: () => void }) => {
  const inv = useMktInvalidate(); const { msg, setMsg } = useNote();
  const [v, setV] = useState({ front_id: camp.front_id ?? "", purpose_id: camp.purpose_id ?? "", product_id: camp.product_id ?? "", pipeline_id: camp.pipeline_id ?? "", unit_id: camp.unit_id ?? "", primary_result: camp.primary_result ?? "", include_in_hub: camp.include_in_hub, include_in_reports: camp.include_in_reports });
  const [effect, setEffect] = useState<string>(""); const [hist, setHist] = useState<HistoryRow[]>([]); const [busy, setBusy] = useState(false);
  const patch = useMemo(() => ({ ...v }), [v]);
  useEffect(() => { let on = true; supabase.rpc("mkt_class_save", { p_campaign: camp.id, p_patch: patch, p_dry_run: true }).then(({ data, error }) => { if (on) setEffect(error ? errText(error) : String(data?.effect ?? "")); }); return () => { on = false; }; }, [camp.id, patch]);
  useEffect(() => { supabase.rpc("mkt_class_history", { p_campaign: camp.id }).then(({ data }) => setHist((data as HistoryRow[]) ?? [])); }, [camp.id]);
  const upd = (k: keyof typeof v, val: string | boolean) => setV((x) => ({ ...x, [k]: val }));
  const save = async () => { setBusy(true); const { data, error } = await supabase.rpc("mkt_class_save", { p_campaign: camp.id, p_patch: patch, p_dry_run: false }); setBusy(false);
    if (error) return setMsg({ kind: "err", text: errText(error) }); inv(); setMsg({ kind: "ok", text: data?.saved ? "Classificação salva. O histórico registrou a alteração." : "Nenhuma alteração." }); if (data?.saved) setTimeout(onClose, 600); };
  const purpose = cfg.purposes.find((p) => p.id === v.purpose_id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="classify-dialog">
        <DialogHeader><DialogTitle>Classificar campanha</DialogTitle><DialogDescription>{camp.name} · {PLATFORM_LABEL[camp.platform]} · {camp.account}. A classificação é só interna: nada muda na campanha dentro da plataforma.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="sm:col-span-2 rounded-lg bg-muted/50 p-3 text-[13px]"><b>Na plataforma (original):</b> objetivo {camp.platform_objective ?? "—"} · status {camp.platform_status ?? "—"} · id {camp.external_id.startsWith("manual:") ? "lançamento manual" : camp.external_id}</div>
          <label className="grid gap-1">Frente de negócio *<select className={sel} value={v.front_id} onChange={(e) => upd("front_id", e.target.value)}><option value="">— escolher —</option>{cfg.fronts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <label className="grid gap-1">Finalidade *<select className={sel} value={v.purpose_id} onChange={(e) => { upd("purpose_id", e.target.value); const p = cfg.purposes.find((x) => x.id === e.target.value); if (p?.default_result && !v.primary_result) upd("primary_result", p.default_result); }}><option value="">— escolher —</option>{cfg.purposes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <label className="grid gap-1">Produto (quando aplicável)<select className={sel} value={v.product_id} onChange={(e) => upd("product_id", e.target.value)}><option value="">Nenhum</option>{cfg.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="grid gap-1">Funil de destino<select className={sel} value={v.pipeline_id} onChange={(e) => upd("pipeline_id", e.target.value)}><option value="">Nenhum</option>{cfg.pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="grid gap-1">Unidade (quando aplicável)<select className={sel} value={v.unit_id} onChange={(e) => upd("unit_id", e.target.value)}><option value="">Toda a organização</option>{cfg.units.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="grid gap-1">Resultado principal<select className={sel} value={v.primary_result} onChange={(e) => upd("primary_result", e.target.value)}><option value="">{purpose?.default_result ? "(padrão da finalidade)" : "Não definido"}</option>{cfg.event_types.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
          <label className="flex items-center gap-2 sm:col-span-1"><input type="checkbox" checked={v.include_in_hub} onChange={(e) => upd("include_in_hub", e.target.checked)} /> Acompanhar no dashboard do Hub <span className="text-xs text-muted-foreground">(não pausa o anúncio)</span></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.include_in_reports} onChange={(e) => upd("include_in_reports", e.target.checked)} /> Incluir nos relatórios operacionais</label>
        </div>
        <div className="rounded-lg border border-border p-3 text-[13px]" data-testid="classify-effect"><b>Efeito nos relatórios:</b> {effect || "…"}</div>
        {hist.length > 0 && <details className="text-[13px]"><summary className="cursor-pointer font-medium">Histórico de alterações ({hist.length})</summary><ul className="mt-2 grid gap-2">{hist.map((h, i) => <li key={i} className="rounded border border-border p-2"><span className="text-muted-foreground">{when(h.at)} · {h.by ?? "—"}</span><br />{h.effect}</li>)}</ul></details>}
        <Msg m={msg} />
        <DialogFooter><button type="button" className={btnGhost} onClick={onClose}>Cancelar</button><button type="button" className={btnPrimary} disabled={busy} onClick={save}>Salvar classificação</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Campanhas: objetivo e status ORIGINAIS da plataforma ao lado da classificação comercial INTERNA, com reconciliação do gasto. */
const MarketingCampaigns = () => {
  const f = useMktFilters("event", "all"); const d = useDetail(f);
  const ct = useMktRpc<{ rows: CampaignRow[]; currency: string }>("mkt_campaign_table", rpcArgs(f, { p_view: f.view })); const rc = useMktRpc<Reconciliation>("mkt_reconciliation", rpcArgs(f));
  const isAdmin = !!useMktOptions().data?.is_admin;
  const admin = useMktRpc<AdminCampaign[]>("mkt_campaigns_admin", {}, isAdmin); const cfg = useMktRpc<Config>("mkt_config_get", {}, isAdmin);
  const [edit, setEdit] = useState<AdminCampaign | null>(null); const [only, setOnly] = useState<"" | "pending">("");
  const rows = (ct.data?.rows ?? []).filter((r) => !only || r.class_state === "pending"); const cur = ct.data?.currency ?? "BRL";
  const pending = (ct.data?.rows ?? []).filter((r) => r.class_state === "pending").length;
  return (
    <div data-testid="mkt-campaigns">
      <PageHead eyebrow="Marketing" title="Campanhas" hint="Campanhas importadas das plataformas. Novas campanhas ficam “Aguardando classificação”; nada é inferido pelo nome. Desligar o acompanhamento aqui não pausa nenhum anúncio." />
      <MktFilterBar f={f} />
      <State loading={ct.isLoading} error={ct.error} />
      {pending > 0 && <div className="hp-card p-3 mb-4 text-sm flex flex-wrap items-center justify-between gap-2" role="status"><span><b>{pending}</b> campanha(s) aguardando classificação — seguem visíveis como “Não classificado” na reconciliação.</span><button type="button" className={btnGhost} onClick={() => setOnly(only ? "" : "pending")}>{only ? "Ver todas" : "Ver só as pendentes"}</button></div>}
      <Table head={["Campanha", "Plataforma / conta", "Original na plataforma", "Classificação interna", "Dashboard", "Investimento", "Leads", "CPL", "Vendas", "ROAS", ""]} right={[5, 6, 7, 8, 9]}>
        {rows.length === 0 && <tr><Td className="text-muted-foreground">Nenhuma campanha neste escopo. Conecte uma conta em Integrações ou lance gastos manualmente.</Td>{Array.from({ length: 10 }, (_, i) => <Td key={i}>{""}</Td>)}</tr>}
        {rows.map((c) => (
          <tr key={c.campaign_id}>
            <Td><b className="break-words">{c.name}</b>{c.origin === "manual" && <span className="block text-xs text-muted-foreground">lançamento manual</span>}</Td>
            <Td>{PLATFORM_LABEL[c.platform]}<span className="block text-xs text-muted-foreground">{c.account}</span></Td>
            <Td><span className="text-[13px]">{c.platform_objective ?? "—"}</span><span className="block text-xs text-muted-foreground">{c.platform_status ?? "—"}</span></Td>
            <Td>{c.class_state === "pending" ? <Badge tone="warning">Aguardando classificação</Badge> : <span className="text-[13px]">{c.front}<span className="block text-xs text-muted-foreground">{c.purpose}{c.primary_result ? ` · resultado: ${c.primary_result}` : ""}</span></span>}{!c.include_in_reports && <span className="block text-xs text-muted-foreground">fora dos relatórios operacionais</span>}</Td>
            <Td>{c.include_in_hub ? <Badge tone="info">Acompanhada</Badge> : <Badge>Fora do dashboard</Badge>}</Td>
            <Td num>{money(c.spend, cur, 0)}{c.other_currency && <span className="block text-xs text-muted-foreground">+ {c.other_currency} (não somado)</span>}</Td><Td num>{num(c.leads)}</Td><Td num>{c.cpl == null ? "—" : money(c.cpl, cur)}</Td><Td num>{num(c.sales)}</Td><Td num>{c.roas == null ? "—" : `${c.roas.toLocaleString("pt-BR")}x`}</Td>
            <Td>{isAdmin && <button type="button" className={btnGhost} disabled={!admin.data || !cfg.data} data-testid={`classify-${c.campaign_id}`} onClick={() => { const a = (admin.data ?? []).find((x) => x.id === c.campaign_id); if (a) setEdit(a); }}>Classificar</button>}</Td>
          </tr>))}
      </Table>
      <p className="text-xs text-muted-foreground mt-2 mb-6">Investimento, leads e vendas do período selecionado ({f.view === "cohort" ? "leads captados no período" : "por data do evento"}). Reclassificar vale para todo o histórico da campanha, porque a classificação é aplicada na leitura dos relatórios.</p>
      {rc.data && (
        <section className="hp-card p-5 max-w-xl" aria-label="Reconciliação">
          <h3 className="text-[0.9375rem] font-bold mb-2">Reconciliação do investimento (todas as campanhas)</h3>
          <ul className="grid gap-1.5 text-sm">{rc.data.parts.map((p) => <li key={p.key} className="flex justify-between gap-3"><span>{p.label}</span><b className="tabular">{money(p.spend, rc.data!.currency, 0)}</b></li>)}</ul>
          <p className="flex justify-between border-t border-border mt-3 pt-2 text-sm"><span>Total efetivo</span><b className="tabular">{money(rc.data.total, rc.data.currency, 0)}</b></p>
        </section>)}
      {edit && cfg.data && <ClassifyDialog camp={edit} cfg={cfg.data} onClose={() => setEdit(null)} />}
      {d.sheet}
    </div>
  );
};
export default MarketingCampaigns;
