// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - resolvido pelo Supabase Edge Runtime no deploy
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decrypt, encrypt, pkcePair, sameSecret, signState, verifyState } from "./crypto.ts";
import { ApiError, defaultDeps } from "./http.ts";
import { META_SCOPES, metaAccountInfo, metaAuthUrl, metaEntities, metaExchangeCode, metaGrantedScopes, metaInsights, metaListAccounts, metaLongLived, metaMe, metaRevoke, META_METRIC_DEFS, type MetaCfg } from "./meta.ts";
import { GOOGLE_METRIC_DEFS, googleAuthUrl, googleDiscover, googleEntities, googleExchangeCode, googleMetrics, googleRefresh, googleRevoke, hasAdsScope, type GoogleCfg } from "./google.ts";
import { syncAccount, type Adapter, type Db } from "./sync.ts";

/**
 * Marketing (Meta Ads e Google Ads) — conexão OAuth, descoberta de contas e sincronização SOMENTE LEITURA. Publicar SEM verify_jwt (o retorno do provedor não traz JWT;
 * as ações do usuário são autenticadas aqui pelo JWT do Supabase e autorizadas pelo banco — mkt_whoami):  deploy com verify_jwt = false.
 *
 * Rotas (após o nome da função):
 *   GET  /status                     → o que está configurado no servidor + as URLs de retorno EXATAS (sem segredos)        [JWT, administrador]
 *   POST /start        {platform}    → inicia o OAuth (state de uso único, vinculado a organização+usuário+plataforma; PKCE no Google)  [JWT, administrador]
 *   GET  /callback/meta | /callback/google                                         → retorno do provedor (state verificado e consumido)
 *   POST /discover     {platform}    → relista as contas autorizadas                                                       [JWT, administrador]
 *   POST /sync         {account_id?} → "Atualizar agora" (com controle de frequência)                                      [JWT, administrador]
 *   POST /sync  (x-cron-secret)      → sincronização horária de todas as organizações                                      [servidor-a-servidor]
 *   POST /disconnect   {platform}    → revoga no provedor (quando suportado), apaga as credenciais e para de sincronizar    [JWT, administrador]
 *
 * Secrets (Supabase → Edge Functions → Secrets; nunca no navegador/repositório):
 *   MKT_TOKEN_ENC_KEY (32 bytes base64) · MKT_SYNC_SECRET · MKT_RETURN_URL (origem do app) · MKT_ALLOWED_ORIGINS (opcional, lista)
 *   META_APP_ID, META_APP_SECRET, MKT_META_API_VERSION (padrão v26.0)
 *   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, MKT_GOOGLE_ADS_API_VERSION (padrão v26), GOOGLE_ADS_DEVELOPER_TOKEN (opcional; ignorado pelo Google desde 09/09/2026)
 */
