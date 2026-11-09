import { useState } from "react";
import { PageHead, State, Table, Td, Tabs } from "@/lib/ui";
import { BarBlock } from "@/lib/IndicatorCharts";
import { MktFilterBar } from "./MktParts";
import { MKT_COLORS, money, num, rpcArgs, useMktFilters, useMktRpc, type AdRow } from "./mktApi";

interface AdsResp { currency: string; level: string; rows: AdRow[]; note: string; breakdowns: { kind: string; value: string; spend: number; impressions: number | null; clicks: number | null }[] }
const BD_LABEL: Record<string, string> = { publisher_platform: "Plataforma de publicação", platform_position: "Posicionamento", device: "Dispositivo" };
const pretty = (v: string) => v.replace(/^facebook$/i, "Facebook").replace(/^instagram$/i, "Instagram").replace(/_/g, " ");

/** Anúncios e criativos: mídia por anúncio/conjunto (nunca somada ao total da campanha) e detalhamento Facebook × Instagram / posicionamento / dispositivo, quando a API oferece. */
const MarketingAds = () => {
  const f = useMktFilters("event", "reports"); const [level, setLevel] = useState<"ad" | "adset">("ad");
  const q = useMktRpc<AdsResp>("mkt_ads_table", { p_from: f.range.from, p_to: f.range.to, p_filters: f.filters, p_level: level }); const d = q.data; const cur = d?.currency ?? "BRL";
  const kinds = [...new Set((d?.breakdowns ?? []).map((b) => b.kind))];
  return (
    <div data-testid="mkt-ads">
      <PageHead eyebrow="Marketing" title="Anúncios e criativos" hint="Mídia por anúncio e por conjunto/grupo, como a plataforma informa. Estes valores são um detalhamento: não se somam ao total da campanha." />
      <MktFilterBar f={f} showView={false} />
      <Tabs tabs={[["ad", "Anúncios / criativos"], ["adset", "Conjuntos / grupos"]]} value={level} onChange={(v) => setLevel(v as "ad" | "adset")} />
      <State loading={q.isLoading} error={q.error} />
      {d && (<>
        <Table head={[level === "ad" ? "Anúncio" : "Conjunto / grupo", "Criativo", "Campanha", "Status (plataforma)", "Investimento", "Impressões", "Cliques", "CTR", "CPC", "Resultados reportados"]} right={[4, 5, 6, 7, 8, 9]}>
          {d.rows.length === 0 && <tr><Td className="text-muted-foreground">Sem anúncios com mídia no período/escopo. Os detalhamentos vêm da sincronização com a plataforma (a entrada manual é por campanha).</Td>{Array.from({ length: 9 }, (_, i) => <Td key={i}>{""}</Td>)}</tr>}
          {d.rows.map((r) => <tr key={r.id}><Td><b>{r.name}</b></Td><Td>{r.creative ?? "—"}</Td><Td>{r.campaign}</Td><Td>{r.status ?? "—"}</Td><Td num>{money(r.spend, cur, 0)}</Td><Td num>{num(r.impressions)}</Td><Td num>{num(r.clicks)}</Td><Td num>{r.ctr == null ? "—" : `${r.ctr.toLocaleString("pt-BR")}%`}</Td><Td num>{r.cpc == null ? "—" : money(r.cpc, cur)}</Td><Td num>{num(r.reported_results)}</Td></tr>)}
        </Table>
        <p className="text-xs text-muted-foreground mt-2 mb-6">{d.note}</p>
        {kinds.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{kinds.map((k) => <BarBlock key={k} title={BD_LABEL[k] ?? k} hint="Investimento por valor do detalhamento. Fora do total canônico." data={d.breakdowns.filter((b) => b.kind === k).map((b) => ({ item: pretty(b.value), Investimento: Math.round(b.spend * 100) / 100 }))} xKey="item" series={[{ key: "Investimento", label: "Investimento", color: MKT_COLORS[0] }]} />)}</div>}
      </>)}
    </div>
  );
};
export default MarketingAds;
