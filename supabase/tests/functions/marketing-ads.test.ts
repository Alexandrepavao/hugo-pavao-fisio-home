// Testes do conector de anúncios (Edge Function marketing-ads) com RESPOSTAS SIMULADAS. Nada aqui fala com a Meta ou com o Google:
// prova a lógica (segurança, somente leitura, paginação, repetição, janelas, falha ≠ zero). A verificação real das APIs está em docs/marketing-campanhas.md.
import { describe, expect, it, vi } from "vitest";
import { appSecretProof, decrypt, encrypt, pkcePair, sameSecret, signState, verifyState, b64 } from "../../functions/marketing-ads/crypto";
import { ApiError, assertGoogleAdsReadOnly, assertMetaReadOnly, requestJson, type HttpDeps } from "../../functions/marketing-ads/http";
import { classifyMeta, metaAuthUrl, metaInsights, metaListAccounts, parseMetaInsightRow, type MetaCfg } from "../../functions/marketing-ads/meta";
import { classifyGoogle, gaql, googleAuthUrl, googleDiscover, googleMetrics, type GoogleCfg } from "../../functions/marketing-ads/google";
import { addDays, daysBetween, planWindow, todayIn } from "../../functions/marketing-ads/plan";
import { splitBreakdown, syncAccount, type Adapter, type Db } from "../../functions/marketing-ads/sync";

const KEY = b64(new Uint8Array(32).map((_, i) => i + 1));
const mkRes = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const deps = (responses: Response[] | ((url: string, init: RequestInit) => Response), maxRetries = 3): HttpDeps & { calls: { url: string; init: RequestInit }[]; sleeps: number[] } => {
  const calls: { url: string; init: RequestInit }[] = []; const sleeps: number[] = []; let i = 0;
  return { calls, sleeps, maxRetries, sleep: async (ms) => { sleeps.push(ms); },
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return typeof responses === "function" ? responses(String(url), init) : responses[Math.min(i++, responses.length - 1)].clone(); }) as typeof fetch };
};
const META: MetaCfg = { appId: "123", appSecret: "segredo-do-app", version: "v26.0" };
const GOOGLE: GoogleCfg = { clientId: "cid", clientSecret: "csecret", version: "v26" };

