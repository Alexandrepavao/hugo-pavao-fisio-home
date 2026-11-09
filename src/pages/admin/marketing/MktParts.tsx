import { useState, type ReactNode } from "react";
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { IndicatorSheet, type IndicatorTrigger } from "@/lib/IndicatorSheet";
import { RANGE_LABEL } from "@/lib/period";
import { Badge, StatCard, btnGhost, btnPrimary } from "@/lib/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FILTER_KEYS, askAssistant, PLATFORM_LABEL, delta, fmtKpi, fmtDay, kpiOf, prevOf, useMktOptions, when, type Kpi, type KpisResp, type MktFilters, type Coverage } from "./mktApi";

const sel = "hp-input w-full";
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="grid gap-1 text-xs font-medium text-muted-foreground">{label}{children}</label>;

/** Barra de filtros compartilhada por todas as páginas do Marketing: período, organização/unidade (conforme acesso), frente, plataforma, conta, campanha, finalidade, produto, funil e responsável. */
export const MktFilterBar = ({ f, showView = true }: { f: MktFilters; showView?: boolean }) => {
  const opts = useMktOptions().data;
  const o = (k: keyof typeof FILTER_KEYS) => f.get(k);
  const set = f.set;
  const accounts = (opts?.accounts ?? []).filter((a) => !o("plataforma") || a.platform === o("plataforma"));
  const campaigns = (opts?.campaigns ?? []).filter((c) => !o("conta") || c.account_id === o("conta"));
  const extra = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Frente de negócio"><select className={sel} value={o("frente")} onChange={(e) => set("frente", e.target.value)}><option value="">Todas</option><option value="none">Sem frente (não classificadas)</option>{opts?.fronts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
      <Field label="Plataforma"><select className={sel} value={o("plataforma")} onChange={(e) => { set("plataforma", e.target.value); set("conta", ""); set("campanha", ""); }}><option value="">Todas</option>{opts?.platforms.filter((p) => p.enabled).map((p) => <option key={p.platform} value={p.platform}>{PLATFORM_LABEL[p.platform!]}</option>)}</select></Field>
      <Field label="Conta de anúncios"><select className={sel} value={o("conta")} onChange={(e) => { set("conta", e.target.value); set("campanha", ""); }}><option value="">Todas</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.origin === "manual" ? " (manual)" : ""}</option>)}</select></Field>
      <Field label="Campanha"><select className={sel} value={o("campanha")} onChange={(e) => set("campanha", e.target.value)}><option value="">Todas</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.state === "pending" ? " · aguardando classificação" : ""}</option>)}</select></Field>
      <Field label="Finalidade"><select className={sel} value={o("finalidade")} onChange={(e) => set("finalidade", e.target.value)}><option value="">Todas</option><option value="none">Sem finalidade</option>{opts?.purposes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
      <Field label="Produto (da campanha)"><select className={sel} value={o("produto")} onChange={(e) => set("produto", e.target.value)}><option value="">Todos</option>{opts?.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Funil de destino"><select className={sel} value={o("funil")} onChange={(e) => set("funil", e.target.value)}><option value="">Todos</option>{opts?.pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Responsável (do lead no CRM)"><select className={sel} value={o("resp")} onChange={(e) => set("resp", e.target.value)}><option value="">Todos</option>{opts?.owners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    </div>
  );
  const p = f.period;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4" data-testid="mkt-filters">
      {showView ? (
        <div role="group" aria-label="Visão dos resultados" className="hp-seg inline-flex rounded-lg border border-border overflow-hidden text-sm">
          {([["event", "Por data do evento"], ["cohort", "Por coorte de captação"]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={f.view === v} onClick={() => f.setView(v)} className={`px-3 h-9 font-medium ${f.view === v ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>{l}</button>))}
        </div>) : <span />}
      <PeriodFilter preset={p.preset} from={f.range.from} to={f.range.to} onPreset={p.onPreset} onFrom={p.onFrom} onTo={p.onTo} unit={p.unit} units={(opts?.units ?? []).map((u) => ({ id: u.id, name: u.name ?? "" }))} onUnit={p.onUnit}
        onClear={f.clear} extra={extra} extraCount={f.extraCount} extraSummary={RANGE_LABEL[p.preset]} />
    </div>
  );
};

/** Cartão de indicador do Marketing: valor, comparação com o período anterior (sem “bom/ruim” em cor), fórmula e detalhamento clicável com os MESMOS filtros. */
export const useDetail = (f: MktFilters) => {
  const [t, setT] = useState<IndicatorTrigger | null>(null);
  const open = (kind: string, title?: string) => setT({ rpc: "mkt_indicator_detail", title, scope: `${f.range.from} a ${f.range.to} · ${f.view === "cohort" ? "coorte" : "por evento"}`, params: { p_kind: kind, p_from: f.range.from, p_to: f.range.to, p_filters: f.filters, p_view: f.view } });
  return { open, sheet: <IndicatorSheet trigger={t} onClose={() => setT(null)} /> };
};
export const MktKpi = ({ k, prev, currency, onOpen, short }: { k: Kpi | undefined; prev?: Kpi; currency: string; onOpen?: (kind: string, title: string) => void; short?: boolean }) => {
  if (!k) return null;
  const d = delta(k, prev);
  return <StatCard label={k.label} value={fmtKpi(k, currency)} unavailable={!k.available} delta={d ? { dir: d.dir, text: d.text } : null} tone={k.warning ? "warning" : undefined}
    basis={k.available ? (short ? k.formula.split(";")[0] : k.formula) + (k.warning ? ` ⚠ ${k.warning}` : "") : `Não disponível: ${k.reason ?? "sem fonte"}`} onClick={k.detail && onOpen ? () => onOpen(k.detail!, k.label) : undefined} />;
};
export const kpiByKeys = (r: KpisResp | undefined, keys: string[]) => keys.map((k) => ({ k: kpiOf(r, k), p: prevOf(r, k) }));

/** Faixa de cobertura/atualização: deixa claro o intervalo efetivamente coberto e que falha não é gasto zero. */
export const CoverageBanner = ({ c, model, view }: { c?: Coverage; model?: KpisResp["model"]; view?: string }) => {
  if (!c) return null;
  const bad = c.accounts > 0 && (c.incomplete || c.stale_accounts > 0);
  return (
    <div className="hp-card p-3 mb-4 text-[13px] flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="mkt-coverage" role="status">
      {bad ? <AlertTriangle size={15} aria-hidden style={{ color: "hsl(var(--warning, 38 80% 40%))" }} /> : <Info size={15} aria-hidden className="text-muted-foreground" />}
      <span>{c.accounts === 0 ? "Nenhuma conta de anúncios acompanhada neste escopo — o investimento aparece como “Não disponível”, não como zero."
        : <>Cobertura do gasto: <b>{c.ok_days}</b> de <b>{c.expected_days}</b> dias/conta{c.failed_days ? <> · <b>{c.failed_days}</b> com falha</> : null}{c.missing_days ? <> · <b>{c.missing_days}</b> sem coleta</> : null}. {c.last_ok_at ? <>Última coleta pela API: {when(c.last_ok_at)}.</> : " Sem coleta pela API (só lançamento manual)."}{c.stale_accounts ? ` ${c.stale_accounts} conta(s) desatualizada(s).` : ""}</>}</span>
      {model && <span className="text-muted-foreground">Atribuição: {model.name} (janela de {model.window_days} dias) · visão {view === "cohort" ? "por coorte" : "por data do evento"}</span>}
    </div>
  );
};
export const SevBadge = ({ s }: { s: string }) => <Badge tone={s === "bad" ? "danger" : s === "warn" ? "warning" : s === "info" ? "info" : "neutral"}>{s === "bad" ? "Atenção" : s === "warn" ? "Revisar" : s === "info" ? "Informativo" : "Em dia"}</Badge>;
export const range = (f: MktFilters) => `${fmtDay(f.range.from)} a ${fmtDay(f.range.to)}`;

const SUGGESTIONS = ["Qual campanha está com melhor retorno e qual está pior neste período?", "Onde está o maior gargalo do funil?", "O que mudou em relação ao período anterior?", "Quais anúncios mereciam ser revisados?"];
/** Assistente de IA: responde perguntas sobre os números do período e filtros atuais. Só lê agregados (sem dado de pessoa) e só sugere — não altera campanhas. */
export const MktAssistantButton = ({ f, funnelId }: { f: MktFilters; funnelId?: string }) => {
  const [open, setOpen] = useState(false); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<{ q: string; a?: string; err?: string; basis?: string }[]>([]);
  const ask = async (text: string) => {
    const question = text.trim(); if (question.length < 3 || busy) return; setBusy(true); setQ("");
    const r = await askAssistant({ question, from: f.range.from, to: f.range.to, view: f.view, filters: f.filters, funnel_id: funnelId });
    setTurns((t) => [...t, r.ok && r.data.answer ? { q: question, a: r.data.answer, basis: r.data.basis } : { q: question, err: r.data.message ?? "Não foi possível obter a resposta agora." }]); setBusy(false);
  };
  return (<>
    <button type="button" className={btnGhost} onClick={() => setOpen(true)} data-testid="mkt-assistant-open"><Sparkles size={15} aria-hidden /> Perguntar à IA</button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0" data-testid="mkt-assistant">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
          <SheetTitle className="text-[1.0625rem]">Assistente de Marketing</SheetTitle>
          <SheetDescription>Responde com base nos números de {range(f)} e nos filtros selecionados. Só enxerga totais e nomes de campanhas e anúncios — nunca dados de pessoas ou de saúde — e apenas sugere: não altera nenhuma campanha.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 grid content-start gap-3" aria-live="polite">
          {turns.length === 0 && <div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">Sugestões</p>{SUGGESTIONS.map((s) => <button key={s} type="button" className="hp-card p-3 text-left text-sm hover:border-primary" onClick={() => ask(s)}>{s}</button>)}</div>}
          {turns.map((t, i) => (<div key={i} className="grid gap-2">
            <p className="text-sm font-medium bg-muted rounded-lg px-3 py-2 justify-self-end max-w-[90%]">{t.q}</p>
            {t.a ? <div className="hp-card p-3 text-sm whitespace-pre-wrap" data-testid="mkt-assistant-answer">{t.a}<p className="text-[11px] text-muted-foreground mt-2">{t.basis}</p></div>
              : <div className="hp-card p-3 text-sm" role="alert" data-testid="mkt-assistant-unavailable"><Badge tone="warning">Indisponível</Badge> <span className="ml-1">{t.err}</span></div>}
          </div>))}
          {busy && <p className="text-sm text-muted-foreground">Analisando os números…</p>}
        </div>
        <form className="px-5 py-4 border-t border-border flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <input className="hp-input flex-1" value={q} maxLength={600} onChange={(e) => setQ(e.target.value)} placeholder="Pergunte sobre campanhas, funil, retorno…" aria-label="Pergunta ao assistente" />
          <button type="submit" className={btnPrimary} disabled={busy || q.trim().length < 3}>Enviar</button>
        </form>
      </SheetContent>
    </Sheet>
  </>);
};
