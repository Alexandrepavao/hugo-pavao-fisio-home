// Google Ads API — SOMENTE LEITURA. OAuth próprio (escopo `adwords`, que o Google não oferece em versão só-leitura: o limite de leitura é aplicado AQUI, no servidor, por lista de operações permitidas).
// A autorização do Google Calendar NÃO concede acesso ao Google Ads: este fluxo usa credenciais e consentimento próprios (GOOGLE_ADS_CLIENT_ID/SECRET).
// Developer token: o processo antigo foi encerrado em 09/09/2026 — o acesso agora é por projeto do Google Cloud (níveis Teste/Explorer/Basic/Standard) e o cabeçalho developer-token é opcional e ignorado.
// Só enviamos o cabeçalho se GOOGLE_ADS_DEVELOPER_TOKEN estiver configurado. Versão da API: MKT_GOOGLE_ADS_API_VERSION (padrão v26; conferida em 09/11/2026).
import { ApiError, assertGoogleAdsReadOnly, requestJson, type HttpDeps } from "./http.ts";

export interface GoogleCfg { clientId: string; clientSecret: string; version: string; developerToken?: string }
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const googleBase = (v: string) => `https://googleads.googleapis.com/${v}`;

export function googleAuthUrl(cfg: GoogleCfg, redirectUri: string, state: string, challenge: string) {
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", scope: `${GOOGLE_ADS_SCOPE} openid email`, access_type: "offline", prompt: "consent",
    include_granted_scopes: "false", state, code_challenge: challenge, code_challenge_method: "S256" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
export function classifyGoogle(status: number, body: any) {
  const err = body?.error; const st = String(err?.status ?? ""); const msg = String(err?.message ?? body?.error_description ?? "").slice(0, 260);
  const detail = JSON.stringify(err?.details ?? "").slice(0, 600);
  if (body?.error === "invalid_grant") return { retry: false, code: "auth_revoked", message: "O acesso ao Google Ads foi revogado ou expirou. Reconecte." };
  if (status === 401 || st === "UNAUTHENTICATED") return { retry: false, code: "auth_expired", message: msg || "Acesso ao Google Ads expirou. Reconecte." };
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION/.test(detail)) return { retry: false, code: "project_not_approved", message: "O projeto do Google Cloud ainda está só com acesso de teste. Solicite o acesso Explorer ou Basic na página da API Google Ads (Visão geral) e tente de novo." };
  if (/AUTHORIZATION_ERROR/.test(detail) || /AUTHORIZATION_ERROR/.test(msg)) return { retry: false, code: "authorization_error", message: msg || "Erro de autorização do Google Ads (confira o nível de acesso do projeto)." };
  if (status === 403 || st === "PERMISSION_DENIED") return { retry: false, code: "permission_denied", message: msg || "Sem permissão para esta conta do Google Ads." };
  if (status === 429 || st === "RESOURCE_EXHAUSTED") return { retry: true, code: "rate_limit", message: msg || "Limite de requisições do Google Ads atingido." };
  if (status >= 500) return { retry: true, code: "provider_error", message: msg || "Erro temporário do Google Ads." };
  return { retry: false, code: `http_${status}`, message: msg || `o Google Ads respondeu ${status}` };
}

export async function googleExchangeCode(deps: HttpDeps, cfg: GoogleCfg, redirectUri: string, code: string, verifier: string) {
  const r = await requestJson(deps, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }) }, { classify: classifyGoogle });
  return r.json as { access_token: string; refresh_token?: string; scope?: string; expires_in?: number; id_token?: string };
}
export async function googleRefresh(deps: HttpDeps, cfg: GoogleCfg, refreshToken: string) {
  const r = await requestJson(deps, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) }, { classify: classifyGoogle });
  if (!r.json.access_token) throw new ApiError("auth_expired", "O Google não devolveu o token de acesso."); return r.json.access_token as string;
}
export async function googleRevoke(deps: HttpDeps, token: string) {
  await deps.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
}
export const hasAdsScope = (scope: string | undefined) => String(scope ?? "").split(/\s+/).includes(GOOGLE_ADS_SCOPE);

