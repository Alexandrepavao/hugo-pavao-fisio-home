// HTTP seguro e SOMENTE LEITURA para as plataformas: lista de endereços permitidos, repetição limitada com espera e classificação de erros.
export class ApiError extends Error {
  constructor(public code: string, message: string, public status?: number, public retryable = false) { super(message); this.name = "ApiError"; }
}
export interface HttpDeps { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; maxRetries: number }
export const defaultDeps = (): HttpDeps => ({ fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), maxRetries: 3 });

/** Meta: só GET em graph.facebook.com. Criar, pausar ou alterar anúncios é impossível por aqui. */
export function assertMetaReadOnly(method: string, url: string) {
  const u = new URL(url);
  if (method.toUpperCase() !== "GET") throw new ApiError("read_only_violation", `Meta: método ${method} não permitido (somente leitura).`);
  if (u.protocol !== "https:" || u.hostname !== "graph.facebook.com") throw new ApiError("host_not_allowed", `Meta: endereço não permitido (${u.hostname}).`);
}
/** Google Ads: só listAccessibleCustomers (GET) e googleAds:search / searchStream (POST de CONSULTA). Qualquer :mutate ou outro serviço é recusado. */
export function assertGoogleAdsReadOnly(method: string, url: string) {
  const u = new URL(url); const m = method.toUpperCase();
  if (u.protocol !== "https:" || u.hostname !== "googleads.googleapis.com") throw new ApiError("host_not_allowed", `Google Ads: endereço não permitido (${u.hostname}).`);
  const path = u.pathname.replace(/^\/v\d+(\.\d+)?/, "");
  const ok = (m === "GET" && path === "/customers:listAccessibleCustomers") || (m === "POST" && /^\/customers\/\d{5,15}\/googleAds:(search|searchStream)$/.test(path));
  if (!ok) throw new ApiError("read_only_violation", "Google Ads: operação não permitida (o conector é somente leitura).");
}

export interface RetryOpts { classify: (status: number, body: any) => { retry: boolean; code: string; message: string } | null; onRetry?: (n: number) => void }
/** Executa a requisição com até `maxRetries` repetições (espera exponencial, respeita Retry-After). Erro de autenticação não repete. */
export async function requestJson(deps: HttpDeps, url: string, init: RequestInit, opts: RetryOpts): Promise<{ json: any; retries: number }> {
  let attempt = 0;
  for (;;) {
    let res: Response | null = null; let body: any = null; let netErr: unknown = null;
    try { res = await deps.fetch(url, init); const txt = await res.text(); try { body = txt ? JSON.parse(txt) : {}; } catch { body = { raw: txt.slice(0, 200) }; } } catch (e) { netErr = e; }
    if (res && res.ok) return { json: body, retries: attempt };
    const cls = res ? opts.classify(res.status, body) : { retry: true, code: "network", message: `falha de rede: ${(netErr as Error)?.message ?? "desconhecida"}` };
    const c = cls ?? { retry: !!res && res.status >= 500, code: res ? `http_${res.status}` : "network", message: `a plataforma respondeu ${res?.status}` };
    if (!c.retry || attempt >= deps.maxRetries) throw new ApiError(c.code, c.message, res?.status, c.retry);
    attempt++; opts.onRetry?.(attempt);
    const ra = Number(res?.headers.get("retry-after")); await deps.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : Math.min(500 * 2 ** attempt, 8000));
  }
}
