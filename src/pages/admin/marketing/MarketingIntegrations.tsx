import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Copy, Link2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge, Msg, PageHead, State, Table, Td, btnGhost, btnPrimary, confirmDialog, errText, type Tone } from "@/lib/ui";
import { PLATFORM_LABEL, callMarketingFn, money, useMktInvalidate, useMktOptions, useMktRpc, when, useNote } from "./mktApi";

interface Conn { id: string; platform: "meta" | "google"; enabled: boolean; status: string; provider_user_label: string | null; granted_scopes: string[]; token_expires_at: string | null; api_version: string | null; connected_at: string | null; last_error: string | null; last_error_at: string | null; last_sync_at: string | null; last_ok_at: string | null }
interface Acc { id: string; platform: string; origin: string; external_id: string; name: string | null; currency: string | null; timezone: string | null; platform_status: string | null; selected: boolean; unit_id: string | null; connection_id: string | null; covered_days: number; last_ok_day: string | null;
  last_run: { kind: string; status: string; started_at: string; error_code: string | null; error_message: string | null; rows_written: number; window_from: string; window_to: string } | null }
interface Cfg { connections: Conn[]; accounts: Acc[]; units: { id: string; name: string }[] }
interface FnStatus { base_ready: boolean; return_url: string | null; meta: { configured: boolean; redirect_uri: string; api_version: string; scopes: string[] }; google: { configured: boolean; redirect_uri: string; api_version: string; developer_token_sent: boolean }; cron_ready: boolean }
interface RefreshState { min_minutes: number; last_manual_at: string | null; allowed: boolean; next_allowed_at: string | null }
interface SyncRun { id: string; kind: string; status: string; started_at: string; rows_written: number; pages: number; retries: number; error_message: string | null; window_from: string | null; window_to: string | null }
interface ManualRow { id: number; day: string; spend: number; currency: string; resolution: string; manual_priority: boolean; note: string | null; campaign: { name: string } | null; account: { name: string } | null }
const sel = "hp-input w-full";
const STATUS: Record<string, [string, Tone]> = { disconnected: ["Desconectada", "neutral"], pending: ["Aguardando autorização", "warning"], active: ["Conectada", "info"], error: ["Com erro", "danger"], reauth_required: ["Precisa reconectar", "danger"] };
const RESULT: Record<string, string> = { conectado: "Conexão concluída. Selecione abaixo as contas que o Hub deve acompanhar.", estado: "A autorização expirou, já foi usada ou não pertence a esta sessão. Inicie a conexão de novo.", negado: "A autorização foi negada ou cancelada na plataforma.",
  permissao: "A plataforma não concedeu a permissão de leitura necessária. Conecte de novo e aceite a permissão.", indisponivel: "As credenciais do aplicativo ainda não foram cadastradas no servidor.", erro: "Não foi possível concluir a conexão. Tente novamente.",
  erro_contas: "Conectou, mas não foi possível listar as contas de anúncios (veja o erro da conexão).", plataforma_desabilitada: "Habilite a plataforma antes de conectar." };
const copy = (t: string) => navigator.clipboard?.writeText(t);

