import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge, Msg, PageHead, State, Table, Td, btnGhost, btnPrimary, errText } from "@/lib/ui";
import { useMktInvalidate, useMktOptions, useMktRpc, when, useNote } from "./mktApi";

interface Settings { attribution_window_days: number; reprocess_days: number; backfill_days: number; manual_refresh_min_minutes: number; stale_after_hours: number; reporting_currency: string; paid_mediums: string[]; partner_active_days: number | null; evaluation_service_ids: string[]; qualified_stage_ids: string[]; config_version: number }
interface AttrLog { id: number; at: string; kind: string; window_from: string | null; window_to: string | null; changed: number; config_version: number | null; note: string | null }
interface Cfg { settings: Settings; fronts: { id: string; label: string; business_line: string | null; position: number; active: boolean }[]; purposes: { id: string; label: string; default_result: string | null; position: number; active: boolean }[]; event_types: { key: string; label: string; description: string }[];
  pipelines: { id: string; name: string; kind: string; stages: { id: string; name: string; position: number; kind: string }[] }[]; services: { id: string; name: string }[] }
const copy = (t: string) => navigator.clipboard?.writeText(t);
const META_TPL = "?utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}&hp_campaign_id={{campaign.id}}&hp_adset_id={{adset.id}}&hp_ad_id={{ad.id}}";
const GOOGLE_TPL = "{lpurl}?utm_source=google&utm_medium=cpc&hp_campaign_id={campaignid}&hp_adset_id={adgroupid}&hp_ad_id={creative}";

