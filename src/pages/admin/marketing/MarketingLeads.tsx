import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, Msg, PageHead, State, Table, Td, Tabs, btnGhost, btnPrimary, errText } from "@/lib/ui";
import { MktAssistantButton, MktFilterBar } from "./MktParts";
import { BAND_LABEL, num, rpcArgs, useMktFilters, useMktInvalidate, useMktOptions, useMktRpc, useNote, type ScoreCfg, type ScoreResp } from "./mktApi";

const BAND_TONE = { hot: "danger", warm: "warning", cold: "info" } as const;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/** Configuração dos pesos (só admin): cada fator tem pontos, parâmetro opcional e liga/desliga; faixas Quente/Morna/Fria por nota mínima. */
const ScoreSettings = ({ cfg, onSaved }: { cfg: ScoreCfg; onSaved: () => void }) => {
  const [base, setBase] = useState(cfg.settings.base); const [hot, setHot] = useState(cfg.settings.hot_min); const [warm, setWarm] = useState(cfg.settings.warm_min);
  const [rules, setRules] = useState(cfg.rules); const { msg, setMsg } = useNote(); const [busy, setBusy] = useState(false);
  useEffect(() => { setBase(cfg.settings.base); setHot(cfg.settings.hot_min); setWarm(cfg.settings.warm_min); setRules(cfg.rules); }, [cfg]);
  const patch = (factor: string, p: Partial<ScoreCfg["rules"][number]>) => setRules((r) => r.map((x) => (x.factor === factor ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("mkt_score_set", { p: { base, hot_min: hot, warm_min: warm, rules: rules.map((r) => ({ factor: r.factor, enabled: r.enabled, points: r.points, param: r.param })) } });
    setBusy(false); if (error) return setMsg({ kind: "err", text: errText(error) }); setMsg({ kind: "ok", text: "Pesos salvos. As notas dos leads já refletem a nova regra." }); onSaved();
  };
  return (
    <section className="hp-card p-4 grid gap-4" aria-label="Pesos da nota" data-testid="mkt-score-settings">
      <p className="text-sm text-muted-foreground">A nota é a soma de pontos de <b>fatos operacionais</b> do lead (origem, rapidez do contato, avanço no funil), limitada de 0 a 100. Respostas de questionário, queixas e qualquer dado de saúde <b>nunca</b> entram na conta. A nota é uma priorização, não uma previsão de compra.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Nota inicial<input type="number" className="hp-input" min={0} max={100} value={base} onChange={(e) => setBase(Number(e.target.value))} /></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Quente a partir de<input type="number" className="hp-input" min={2} max={100} value={hot} onChange={(e) => setHot(Number(e.target.value))} /></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Morna a partir de<input type="number" className="hp-input" min={1} max={99} value={warm} onChange={(e) => setWarm(Number(e.target.value))} /></label>
      </div>
      <ul className="grid gap-2">
        {rules.map((r) => (
          <li key={r.factor} className="grid gap-2 sm:grid-cols-[1fr_auto] items-center border-b border-border pb-2" data-testid={`mkt-score-rule-${r.factor}`}>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={r.enabled} onChange={(e) => patch(r.factor, { enabled: e.target.checked })} /><span><b>{r.label}</b> <Badge tone={r.kind === "positive" ? "success" : "warning"}>{r.kind === "positive" ? "soma" : "subtrai"}</Badge><span className="block text-xs text-muted-foreground">{r.description}</span></span></label>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">pontos<input type="number" aria-label={`Pontos de ${r.label}`} className="hp-input w-20 ml-1" min={r.kind === "positive" ? 0 : -50} max={r.kind === "positive" ? 50 : 0} value={r.points} onChange={(e) => patch(r.factor, { points: Number(e.target.value) })} /></label>
              {r.param_label && <label className="text-xs text-muted-foreground">{r.param_label}<input type="number" aria-label={`${r.param_label} de ${r.label}`} className="hp-input w-20 ml-1" min={1} max={10080} value={r.param ?? ""} onChange={(e) => patch(r.factor, { param: Number(e.target.value) })} /></label>}
            </div>
          </li>))}
      </ul>
      <Msg m={msg} />
      <div><button type="button" className={btnPrimary} onClick={save} disabled={busy} data-testid="mkt-score-save">Salvar pesos</button></div>
    </section>
  );
};

/** Leads com nota de 0 a 100: faixa, fatores que somaram/subtraíram (explicável), taxa de venda observada por faixa e distribuição. */
const MarketingLeads = () => {
  const f = useMktFilters("event", "reports"); const inv = useMktInvalidate(); const isAdmin = !!useMktOptions().data?.is_admin;
  const [tab, setTab] = useState<"leads" | "weights">("leads"); const [band, setBand] = useState<"" | "hot" | "warm" | "cold">("");
  const sc = useMktRpc<ScoreResp>("mkt_lead_scores", rpcArgs(f, { p_limit: 200 })); const cfg = useMktRpc<ScoreCfg>("mkt_score_get", {});
  const d = sc.data; const maxN = Math.max(1, ...(d?.distribution ?? []).map((x) => x.n));
  const rows = (d?.leads ?? []).filter((l) => !band || l.band === band);
  return (
    <div data-testid="mkt-leads-page">
      <PageHead eyebrow="Marketing" title="Leads e pontuação" hint="Nota de 0 a 100 por lead, explicável fator a fator, para priorizar o atendimento. Usa só fatos operacionais — nunca dados de saúde." actions={<MktAssistantButton f={f} />} />
      <MktFilterBar f={f} showView={false} />
      <Tabs tabs={[["leads", "Leads"], ...(isAdmin ? [["weights", "Pesos da nota"] as [string, string]] : [])]} value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab === "weights" && isAdmin && (cfg.data ? <ScoreSettings cfg={cfg.data} onSaved={() => { inv(); void sc.refetch(); void cfg.refetch(); }} /> : <State loading={cfg.isLoading} error={cfg.error} />)}
      {tab === "leads" && (<>
        <State loading={sc.isLoading} error={sc.error} />
        {d && (<>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4" data-testid="mkt-score-bands">
            <div className="hp-card p-4"><p className="text-xs text-muted-foreground">Leads no período</p><p className="text-2xl font-extrabold tabular">{num(d.total)}</p><p className="text-xs text-muted-foreground">Nota média: {d.avg_score == null ? "—" : num(d.avg_score)}</p></div>
            {(["hot", "warm", "cold"] as const).map((b) => (
              <button key={b} type="button" aria-pressed={band === b} onClick={() => setBand(band === b ? "" : b)} className={`hp-card p-4 text-left ${band === b ? "border-2 border-primary" : ""}`} data-testid={`mkt-band-${b}`}>
                <p className="text-xs text-muted-foreground">{BAND_LABEL[b]}</p><p className="text-2xl font-extrabold tabular">{num(d.bands[b]?.n ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{d.bands[b]?.conversion_pct == null ? "Sem base para taxa de venda" : `${pct(d.bands[b].conversion_pct)} viraram venda (${d.bands[b].sold})`}</p>
              </button>))}
          </div>
          <section className="hp-card p-4 mb-4" aria-label="Distribuição das notas">
            <h3 className="text-[0.9375rem] font-bold mb-2">Distribuição das notas</h3>
            <div className="flex items-end gap-1 h-24" role="img" aria-label="Quantidade de leads por faixa de nota">{d.distribution.map((x) => <div key={x.from} className="flex-1 bg-primary rounded-t" style={{ height: `${Math.max(2, (x.n / maxN) * 100)}%`, opacity: x.n ? 1 : 0.2 }} title={`${x.from}–${x.to}: ${x.n}`} />)}</div>
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1"><span>0</span><span>50</span><span>100</span></div>
            {d.notes.map((n) => <p key={n} className="text-[13px] text-muted-foreground mt-2">• {n}</p>)}
          </section>
          <Table head={["Lead", "Nota", "Faixa", "Por que essa nota", "Campanha", "Entrou em", "Situação"]} right={[1]}>
            {rows.length === 0 ? <tr><Td className="text-muted-foreground" >Nenhum lead nesta faixa.</Td></tr> : rows.map((l) => (
              <tr key={l.opp_id} data-testid="mkt-lead-row"><Td><b>{l.name}</b></Td><Td num><b>{l.score}</b></Td><Td><Badge tone={BAND_TONE[l.band]}>{BAND_LABEL[l.band]}</Badge></Td>
                <Td className="text-[12.5px] min-w-[16rem]">{l.factors.length === 0 ? "Sem fatores além da nota inicial" : l.factors.map((x) => `${x.points > 0 ? "+" : ""}${x.points} ${x.label}`).join(" · ")}</Td>
                <Td className="text-[12.5px]">{l.campaign ?? "Sem atribuição"}</Td><Td className="text-[12.5px]">{fmtDateTime(l.created_at)}</Td><Td>{l.sold ? <Badge tone="success">Venda</Badge> : <Badge>{l.status}</Badge>}</Td></tr>))}
          </Table>
          {d.total > d.leads.length && <p className="text-xs text-muted-foreground mt-2">Mostrando os {d.leads.length} leads mais recentes de {num(d.total)}.</p>}
        </>)}
        {!isAdmin && <p className="text-xs text-muted-foreground mt-3">Os pesos da nota são definidos pela administração.</p>}
        {isAdmin && <div className="mt-3"><button type="button" className={btnGhost} onClick={() => setTab("weights")}>Ajustar pesos da nota</button></div>}
      </>)}
    </div>
  );
};
export default MarketingLeads;