const PlatformCard = ({ c, accs, units, st, stError, refresh, admin, reload }: { c: Conn; accs: Acc[]; units: { id: string; name: string }[]; st?: FnStatus; stError?: boolean; refresh?: RefreshState; admin: boolean; reload: () => void }) => {
  const { msg, setMsg } = useNote(); const [busy, setBusy] = useState(""); const [s, tone] = STATUS[c.status] ?? [c.status, "neutral" as Tone];
  const conf = st?.[c.platform]; const act = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e) { setMsg({ kind: "err", text: errText(e as Error) }); } setBusy(""); reload(); };
  const call = async (route: string, body: unknown, ok: string) => { const r = await callMarketingFn<{ message?: string; url?: string; error?: string; results?: unknown }>(route, "POST", body); if (!r.ok) setMsg({ kind: "err", text: r.data.message ?? r.data.error ?? `Falhou (${r.status}).` }); else setMsg({ kind: "ok", text: ok }); return r; };
  const connect = () => act("start", async () => { const r = await call("start", { platform: c.platform }, "Redirecionando…"); if (r.ok && r.data.url) window.location.assign(r.data.url); });
  const syncNow = () => act("sync", async () => { const r = await call("sync", {}, "Atualização executada. Veja o resultado por conta abaixo."); void r; });
  return (
    <section className="hp-card p-5 mb-5" aria-label={PLATFORM_LABEL[c.platform]} data-testid={`mkt-platform-${c.platform}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-base font-bold">{PLATFORM_LABEL[c.platform]}</h3><p className="text-xs text-muted-foreground">Somente leitura · API v{(conf?.api_version ?? c.api_version ?? "").replace(/^v/, "")}{c.provider_user_label ? ` · ${c.provider_user_label}` : ""}</p></div>
        <div className="flex items-center gap-3"><Badge tone={tone}>{s}</Badge>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.enabled} disabled={!admin || !!busy} aria-label={`Habilitar ${PLATFORM_LABEL[c.platform]}`} onChange={(e) => act("enable", async () => { const { error } = await supabase.rpc("mkt_connection_enable", { p_platform: c.platform, p_enabled: e.target.checked }); if (error) throw error; })} /> Usar esta plataforma</label></div>
      </div>
      {stError && !conf && <div className="mt-3 rounded-lg border border-border p-3 text-[13px]" role="alert"><AlertTriangle size={14} className="inline mr-1" aria-hidden /><b>Não foi possível consultar a função de integração</b> (marketing-ads): ela pode não estar publicada neste ambiente ou não aceitar esta origem. A conexão fica desabilitada até a consulta funcionar.</div>}
      {conf && !conf.configured && <div className="mt-3 rounded-lg border border-border p-3 text-[13px]" role="alert"><AlertTriangle size={14} className="inline mr-1" aria-hidden /><b>Conexão ainda indisponível:</b> as credenciais do aplicativo {c.platform === "meta" ? "Meta (META_APP_ID/META_APP_SECRET)" : "Google Ads (GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET)"} não foram cadastradas no servidor. Nada é simulado: o botão Conectar só funciona depois disso. Veja <code>docs/marketing-conexao-meta-google.md</code>.</div>}
      {conf && <div className="mt-3 text-[13px] text-muted-foreground"><p>URL de retorno (cadastre exatamente esta no {c.platform === "meta" ? "painel do app da Meta (Login do Facebook › URIs de redirecionamento OAuth válidos)" : "cliente OAuth do Google Cloud (URIs de redirecionamento autorizados)"}):</p>
        <p className="flex items-center gap-2 mt-1"><code className="break-all text-foreground" data-testid={`redirect-${c.platform}`}>{conf.redirect_uri}</code><button type="button" className="text-accent" aria-label="Copiar URL de retorno" onClick={() => copy(conf.redirect_uri)}><Copy size={14} /></button></p></div>}
      <dl className="grid gap-x-6 gap-y-1 text-[13px] mt-3 sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Última sincronização</dt><dd>{when(c.last_sync_at)}</dd></div><div><dt className="text-muted-foreground">Último sucesso</dt><dd>{when(c.last_ok_at)}</dd></div>
        <div><dt className="text-muted-foreground">{c.platform === "meta" ? "Acesso válido até" : "Permissão"}</dt><dd>{c.platform === "meta" ? (c.token_expires_at ? when(c.token_expires_at) : "—") : c.granted_scopes.length ? "somente leitura (consultas)" : "—"}</dd></div>
      </dl>
      {c.last_error && <p className="mt-2 text-[13px] rounded-lg p-2.5" role="alert" style={{ background: "hsl(var(--destructive-soft))", color: "hsl(var(--destructive))" }}><b>Último erro</b> ({when(c.last_error_at)}): {c.last_error}</p>}
      {admin && <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" className={btnPrimary} disabled={!c.enabled || !!busy || !conf || !conf.configured} onClick={connect} data-testid={`connect-${c.platform}`}><Link2 size={14} /> {c.status === "active" ? "Reconectar" : c.status === "disconnected" ? "Conectar" : "Conectar de novo"}</button>
        <button type="button" className={btnGhost} disabled={c.status === "disconnected" || !!busy} onClick={() => act("discover", async () => { await call("discover", { platform: c.platform }, "Contas atualizadas."); })}>Atualizar lista de contas</button>
        <button type="button" className={btnGhost} disabled={!c.enabled || c.status === "disconnected" || !!busy || (refresh ? !refresh.allowed : false)} onClick={syncNow} title={refresh && !refresh.allowed ? `Disponível de novo às ${when(refresh.next_allowed_at)}` : ""}><RefreshCw size={14} /> Atualizar agora</button>
        <button type="button" className={btnGhost} disabled={c.status === "disconnected" || !!busy} onClick={async () => { if (await confirmDialog(`Desconectar ${PLATFORM_LABEL[c.platform]}?`, "Para as sincronizações, revoga o acesso na plataforma quando suportado, apaga as credenciais e deixa de acompanhar as contas. O histórico já importado é preservado. Nenhum anúncio é alterado.", "Desconectar", true)) act("disc", async () => { await call("disconnect", { platform: c.platform }, "Desconectada. Credenciais apagadas."); }); }}>Desconectar</button>
        {refresh && !refresh.allowed && <span className="text-xs text-muted-foreground self-center">Atualização manual: próxima liberação às {when(refresh.next_allowed_at)} (mínimo de {refresh.min_minutes} min).</span>}
      </div>}
      <Msg m={msg} />
      <h4 className="text-sm font-bold mt-5 mb-2">Contas de anúncios autorizadas</h4>
      {accs.length === 0 ? <p className="text-[13px] text-muted-foreground">Nenhuma conta listada. {c.status === "disconnected" ? "Conecte a plataforma para listar as contas que você autorizou." : "Use “Atualizar lista de contas”."}</p> : (
        <Table head={["Conta", "Moeda / fuso", "Situação", "Acompanhar", "Unidade", "Cobertura", "Última execução"]}>
          {accs.map((a) => (
            <tr key={a.id}>
              <Td><b>{a.name ?? a.external_id}</b><span className="block text-xs text-muted-foreground">{a.external_id}</span></Td><Td className="text-[13px]">{a.currency ?? "—"}<span className="block text-xs text-muted-foreground">{a.timezone ?? "—"}</span></Td><Td className="text-[13px]">{a.platform_status ?? "—"}</Td>
              <Td><input type="checkbox" aria-label={`Acompanhar ${a.name ?? a.external_id}`} checked={a.selected} disabled={!admin || !!busy} onChange={(e) => act("sel", async () => { const { error } = await supabase.rpc("mkt_account_select", { p_account: a.id, p_selected: e.target.checked, p_unit: a.unit_id }); if (error) throw error; })} /></Td>
              <Td><select className={sel} aria-label={`Unidade de ${a.name ?? a.external_id}`} value={a.unit_id ?? ""} disabled={!admin || !a.selected} onChange={(e) => act("unit", async () => { const { error } = await supabase.rpc("mkt_account_select", { p_account: a.id, p_selected: true, p_unit: e.target.value || null }); if (error) throw error; })}><option value="">Toda a organização</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Td>
              <Td className="text-[13px]">{a.covered_days} dia(s){a.last_ok_day ? <span className="block text-xs text-muted-foreground">até {a.last_ok_day.split("-").reverse().join("/")}</span> : null}</Td>
              <Td className="text-[12.5px]">{a.last_run ? <>{a.last_run.status === "ok" ? "Concluída" : a.last_run.status === "partial" ? "Parcial" : a.last_run.status === "error" ? "Erro" : a.last_run.status}<span className="block text-xs text-muted-foreground">{when(a.last_run.started_at)} · {a.last_run.rows_written} linha(s)</span>{a.last_run.error_message && <span className="block text-xs" style={{ color: "hsl(var(--destructive))" }}>{a.last_run.error_message}</span>}</> : "—"}</Td>
            </tr>))}
        </Table>)}
    </section>
  );
};

const ManualSpend = ({ cfg, reload }: { cfg: Cfg; reload: () => void }) => {
  const { msg, setMsg } = useNote(); const manualAccs = cfg.accounts.filter((a) => a.origin === "manual" && a.selected);
  const campaigns = useMktRpc<{ id: string; name: string; account: string; account_id: string; origin: string }[]>("mkt_campaigns_admin", {}); const rows = useQuery({ queryKey: ["mkt", "manual-rows"], queryFn: async () => (await supabase.from("mkt_spend_daily").select("id, day, spend, currency, resolution, manual_priority, note, campaign:mkt_campaigns(name), account:mkt_ad_accounts(name)").eq("source", "manual").order("day", { ascending: false }).limit(40)).data as unknown as ManualRow[] ?? [] });
  const [acc, setAcc] = useState({ platform: "meta", name: "", currency: "BRL" }); const [f, setF] = useState({ account: "", campaign: "", newCampaign: "", day: new Date().toISOString().slice(0, 10), currency: "BRL", amount: "", note: "", prefer: false }); const [csv, setCsv] = useState("");
  const inv = useMktInvalidate(); const done = () => { inv(); reload(); rows.refetch(); };
  const run = async (fn: () => Promise<{ error: unknown; data?: unknown }>, ok: string) => { const { error, data } = await fn(); if (error) return setMsg({ kind: "err", text: errText(error as Error) }); setMsg({ kind: "ok", text: ok + (data && typeof data === "object" && "imported" in (data as object) ? ` ${JSON.stringify(data)}` : "") }); done(); };
  const accCamps = (campaigns.data ?? []).filter((c) => c.account_id === f.account);
  return (
    <section className="hp-card p-5 mb-5" aria-label="Lançamento manual de gastos" data-testid="mkt-manual">
      <h3 className="text-base font-bold">Lançamento manual de gastos</h3>
      <p className="text-[13px] text-muted-foreground mt-1">Para usar o Marketing antes de conectar as APIs. Cada lançamento informa data, plataforma, conta, campanha, moeda e valor e fica identificado como <b>manual</b>. Se a API depois trouxer o mesmo dia da mesma conta, o manual fica “substituído pela API” (fora da soma) — a menos que você o priorize explicitamente. Nunca somam os dois.</p>
      <div className="grid gap-5 lg:grid-cols-2 mt-4">
        <div className="grid gap-2 content-start"><h4 className="text-sm font-bold">1. Conta manual</h4>
          <div className="grid grid-cols-3 gap-2"><select className={sel} aria-label="Plataforma da conta manual" value={acc.platform} onChange={(e) => setAcc({ ...acc, platform: e.target.value })}><option value="meta">Meta Ads</option><option value="google">Google Ads</option></select>
            <input className="hp-input" aria-label="Nome da conta manual" placeholder="Nome da conta" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /><input className="hp-input" aria-label="Moeda da conta" maxLength={3} value={acc.currency} onChange={(e) => setAcc({ ...acc, currency: e.target.value.toUpperCase() })} /></div>
          <button type="button" className={btnGhost} disabled={acc.name.trim().length < 2} onClick={() => run(async () => supabase.rpc("mkt_manual_account_create", { p_platform: acc.platform, p_name: acc.name, p_currency: acc.currency, p_timezone: "America/Sao_Paulo", p_unit: null }), "Conta manual criada.")}>Criar conta manual</button></div>
        <div className="grid gap-2 content-start"><h4 className="text-sm font-bold">2. Lançar gasto</h4>
          <select className={sel} aria-label="Conta do lançamento" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value, campaign: "" })}><option value="">Conta…</option>{cfg.accounts.filter((a) => a.selected).map((a) => <option key={a.id} value={a.id}>{PLATFORM_LABEL[a.platform]} · {a.name}{a.origin === "api" ? " (API)" : " (manual)"}</option>)}</select>
          <select className={sel} aria-label="Campanha do lançamento" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })}><option value="">{f.account ? "Campanha existente…" : "Escolha a conta"}</option>{accCamps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ Nova campanha manual</option></select>
          {f.campaign === "__new" && <input className="hp-input" aria-label="Nome da nova campanha" placeholder="Nome da campanha" value={f.newCampaign} onChange={(e) => setF({ ...f, newCampaign: e.target.value })} />}
          <div className="grid grid-cols-3 gap-2"><input className="hp-input" type="date" aria-label="Data do gasto" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /><input className="hp-input" aria-label="Moeda" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /><input className="hp-input" aria-label="Valor" inputMode="decimal" placeholder="Valor" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.prefer} onChange={(e) => setF({ ...f, prefer: e.target.checked })} /> Priorizar este lançamento sobre a API do mesmo dia</label>
          <button type="button" className={btnPrimary} disabled={!f.account || !f.campaign || (f.campaign === "__new" && f.newCampaign.trim().length < 2) || !f.amount} onClick={() => run(async () => {
            let camp = f.campaign; if (camp === "__new") { const r = await supabase.rpc("mkt_manual_campaign_create", { p_account: f.account, p_name: f.newCampaign }); if (r.error) return { error: r.error }; camp = r.data as string; }
            return supabase.rpc("mkt_spend_manual_upsert", { p_campaign: camp, p_day: f.day, p_amount: Number(f.amount.replace(",", ".")), p_currency: f.currency, p_impressions: null, p_clicks: null, p_note: null, p_prefer_manual: f.prefer });
          }, "Gasto lançado (origem: manual).")}>Lançar gasto</button></div>
      </div>
      <details className="mt-4 text-[13px]"><summary className="cursor-pointer font-medium">Importar vários lançamentos (colar CSV)</summary>
        <p className="text-muted-foreground mt-2">Colunas, separadas por ponto e vírgula, com cabeçalho: <code>data;conta;campanha;moeda;valor</code>. A conta (manual) e a moeda devem existir; a campanha é criada se for nova. Linhas com erro não impedem as demais.</p>
        <textarea className="hp-input w-full mt-2 font-mono text-xs" rows={5} aria-label="CSV de gastos" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"data;conta;campanha;moeda;valor\n2026-11-03;Meta manual;Campanha A;BRL;120,50"} />
        <button type="button" className={`${btnGhost} mt-2`} disabled={csv.trim().split("\n").length < 2} onClick={() => { const lines = csv.trim().split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(";").map((x) => x.trim())); run(async () => supabase.rpc("mkt_spend_manual_import", { p_rows: lines.map(([day, account, campaign, currency, amount]) => ({ day, account, campaign, currency, amount })) }), "Importação processada."); }}>Importar</button></details>
      <Msg m={msg} />
      <h4 className="text-sm font-bold mt-5 mb-2">Últimos lançamentos manuais</h4>
      <Table head={["Data", "Conta", "Campanha", "Valor", "Situação", ""]} right={[3]}>
        {(rows.data ?? []).length === 0 && <tr><Td className="text-muted-foreground">Nenhum lançamento manual.</Td>{Array.from({ length: 5 }, (_, i) => <Td key={i}>{""}</Td>)}</tr>}
        {(rows.data ?? []).map((r) => <tr key={r.id}><Td>{r.day.split("-").reverse().join("/")}</Td><Td>{r.account?.name}</Td><Td>{r.campaign?.name}</Td><Td num>{money(r.spend, r.currency)}</Td>
          <Td>{r.resolution === "active" ? <Badge tone="info">Na soma{r.manual_priority ? " (priorizado)" : ""}</Badge> : <Badge tone="warning">{r.resolution === "superseded_by_api" ? "Substituído pela API (fora da soma)" : "Substituído (fora da soma)"}</Badge>}</Td>
          <Td><button type="button" className="text-accent hover:underline text-sm" onClick={() => run(async () => supabase.rpc("mkt_spend_manual_delete", { p_id: r.id }), "Lançamento removido.")}>Remover</button></Td></tr>)}
      </Table>
    </section>
  );
};

/** Integrações: conexão oficial (somente leitura) com Meta Ads e Google Ads, seleção de contas autorizadas, atualização e lançamento manual enquanto não há acesso real. */
const MarketingIntegrations = () => {
  const [sp, setSp] = useSearchParams(); const opts = useMktOptions(); const admin = !!opts.data?.is_admin; const inv = useMktInvalidate();
  const cfg = useMktRpc<Cfg>("mkt_config_get", {}, admin);
  const st = useQuery({ queryKey: ["mkt", "fn-status"], enabled: admin, queryFn: async () => { const r = await callMarketingFn<FnStatus>("status", "GET"); if (!r.ok) throw new Error("não foi possível consultar a configuração do servidor"); return r.data; } });
  const rf = useMktRpc<RefreshState>("mkt_refresh_state", {}); const result = sp.get("conexao"); const plat = sp.get("plataforma");
  const runs = useQuery({ queryKey: ["mkt", "runs"], enabled: admin, queryFn: async () => ((await supabase.from("mkt_sync_runs").select("id, kind, status, started_at, finished_at, rows_written, pages, retries, error_code, error_message, window_from, window_to, api_version").order("started_at", { ascending: false }).limit(15)).data ?? []) as SyncRun[] });
  const reload = () => { inv(); runs.refetch(); st.refetch(); };
  return (
    <div data-testid="mkt-integrations">
      <PageHead eyebrow="Marketing" title="Integrações" hint="Conexão oficial e somente leitura com Meta Ads e Google Ads. O Hub nunca cria, pausa ou altera anúncios, e não envia dados de pacientes ou conversões às plataformas nesta fase." />
      {result && <div className="hp-card p-3 mb-4 text-sm flex items-start justify-between gap-3" role="status" data-testid="mkt-oauth-result"><span><b>{plat ? PLATFORM_LABEL[plat] : "Conexão"}:</b> {RESULT[result] ?? result}</span><button type="button" className="text-accent text-sm" onClick={() => setSp({}, { replace: true })}>Fechar</button></div>}
      {!admin && !opts.isLoading && <div className="hp-card p-4 text-sm" role="note">Somente administradores configuram as integrações. Você pode consultar os indicadores nas outras páginas do Marketing.</div>}
      <State loading={cfg.isLoading} error={cfg.error} />
      {admin && cfg.data && (<>
        {cfg.data.connections.map((c) => <PlatformCard key={c.id} c={c} accs={cfg.data!.accounts.filter((a) => a.connection_id === c.id)} units={cfg.data!.units} st={st.data} stError={st.isError} refresh={rf.data} admin={admin} reload={reload} />)}
        <section className="hp-card p-5 mb-5" aria-label="Formulários nativos das plataformas" data-testid="mkt-leadads">
          <h3 className="text-base font-bold">Formulários nativos (Lead Ads) <Badge>Não conectado</Badge></h3>
          <p className="text-[13px] text-muted-foreground mt-1">A API de relatórios de anúncios traz <b>métricas</b>, não os contatos dos formulários nativos da Meta ou do Google. Receber esses contatos exige um fluxo separado (webhook de leads, permissões específicas como <code>leads_retrieval</code> e páginas do Facebook, e aprovação da plataforma). <b>Não está implementado nesta fase</b>: leads chegam ao Hub pelos formulários e quizzes do site (com UTMs) e pelo CRM.</p>
        </section>
        <section className="hp-card p-5 mb-5" aria-label="Envio de conversões" data-testid="mkt-conversions"><h3 className="text-base font-bold">Envio de conversões às plataformas <Badge>Desativado</Badge></h3>
          <p className="text-[13px] text-muted-foreground mt-1">Esta fase só <b>importa relatórios e cruza dados internamente</b>. Nenhum evento, lista de pacientes ou conversão é enviado a Meta ou Google, e nenhum pixel é instalado em portais autenticados ou páginas clínicas. Uma etapa futura exigirá verificar as políticas vigentes, o consentimento e a elegibilidade dos dados (nunca diagnósticos, sintomas, evolução clínica, respostas de questionários ou nomes de protocolos que revelem condições de saúde).</p></section>
        {cfg.data && <ManualSpend cfg={cfg.data} reload={reload} />}
        <h3 className="text-base font-bold mb-2">Execuções de sincronização</h3>
        <Table head={["Quando", "Tipo", "Situação", "Janela", "Linhas", "Páginas / tentativas", "Erro"]} right={[4]}>
          {(runs.data ?? []).length === 0 && <tr><Td className="text-muted-foreground">Nenhuma execução ainda.</Td>{Array.from({ length: 6 }, (_, i) => <Td key={i}>{""}</Td>)}</tr>}
          {(runs.data ?? []).map((r) => <tr key={r.id}><Td>{when(r.started_at)}</Td><Td>{{ scheduled: "Horária", manual: "Atualizar agora", backfill: "Histórico inicial", reprocess: "Reprocesso", discovery: "Contas" }[r.kind as string] ?? r.kind}</Td><Td>{{ ok: "Concluída", partial: "Parcial", error: "Erro", running: "Em andamento", skipped: "Ignorada" }[r.status as string] ?? r.status}</Td>
            <Td className="text-[13px]">{r.window_from && r.window_to ? `${r.window_from.split("-").reverse().join("/")} a ${r.window_to.split("-").reverse().join("/")}` : "—"}</Td><Td num>{r.rows_written}</Td><Td className="text-[13px]">{r.pages} / {r.retries}</Td><Td className="text-[12.5px]">{r.error_message ?? "—"}</Td></tr>)}
        </Table>
        <p className="text-xs text-muted-foreground mt-2">Sincronização automática de hora em hora{st.data ? (st.data.cron_ready ? "" : " (segredo da agenda ainda não configurado)") : ""}, com reprocesso da janela recente para incorporar revisões das plataformas. Falha de sincronização nunca vira gasto zero.</p>
      </>)}
    </div>
  );
};
export default MarketingIntegrations;
