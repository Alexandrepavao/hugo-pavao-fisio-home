// Orquestração da sincronização de UMA conta (pura, com Db e adaptador injetados → testável com respostas simuladas).
// Garantias: execução protegida por trava (uma por conta), idempotente (chave conta+entidade+dia), paginação/retentativas dentro dos adaptadores, falha NUNCA grava gasto zero
// (o dia fica "falho" na cobertura), e somente o nível de campanha entra no total canônico — conjunto/anúncio/posicionamento/dispositivo são detalhamentos separados.
import { ApiError } from "./http.ts";
import { eachDay, planWindow, todayIn, type Coverage, type Settings } from "./plan.ts";

export type Level = "campaign" | "adset" | "ad" | "breakdown";
export interface Adapter {
  platform: "meta" | "google"; version: string; defs: Record<string, unknown>;
  accountInfo(): Promise<{ currency: string | null; timezone: string | null }>;
  entities(onPage: (n: number) => void): Promise<{ campaigns: any[]; adsets: any[]; ads: any[]; pages: number; retries: number }>;
  metrics(level: Level, since: string, until: string, onPage: (n: number) => void): Promise<{ rows: any[]; currency?: string | null; pages: number; retries: number }>;
}
export interface Db {
  runStart(a: { kind: string; from: string; to: string }): Promise<string | null>;
  heartbeat(run: string, pages: number, retries: number): Promise<void>;
  finish(run: string, status: "ok" | "partial" | "error", rows: number, code: string | null, message: string | null, daysOk: string[], daysFailed: string[]): Promise<void>;
  ingestEntities(run: string, e: { campaigns: any[]; adsets: any[]; ads: any[] }): Promise<void>;
  ingestMetrics(run: string, level: "campaign" | "adset" | "ad" | "breakdown", rows: any[], currency: string, tz: string, defs: unknown): Promise<number>;
}
export interface Ctx { kind: "scheduled" | "manual" | "backfill" | "reprocess"; account: { currency: string | null; timezone: string | null }; settings: Settings; coverage: Coverage; now?: Date }
export interface Result { status: "ok" | "partial" | "error" | "skipped"; run?: string; rows: number; code?: string; message?: string; window?: { from: string; to: string }; daysOk: number; daysFailed: number }

const AUTH = new Set(["auth_expired", "auth_revoked", "permission_denied", "project_not_approved", "authorization_error"]);
const inChunk = (rows: any[], from: string, to: string) => rows.filter((r) => typeof r.day === "string" && r.day >= from && r.day <= to && Number.isFinite(r.spend) && r.spend >= 0);

