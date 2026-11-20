// Cria (ou reaproveita) uma organização de TESTE pelo motor de provisionamento e envia o convite REAL do administrador pelo Resend, só para um endereço de teste autorizado. Só Dev.
//   node supabase/tools/wl-convite-real.mjs --nome "Clínica Épsilon QA" --sub epsilon-qa --email jan.darioush@yahoo.com.br
//   node supabase/tools/wl-convite-real.mjs --conferir <request_id>        (só confere a entrega no provedor e mostra a evidência)
// Usa a conta QA da plataforma (qa.plataforma@hp-test.dev, senha em HP_QA_PASSWORD) e as chaves públicas do .env.local. Nunca imprime senha, token, link nem e-mail completo.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY, PASS = process.env.HP_QA_PASSWORD;
if (!URL_ || !KEY || !PASS) throw new Error("Faltam VITE_SUPABASE_* no .env.local ou HP_QA_PASSWORD no ambiente.");
if (!URL_.includes("fsvtzowcwhvwtluwrhnb")) throw new Error("Recusado: só o banco Dev.");
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const mask = (e) => (e ? e[0] + "***@" + e.split("@")[1] : "");

const login = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: "qa.plataforma@hp-test.dev", password: PASS }) })).json();
if (!login.access_token) throw new Error("login da conta QA da plataforma falhou");
const H = { apikey: KEY, authorization: `Bearer ${login.access_token}`, "content-type": "application/json" };
const rpc = async (fn, body) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

let id = arg("conferir");
if (!id) {
  const nome = arg("nome"), sub = arg("sub"), email = arg("email");
  if (!nome || !sub || !email) throw new Error("Informe --nome, --sub e --email.");
  const answers = {
    company: { name: nome, segment: "fisioterapia", responsible: { name: `Admin ${nome}`, email }, city: "São Paulo", state: "SP", units: [{ name: "Sede" }] },
    operation: { services: ["Fisioterapia ortopédica"], modes: ["in_clinic"], sales_models: ["single", "package"] },
    team: { users_count: 2, roles: [{ role: "physio", count: 1 }, { role: "manager", count: 1 }] },
    customers: { crm: true, capture: true, forms: true, proposals: false, portal: true, import: { needed: false } }, modules: [],
    brand: { app_name: nome, color_primary: "#0f766e", color_accent: "#f59e0b", subdomain: sub }, integrations: [],
    plan: { plan_key: "essencial", implementation: "standard", import_assisted: false, training: false },
  };
  const key = `q-real-${sub}`;
  const d = await rpc("provisioning_draft_save", { p_key: key, p_answers: answers }); if (d.status >= 300) throw new Error("rascunho: " + JSON.stringify(d.body));
  const s = await rpc("provisioning_submit", { p_key: key }); if (s.status >= 300) throw new Error("submit: " + JSON.stringify(s.body));
  id = s.body.id; console.log(`solicitação ${id} · estado ${s.body.status}${s.body.reused ? " (reaproveitada)" : ""}`);
  const inv = await fetch(`${URL_}/functions/v1/provisioning-invite`, { method: "POST", headers: H, body: JSON.stringify({ request_id: id, action: "send" }) });
  const j = await inv.json().catch(() => ({})); console.log(`envio do convite → HTTP ${inv.status} · ${j.status ?? ""} ${j.code ?? ""} ${j.message ?? ""}`.trim());
  await new Promise((r) => setTimeout(r, 2500));   // o hook registra o aceite do Resend de forma síncrona, mas damos um instante
}
const chk = await fetch(`${URL_}/functions/v1/provisioning-invite`, { method: "POST", headers: H, body: JSON.stringify({ request_id: id, action: "check_delivery" }) });
console.log(`conferência de entrega no provedor → HTTP ${chk.status}`, JSON.stringify(await chk.json().catch(() => ({}))));
const ev = await rpc("provisioning_access_evidence", { p_id: id });
console.log("evidência:", JSON.stringify(ev.body, null, 1));
const g = await rpc("provisioning_get", { p_id: id });
if (g.body?.org_slug) console.log(`endereço de acesso: <preview>/empresa/${g.body.org_slug}   (destinatário ${mask(arg("email") ?? "")})`);