describe("segurança: criptografia, state e PKCE", () => {
  it("criptografa com IV aleatório e só abre com a mesma chave", async () => {
    const a = await encrypt(KEY, "token-secreto"); const b = await encrypt(KEY, "token-secreto");
    expect(a).not.toBe(b); expect(a).not.toContain("token-secreto"); expect(await decrypt(KEY, a)).toBe("token-secreto");
    await expect(decrypt(b64(new Uint8Array(32).fill(9)), a)).rejects.toBeTruthy();
    await expect(encrypt("curta", "x")).rejects.toBeTruthy();
  });
  it("state: assinado, vinculado, vence e não aceita adulteração", async () => {
    const payload = { u: "user-1", o: "org-1", p: "meta" as const, n: "nonce-1", exp: Date.now() + 60_000 };
    const s = await signState(KEY, payload); expect(await verifyState(KEY, s)).toEqual(payload);
    expect(await verifyState(KEY, s, Date.now() + 120_000)).toBeNull();                              // vencido
    const [body, sig] = s.split("."); const forged = btoa(JSON.stringify({ ...payload, o: "org-2" })).replace(/=+$/, "");
    expect(await verifyState(KEY, `${forged}.${sig}`)).toBeNull();                                  // corpo trocado (outra organização)
    expect(await verifyState(KEY, `${body}.${sig.slice(0, -2)}AA`)).toBeNull();                     // assinatura adulterada
    expect(await verifyState(b64(new Uint8Array(32).fill(7)), s)).toBeNull();                       // outra chave
    expect(await verifyState(KEY, "lixo")).toBeNull(); expect(await verifyState(KEY, "")).toBeNull();
  });
  it("PKCE S256 e prova do segredo do app (appsecret_proof) são determinísticos", async () => {
    const { verifier, challenge } = await pkcePair(); const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(challenge).toBe(btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    expect(await appSecretProof("t", "s")).toBe(await appSecretProof("t", "s")); expect(await appSecretProof("t", "s")).toHaveLength(64);
    expect(sameSecret("abc", "abc")).toBe(true); expect(sameSecret("abc", "abd")).toBe(false); expect(sameSecret("", "")).toBe(false);
  });
});

describe("somente leitura (lista de operações permitidas)", () => {
  it("Meta: só GET em graph.facebook.com", () => {
    expect(() => assertMetaReadOnly("GET", "https://graph.facebook.com/v26.0/act_1/insights")).not.toThrow();
    for (const m of ["POST", "DELETE", "PUT"]) expect(() => assertMetaReadOnly(m, "https://graph.facebook.com/v26.0/act_1/campaigns")).toThrow(/somente leitura/);
    expect(() => assertMetaReadOnly("GET", "https://evil.example.com/v26.0/act_1/insights")).toThrow(/não permitido/);
    expect(() => assertMetaReadOnly("GET", "http://graph.facebook.com/x")).toThrow();
  });
  it("Google Ads: só search/searchStream/listAccessibleCustomers; qualquer :mutate é recusado", () => {
    expect(() => assertGoogleAdsReadOnly("GET", "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers")).not.toThrow();
    expect(() => assertGoogleAdsReadOnly("POST", "https://googleads.googleapis.com/v26/customers/1234567890/googleAds:search")).not.toThrow();
    expect(() => assertGoogleAdsReadOnly("POST", "https://googleads.googleapis.com/v26/customers/1234567890/googleAds:searchStream")).not.toThrow();
    for (const p of ["customers/1234567890/campaigns:mutate", "customers/1234567890/googleAds:mutate", "customers/1234567890/campaignBudgets:mutate", "customers/1234567890/adGroups:mutate"])
      expect(() => assertGoogleAdsReadOnly("POST", `https://googleads.googleapis.com/v26/${p}`)).toThrow(/somente leitura/);
    expect(() => assertGoogleAdsReadOnly("POST", "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers")).toThrow();
    expect(() => assertGoogleAdsReadOnly("POST", "https://other.googleapis.com/v26/customers/1234567890/googleAds:search")).toThrow(/não permitido/);
  });
  it("GAQL só aceita SELECT", async () => {
    await expect(gaql(deps([mkRes(200, {})]), GOOGLE, "t", "1234567890", null, "UPDATE campaign SET status = 'PAUSED'")).rejects.toThrow(/SELECT/);
  });
});

describe("repetição limitada, limite de requisições e expiração", () => {
  it("repete em 429 com espera e termina com sucesso", async () => {
    const d = deps([mkRes(429, { error: { code: 17, message: "limite" } }), mkRes(429, { error: { code: 4 } }), mkRes(200, { data: [] })]);
    const r = await requestJson(d, "https://graph.facebook.com/x", {}, { classify: classifyMeta }); expect(r.retries).toBe(2); expect(d.sleeps).toHaveLength(2); expect(d.sleeps[1]).toBeGreaterThan(d.sleeps[0]);
  });
  it("respeita Retry-After e desiste depois do limite de tentativas (3)", async () => {
    const d = deps([mkRes(429, { error: { code: 17 } }, { "retry-after": "2" })], 3);
    await expect(requestJson(d, "https://graph.facebook.com/x", {}, { classify: classifyMeta })).rejects.toMatchObject({ code: "rate_limit" });
    expect(d.calls).toHaveLength(4); expect(d.sleeps[0]).toBe(2000);
  });
  it("token expirado/revogado NÃO é repetido e vira auth_expired", async () => {
    const d = deps([mkRes(400, { error: { code: 190, error_subcode: 463, message: "Session has expired" } })]);
    await expect(requestJson(d, "https://graph.facebook.com/x", {}, { classify: classifyMeta })).rejects.toMatchObject({ code: "auth_expired", retryable: false }); expect(d.calls).toHaveLength(1);
  });
  it("erro de rede é repetido; 5xx também; 403 não", async () => {
    let n = 0; const d: HttpDeps = { maxRetries: 2, sleep: async () => undefined, fetch: (async () => { if (n++ < 2) throw new Error("ECONNRESET"); return mkRes(200, { ok: true }); }) as typeof fetch };
    expect((await requestJson(d, "https://graph.facebook.com/x", {}, { classify: classifyMeta })).retries).toBe(2);
    await expect(requestJson(deps([mkRes(403, { error: { message: "sem permissão" } })]), "https://graph.facebook.com/x", {}, { classify: classifyMeta })).rejects.toMatchObject({ code: "permission_denied" });
  });
  it("Google: classifica projeto só de teste, autorização, limite e revogação", () => {
    expect(classifyGoogle(403, { error: { status: "PERMISSION_DENIED", message: "x", details: [{ errors: [{ errorCode: { authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" } }] }] } })).toMatchObject({ code: "project_not_approved", retry: false });
    expect(classifyGoogle(400, { error: "invalid_grant" })).toMatchObject({ code: "auth_revoked" });
    expect(classifyGoogle(429, { error: { status: "RESOURCE_EXHAUSTED" } })).toMatchObject({ code: "rate_limit", retry: true });
    expect(classifyGoogle(401, {})).toMatchObject({ code: "auth_expired" }); expect(classifyGoogle(503, {})).toMatchObject({ retry: true });
  });
});

describe("Meta: OAuth só com ads_read, paginação e normalização", () => {
  it("pede apenas ads_read e não monta URL com segredo", () => {
    const u = new URL(metaAuthUrl(META, "https://p.supabase.co/functions/v1/marketing-ads/callback/meta", "STATE"));
    expect(u.hostname).toBe("www.facebook.com"); expect(u.searchParams.get("scope")).toBe("ads_read"); expect(u.searchParams.get("state")).toBe("STATE"); expect(u.toString()).not.toContain("segredo-do-app");
    expect(u.pathname).toBe("/v26.0/dialog/oauth");
  });
  it("lista contas seguindo a paginação, sem repassar o access_token da URL de próxima página (usa cabeçalho)", async () => {
    const d = deps((url) => url.includes("after=PAG2") ? mkRes(200, { data: [{ account_id: "222", name: "B", currency: "USD", timezone_name: "America/New_York", account_status: 1 }] })
      : mkRes(200, { data: [{ account_id: "111", name: "A", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 2 }], paging: { next: "https://graph.facebook.com/v26.0/me/adaccounts?after=PAG2&access_token=VAZADO" } }));
    const accs = await metaListAccounts(d, META, "TOKEN"); expect(accs.map((a) => a.external_id)).toEqual(["act_111", "act_222"]); expect(accs[0].status).toBe("DISABLED");
    for (const c of d.calls) { expect(c.url).not.toContain("VAZADO"); expect(c.url).not.toContain("access_token"); expect(c.url).toContain("appsecret_proof="); expect((c.init.headers as any).Authorization).toBe("Bearer TOKEN"); expect(c.init.method).toBe("GET"); }
  });
  it("recusa seguir paginação para outro host (SSRF) e limita o número de páginas", async () => {
    const d = deps([mkRes(200, { data: [{ account_id: "1" }], paging: { next: "https://evil.example.com/steal" } })]);
    await expect(metaListAccounts(d, META, "T")).rejects.toMatchObject({ code: "host_not_allowed" });
  });
  it("normaliza linhas de insights (spend em texto, ações) e guarda o resultado reportado à parte", () => {
    const r = parseMetaInsightRow({ campaign_id: "9", date_start: "2026-11-01", spend: "12.50", impressions: "1000", clicks: "40", inline_link_clicks: "30", actions: [{ action_type: "lead", value: "3" }, { action_type: "link_click", value: "30" }] }, "campaign") as any;
    expect(r).toMatchObject({ campaign_external_id: "9", day: "2026-11-01", spend: 12.5, impressions: 1000, link_clicks: 30, clicks_all: 40, reported_results: 3 }); expect(r.reported_actions.link_click).toBe(30);
    expect((parseMetaInsightRow({ campaign_id: "9", date_start: "2026-11-01", spend: "0" }, "campaign") as any).reported_results).toBeNull();     // sem ações: nulo, não zero
  });
  it("insights pedem nível, incremento diário e período; moeda vem da resposta", async () => {
    const d = deps([mkRes(200, { data: [{ campaign_id: "1", date_start: "2026-11-01", spend: "5", account_currency: "BRL" }] })]);
    const r = await metaInsights(d, META, "T", "act_1", "campaign", "2026-11-01", "2026-11-07"); expect(r.currency).toBe("BRL");
    const u = new URL(d.calls[0].url); expect(u.searchParams.get("level")).toBe("campaign"); expect(u.searchParams.get("time_increment")).toBe("1"); expect(JSON.parse(u.searchParams.get("time_range")!)).toEqual({ since: "2026-11-01", until: "2026-11-07" });
  });
});

describe("Google Ads: descoberta, GAQL paginado e conversão de micros", () => {
  it("developer-token só é enviado se configurado; login-customer-id só quando necessário", async () => {
    const d1 = deps([mkRes(200, { results: [] })]); await gaql(d1, GOOGLE, "TK", "1234567890", null, "SELECT campaign.id FROM campaign");
    expect((d1.calls[0].init.headers as any)["developer-token"]).toBeUndefined(); expect((d1.calls[0].init.headers as any)["login-customer-id"]).toBeUndefined();
    const d2 = deps([mkRes(200, { results: [] })]); await gaql(d2, { ...GOOGLE, developerToken: "DT" }, "TK", "123-456-7890", "999-888-7777", "SELECT campaign.id FROM campaign");
    expect((d2.calls[0].init.headers as any)["developer-token"]).toBe("DT"); expect((d2.calls[0].init.headers as any)["login-customer-id"]).toBe("9998887777"); expect(d2.calls[0].url).toContain("/customers/1234567890/googleAds:search");
  });
  it("pagina por nextPageToken e converte cost_micros em moeda", async () => {
    const d = deps((_u, init) => JSON.parse(String(init.body)).pageToken ? mkRes(200, { results: [{ campaign: { id: "2" }, segments: { date: "2026-11-02" }, metrics: { costMicros: "2500000", impressions: "10", clicks: "1", conversions: 0.5 } }] })
      : mkRes(200, { results: [{ campaign: { id: "1" }, segments: { date: "2026-11-01" }, metrics: { costMicros: "10000000", impressions: "100", clicks: "5", conversions: 2 } }], nextPageToken: "P2" }));
    const r = await googleMetrics(d, GOOGLE, "T", "1234567890", null, "campaign", "2026-11-01", "2026-11-02");
    expect(r.rows).toHaveLength(2); expect(r.rows[0]).toMatchObject({ campaign_external_id: "1", day: "2026-11-01", spend: 10, impressions: 100, link_clicks: 5, reported_results: 2 }); expect(r.rows[1].spend).toBe(2.5); expect(r.pages).toBe(2);
  });
  it("descoberta: conta direta e contas-cliente de uma administradora (com login-customer-id)", async () => {
    const d = deps((url, init) => {
      if (url.endsWith("customers:listAccessibleCustomers")) return mkRes(200, { resourceNames: ["customers/1111111111", "customers/2222222222"] });
      const q = String(JSON.parse(String(init.body)).query); const id = url.match(/customers\/(\d+)/)![1];
      if (q.includes("FROM customer_client")) return mkRes(200, { results: [{ customerClient: { id: "3333333333", descriptiveName: "Cliente 1", currencyCode: "BRL", timeZone: "America/Sao_Paulo", manager: false, status: "ENABLED" } }, { customerClient: { id: "4444444444", manager: true } }] });
      return mkRes(200, { results: [{ customer: id === "1111111111" ? { id, descriptiveName: "Direta", currencyCode: "BRL", timeZone: "America/Sao_Paulo", manager: false, status: "ENABLED" } : { id, descriptiveName: "MCC", manager: true } }] });
    });
    const accs = await googleDiscover(d, GOOGLE, "T"); expect(accs.map((a) => [a.external_id, a.login_customer_id])).toEqual([["1111111111", null], ["3333333333", "2222222222"]]);
  });
  it("URL de consentimento: escopo adwords, PKCE e acesso offline; sem segredo", () => {
    const u = new URL(googleAuthUrl(GOOGLE, "https://p.supabase.co/functions/v1/marketing-ads/callback/google", "ST", "CH"));
    expect(u.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/adwords"); expect(u.searchParams.get("code_challenge_method")).toBe("S256"); expect(u.searchParams.get("access_type")).toBe("offline"); expect(u.toString()).not.toContain("csecret");
    expect(u.searchParams.get("scope")).not.toContain("calendar");
  });
});

describe("janelas de sincronização", () => {
  it("sem histórico → histórico inicial; com histórico → reprocessa a janela recente", () => {
    const first = planWindow("2026-11-09", { backfill_days: 90, reprocess_days: 7 }, { okDays: [], failedDays: [] });
    expect(first.kind).toBe("backfill"); expect(daysBetween(first.from, first.to)).toBe(90); expect(first.chunks.length).toBe(3); expect(first.chunks[0].from).toBe(first.from); expect(first.chunks.at(-1)!.to).toBe("2026-11-09");
    const again = planWindow("2026-11-09", { backfill_days: 90, reprocess_days: 7 }, { okDays: ["2026-11-08"], failedDays: [] }); expect(again.kind).toBe("reprocess"); expect(again.from).toBe("2026-11-03");
  });
  it("recupera dia que falhou antes (catch-up), sem passar do histórico configurado", () => {
    const p = planWindow("2026-11-09", { backfill_days: 90, reprocess_days: 7 }, { okDays: ["2026-11-08"], failedDays: ["2026-10-20", "2026-01-01"] }); expect(p.from).toBe("2026-10-20"); expect(p.includesCatchup).toBe(true);
    expect(planWindow("2026-11-09", { backfill_days: 30, reprocess_days: 7 }, { okDays: ["x"], failedDays: ["2026-01-01"] }).from).toBe("2026-11-03");   // dia falho anterior ao histórico configurado não é recuperado
  });
  it("matemática de datas e fuso da conta", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02"); expect(daysBetween("2026-11-01", "2026-11-30")).toBe(30);
    const t = new Date("2026-11-09T01:00:00Z"); expect(todayIn("America/Sao_Paulo", t)).toBe("2026-11-08"); expect(todayIn("Asia/Tokyo", t)).toBe("2026-11-09"); expect(todayIn("Fuso/Invalido", t)).toBe("2026-11-08");
  });
});

// ---------------------------------------------------------------- orquestração com Db e adaptador simulados
const fakeDb = (opts: { busy?: boolean } = {}) => {
  const calls: any = { metrics: [] as any[], finish: null as any, entities: 0, started: [] as any[] };
  const db: Db = { runStart: async (a) => { calls.started.push(a); return opts.busy ? null : "run-1"; }, heartbeat: async () => undefined,
    finish: async (run, status, rows, code, message, ok, failed) => { calls.finish = { run, status, rows, code, message, ok, failed }; },
    ingestEntities: async () => { calls.entities++; }, ingestMetrics: async (_r, level, rows, currency, tz) => { calls.metrics.push({ level, rows, currency, tz }); return rows.length; } };
  return { db, calls };
};
const fakeAdapter = (over: Partial<Adapter> = {}, failChunks: number[] = []): Adapter => {
  let chunk = -1;
  return { platform: "meta", version: "v26.0", defs: { s: 1 },
    accountInfo: async () => ({ currency: "BRL", timezone: "America/Sao_Paulo" }),
    entities: async () => ({ campaigns: [{ external_id: "c1" }], adsets: [], ads: [], pages: 1, retries: 0 }),
    metrics: async (level, since, until) => {
      if (level === "campaign") { chunk++; if (failChunks.includes(chunk)) throw new ApiError("provider_error", "erro temporário", 500, true); return { rows: [{ campaign_external_id: "c1", day: since, spend: 10, impressions: 100, link_clicks: 5 }, { campaign_external_id: "c1", day: "1999-01-01", spend: 1 }], pages: 1, retries: 1, currency: "BRL" }; }
      if (level === "breakdown") return { rows: [{ campaign_external_id: "c1", day: since, spend: 6, impressions: 60, link_clicks: 3, publisher: "instagram", position: "feed" }, { campaign_external_id: "c1", day: since, spend: 4, impressions: 40, link_clicks: 2, publisher: "facebook", position: "feed" }], pages: 1, retries: 0 };
      return { rows: [{ entity_external_id: "e1", day: since, spend: 10 }], pages: 1, retries: 0 };
    }, ...over };
};
const ctx = (cov = { okDays: [] as string[], failedDays: [] as string[] }) => ({ kind: "scheduled" as const, account: { currency: "BRL", timezone: "America/Sao_Paulo" }, settings: { backfill_days: 62, reprocess_days: 7 }, coverage: cov, now: new Date("2026-11-09T15:00:00Z") });

describe("syncAccount (respostas simuladas)", () => {
  it("histórico inicial: só o nível de campanha entra no total canônico; linhas fora do bloco são descartadas; todos os dias ficam cobertos", async () => {
    const { db, calls } = fakeDb(); const r = await syncAccount(db, fakeAdapter(), ctx());
    expect(r.status).toBe("ok"); expect(r.daysOk).toBe(62); expect(r.daysFailed).toBe(0);
    const camp = calls.metrics.filter((m: any) => m.level === "campaign"); expect(camp).toHaveLength(2); expect(camp.every((m: any) => m.rows.every((x: any) => x.day !== "1999-01-01"))).toBe(true);
    expect(calls.metrics.filter((m: any) => m.level === "adset" || m.level === "ad").length).toBe(4);
    const bd = calls.metrics.find((m: any) => m.level === "breakdown"); expect(bd.rows.map((x: any) => `${x.kind}:${x.value}`).sort()).toEqual(["platform_position:facebook:feed", "platform_position:instagram:feed", "publisher_platform:facebook", "publisher_platform:instagram"]);
    expect(calls.started[0]).toMatchObject({ kind: "backfill", to: "2026-11-09" }); expect(calls.finish.status).toBe("ok");
  });
  it("falha num bloco: os dias do bloco ficam FALHOS e nenhuma linha de gasto é escrita para eles (nunca zero)", async () => {
    const { db, calls } = fakeDb(); const r = await syncAccount(db, fakeAdapter({}, [0]), ctx());
    expect(r.status).toBe("partial"); expect(calls.finish.failed.length).toBe(31); expect(calls.finish.ok.length).toBe(31); expect(calls.finish.code).toBe("provider_error");
    const days = new Set(calls.metrics.filter((m: any) => m.level === "campaign").flatMap((m: any) => m.rows.map((x: any) => x.day))); for (const d of calls.finish.failed) expect(days.has(d)).toBe(false);
  });
  it("sem acesso (token expirado): para, marca erro e não grava nada", async () => {
    const { db, calls } = fakeDb(); const ad = fakeAdapter({ metrics: async () => { throw new ApiError("auth_expired", "expirou"); } });
    const r = await syncAccount(db, ad, ctx()); expect(r.status).toBe("error"); expect(r.code).toBe("auth_expired"); expect(calls.metrics).toHaveLength(0); expect(calls.finish.ok).toHaveLength(0);
  });
  it("execução concorrente (trava ocupada): descartada sem tocar em nada", async () => {
    const { db, calls } = fakeDb({ busy: true }); const r = await syncAccount(db, fakeAdapter(), ctx()); expect(r.status).toBe("skipped"); expect(calls.entities).toBe(0); expect(calls.finish).toBeNull();
  });
  it("moeda divergente da conta: nada é gravado e o erro é explícito", async () => {
    const { db, calls } = fakeDb(); const r = await syncAccount(db, fakeAdapter({ accountInfo: async () => ({ currency: "USD", timezone: "America/Sao_Paulo" }) }), ctx());
    expect(r.status).toBe("error"); expect(r.code).toBe("currency_changed"); expect(calls.metrics).toHaveLength(0);
    const r2 = await syncAccount(fakeDb().db, fakeAdapter({ metrics: async () => ({ rows: [], currency: "EUR", pages: 1, retries: 0 }) }), ctx()); expect(r2.code).toBe("currency_changed");
  });
  it("detalhamento que falha deixa a execução parcial, sem derrubar o total canônico", async () => {
    const { db, calls } = fakeDb(); const base = fakeAdapter(); const ad = fakeAdapter({ metrics: async (l, s, u, p) => { if (l === "ad") throw new ApiError("provider_error", "ads indisponível"); return base.metrics(l, s, u, p); } });
    const r = await syncAccount(db, ad, ctx({ okDays: ["2026-11-08"], failedDays: [] })); expect(r.status).toBe("partial"); expect(r.daysOk).toBe(7); expect(calls.finish.code).toBe("detail_incomplete");
  });
  it("com histórico, reprocessa a janela recente (7 dias) em um único bloco", async () => {
    const { db, calls } = fakeDb(); const r = await syncAccount(db, fakeAdapter(), ctx({ okDays: ["2026-11-08"], failedDays: [] })); expect(r.window).toEqual({ from: "2026-11-03", to: "2026-11-09" });
    expect(calls.metrics.filter((m: any) => m.level === "campaign")).toHaveLength(1); expect(calls.started[0].kind).toBe("scheduled");
  });
  it("splitBreakdown soma linhas repetidas e separa Facebook × Instagram; Google usa dispositivo", () => {
    const m = splitBreakdown("meta", [{ campaign_external_id: "c", day: "d", spend: 1, impressions: 10, link_clicks: 1, publisher: "instagram", position: "feed" }, { campaign_external_id: "c", day: "d", spend: 2, impressions: 20, link_clicks: 2, publisher: "instagram", position: "story" }]);
    expect(m.find((x) => x.kind === "publisher_platform")).toMatchObject({ value: "instagram", spend: 3, impressions: 30 });
    expect(splitBreakdown("google", [{ campaign_external_id: "c", day: "d", spend: 5, device: "MOBILE" }])[0]).toMatchObject({ kind: "device", value: "MOBILE", spend: 5 });
  });
});

describe("não vaza segredo", () => {
  it("mensagens de erro da Meta não carregam o token", async () => {
    const d = deps([mkRes(400, { error: { code: 190, message: "Invalid OAuth access token." } })]);
    try { await metaListAccounts(d, META, "TOKEN-SECRETO-123"); } catch (e) { expect((e as Error).message).not.toContain("TOKEN-SECRETO-123"); }
    for (const c of d.calls) expect(c.url).not.toContain("TOKEN-SECRETO-123");
    void vi;
  });
});