const hdrs = (cfg: GoogleCfg, token: string, login?: string | null) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(cfg.developerToken ? { "developer-token": cfg.developerToken } : {}), ...(login ? { "login-customer-id": login.replace(/\D/g, "") } : {}) });
/** Consulta GAQL paginada (googleAds:search). Somente SELECT; o servidor recusa qualquer outra coisa. */
export async function gaql(deps: HttpDeps, cfg: GoogleCfg, token: string, customerId: string, login: string | null, query: string, onPage?: (n: number) => void, maxPages = 300) {
  if (!/^\s*select\s/i.test(query)) throw new ApiError("read_only_violation", "Somente consultas SELECT são permitidas.");
  const url = `${googleBase(cfg.version)}/customers/${customerId.replace(/\D/g, "")}/googleAds:search`; assertGoogleAdsReadOnly("POST", url);
  const rows: any[] = []; let pageToken: string | undefined; let n = 0; let retries = 0;
  for (;;) {
    const r = await requestJson(deps, url, { method: "POST", headers: hdrs(cfg, token, login), body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) }, { classify: classifyGoogle, onRetry: () => retries++ });
    n++; onPage?.(n); rows.push(...(r.json.results ?? [])); pageToken = r.json.nextPageToken || undefined;
    if (!pageToken) break; if (n >= maxPages) throw new ApiError("too_many_pages", "Paginação excedeu o limite de segurança.");
  }
  return { rows, pages: n, retries };
}
export async function listAccessible(deps: HttpDeps, cfg: GoogleCfg, token: string) {
  const url = `${googleBase(cfg.version)}/customers:listAccessibleCustomers`; assertGoogleAdsReadOnly("GET", url);
  const r = await requestJson(deps, url, { method: "GET", headers: hdrs(cfg, token) }, { classify: classifyGoogle });
  return (r.json.resourceNames ?? []).map((n: string) => n.replace("customers/", "")) as string[];
}
const STATUS: Record<string, string> = { ENABLED: "ENABLED", PAUSED: "PAUSED", REMOVED: "REMOVED", SUSPENDED: "SUSPENDED", CANCELED: "CANCELED", CLOSED: "CLOSED" };
/** Descobre contas: as acessíveis diretamente; se for administradora (MCC), lista as contas-cliente (nível 1) e guarda a administradora como login-customer-id. */
export async function googleDiscover(deps: HttpDeps, cfg: GoogleCfg, token: string, onPage?: (n: number) => void) {
  const out: { external_id: string; name: string | null; currency: string | null; timezone: string | null; status: string | null; login_customer_id: string | null }[] = [];
  for (const id of await listAccessible(deps, cfg, token)) {
    let me: any;
    try { me = (await gaql(deps, cfg, token, id, null, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer", onPage)).rows[0]?.customer; }
    catch (e) { if (e instanceof ApiError && ["permission_denied"].includes(e.code)) continue; throw e; }          // conta sem acesso direto: ignorada
    if (!me) continue;
    if (me.manager) {
      const cl = await gaql(deps, cfg, token, id, id, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level <= 1", onPage);
      for (const r of cl.rows) { const c = r.customerClient; if (!c || c.manager) continue; out.push({ external_id: String(c.id), name: c.descriptiveName ?? null, currency: c.currencyCode ?? null, timezone: c.timeZone ?? null, status: STATUS[c.status] ?? c.status ?? null, login_customer_id: String(id) }); }
    } else out.push({ external_id: String(me.id), name: me.descriptiveName ?? null, currency: me.currencyCode ?? null, timezone: me.timeZone ?? null, status: STATUS[me.status] ?? me.status ?? null, login_customer_id: null });
  }
  const seen = new Set<string>(); return out.filter((a) => (seen.has(a.external_id) ? false : (seen.add(a.external_id), true)));
}
export async function googleEntities(deps: HttpDeps, cfg: GoogleCfg, token: string, customer: string, login: string | null, onPage?: (n: number) => void) {
  const c = await gaql(deps, cfg, token, customer, login, "SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status, campaign.start_date FROM campaign WHERE campaign.status != 'REMOVED'", onPage);
  const g = await gaql(deps, cfg, token, customer, login, "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'", onPage);
  const a = await gaql(deps, cfg, token, customer, login, "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'", onPage);
  return {
    campaigns: c.rows.map((r) => ({ external_id: String(r.campaign.id), name: String(r.campaign.name ?? r.campaign.id), objective: r.campaign.advertisingChannelType ?? null, status: r.campaign.status ?? null, created_at: r.campaign.startDate ? `${r.campaign.startDate}T00:00:00Z` : null, updated_at: null })),
    adsets: g.rows.map((r) => ({ external_id: String(r.adGroup.id), campaign_external_id: String(r.campaign.id), name: String(r.adGroup.name ?? r.adGroup.id), status: r.adGroup.status ?? null })),
    ads: a.rows.map((r) => ({ external_id: String(r.adGroupAd.ad.id), campaign_external_id: String(r.campaign.id), adset_external_id: String(r.adGroup.id), name: String(r.adGroupAd.ad.name ?? `Anúncio ${r.adGroupAd.ad.id}`), status: r.adGroupAd.status ?? null, creative_ref: String(r.adGroupAd.ad.id), creative_name: r.adGroupAd.ad.name ?? null })),
    pages: c.pages + g.pages + a.pages, retries: c.retries + g.retries + a.retries,
  };
}
export const GOOGLE_METRIC_DEFS = { source: "Google Ads API · GAQL", fields: "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions", link_clicks: "metrics.clicks (cliques no anúncio)", clicks_all: "metrics.clicks",
  reported_results: "metrics.conversions (conversões reportadas pelo Google; podem ser fracionárias)", day: "segments.date na timezone da conta" };
const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** Métricas diárias. level: campaign (canônico) | ad_group | ad | device (detalhamento). cost_micros → unidade da moeda da conta. */
export async function googleMetrics(deps: HttpDeps, cfg: GoogleCfg, token: string, customer: string, login: string | null, level: "campaign" | "adset" | "ad" | "breakdown", since: string, until: string, onPage?: (n: number) => void) {
  const between = `segments.date BETWEEN '${since}' AND '${until}'`;
  const q = {
    campaign: `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${between}`,
    adset: `SELECT ad_group.id, campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group WHERE ${between}`,
    ad: `SELECT ad_group_ad.ad.id, ad_group.id, campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${between}`,
    breakdown: `SELECT campaign.id, segments.device, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE ${between}`,
  }[level];
  const r = await gaql(deps, cfg, token, customer, login, q, onPage);
  const rows = r.rows.map((x) => {
    const m = x.metrics ?? {}; const base = { day: String(x.segments.date), spend: (toNum(m.costMicros) ?? 0) / 1e6, impressions: toNum(m.impressions), link_clicks: toNum(m.clicks) };
    if (level === "campaign") return { campaign_external_id: String(x.campaign.id), ...base, clicks_all: toNum(m.clicks), reported_results: toNum(m.conversions), reported_actions: null };
    if (level === "breakdown") return { campaign_external_id: String(x.campaign.id), ...base, device: String(x.segments.device ?? "UNKNOWN") };
    return { entity_external_id: String(level === "adset" ? x.adGroup.id : x.adGroupAd.ad.id), ...base, reported_results: toNum(m.conversions) };
  });
  return { rows, pages: r.pages, retries: r.retries };
}
