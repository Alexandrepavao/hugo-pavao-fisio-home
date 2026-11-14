// Adaptadores de provedor de rotas. SEM Deno/rede implícita: o `fetch` e o `sleep` são injetados (assim os testes usam respostas SIMULADAS e
// a função usa o fetch real). Trocar de provedor = escrever outro adaptador com esta interface; tela e algoritmo não mudam.
//
// PRIVACIDADE: a requisição ao provedor leva SOMENTE coordenadas (arredondadas a 3 casas) e o perfil de deslocamento. Nunca nome, telefone, diagnóstico,
// prontuário ou orientação. Mensagens de erro NUNCA incluem coordenadas, corpo da requisição nem a chave.

export type Profile = "driving-car" | "foot-walking" | "cycling-regular";
export interface LL { lat: number; lng: number }
export type ProviderCode = "unauthorized" | "rate_limited" | "unavailable" | "bad_request" | "timeout";
export class ProviderError extends Error { constructor(public code: ProviderCode, message: string, public status?: number) { super(message); this.name = "ProviderError"; } }

export interface RouteProvider {
  name: string;
  attribution: string;
  /** Duração em segundos entre todos os pares (linha = origem, coluna = destino); null = sem rota/estimativa (NUNCA 0). */
  matrix(profile: Profile, pts: LL[]): Promise<(number | null)[][]>;
  directions(profile: Profile, pts: LL[]): Promise<{ line: [number, number][]; distanceM: number; durationS: number }>;
}
export interface Deps { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; timeoutMs?: number }

export const roundCoord = (v: number) => Math.round(v * 1000) / 1000;
export const roundLL = (p: LL): LL => ({ lat: roundCoord(p.lat), lng: roundCoord(p.lng) });
export const cacheKey = (profile: string, a: LL, b: LL) => `${profile}|${roundCoord(a.lat).toFixed(3)}|${roundCoord(a.lng).toFixed(3)}|${roundCoord(b.lat).toFixed(3)}|${roundCoord(b.lng).toFixed(3)}`;

const BASE = "https://api.openrouteservice.org";
const PROFILES = ["driving-car", "foot-walking", "cycling-regular"];
const MAX_POINTS = 25;   // muito abaixo do limite do provedor (3.500 rotas por matriz); mantém o consumo previsível

/** OpenRouteService (plano gratuito). Chave só aqui no backend. Uma retentativa para 429/5xx/timeout; 401/403 não repete. */
export function orsProvider(key: string, deps: Deps): RouteProvider {
  const call = async (path: string, body: unknown) => {
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 12000);
      let res: Response | null = null; let timedOut = false;
      try {
        res = await deps.fetch(BASE + path, { method: "POST", headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/json, application/geo+json" }, body: JSON.stringify(body), signal: ctl.signal });
      } catch (e) { timedOut = (e as Error)?.name === "AbortError"; } finally { clearTimeout(t); }
      if (res?.ok) { return await res.json(); }
      const status = res?.status;
      if (status === 401 || status === 403) throw new ProviderError("unauthorized", `o provedor recusou a chave (HTTP ${status})`, status);
      if (status === 400 || status === 404 || status === 413) throw new ProviderError("bad_request", `o provedor recusou a consulta (HTTP ${status})`, status);
      const retryable = status === 429 || (status !== undefined && status >= 500) || res === null;
      if (!retryable || attempt >= 1) {
        if (status === 429) throw new ProviderError("rate_limited", "limite de consultas por minuto do provedor atingido", 429);
        if (res === null && timedOut) throw new ProviderError("timeout", "o provedor demorou demais para responder");
        throw new ProviderError("unavailable", status ? `o provedor respondeu HTTP ${status}` : "falha de rede com o provedor", status);
      }
      const ra = Number(res?.headers.get("retry-after")); await deps.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 4000) : 1500);
    }
  };
  const check = (profile: string, pts: LL[]) => {
    if (!PROFILES.includes(profile)) throw new ProviderError("bad_request", "perfil de deslocamento inválido");
    if (pts.length < 2 || pts.length > MAX_POINTS) throw new ProviderError("bad_request", `número de pontos fora do limite (2 a ${MAX_POINTS})`);
  };
  return {
    name: "ors",
    attribution: "Rotas: © openrouteservice.org by HeiGIT · Dados © OpenStreetMap contributors",
    async matrix(profile, pts) {
      check(profile, pts);
      const j = await call(`/v2/matrix/${profile}`, { locations: pts.map((p) => [p.lng, p.lat]), metrics: ["duration"] });
      const d = j?.durations;
      if (!Array.isArray(d) || d.length !== pts.length) throw new ProviderError("unavailable", "resposta do provedor em formato inesperado");
      return d.map((row: unknown) => (Array.isArray(row) ? row : []).map((v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)));
    },
    async directions(profile, pts) {
      check(profile, pts);
      const j = await call(`/v2/directions/${profile}/geojson`, { coordinates: pts.map((p) => [p.lng, p.lat]) });
      const f = j?.features?.[0]; const line = f?.geometry?.coordinates; const sum = f?.properties?.summary;
      if (!Array.isArray(line) || !sum) throw new ProviderError("unavailable", "resposta do provedor em formato inesperado");
      return { line: line as [number, number][], distanceM: Math.round(sum.distance ?? 0), durationS: Math.round(sum.duration ?? 0) };
    },
  };
}

/** Mensagem para a tela por classe de erro (nunca expõe detalhe técnico, chave ou coordenada). */
export function userMessage(code: ProviderCode | "no_key" | "cap" | "too_many_points"): string {
  switch (code) {
    case "no_key": return "Estimativa indisponível: o serviço de rotas ainda não foi configurado.";
    case "cap": return "Estimativa indisponível: o limite diário de consultas de rota foi atingido. Tente amanhã ou fale com o administrador.";
    case "rate_limited": return "Estimativa indisponível: muitas consultas por minuto. Tente de novo em instantes.";
    case "unauthorized": return "Estimativa indisponível: o serviço de rotas recusou a configuração. Avise o administrador.";
    case "timeout": return "Estimativa indisponível: o serviço de rotas demorou demais para responder.";
    case "too_many_points": return "Estimativa indisponível: pontos demais para uma consulta.";
    default: return "Estimativa indisponível no momento.";
  }
}
