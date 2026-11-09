// Meta Marketing API — SOMENTE LEITURA. Permissão pedida: apenas `ads_read` (ler insights e listar contas de anúncios que o usuário autorizou).
// Versão da API: configurável (MKT_META_API_VERSION); padrão v26.0. Conferida na documentação oficial em 09/11/2026 (v27.0 é a mais nova; v26.0 e v25.0 seguem ativas) — ver docs/marketing-campanhas.md.
// Contas PRÓPRIAS (da empresa que é dona do app) funcionam com acesso Standard às permissões; contas de CLIENTES exigem acesso Advanced (App Review) — o código é o mesmo.
import { ApiError, assertMetaReadOnly, requestJson, type HttpDeps } from "./http.ts";
import { appSecretProof } from "./crypto.ts";

export interface MetaCfg { appId: string; appSecret: string; version: string }
export const META_SCOPES = ["ads_read"];
export const metaBase = (v: string) => `https://graph.facebook.com/${v}`;

export function metaAuthUrl(cfg: MetaCfg, redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_id: cfg.appId, redirect_uri: redirectUri, state, response_type: "code", scope: META_SCOPES.join(","), auth_type: "rerequest" });
  return `https://www.facebook.com/${cfg.version}/dialog/oauth?${q}`;
}
/** Códigos de erro da Graph API que pedem nova autorização / limite de uso / erro transitório. */
export function classifyMeta(status: number, body: any) {
  const e = body?.error; const code = Number(e?.code); const sub = Number(e?.error_subcode); const msg = String(e?.message ?? "").slice(0, 240);
  if (code === 190 || sub === 463 || sub === 467 || status === 401) return { retry: false, code: "auth_expired", message: msg || "O acesso à Meta expirou ou foi revogado. Reconecte." };
  if ([4, 17, 32, 613, 80000, 80003, 80004].includes(code) || status === 429) return { retry: true, code: "rate_limit", message: msg || "Limite de requisições da Meta atingido." };
  if (code === 10 || code === 200 || status === 403) return { retry: false, code: "permission_denied", message: msg || "Sem permissão para esta conta de anúncios." };
  if (code === 1 || code === 2 || status >= 500) return { retry: true, code: "provider_error", message: msg || "Erro temporário da Meta." };
  return { retry: false, code: `http_${status}`, message: msg || `a Meta respondeu ${status}` };
}

