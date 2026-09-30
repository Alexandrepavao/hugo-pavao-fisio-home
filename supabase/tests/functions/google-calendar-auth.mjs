// Teste de autenticação e de "state" de uso único da Edge Function google-calendar (publicada SEM verify_jwt) contra o DEV.
//   Precisa de segredos FICTÍCIOS temporários no Dev (a função só se comporta assim quando "configurada"); quem roda cadastra e depois remove:
//     supabase secrets set GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake GOOGLE_TOKEN_ENC_KEY=<base64 de 32 bytes> PUBLIC_SITE_URL=http://127.0.0.1:5181 --project-ref <dev>
//   Variáveis deste script: GOOGLE_TOKEN_ENC_KEY (a mesma, para forjar states inválidos), HP_QA_PASSWORD. Nada é impresso além do relatório.
// Nenhum token real do Google é usado: o "code" do callback é falso e o Google o recusa — o que basta para provar que o state foi consumido.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY, PW = process.env.HP_QA_PASSWORD, ENC = process.env.GOOGLE_TOKEN_ENC_KEY;
if (!URL_.includes("fsvtzowcwhvwtluwrhnb")) throw new Error("Recusado: só o Dev.");
if (!PW || !ENC) throw new Error("Defina HP_QA_PASSWORD e GOOGLE_TOKEN_ENC_KEY.");
const FN = `${URL_}/functions/v1/google-calendar`;
const out = []; const chk = (ok, msg) => out.push(`[${ok ? "OK" : "FALHA"}] ${msg}`);
const login = async (e) => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: e, password: PW }) }); const j = await r.json(); if (!j.access_token) throw new Error("login falhou"); return j.access_token; };
const call = (path, { method = "POST", headers = {} } = {}) => fetch(`${FN}/${path}`, { method, headers, redirect: "manual" });
const where = (r) => r.headers.get("location") ?? "";
const b64url = (s) => Buffer.from(s).toString("base64url");
const forge = async (payload) => { // mesma assinatura da função: HMAC-SHA256 com sha256("oauth-state:" + chave)
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("oauth-state:" + ENC)); const k = await crypto.subtle.importKey("raw", d, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = b64url(JSON.stringify(payload)); const sig = Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body))).toString("base64url"); return `${body}.${sig}`;
};

const tok = await login("qa.fisio@hp-test.dev");
const me = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).sub;
const user = { authorization: `Bearer ${tok}`, apikey: KEY }; const anonKey = { authorization: `Bearer ${KEY}`, apikey: KEY };

// ---------- ações do usuário exigem login (a plataforma NÃO valida o JWT desta função; a função valida)
for (const path of ["start", "sync", "disconnect"]) {
  chk((await call(path, { headers: {} })).status === 401, `POST /${path} sem Authorization → 401`);
  chk((await call(path, { headers: anonKey })).status === 401, `POST /${path} só com a chave pública (sem sessão de usuário) → 401`);
  chk((await call(path, { headers: { authorization: "Bearer lixo.lixo.lixo", apikey: KEY } })).status === 401, `POST /${path} com JWT inválido → 401`);
}
chk((await call("sync", { headers: { "x-cron-secret": "segredo-errado" } })).status === 401, "POST /sync com x-cron-secret errado e sem sessão → 401 (sincronização agendada desligada ou segredo incorreto)");
chk((await call("start", { method: "GET", headers: user })).status === 404, "GET /start (método errado) → 404");

// ---------- início do OAuth: só com usuário logado; devolve a URL do Google com o state
const s1 = await call("start", { headers: user }); const j1 = await s1.json();
chk(s1.status === 200 && typeof j1.url === "string" && j1.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"), `POST /start com sessão de usuário → 200 e URL do Google (HTTP ${s1.status})`);
const q1 = new URL(j1.url).searchParams; const state1 = q1.get("state") ?? "";
chk(q1.get("access_type") === "offline" && /calendar\.app\.created/.test(q1.get("scope") ?? "") && !/auth\/calendar(\s|$)/.test(q1.get("scope") ?? ""), "escopos pedidos: calendar.app.created + leitura de eventos (nunca o escopo amplo de calendário)");
const payload1 = JSON.parse(Buffer.from(state1.split(".")[0], "base64url").toString());
chk(payload1.u === me && /^[0-9a-f-]{36}$/.test(payload1.n) && payload1.exp > Date.now(), "o state carrega o usuário, um nonce e a validade");

// ---------- callback: state inválido, forjado, vencido, desconhecido
const cb = (state, extra = "&code=codigo-falso") => call(`callback?state=${encodeURIComponent(state)}${extra}`, { method: "GET" });
chk(where(await cb("lixo")).includes("google=estado"), "callback com state malformado → volta com google=estado");
chk(where(await call("callback", { method: "GET" })).includes("google=estado"), "callback sem state → google=estado");
chk(where(await cb(state1.slice(0, -4) + "AAAA")).includes("google=estado"), "callback com assinatura adulterada → google=estado");
chk(where(await cb(await forge({ u: me, exp: Date.now() + 60_000, n: crypto.randomUUID() }))).includes("google=estado"), "state com assinatura VÁLIDA mas nonce nunca emitido pelo servidor → google=estado");
chk(where(await cb(await forge({ u: me, exp: Date.now() - 1000, n: payload1.n }))).includes("google=estado"), "state vencido → google=estado");
chk(where(await cb(await forge({ u: crypto.randomUUID(), exp: Date.now() + 60_000, n: payload1.n }))).includes("google=estado"), "nonce emitido para OUTRO usuário não serve → google=estado");

// ---------- uso único: o state legítimo vale uma vez
const first = await cb(state1);
chk(!where(first).includes("google=estado"), `1º uso do state legítimo segue para a troca do código (volta com ${where(first).split("?")[1] ?? "?"}) — o Google recusa o código falso, o que é esperado`);
const replay = await cb(state1);
chk(where(replay).includes("google=estado"), "2º uso do MESMO state → google=estado (uso único)");
// um segundo /start gera outro nonce, independente
const s2 = await call("start", { headers: user }); const st2 = new URL((await s2.json()).url).searchParams.get("state");
chk(st2 !== state1, "cada /start emite um state diferente");
chk(!where(await cb(st2)).includes("google=estado"), "o novo state funciona uma vez");

// ---------- a tabela de nonces não é legível pelo navegador
const rd = await fetch(`${URL_}/rest/v1/google_oauth_states?select=nonce`, { headers: user });
chk(rd.status === 401 || rd.status === 403 || (rd.status === 200 && (await rd.clone().json()).length === 0), `tabela google_oauth_states não é legível pela API (HTTP ${rd.status})`);

console.log(out.join("\n")); process.exit(out.some((l) => l.startsWith("[FALHA]")) ? 1 : 0);