// @ts-ignore
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const returnUrl = () => env("MKT_RETURN_URL").replace(/\/+$/, "");
const allowedOrigins = () => [returnUrl(), ...env("MKT_ALLOWED_ORIGINS").split(",").map((s) => s.trim().replace(/\/+$/, ""))].filter(Boolean);
const corsFor = (req: Request) => { const o = req.headers.get("origin") ?? ""; const ok = allowedOrigins().includes(o); return { "Access-Control-Allow-Origin": ok ? o : "null", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; };
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const redirectUri = (p: "meta" | "google") => `${env("SUPABASE_URL")}/functions/v1/marketing-ads/callback/${p}`;
const metaCfg = (): MetaCfg | null => (env("META_APP_ID") && env("META_APP_SECRET") ? { appId: env("META_APP_ID"), appSecret: env("META_APP_SECRET"), version: env("MKT_META_API_VERSION") || "v26.0" } : null);
const googleCfg = (): GoogleCfg | null => (env("GOOGLE_ADS_CLIENT_ID") && env("GOOGLE_ADS_CLIENT_SECRET") ? { clientId: env("GOOGLE_ADS_CLIENT_ID"), clientSecret: env("GOOGLE_ADS_CLIENT_SECRET"), version: env("MKT_GOOGLE_ADS_API_VERSION") || "v26", developerToken: env("GOOGLE_ADS_DEVELOPER_TOKEN") || undefined } : null);
const baseReady = () => !!(env("MKT_TOKEN_ENC_KEY") && returnUrl());
const deps = defaultDeps();

// @ts-ignore
const service = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
async function whoami(req: Request): Promise<{ user_id: string; org_id: string; is_admin: boolean } | null> {
  const auth = req.headers.get("Authorization"); if (!auth) return null;
  // @ts-ignore
  const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await c.rpc("mkt_whoami"); if (error || !data?.user_id || !data?.org_id) return null; return data;
}
const back = (result: string, platform: string) => Response.redirect(`${returnUrl()}/admin/marketing/integracoes?conexao=${encodeURIComponent(result)}&plataforma=${platform}`, 302);

// ---------------------------------------------------------------- acesso às credenciais (só aqui, só no servidor)
async function accessFor(sb: any, conn: any): Promise<{ token: string; cfg: MetaCfg | GoogleCfg }> {
  const key = env("MKT_TOKEN_ENC_KEY");
  const { data } = await sb.from("mkt_credentials").select("token_enc, refresh_token_enc").eq("connection_id", conn.id).maybeSingle();
  if (conn.platform === "meta") {
    const cfg = metaCfg(); if (!cfg || !data?.token_enc) throw new ApiError("not_configured", "Credenciais da Meta ausentes no servidor.");
    if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() <= Date.now()) { await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "reauth_required", p_error: "O acesso à Meta expirou. Reconecte.", p_scopes: null, p_expires: conn.token_expires_at, p_label: null, p_version: null, p_connected_by: null }); throw new ApiError("auth_expired", "O acesso à Meta expirou. Reconecte."); }
    return { token: await decrypt(key, data.token_enc), cfg };
  }
  const cfg = googleCfg(); if (!cfg || !data?.refresh_token_enc) throw new ApiError("not_configured", "Credenciais do Google Ads ausentes no servidor.");
  return { token: await googleRefresh(deps, cfg, await decrypt(key, data.refresh_token_enc)), cfg };
}
async function markAuthError(sb: any, conn: any, e: ApiError) {
  if (["auth_expired", "auth_revoked"].includes(e.code)) await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "reauth_required", p_error: e.message, p_scopes: null, p_expires: conn.token_expires_at, p_label: null, p_version: null, p_connected_by: null });
}

