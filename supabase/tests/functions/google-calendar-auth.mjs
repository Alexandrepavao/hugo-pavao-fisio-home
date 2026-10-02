// Teste de autenticação e de "state" de uso único da Edge Function google-calendar (publicada SEM verify_jwt) contra o DEV, já com as credenciais REAIS configuradas.
//   Variáveis: HP_QA_PASSWORD. Opcional: GOOGLE_TOKEN_ENC_KEY — só serve para forjar states com assinatura válida; o segredo real do Dev nunca é lido, então sem ela esses
//   casos são PULADOS (os demais — sem sessão, assinatura adulterada, state repetido — não dependem da chave). Nada é impresso além do relatório.
// Nenhum token real do Google é usado: o "code" do callback é falso e o Google o recusa — o que basta para provar que o state foi consumido.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY, PW = process.env.HP_QA_PASSWORD, ENC = process.env.GOOGLE_TOKEN_ENC_KEY;
if (!URL_.includes("fsvtzowcwhvwtluwrhnb")) throw new Error("Recusado: só o Dev.");
if (!PW) throw new Error("Defina HP_QA_PASSWORD.");
const FN = `${URL_}/functions/v1/google-calendar`;
const out = []; const chk = (ok, msg) => out.push(`[${ok ? "OK" : "FALHA"}] ${msg}`);
const login = async (e) => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: e, password: PW }) }); const j = await r.json(); if (!j.access_token) throw new Error("login falhou"); return j.access_token; };
const call = (path, { method = "POST", headers = {} } = {}) => fetch(`${FN}/${path}`, { method, headers, redirect: "manual" });
const where = (r) => r.headers.get("location") ?? "";
const b64url = (s) => Buffer.from(s).toString("base64url");
const skip = (msg) => out.push(`[PULADO] ${msg} (precisa de GOOGLE_TOKEN_ENC_KEY no ambiente do teste)`);
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
const scopes = (q1.get("scope") ?? "").split(" ").sort();
chk(JSON.stringify(scopes) === JSON.stringify(["email", "https://www.googleapis.com/auth/calendar.app.created", "https://www.googleapis.com/auth/calendar.events.readonly", "openid"].sort()), `escopos pedidos exatamente: ${scopes.map((x) => x.replace("https://www.googleapis.com/auth/", "")).join(", ")}`);
chk(q1.get("redirect_uri") === `${URL_}/functions/v1/google-calendar/callback` && /\.apps\.googleusercontent\.com$/.test(q1.get("client_id") ?? ""), "redirect_uri = callback da função no Dev e client_id de um cliente OAuth Web do Google");
// o Google aceita o cliente e o callback? (um erro de configuração vira página 400 com redirect_uri_mismatch / invalid_client / access_blocked)
const gr = await fetch(j1.url, { redirect: "manual" }); const gtxt = gr.status < 300 || gr.status >= 400 ? await gr.text() : "";
chk(gr.status !== 400 && !/redirect_uri_mismatch|invalid_client|access_blocked|deleted_client|invalid_request/i.test(gtxt), `o Google aceita o cliente e o callback: abre a escolha de conta (HTTP ${gr.status}${gr.headers.get("location") ? " → " + new URL(gr.headers.get("location")).hostname : ""})`);
const payload1 = JSON.parse(Buffer.from(state1.split(".")[0], "base64url").toString());
chk(payload1.u === me && /^[0-9a-f-]{36}$/.test(payload1.n) && payload1.exp > Date.now(), "o state carrega o usuário, um nonce e a validade");

// ---------- callback: state inválido, forjado, vencido, desconhecido
const cb = (state, extra = "&code=codigo-falso") => call(`callback?state=${encodeURIComponent(state)}${extra}`, { method: "GET" });
chk(where(await cb("lixo")).includes("google=estado"), "callback com state malformado → volta com google=estado");
chk(where(await call("callback", { method: "GET" })).includes("google=estado"), "callback sem state → google=estado");
chk(where(await cb(state1.slice(0, -4) + "AAAA")).includes("google=estado"), "callback com assinatura adulterada → google=estado");
if (ENC) {
  chk(where(await cb(await forge({ u: me, exp: Date.now() + 60_000, n: crypto.randomUUID() }))).includes("google=estado"), "state com assinatura VÁLIDA mas nonce nunca emitido pelo servidor → google=estado");
  chk(where(await cb(await forge({ u: me, exp: Date.now() - 1000, n: payload1.n }))).includes("google=estado"), "state vencido → google=estado");
  chk(where(await cb(await forge({ u: crypto.randomUUID(), exp: Date.now() + 60_000, n: payload1.n }))).includes("google=estado"), "nonce emitido para OUTRO usuário não serve → google=estado");
} else skip("state forjado com assinatura válida / vencido / de outro usuário");

// ---------- uso único: o state legítimo vale uma vez
const first = await cb(state1);
chk(where(first).startsWith("https://release-v1--hp-group-hub.netlify.app/admin/meu-dia") || where(first).includes("/admin/meu-dia"), `o retorno vai para a URL do app configurada para o calendário (${new URL(where(first)).origin})`);
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
