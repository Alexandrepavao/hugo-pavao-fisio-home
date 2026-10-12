// Dados de BASE do banco DEV (nunca produção): o suficiente para testar o preview à mão e para os E2E que comparam o que cada papel enxerga.
//   HP_QA_PASSWORD=... node supabase/tools/seed-dev.mjs           (ou: npm run seed:dev)
// Tudo é marcado "(exemplo)" ou "Exemplo …", usa e-mails @example.com (nada é enviado) e é reexecutável: só cria o que falta.
// Cria: profissional (conta QA de fisioterapeuta) com agenda semanal, 1 serviço, 1 pacote, 8 pacientes, 1 venda de pacote já paga (com recebimento),
// 1 conta a pagar e 1 oportunidade no funil de pacientes. Usa as funções do próprio sistema, como um gestor faria.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const URL_ = env.VITE_SUPABASE_URL; const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY; const DEV = "fsvtzowcwhvwtluwrhnb";
if (!URL_?.includes(DEV)) throw new Error("Recusado: o .env.local não aponta para o banco Dev. Este script nunca roda contra outro banco.");
const PASSWORD = process.env.HP_QA_PASSWORD; if (!PASSWORD) throw new Error("Defina HP_QA_PASSWORD (variável do usuário do Windows).");

const login = async (email) => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) }); const j = await r.json(); if (!j.access_token) throw new Error(`login de ${email} falhou`); return j; };
const mgr = await login("qa.manager@hp-test.dev"); const fis = await login("qa.fisio@hp-test.dev");
const H = { apikey: KEY, authorization: `Bearer ${mgr.access_token}`, "content-type": "application/json", prefer: "return=representation" };
const get = async (p) => (await (await fetch(`${URL_}/rest/v1/${p}`, { headers: H })).json());
const post = async (t, b) => { const r = await fetch(`${URL_}/rest/v1/${t}`, { method: "POST", headers: H, body: JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(`${t}: ${JSON.stringify(j)}`); return j[0]; };
const rpc = async (fn, b) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(b) }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`${fn}: ${JSON.stringify(j)}`); return j; };
const log = (m) => console.log(m);

const org = (await get("organizations?select=id&slug=eq.hp-group"))[0].id; const unit = (await get("units?select=id&slug=eq.sao-paulo"))[0].id;
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

// 1) profissional (conta QA de fisioterapeuta) com agenda semanal
let prof = (await get(`professionals?select=id&user_id=eq.${fis.user.id}`))[0];
if (!prof) { prof = await post("professionals", { org_id: org, display_name: "Fisioterapeuta QA (exemplo)", council_registration: "CREFITO-SP 000000-F (exemplo)", active: true, user_id: fis.user.id }); await post("professional_units", { professional_id: prof.id, unit_id: unit }); log("+ profissional"); }
if ((await get(`availability_rules?select=id&professional_id=eq.${prof.id}&limit=1`)).length === 0) { for (let d = 1; d <= 6; d++) await post("availability_rules", { org_id: org, professional_id: prof.id, unit_id: unit, weekday: d, start_time: "08:00", end_time: "18:00" }); log("+ agenda semanal (seg a sáb, 8h–18h)"); }

// 2) serviço e pacote
let svc = (await get("services?select=id&name=eq.Sessão de fisioterapia (exemplo)"))[0];
if (!svc) { svc = await post("services", { org_id: org, name: "Sessão de fisioterapia (exemplo)", duration_min: 60, price_cents: 15000, active: true }); log("+ serviço"); }
let pkg = (await get("products?select=id&name=eq.Pacote 10 sessões (exemplo)"))[0];
if (!pkg) { pkg = await post("products", { org_id: org, kind: "package", name: "Pacote 10 sessões (exemplo)", price_cents: 120000, sessions_count: 10, validity_days: 90, consume_on_no_show: true, late_cancel_hours: 24, service_id: svc.id, active: true, access_rule: "on_first_payment" }); log("+ pacote"); }

// 3) pacientes de exemplo
const existentes = (await get("people?select=id,full_name&full_name=ilike.Exemplo Paciente*")); const porNome = new Map(existentes.map((p) => [p.full_name, p.id]));
for (let i = 1; i <= 8; i++) {
  const nome = `Exemplo Paciente ${String(i).padStart(2, "0")}`; if (porNome.has(nome)) continue;
  const r = await rpc("create_person", { p_full_name: nome, p_unit_id: unit, p_kinds: ["patient"], p_email: `exemplo.paciente${String(i).padStart(2, "0")}@example.com`, p_phone: null, p_notes: "Dado de exemplo (seed do Dev)", p_force: true });
  porNome.set(nome, r.id); log(`+ ${nome}`);
}
const p1 = porNome.get("Exemplo Paciente 01"); const p2 = porNome.get("Exemplo Paciente 02");

// 4) venda do pacote, já paga (gera recebível e recebimento)
if ((await get(`sales?select=id&person_id=eq.${p1}&limit=1`)).length === 0) {
  const sale = await rpc("sale_create", { p_person: p1, p_unit: unit, p_opportunity: null, p_items: [{ product_id: pkg.id, qty: 1 }], p_discount_cents: 0, p_installments: 1, p_first_due: hoje });
  await rpc("sale_confirm", { p_sale: sale });
  const rec = (await get(`receivables?select=id,amount_cents&sale_id=eq.${sale}`))[0];
  await rpc("payment_record", { p_receivable: rec.id, p_amount_cents: rec.amount_cents, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `seed-dev-${p1}` });
  log("+ venda do pacote com recebimento");
}

// 5) conta a pagar
if ((await get("payables?select=id&description=eq.Aluguel do consultório (exemplo)&limit=1")).length === 0) {
  const cat = (await get("finance_categories?select=id&kind=eq.expense&limit=1"))[0];
  await post("payables", { org_id: org, unit_id: unit, category_id: cat?.id ?? null, description: "Aluguel do consultório (exemplo)", amount_cents: 250000, due_date: hoje, competence_month: hoje.slice(0, 8) + "01", status: "open", created_by: mgr.user.id });
  log("+ conta a pagar");
}

// 6) oportunidade no funil de pacientes
const pipe = (await get("pipelines?select=id&kind=eq.patients&active=eq.true"))[0];
if (pipe && p2 && (await get(`opportunities?select=id&person_id=eq.${p2}&limit=1`)).length === 0) {
  await rpc("crm_create_opportunity", { p_person_id: p2, p_pipeline_id: pipe.id, p_unit_id: unit, p_title: "Avaliação (exemplo)", p_product_id: null, p_value_cents: 15000, p_owner: null, p_source: "seed-dev", p_campaign: null, p_legal_entity_id: null });
  log("+ oportunidade");
}

const contagem = async (t) => (await get(`${t}?select=id`)).length;
log(`\nBase do Dev: pessoas=${await contagem("people")} · pagamentos=${await contagem("payments")} · contas a pagar=${await contagem("payables")} · oportunidades=${await contagem("opportunities")} · serviços=${await contagem("services")} · pacotes=${(await get("products?select=id&kind=eq.package")).length}`);