function adapterFor(conn: any, acc: any, token: string, cfg: any): Adapter {
  if (conn.platform === "meta") {
    const c = cfg as MetaCfg; const act = acc.external_id as string;
    return { platform: "meta", version: c.version, defs: META_METRIC_DEFS,
      accountInfo: async () => { const i = await metaAccountInfo(deps, c, token, act); return { currency: i.currency ?? null, timezone: i.timezone_name ?? null }; },
      entities: (onPage) => metaEntities(deps, c, token, act, onPage),
      metrics: (level, since, until, onPage) => metaInsights(deps, c, token, act, level, since, until, onPage) };
  }
  const c = cfg as GoogleCfg; const id = acc.external_id as string; const login = acc.login_customer_id as string | null;
  return { platform: "google", version: c.version, defs: GOOGLE_METRIC_DEFS,
    accountInfo: async () => ({ currency: acc.currency ?? null, timezone: acc.timezone ?? null }),            // moeda/fuso vieram da descoberta (GAQL customer); a divergência é verificada nas linhas
    entities: (onPage) => googleEntities(deps, c, token, id, login, onPage),
    metrics: (level, since, until, onPage) => googleMetrics(deps, c, token, id, login, level, since, until, onPage) };
}
const dbFor = (sb: any, orgId: string, connId: string, accId: string, userId: string | null, version: string): Db => ({
  runStart: async (a) => { const { data, error } = await sb.rpc("mkt_run_start", { p_org: orgId, p_connection: connId, p_account: accId, p_kind: a.kind, p_from: a.from, p_to: a.to, p_user: userId, p_version: version }); if (error) throw new ApiError("db", error.message); return data ?? null; },
  heartbeat: async (run, pages, retries) => { await sb.rpc("mkt_run_heartbeat", { p_run: run, p_pages: pages, p_retries: retries }); },
  finish: async (run, status, rows, code, message, ok, failed) => { const { error } = await sb.rpc("mkt_run_finish", { p_run: run, p_status: status, p_rows: rows, p_error_code: code, p_error_message: message, p_days_ok: ok, p_days_failed: failed }); if (error) throw new ApiError("db", error.message); },
  ingestEntities: async (run, e) => { const { error } = await sb.rpc("mkt_ingest_entities", { p_run: run, p_campaigns: e.campaigns, p_adsets: e.adsets, p_ads: e.ads }); if (error) throw new ApiError("db", error.message); },
  ingestMetrics: async (run, level, rows, currency, tz, defs) => { let n = 0; for (let i = 0; i < rows.length; i += 800) { const { data, error } = await sb.rpc("mkt_ingest_metrics", { p_run: run, p_level: level, p_rows: rows.slice(i, i + 800), p_currency: currency, p_tz: tz, p_defs: defs }); if (error) throw new ApiError("db", error.message); n += Number(data ?? 0); } return n; },
});

async function syncOrg(sb: any, orgId: string, kind: "scheduled" | "manual", userId: string | null, deadline: number, onlyAccount?: string) {
  const out: Record<string, unknown>[] = [];
  const { data: settings } = await sb.from("mkt_settings").select("backfill_days, reprocess_days").eq("org_id", orgId).maybeSingle();
  const st = { backfill_days: settings?.backfill_days ?? 90, reprocess_days: settings?.reprocess_days ?? 7 };
  const { data: conns } = await sb.from("mkt_connections").select("*").eq("org_id", orgId).eq("enabled", true).in("status", ["active", "error"]);
  for (const conn of conns ?? []) {
    let q = sb.from("mkt_ad_accounts").select("*").eq("connection_id", conn.id).eq("selected", true).eq("origin", "api"); if (onlyAccount) q = q.eq("id", onlyAccount);
    const { data: accs } = await q; if (!accs?.length) continue;
    let access: { token: string; cfg: MetaCfg | GoogleCfg };
    try { access = await accessFor(sb, conn); } catch (e) { const ae = e instanceof ApiError ? e : new ApiError("internal", (e as Error).message); await markAuthError(sb, conn, ae); out.push({ platform: conn.platform, status: "error", code: ae.code, message: ae.message }); continue; }
    for (const acc of accs) {
      if (Date.now() > deadline) { out.push({ account: acc.name, status: "skipped", code: "time_budget", message: "Tempo da execução esgotado; segue na próxima." }); continue; }
      const { data: cov } = await sb.from("mkt_day_status").select("day, status").eq("account_id", acc.id).gte("day", new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10));
      const coverage = { okDays: (cov ?? []).filter((x: any) => x.status === "ok").map((x: any) => x.day), failedDays: (cov ?? []).filter((x: any) => x.status === "failed").map((x: any) => x.day) };
      const adapter = adapterFor(conn, acc, access.token, access.cfg);
      const r = await syncAccount(dbFor(sb, orgId, conn.id, acc.id, userId, adapter.version), adapter, { kind, account: { currency: acc.currency, timezone: acc.timezone }, settings: st, coverage });
      if (r.code && ["auth_expired", "auth_revoked"].includes(r.code)) await markAuthError(sb, conn, new ApiError(r.code, r.message ?? ""));
      out.push({ platform: conn.platform, account: acc.name, ...r });
    }
  }
  return out;
}