async function graph(deps: HttpDeps, cfg: MetaCfg, token: string, pathOrUrl: string, params: Record<string, string> = {}, onRetry?: (n: number) => void) {
  let url: URL;
  if (pathOrUrl.startsWith("https://")) { url = new URL(pathOrUrl); url.searchParams.delete("access_token"); }        // `paging.next` traz o token na URL: removido; usamos o cabeçalho
  else url = new URL(`${metaBase(cfg.version)}/${pathOrUrl.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("appsecret_proof", await appSecretProof(token, cfg.appSecret));
  assertMetaReadOnly("GET", url.toString());
  return requestJson(deps, url.toString(), { method: "GET", headers: { Authorization: `Bearer ${token}` } }, { classify: classifyMeta, onRetry });
}
async function pages(deps: HttpDeps, cfg: MetaCfg, token: string, path: string, params: Record<string, string>, onPage?: (n: number) => void, maxPages = 200) {
  const out: any[] = []; let next: string | null = null; let n = 0; let retries = 0;
  for (;;) {
    const r = await graph(deps, cfg, token, next ?? path, next ? {} : params, () => retries++); n++; onPage?.(n);
    out.push(...(r.json.data ?? []));
    next = r.json.paging?.next ?? null;
    if (!next) break; if (n >= maxPages) throw new ApiError("too_many_pages", "Paginação excedeu o limite de segurança.");
  }
  return { rows: out, pages: n, retries };
}

export async function metaExchangeCode(deps: HttpDeps, cfg: MetaCfg, redirectUri: string, code: string) {
  const u = new URL(`${metaBase(cfg.version)}/oauth/access_token`); u.searchParams.set("client_id", cfg.appId); u.searchParams.set("client_secret", cfg.appSecret); u.searchParams.set("redirect_uri", redirectUri); u.searchParams.set("code", code);
  const r = await requestJson(deps, u.toString(), { method: "GET" }, { classify: classifyMeta });
  if (!r.json.access_token) throw new ApiError("no_token", "A Meta não devolveu o token de acesso."); return r.json as { access_token: string; expires_in?: number };
}
/** Troca o token curto por um de longa duração (~60 dias). Só no servidor (usa o segredo do app). */
export async function metaLongLived(deps: HttpDeps, cfg: MetaCfg, shortToken: string) {
  const u = new URL(`${metaBase(cfg.version)}/oauth/access_token`); u.searchParams.set("grant_type", "fb_exchange_token"); u.searchParams.set("client_id", cfg.appId); u.searchParams.set("client_secret", cfg.appSecret); u.searchParams.set("fb_exchange_token", shortToken);
  const r = await requestJson(deps, u.toString(), { method: "GET" }, { classify: classifyMeta });
  if (!r.json.access_token) throw new ApiError("no_token", "A Meta não devolveu o token de longa duração."); return r.json as { access_token: string; expires_in?: number };
}
export async function metaMe(deps: HttpDeps, cfg: MetaCfg, token: string) { const r = await graph(deps, cfg, token, "me", { fields: "id,name" }); return r.json as { id: string; name?: string }; }
/** Permissões efetivamente concedidas (o usuário pode desmarcar `ads_read` na caixa de diálogo). */
export async function metaGrantedScopes(deps: HttpDeps, cfg: MetaCfg, token: string) {
  const r = await graph(deps, cfg, token, "me/permissions"); return (r.json.data ?? []).filter((p: any) => p.status === "granted").map((p: any) => String(p.permission));
}
export async function metaListAccounts(deps: HttpDeps, cfg: MetaCfg, token: string, onPage?: (n: number) => void) {
  const r = await pages(deps, cfg, token, "me/adaccounts", { fields: "account_id,id,name,currency,timezone_name,account_status", limit: "100" }, onPage);
  const status: Record<number, string> = { 1: "ACTIVE", 2: "DISABLED", 3: "UNSETTLED", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "CLOSED", 201: "ANY_ACTIVE", 202: "ANY_CLOSED" };
  return r.rows.map((a) => ({ external_id: `act_${String(a.account_id ?? a.id).replace(/^act_/, "")}`, name: a.name ?? null, currency: a.currency ?? null, timezone: a.timezone_name ?? null, status: status[Number(a.account_status)] ?? String(a.account_status ?? "") }));
}
/** Revoga o app para o usuário (remove as permissões). Único DELETE permitido, e só neste fluxo de desconexão. */
export async function metaRevoke(deps: HttpDeps, cfg: MetaCfg, token: string) {
  const u = new URL(`${metaBase(cfg.version)}/me/permissions`); u.searchParams.set("appsecret_proof", await appSecretProof(token, cfg.appSecret));
  if (u.hostname !== "graph.facebook.com") throw new ApiError("host_not_allowed", "endereço inválido");
  await requestJson(deps, u.toString(), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, { classify: classifyMeta });
}

export async function metaEntities(deps: HttpDeps, cfg: MetaCfg, token: string, act: string, onPage?: (n: number) => void) {
  const camp = await pages(deps, cfg, token, `${act}/campaigns`, { fields: "id,name,objective,effective_status,created_time,updated_time", limit: "500" }, onPage);
  const sets = await pages(deps, cfg, token, `${act}/adsets`, { fields: "id,name,campaign_id,effective_status", limit: "500" }, onPage);
  const ads = await pages(deps, cfg, token, `${act}/ads`, { fields: "id,name,campaign_id,adset_id,effective_status,creative{id,name}", limit: "500" }, onPage);
  return {
    campaigns: camp.rows.map((c) => ({ external_id: String(c.id), name: String(c.name ?? c.id), objective: c.objective ?? null, status: c.effective_status ?? null, created_at: c.created_time ?? null, updated_at: c.updated_time ?? null })),
    adsets: sets.rows.map((s) => ({ external_id: String(s.id), campaign_external_id: String(s.campaign_id), name: String(s.name ?? s.id), status: s.effective_status ?? null })),
    ads: ads.rows.map((a) => ({ external_id: String(a.id), campaign_external_id: String(a.campaign_id), adset_external_id: a.adset_id ? String(a.adset_id) : null, name: String(a.name ?? a.id), status: a.effective_status ?? null, creative_ref: a.creative?.id ?? null, creative_name: a.creative?.name ?? null })),
    pages: camp.pages + sets.pages + ads.pages, retries: camp.retries + sets.retries + ads.retries,
  };
}

/** Ações que contam como "resultado" de captação de leads no relatório da Meta (aproximação declarada — não equivale ao “Resultados” do Gerenciador de Anúncios). */
export const META_RESULT_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
export function parseMetaInsightRow(r: any, level: "campaign" | "adset" | "ad" | "breakdown") {
  const actions: Record<string, number> = {}; for (const a of r.actions ?? []) { const v = num(a.value); if (v != null) actions[String(a.action_type)] = v; }
  const results = META_RESULT_ACTIONS.reduce((s, k) => s + (actions[k] ?? 0), 0);
  const base = { day: String(r.date_start), spend: num(r.spend) ?? 0, impressions: num(r.impressions), link_clicks: num(r.inline_link_clicks), clicks_all: num(r.clicks), reported_results: Object.keys(actions).length ? results : null, reported_actions: Object.keys(actions).length ? actions : null };
  if (level === "campaign") return { campaign_external_id: String(r.campaign_id), ...base };
  if (level === "breakdown") return { campaign_external_id: String(r.campaign_id), day: base.day, spend: base.spend, impressions: base.impressions, link_clicks: base.link_clicks, publisher: String(r.publisher_platform ?? "unknown"), position: String(r.platform_position ?? "unknown") };
  return { entity_external_id: String(level === "adset" ? r.adset_id : r.ad_id), day: base.day, spend: base.spend, impressions: base.impressions, link_clicks: base.link_clicks, reported_results: base.reported_results };
}
export const META_METRIC_DEFS = { source: "Meta Marketing API · Insights", fields: "spend, impressions, clicks, inline_link_clicks, actions", link_clicks: "inline_link_clicks (cliques no link)", clicks_all: "clicks (todos os cliques)",
  reported_results: `soma de actions ${META_RESULT_ACTIONS.join(" + ")} (aproximação; não é o “Resultados” do Gerenciador)`, attribution: "janela de atribuição padrão da conta (não alterada)", day: "dia na timezone da conta de anúncios" };

/** Insights diários de um período. level: campaign | adset | ad | breakdown (publisher_platform + platform_position). Retorna linhas já normalizadas. */
export async function metaInsights(deps: HttpDeps, cfg: MetaCfg, token: string, act: string, level: "campaign" | "adset" | "ad" | "breakdown", since: string, until: string, onPage?: (n: number) => void) {
  const idField = { campaign: "campaign_id,campaign_name", adset: "adset_id,campaign_id", ad: "ad_id,campaign_id", breakdown: "campaign_id" }[level];
  const params: Record<string, string> = { level: level === "breakdown" ? "campaign" : level, time_increment: "1", time_range: JSON.stringify({ since, until }), limit: "500",
    fields: `${idField},spend,impressions,clicks,inline_link_clicks${level === "breakdown" ? "" : ",actions"},account_currency,date_start,date_stop` };
  if (level === "breakdown") params.breakdowns = "publisher_platform,platform_position";
  const r = await pages(deps, cfg, token, `${act}/insights`, params, onPage);
  const currency = r.rows.find((x) => x.account_currency)?.account_currency ?? null;
  return { rows: r.rows.map((x) => parseMetaInsightRow(x, level)), currency: currency ? String(currency).toUpperCase() : null, pages: r.pages, retries: r.retries };
}
export async function metaAccountInfo(deps: HttpDeps, cfg: MetaCfg, token: string, act: string) {
  const r = await graph(deps, cfg, token, act, { fields: "name,currency,timezone_name,account_status" }); return r.json as { name?: string; currency?: string; timezone_name?: string; account_status?: number };
}