const Rules = ({ cfg }: { cfg: Cfg }) => {
  const inv = useMktInvalidate(); const { msg, setMsg } = useNote(); const s0 = cfg.settings;
  const [s, setS] = useState({ ...s0, paid: s0.paid_mediums.join(", "), pad: s0.partner_active_days == null ? "" : String(s0.partner_active_days) }); useEffect(() => setS({ ...s0, paid: s0.paid_mediums.join(", "), pad: s0.partner_active_days == null ? "" : String(s0.partner_active_days) }), [s0]);
  const toggle = (k: "qualified_stage_ids" | "evaluation_service_ids", id: string) => setS((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));
  const save = async () => { const { data, error } = await supabase.rpc("mkt_settings_set", { p: { attribution_window_days: Number(s.attribution_window_days), reprocess_days: Number(s.reprocess_days), backfill_days: Number(s.backfill_days), manual_refresh_min_minutes: Number(s.manual_refresh_min_minutes),
    stale_after_hours: Number(s.stale_after_hours), reporting_currency: s.reporting_currency, paid_mediums: s.paid.split(",").map((x) => x.trim()).filter(Boolean), partner_active_days: s.pad === "" ? null : Number(s.pad), qualified_stage_ids: s.qualified_stage_ids, evaluation_service_ids: s.evaluation_service_ids } });
    if (error) return setMsg({ kind: "err", text: errText(error) }); inv(); setMsg({ kind: "ok", text: data?.note ? `Salvo. ${data.note}` : "Configurações salvas." }); };
  const num = (k: "attribution_window_days" | "reprocess_days" | "backfill_days" | "manual_refresh_min_minutes" | "stale_after_hours", label: string, hint: string) => (
    <label className="grid gap-1 text-sm">{label}<input className="hp-input" type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">{hint}</span></label>);
  return (
    <section className="hp-card p-5 mb-5" aria-label="Regras" data-testid="mkt-rules">
      <h3 className="text-base font-bold">Regras de atribuição e coleta <Badge tone="info">versão {s0.config_version}</Badge></h3>
      <p className="text-[13px] text-muted-foreground mt-1">Mudar uma regra <b>não recalcula o histórico sozinho</b>: as atribuições já calculadas guardam a janela e a versão usadas. Para aplicar a nova regra a um período, use “Recalcular atribuição” em Funil e atribuição.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
        {num("attribution_window_days", "Janela de atribuição (dias)", "Último toque pago elegível antes da criação da oportunidade, dentro desta janela.")}
        {num("backfill_days", "Histórico inicial (dias)", "Quanto tempo voltar ao conectar uma conta.")}
        {num("reprocess_days", "Reprocessar janela recente (dias)", "Incorpora revisões que as plataformas fazem nos dados recentes.")}
        {num("manual_refresh_min_minutes", "Intervalo mínimo do “Atualizar agora” (min)", "Controle de frequência para respeitar os limites das APIs.")}
        {num("stale_after_hours", "Dado desatualizado após (h)", "Sem coleta bem-sucedida há mais que isto = aviso no painel de qualidade.")}
        <label className="grid gap-1 text-sm">Moeda dos relatórios<input className="hp-input" maxLength={3} value={s.reporting_currency} onChange={(e) => setS({ ...s, reporting_currency: e.target.value.toUpperCase() })} /><span className="text-xs text-muted-foreground">Gasto em outra moeda NÃO é somado (sem conversão).</span></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Mídias consideradas pagas (utm_medium)<input className="hp-input" value={s.paid} onChange={(e) => setS({ ...s, paid: e.target.value })} /><span className="text-xs text-muted-foreground">Lista separada por vírgula. Toque de Meta/Google com id de campanha ou clique também conta como pago.</span></label>
        <label className="grid gap-1 text-sm">Parceiro ativo = indicou nos últimos (dias)<input className="hp-input" type="number" value={s.pad} placeholder="não configurado" onChange={(e) => setS({ ...s, pad: e.target.value })} /><span className="text-xs text-muted-foreground">Vazio = “parceiro ativo” fica indisponível (critério explícito).</span></label>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 mt-5">
        <fieldset><legend className="text-sm font-bold mb-1">Etapas do funil que significam “lead qualificado”</legend><p className="text-xs text-muted-foreground mb-2">Marque também as etapas posteriores. Vazio = “lead qualificado” fica indisponível.</p>
          {cfg.pipelines.map((p) => <div key={p.id} className="mb-2"><p className="text-xs font-semibold text-muted-foreground">{p.name}</p><div className="flex flex-wrap gap-x-4 gap-y-1">{p.stages.map((st) => <label key={st.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.qualified_stage_ids.includes(st.id)} onChange={() => toggle("qualified_stage_ids", st.id)} />{st.name}</label>)}</div></div>)}</fieldset>
        <fieldset><legend className="text-sm font-bold mb-1">Serviços que contam como “avaliação”</legend><p className="text-xs text-muted-foreground mb-2">Base das avaliações agendadas/realizadas e do custo por avaliação. Vazio = indisponível.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{cfg.services.map((sv) => <label key={sv.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.evaluation_service_ids.includes(sv.id)} onChange={() => toggle("evaluation_service_ids", sv.id)} />{sv.name}</label>)}</div></fieldset>
      </div>
      <div className="mt-4"><button type="button" className={btnPrimary} onClick={save}>Salvar regras</button></div><Msg m={msg} />
    </section>
  );
};

const Catalog = ({ cfg, kind }: { cfg: Cfg; kind: "front" | "purpose" }) => {
  const inv = useMktInvalidate(); const { msg, setMsg } = useNote(); const [label, setLabel] = useState(""); const [res, setRes] = useState("");
  const rows = kind === "front" ? cfg.fronts : cfg.purposes;
  const save = async (id: string | null, l: string, extra: { business_line?: string | null; default_result?: string | null; position?: number; active?: boolean }) => {
    const r = kind === "front" ? await supabase.rpc("mkt_front_save", { p_id: id, p_label: l, p_business_line: extra.business_line ?? null, p_position: extra.position ?? 0, p_active: extra.active ?? true })
      : await supabase.rpc("mkt_purpose_save", { p_id: id, p_label: l, p_default_result: extra.default_result ?? null, p_position: extra.position ?? 0, p_active: extra.active ?? true });
    if (r.error) return setMsg({ kind: "err", text: errText(r.error) }); setLabel(""); setRes(""); inv(); setMsg({ kind: "ok", text: "Salvo." });
  };
  return (
    <section className="hp-card p-5" aria-label={kind === "front" ? "Frentes de negócio" : "Finalidades"} data-testid={`mkt-${kind}`}>
      <h3 className="text-base font-bold">{kind === "front" ? "Frentes de negócio" : "Finalidades das campanhas"}</h3>
      <p className="text-xs text-muted-foreground mb-3">{kind === "front" ? "Cadastros livres (HP Fisioterapia, HP Academy, HP Tech ou outras): não há lista fixa." : "Para que serve a campanha dentro da organização (captar pacientes, parceiros, vender mentoria…). Cadastros livres."}</p>
      <ul className="grid gap-1.5 text-sm">{rows.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span className={r.active ? "" : "text-muted-foreground line-through"}>{r.label}{"default_result" in r && r.default_result ? <span className="text-xs text-muted-foreground"> · resultado padrão: {cfg.event_types.find((e) => e.key === r.default_result)?.label}</span> : null}</span>
        <button type="button" className="text-accent text-xs hover:underline" onClick={() => save(r.id, r.label, { business_line: "business_line" in r ? r.business_line : null, default_result: "default_result" in r ? r.default_result : null, position: r.position, active: !r.active })}>{r.active ? "Desativar" : "Reativar"}</button></li>)}</ul>
      <div className="flex flex-wrap gap-2 mt-3"><input className="hp-input flex-1 min-w-[10rem]" aria-label={kind === "front" ? "Nova frente" : "Nova finalidade"} placeholder={kind === "front" ? "Nova frente" : "Nova finalidade"} value={label} onChange={(e) => setLabel(e.target.value)} />
        {kind === "purpose" && <select className="hp-input" aria-label="Resultado principal padrão" value={res} onChange={(e) => setRes(e.target.value)}><option value="">Resultado padrão…</option>{cfg.event_types.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select>}
        <button type="button" className={btnGhost} disabled={label.trim().length < 2} onClick={() => save(null, label, { default_result: res || null, position: rows.length + 1 })}>Adicionar</button></div><Msg m={msg} />
    </section>
  );
};

/** Configurações do Marketing: regras, frentes, finalidades, modelo de link de campanha e registro das ações explícitas de atribuição. */
const MarketingSettings = () => {
  const admin = !!useMktOptions().data?.is_admin; const cfg = useMktRpc<Cfg>("mkt_config_get", {}, admin);
  const log = useQuery({ queryKey: ["mkt", "attr-log"], enabled: admin, queryFn: async () => ((await supabase.from("mkt_attribution_log").select("id, at, kind, window_from, window_to, changed, config_version, note").order("at", { ascending: false }).limit(10)).data ?? []) as AttrLog[] });
  return (
    <div data-testid="mkt-settings">
      <PageHead eyebrow="Marketing" title="Configurações" hint="Regras de atribuição, frentes e finalidades (livres por organização), e como marcar os links das campanhas." />
      {!admin && <div className="hp-card p-4 text-sm" role="note">Somente administradores alteram as configurações do Marketing.</div>}
      <State loading={cfg.isLoading} error={cfg.error} />
      {admin && cfg.data && (<>
        <Rules cfg={cfg.data} />
        <div className="grid gap-4 lg:grid-cols-2 mb-5"><Catalog cfg={cfg.data} kind="front" /><Catalog cfg={cfg.data} kind="purpose" /></div>
        <section className="hp-card p-5 mb-5" aria-label="Links das campanhas" data-testid="mkt-links">
          <h3 className="text-base font-bold">Como marcar os links dos anúncios</h3>
          <p className="text-[13px] text-muted-foreground mt-1">Para o Hub ligar cada lead à campanha <b>importada</b>, o link de destino do anúncio deve levar o <b>id</b> da campanha (<code>hp_campaign_id</code>). Os modelos abaixo usam os parâmetros dinâmicos de cada plataforma; confira no pré-visualizar do anúncio antes de publicar. Os parâmetros são gravados higienizados (sem e-mail, token ou URL completa) e <b>não são prova de autenticidade</b>: servem para análise. Identificadores de clique (fbclid/gclid) só são guardados com consentimento de rastreamento — hoje nenhum consentimento é coletado, então não são guardados.</p>
          {([["Meta Ads (parâmetros de URL do anúncio)", META_TPL], ["Google Ads (modelo de acompanhamento)", GOOGLE_TPL]] as const).map(([t, v]) => <div key={t} className="mt-3"><p className="text-sm font-medium">{t}</p><p className="flex items-start gap-2 mt-1"><code className="break-all text-xs bg-muted/50 rounded p-2 flex-1">{v}</code><button type="button" aria-label={`Copiar modelo ${t}`} className="text-accent mt-2" onClick={() => copy(v)}><Copy size={14} /></button></p></div>)}
        </section>
        <h3 className="text-base font-bold mb-2">Ações explícitas sobre a atribuição</h3>
        <Table head={["Quando", "Ação", "Período", "Registros", "Versão da regra", "Observação"]} right={[3]}>
          {(log.data ?? []).length === 0 && <tr><Td className="text-muted-foreground">Nenhuma ação registrada.</Td>{Array.from({ length: 5 }, (_, i) => <Td key={i}>{""}</Td>)}</tr>}
          {(log.data ?? []).map((l) => <tr key={l.id}><Td>{when(l.at)}</Td><Td>{{ recompute: "Recalcular", backfill: "Preencher histórico", relink: "Religar toques" }[l.kind as string]}</Td><Td className="text-[13px]">{l.window_from ? `${l.window_from} a ${l.window_to}` : "—"}</Td><Td num>{l.changed}</Td><Td>{l.config_version ?? "—"}</Td><Td className="text-[12.5px]">{l.note}</Td></tr>)}
        </Table>
      </>)}
    </div>
  );
};
export default MarketingSettings;