// @ts-ignore - Deno é global no Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(req) });
  const parts = new URL(req.url).pathname.split("/").filter(Boolean); const i = parts.indexOf("marketing-ads"); const route = parts.slice(i + 1).join("/");
  try {
    const sb = service();
    // ---- callbacks dos provedores (autenticados pelo state assinado de uso único)
    if (req.method === "GET" && (route === "callback/meta" || route === "callback/google")) {
      const platform = route.endsWith("meta") ? "meta" : "google" as "meta" | "google"; if (!baseReady()) return back("indisponivel", platform);
      const q = new URL(req.url).searchParams; const st = await verifyState(env("MKT_TOKEN_ENC_KEY"), q.get("state") ?? "");
      if (!st || st.p !== platform) return back("estado", platform);
      // uso único e vínculo: apaga o nonce SÓ se existir, for deste usuário/organização/plataforma e não tiver vencido — repetir o state cai aqui
      const used = await sb.from("mkt_oauth_states").delete().eq("nonce", st.n).eq("user_id", st.u).eq("org_id", st.o).eq("platform", platform).gt("expires_at", new Date().toISOString()).select("code_verifier_enc");
      if (used.error || !used.data || used.data.length !== 1) return back("estado", platform);
      if (q.get("error") || !q.get("code")) return back("negado", platform);
      const { data: conn } = await sb.from("mkt_connections").select("*").eq("org_id", st.o).eq("platform", platform).maybeSingle();
      if (!conn || !conn.enabled) return back("plataforma_desabilitada", platform);
      try {
        const key = env("MKT_TOKEN_ENC_KEY");
        if (platform === "meta") {
          const cfg = metaCfg(); if (!cfg) return back("indisponivel", platform);
          const short = await metaExchangeCode(deps, cfg, redirectUri("meta"), q.get("code")!); const long = await metaLongLived(deps, cfg, short.access_token);
          const scopes = await metaGrantedScopes(deps, cfg, long.access_token);
          if (!scopes.includes("ads_read")) { await metaRevoke(deps, cfg, long.access_token).catch(() => undefined); return back("permissao", platform); }
          const me = await metaMe(deps, cfg, long.access_token);
          await sb.from("mkt_credentials").upsert({ connection_id: conn.id, org_id: st.o, token_enc: await encrypt(key, long.access_token), refresh_token_enc: null, updated_at: new Date().toISOString() }, { onConflict: "connection_id" });
          const exp = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;
          await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "active", p_error: null, p_scopes: scopes.filter((s: string) => META_SCOPES.includes(s)), p_expires: exp, p_label: me.name ?? me.id, p_version: cfg.version, p_connected_by: st.u });
          try { await sb.rpc("mkt_accounts_upsert", { p_connection: conn.id, p_accounts: await metaListAccounts(deps, cfg, long.access_token) }); } catch (e) { await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "error", p_error: (e as Error).message, p_scopes: null, p_expires: exp, p_label: null, p_version: null, p_connected_by: null }); return back("erro_contas", platform); }
        } else {
          const cfg = googleCfg(); if (!cfg) return back("indisponivel", platform);
          const verifier = used.data[0].code_verifier_enc ? await decrypt(key, used.data[0].code_verifier_enc) : "";
          const tok = await googleExchangeCode(deps, cfg, redirectUri("google"), q.get("code")!, verifier);
          if (!tok.refresh_token || !hasAdsScope(tok.scope)) return back("permissao", platform);
          const ui = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json().catch(() => ({}));
          await sb.from("mkt_credentials").upsert({ connection_id: conn.id, org_id: st.o, token_enc: null, refresh_token_enc: await encrypt(key, tok.refresh_token), updated_at: new Date().toISOString() }, { onConflict: "connection_id" });
          await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "active", p_error: null, p_scopes: [tok.scope && "adwords"].filter(Boolean), p_expires: null, p_label: ui.email ?? null, p_version: cfg.version, p_connected_by: st.u });
          try { await sb.rpc("mkt_accounts_upsert", { p_connection: conn.id, p_accounts: await googleDiscover(deps, cfg, tok.access_token) }); }
          catch (e) { await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "error", p_error: (e as Error).message, p_scopes: null, p_expires: null, p_label: null, p_version: null, p_connected_by: null }); return back("erro_contas", platform); }
        }
        return back("conectado", platform);
      } catch { return back("erro", platform); }
    }

    // ---- sincronização automática (servidor-a-servidor)
    if (req.method === "POST" && route === "sync" && req.headers.get("x-cron-secret")) {
      if (!sameSecret(req.headers.get("x-cron-secret")!, env("MKT_SYNC_SECRET"))) return json(req, 401, { error: "unauthorized" });
      const deadline = Date.now() + 110_000; const { data: orgs } = await sb.from("mkt_connections").select("org_id").eq("enabled", true).in("status", ["active", "error"]);
      const res: Record<string, unknown> = {}; for (const org of [...new Set((orgs ?? []).map((o: any) => o.org_id))] as string[]) res[org] = await syncOrg(sb, org, "scheduled", null, deadline);
      return json(req, 200, { ok: true, orgs: res });
    }

    // ---- ações do administrador (JWT)
    const who = await whoami(req); if (!who) return json(req, 401, { error: "unauthenticated" });
    if (!who.is_admin) return json(req, 403, { error: "forbidden", message: "Apenas administradores configuram as integrações de Marketing." });
    let body: any = {}; if (req.method === "POST") { try { body = await req.json(); } catch { body = {}; } }
    const platform = body.platform === "google" ? "google" : body.platform === "meta" ? "meta" : null;

    if (req.method === "GET" && route === "status") {
      return json(req, 200, { base_ready: baseReady(), return_url: returnUrl() || null,
        meta: { configured: !!metaCfg(), redirect_uri: redirectUri("meta"), api_version: (metaCfg()?.version ?? (env("MKT_META_API_VERSION") || "v26.0")), scopes: META_SCOPES },
        google: { configured: !!googleCfg(), redirect_uri: redirectUri("google"), api_version: (googleCfg()?.version ?? (env("MKT_GOOGLE_ADS_API_VERSION") || "v26")), developer_token_sent: !!env("GOOGLE_ADS_DEVELOPER_TOKEN") },
        cron_ready: !!env("MKT_SYNC_SECRET") });
    }
    if (req.method === "POST" && route === "start") {
      if (!platform) return json(req, 400, { error: "invalid_platform" });
      if (!baseReady() || (platform === "meta" ? !metaCfg() : !googleCfg())) return json(req, 503, { error: `${platform}_not_configured`, message: "Conexão indisponível: as credenciais do aplicativo OAuth ainda não foram cadastradas no servidor (veja docs/marketing-conexao-meta-google.md)." });
      const { data: conn } = await sb.from("mkt_connections").select("id, enabled").eq("org_id", who.org_id).eq("platform", platform).maybeSingle();
      if (!conn?.enabled) return json(req, 409, { error: "platform_disabled", message: "Habilite a plataforma antes de conectar." });
      const key = env("MKT_TOKEN_ENC_KEY"); const nonce = crypto.randomUUID(); const exp = Date.now() + 10 * 60_000;
      await sb.from("mkt_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const pk = platform === "google" ? await pkcePair() : null;
      const ins = await sb.from("mkt_oauth_states").insert({ nonce, org_id: who.org_id, user_id: who.user_id, platform, code_verifier_enc: pk ? await encrypt(key, pk.verifier) : null, expires_at: new Date(exp).toISOString() });
      if (ins.error) return json(req, 500, { error: "state_unavailable" });
      const state = await signState(key, { u: who.user_id, o: who.org_id, p: platform, n: nonce, exp });
      await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "pending", p_error: null, p_scopes: null, p_expires: null, p_label: null, p_version: null, p_connected_by: null });
      return json(req, 200, { url: platform === "meta" ? metaAuthUrl(metaCfg()!, redirectUri("meta"), state) : googleAuthUrl(googleCfg()!, redirectUri("google"), state, pk!.challenge) });
    }
    if (req.method === "POST" && route === "discover") {
      if (!platform) return json(req, 400, { error: "invalid_platform" });
      const { data: conn } = await sb.from("mkt_connections").select("*").eq("org_id", who.org_id).eq("platform", platform).maybeSingle(); if (!conn || conn.status === "disconnected") return json(req, 409, { error: "not_connected" });
      try { const a = await accessFor(sb, conn); const accounts = platform === "meta" ? await metaListAccounts(deps, a.cfg as MetaCfg, a.token) : await googleDiscover(deps, a.cfg as GoogleCfg, a.token);
        await sb.rpc("mkt_accounts_upsert", { p_connection: conn.id, p_accounts: accounts }); return json(req, 200, { ok: true, accounts: accounts.length }); }
      catch (e) { const ae = e instanceof ApiError ? e : new ApiError("internal", (e as Error).message); await markAuthError(sb, conn, ae); return json(req, 502, { error: ae.code, message: ae.message }); }
    }
    if (req.method === "POST" && route === "sync") {
      // "Atualizar agora": no mínimo manual_refresh_min_minutes entre execuções manuais da organização
      const { data: s } = await sb.from("mkt_settings").select("manual_refresh_min_minutes").eq("org_id", who.org_id).maybeSingle(); const minM = s?.manual_refresh_min_minutes ?? 15;
      const { data: last } = await sb.from("mkt_sync_runs").select("started_at").eq("org_id", who.org_id).eq("kind", "manual").order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (last && new Date(last.started_at).getTime() > Date.now() - minM * 60_000) return json(req, 429, { error: "too_soon", message: `Atualização manual disponível novamente às ${new Date(new Date(last.started_at).getTime() + minM * 60_000).toISOString()}.`, next_allowed_at: new Date(new Date(last.started_at).getTime() + minM * 60_000).toISOString() });
      const results = await syncOrg(sb, who.org_id, "manual", who.user_id, Date.now() + 110_000, typeof body.account_id === "string" ? body.account_id : undefined);
      return json(req, 200, { ok: true, results });
    }
    if (req.method === "POST" && route === "disconnect") {
      if (!platform) return json(req, 400, { error: "invalid_platform" });
      const { data: conn } = await sb.from("mkt_connections").select("*").eq("org_id", who.org_id).eq("platform", platform).maybeSingle(); if (!conn) return json(req, 404, { error: "not_found" });
      let revoked = false;
      try { const key = env("MKT_TOKEN_ENC_KEY"); const { data } = await sb.from("mkt_credentials").select("token_enc, refresh_token_enc").eq("connection_id", conn.id).maybeSingle();
        if (platform === "meta" && data?.token_enc && metaCfg()) { await metaRevoke(deps, metaCfg()!, await decrypt(key, data.token_enc)); revoked = true; }
        if (platform === "google" && data?.refresh_token_enc) { await googleRevoke(deps, await decrypt(key, data.refresh_token_enc)); revoked = true; } } catch { /* já revogado ou sem acesso: segue limpando localmente */ }
      await sb.rpc("mkt_connection_set_state", { p_connection: conn.id, p_status: "disconnected", p_error: null, p_scopes: [], p_expires: null, p_label: null, p_version: null, p_connected_by: null });
      return json(req, 200, { ok: true, revoked_at_provider: revoked });
    }
    return json(req, 404, { error: "not_found" });
  } catch (e) { return json(req, 500, { error: "internal", message: String((e as Error).message).slice(0, 200) }); }
});