export async function syncAccount(db: Db, ad: Adapter, ctx: Ctx): Promise<Result> {
  const tz0 = ctx.account.timezone ?? "America/Sao_Paulo"; const today = todayIn(tz0, ctx.now);
  const plan = planWindow(today, ctx.settings, ctx.coverage);
  const run = await db.runStart({ kind: plan.kind === "backfill" && ctx.kind === "scheduled" ? "backfill" : ctx.kind, from: plan.from, to: plan.to });
  if (!run) return { status: "skipped", rows: 0, code: "busy", message: "Já existe uma sincronização desta conta em andamento.", daysOk: 0, daysFailed: 0 };
  let pages = 0, retries = 0, rows = 0; const daysOk: string[] = [], daysFailed: string[] = []; let firstErr: ApiError | null = null; let detailErr: string | null = null;
  const onPage = () => { pages++; void db.heartbeat(run, pages, retries); };
  try {
    const info = await ad.accountInfo();
    const currency = (info.currency ?? ctx.account.currency)?.toUpperCase() ?? null; const tz = info.timezone ?? ctx.account.timezone ?? "America/Sao_Paulo";
    if (!currency) throw new ApiError("no_currency", "A plataforma não informou a moeda da conta; nada foi gravado.");
    if (ctx.account.currency && ctx.account.currency.toUpperCase() !== currency) throw new ApiError("currency_changed", `A moeda da conta mudou (${ctx.account.currency} → ${currency}). Nada foi gravado; revise a conta antes de sincronizar.`);
    const ent = await ad.entities(onPage); pages += ent.pages; retries += ent.retries;
    await db.ingestEntities(run, ent);
    for (const ch of plan.chunks) {
      const days = eachDay(ch.from, ch.to);
      try {
        const m = await ad.metrics("campaign", ch.from, ch.to, onPage); retries += m.retries;
        const mc = (m.currency ?? currency).toUpperCase(); if (mc !== currency) throw new ApiError("currency_changed", `Resposta em ${mc}, esperado ${currency}.`);
        rows += await db.ingestMetrics(run, "campaign", inChunk(m.rows, ch.from, ch.to), currency, tz, ad.defs);
        daysOk.push(...days);
      } catch (e) {
        daysFailed.push(...days); if (!(e instanceof ApiError)) throw e; firstErr ??= e;
        if (AUTH.has(e.code) || e.code === "currency_changed" || e.code === "rate_limit") break;       // sem acesso / moeda divergente / limite esgotado: não insiste nos demais blocos
        continue;
      }
      for (const lv of ["adset", "ad", "breakdown"] as const) {                                         // detalhamentos: melhor esforço; nunca entram no total canônico
        try {
          const m = await ad.metrics(lv, ch.from, ch.to, onPage); retries += m.retries; const ok = inChunk(m.rows, ch.from, ch.to);
          rows += await db.ingestMetrics(run, lv, lv === "breakdown" ? splitBreakdown(ad.platform, ok) : ok, currency, tz, ad.defs);
        } catch (e) { detailErr ??= `${lv}: ${(e as Error).message}`; }
      }
    }
    // dias do plano que não foram nem coletados nem marcados falhos (ex.: blocos não tentados) ficam SEM marcação — ausência de dado, nunca zero
    const status = daysOk.length === 0 ? "error" : daysFailed.length || detailErr ? "partial" : "ok";
    const msg = firstErr?.message ?? detailErr ?? null;
    await db.finish(run, status, rows, firstErr?.code ?? (detailErr ? "detail_incomplete" : null), msg, daysOk, daysFailed);
    return { status, run, rows, code: firstErr?.code, message: msg ?? undefined, window: { from: plan.from, to: plan.to }, daysOk: daysOk.length, daysFailed: daysFailed.length };
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "internal"; const message = (e as Error).message ?? "erro";
    await db.finish(run, "error", rows, code, message, daysOk, daysFailed).catch(() => undefined);
    return { status: "error", run, rows, code, message, window: { from: plan.from, to: plan.to }, daysOk: daysOk.length, daysFailed: daysFailed.length };
  }
}

/** Meta devolve (publicador × posição) por linha; Google, o dispositivo. Normaliza para (kind, value) somando linhas repetidas por (campanha, dia, valor). */
export function splitBreakdown(platform: "meta" | "google", rows: any[]) {
  const acc = new Map<string, any>();
  const add = (campaign: string, day: string, kind: string, value: string, r: any) => {
    const k = `${campaign}|${day}|${kind}|${value}`; const cur = acc.get(k) ?? { campaign_external_id: campaign, day, kind, value, spend: 0, impressions: 0, link_clicks: 0 };
    cur.spend += r.spend ?? 0; cur.impressions += r.impressions ?? 0; cur.link_clicks += r.link_clicks ?? 0; acc.set(k, cur);
  };
  for (const r of rows) {
    if (platform === "meta") { add(r.campaign_external_id, r.day, "publisher_platform", r.publisher, r); add(r.campaign_external_id, r.day, "platform_position", `${r.publisher}:${r.position}`, r); }
    else add(r.campaign_external_id, r.day, "device", r.device, r);
  }
  return [...acc.values()];
}
