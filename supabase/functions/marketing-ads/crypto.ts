// Utilitários de segurança do conector de anúncios (Web Crypto: roda no Deno e no Node). Sem dependências externas.
export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Comparação em tempo constante de segredos (cron, assinaturas). */
export const sameSecret = (a: string, b: string) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function aesKey(keyB64: string) {
  const raw = unb64(keyB64); if (raw.length !== 32) throw new Error("MKT_TOKEN_ENC_KEY deve ter 32 bytes em base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** AES-GCM com IV aleatório: "<iv>.<ciphertext>" em base64. É o ÚNICO formato gravado em mkt_credentials / mkt_oauth_states. */
export async function encrypt(keyB64: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function decrypt(keyB64: string, s: string) {
  const [iv, ct] = s.split("."); if (!iv || !ct) throw new Error("formato inválido");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(keyB64), unb64(ct)));
}

async function hmacKey(keyB64: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode("mkt-oauth-state:" + keyB64));          // chave derivada: separada da usada para criptografar
  return crypto.subtle.importKey("raw", d, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export interface StatePayload { u: string; o: string; p: "meta" | "google"; n: string; exp: number }
/** state assinado (HMAC) — o nonce correspondente fica no banco e só vale uma vez. */
export async function signState(keyB64: string, payload: StatePayload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(keyB64), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}
export async function verifyState(keyB64: string, state: string, now = Date.now()): Promise<StatePayload | null> {
  const [body, sig] = (state ?? "").split("."); if (!body || !sig) return null;
  const pad = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  let ok = false; try { ok = await crypto.subtle.verify("HMAC", await hmacKey(keyB64), unb64(pad(sig)), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let p: Partial<StatePayload>; try { p = JSON.parse(dec.decode(unb64(pad(body)))); } catch { return null; }
  if (typeof p.u !== "string" || typeof p.o !== "string" || typeof p.n !== "string" || (p.p !== "meta" && p.p !== "google") || typeof p.exp !== "number" || p.exp <= now) return null;
  return p as StatePayload;
}

/** PKCE (S256) — usado no fluxo do Google. */
export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
  return { verifier, challenge };
}
/** appsecret_proof da Meta: HMAC-SHA256 do token com o segredo do app (protege chamadas com token vazado). */
export async function appSecretProof(token: string, appSecret: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
