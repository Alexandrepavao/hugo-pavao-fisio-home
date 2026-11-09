// Rastreamento da captação (campanhas pagas). Só o que pode atravessar páginas e formulários:
//  • parâmetros de CAMPANHA (utm_* e os ids de campanha/conjunto/anúncio do link) — não são dado pessoal;
//  • identificadores de CLIQUE (fbclid, gclid, wbraid, gbraid) apenas quando o visitante deu consentimento de rastreamento neste navegador
//    (localStorage "hp_consent_tracking" = "1"; hoje NADA define esse valor, então por padrão os identificadores de clique NÃO são guardados).
// O servidor valida e limita tudo de novo (private.mkt_clean_utm): parâmetro público não é prova de autenticidade.
export const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "hp_campaign_id", "hp_adset_id", "hp_ad_id"] as const;
export const CLICK_KEYS = ["fbclid", "gclid", "wbraid", "gbraid"] as const;
export const CONSENT_KEY = "hp_consent_tracking";
export const hasTrackingConsent = (): boolean => { try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; } };

// caracteres removidos: controle, aspas, sinais de maior/menor, crase e barra invertida (sem regex, para não depender de escapes)
const FORBIDDEN = new Set(["<", ">", '"', "'", "`", String.fromCharCode(92)]);
const clean = (v: string, max: number) => [...v].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127 && !FORBIDDEN.has(ch)).join("").trim().slice(0, max);

/** Lê os parâmetros permitidos de uma fonte (URL, sessão…). Sem consentimento, ids de clique nunca saem daqui. */
export function pickTracking(get: (k: string) => string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CAMPAIGN_KEYS) { const v = get(k); if (v) { const c = clean(v, 150); if (c) out[k] = c; } }
  if (hasTrackingConsent()) {
    let any = false;
    for (const k of CLICK_KEYS) { const v = get(k); if (v) { const c = clean(v, 200); if (c) { out[k] = c; any = true; } } }
    if (any) out.hp_consent = "tracking";
  }
  return out;
}
/** Remove ids de clique de um objeto já guardado quando o consentimento não existe (ex.: foi revogado). */
export function stripClickIds(o: Record<string, string>): Record<string, string> {
  if (hasTrackingConsent()) return o;
  const c = { ...o }; for (const k of CLICK_KEYS) delete c[k]; delete c.hp_consent; return c;
}
