// Capturas das telas novas desta etapa: Cartões (lista, compras e faturas), Calendário (mês), e a gaveta de cada aplicativo no celular — desktop (1440 px) e celular (390 px).
// Cria dados de DEMONSTRAÇÃO no Dev pelas próprias funções do sistema (card_create, card_purchase_create…), captura e REMOVE tudo ao final (inclusive se a captura falhar).
// Uso: HP_QA_PASSWORD=... SUPABASE_ACCESS_TOKEN=... node e2e/tools/shots-novas-telas.mjs <baseUrl> <pastaSaida>
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) throw new Error("uso: shots-novas-telas.mjs <baseUrl> <pastaSaida>");
mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const URL_ = env.VITE_SUPABASE_URL; const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY; const REF = new globalThis.URL(URL_).hostname.split(".")[0];
if (REF !== "fsvtzowcwhvwtluwrhnb") throw new Error(`recusado: o projeto ${REF} não é o Dev`);
const storageKey = `sb-${REF}-auth-token`;
const login = async (email) => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.HP_QA_PASSWORD }) }); const s = await r.json(); if (!s.access_token) throw new Error(`login ${email}: ${r.status}`); return s; };
const sql = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) }); const t = await r.json(); if (!r.ok) throw new Error(JSON.stringify(t)); return t; };
const TAG = "Demonstração capturas";
const cleanup = async () => {
  await sql(`delete from public.card_purchases where card_id in (select id from public.corporate_cards where nickname like '%${TAG}%')`);
  await sql(`delete from public.card_invoices where card_id in (select id from public.corporate_cards where nickname like '%${TAG}%')`);
  await sql(`delete from public.payables where description like '%${TAG}%'`);
  await sql(`delete from public.corporate_cards where nickname like '%${TAG}%'`);
  await sql(`delete from public.financial_accounts where name like '%${TAG}%'`);
};

const mgr = await login("qa.manager@hp-test.dev"); const fis = await login("qa.fisio@hp-test.dev");
const rpc = async (s, fn, body) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${s.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${fn}: ${t}`); return t ? JSON.parse(t) : null; };
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
let bad = 0;
try {
  await cleanup();
  const [unit] = await sql(`select id, org_id from public.units where slug = 'sao-paulo'`);
  await sql(`insert into public.financial_accounts (org_id, unit_id, name, kind) values ('${unit.org_id}', '${unit.id}', 'Conta corrente — ${TAG}', 'bank')`);
  const [cat] = await sql(`select id from public.finance_categories where kind = 'expense' and active order by name limit 1`);
  const c1 = await rpc(mgr, "card_create", { p_unit: unit.id, p_nickname: `Marketing — ${TAG}`, p_issuer: "Banco Horizonte", p_brand: "visa", p_limit_cents: 800000, p_closing_day: 8, p_due_day: 18, p_last4: "4821", p_holder: "Equipe de Marketing", p_account: null });
  const c2 = await rpc(mgr, "card_create", { p_unit: unit.id, p_nickname: `Operação — ${TAG}`, p_issuer: "Banco Litoral", p_brand: "mastercard", p_limit_cents: 300000, p_closing_day: 20, p_due_day: 5, p_last4: "7306", p_holder: "Operação das unidades", p_account: null });
  const c3 = await rpc(mgr, "card_create", { p_unit: unit.id, p_nickname: `Academy — ${TAG}`, p_issuer: "Banco Serra", p_brand: "elo", p_limit_cents: 150000, p_closing_day: 15, p_due_day: 25, p_last4: null, p_holder: null, p_account: null });
  const buy = (card, d, cents, desc, merchant, line) => rpc(mgr, "card_purchase_create", { p_card: card, p_date: day(d), p_amount_cents: cents, p_description: `${desc} — ${TAG}`, p_merchant: merchant, p_category: cat?.id ?? null, p_line: line, p_allocations: null, p_note: null });
  await buy(c1, -48, 128000, "Campanha de anúncios", "Plataforma Ads", "physio"); await buy(c1, -33, 34990, "Licença de software", "Loja Soft", "shared");
  await buy(c1, -12, 61200, "Material de eventos", "Gráfica Central", "academy"); await buy(c1, -2, 25500, "Assinatura de ferramenta", "Cloud Tools", "physio"); await buy(c1, 0, 9800, "Impulsionamento de post", "Rede Social", "physio");
  await buy(c2, -30, 74000, "Insumos de atendimento", "Distribuidora Med", "physio"); await buy(c2, -4, 38000, "Manutenção de equipamento", "Assistência Técnica", "physio");
  await buy(c3, -10, 142000, "Plataforma de cursos", "Hospedagem EAD", "academy");
  await rpc(mgr, "card_set_status", { p_card: c2, p_status: "blocked", p_reason: "Aguardando troca do cartão físico" });

  const browser = await chromium.launch({ channel: "msedge" });
  const sizes = [["1440", 1440, 900], ["390", 390, 844]];
  for (const [sn, w, h] of sizes) {
    const mk = async (session) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: sn === "390", isMobile: sn === "390" }); await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(session)]); return ctx; };
    const check = async (page, name) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) { console.log(`OVERFLOW ${name} @${sn}: ${o}px`); bad++; } };
    const shot = async (page, name, full = true) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(900); await check(page, name); await page.screenshot({ path: `${outDir}/${name}-${sn}.png`, fullPage: full }); };
    const errors = []; const ctxM = await mk(mgr); const page = await ctxM.newPage();
    page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${base}/admin/financeiro/cartoes`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /^Cartão Marketing/ }).click(); await shot(page, "cartoes-compras");
    await page.getByRole("tab", { name: "Faturas" }).click(); await shot(page, "cartoes-faturas");
    await page.getByRole("tab", { name: "Compras" }).click(); await page.getByRole("button", { name: "Registrar compra" }).first().click(); await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/cartoes-nova-compra-${sn}.png` });
    await page.keyboard.press("Escape");
    await page.goto(`${base}/admin/financeiro/cartoes`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: "Novo cartão" }).first().click(); await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/cartoes-novo-cartao-${sn}.png` });
    await page.keyboard.press("Escape");
    if (sn === "390") for (const [name, path] of [["hub", "/admin"], ["financeiro", "/admin/financeiro"], ["crm", "/admin/crm"]]) {
      await page.goto(base + path, { waitUntil: "networkidle" }); await page.getByRole("button", { name: "Abrir menu" }).click(); await page.waitForTimeout(700); await page.screenshot({ path: `${outDir}/gaveta-${name}-${sn}.png` }); await page.keyboard.press("Escape");
    }
    await ctxM.close();
    const ctxF = await mk(fis); const pf = await ctxF.newPage();
    pf.on("pageerror", (e) => errors.push(e.message)); pf.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await pf.goto(`${base}/admin/meu-dia`, { waitUntil: "networkidle" }); await pf.getByRole("group", { name: "Visualização" }).getByRole("button", { name: "Mês" }).click(); await shot(pf, "calendario-mes");
    await pf.getByRole("group", { name: "Visualização" }).getByRole("button", { name: "Semana" }).click(); await shot(pf, "calendario-semana");
    await ctxF.close();
    if (errors.length) { console.log(`ERROS DE CONSOLE @${sn}:`, [...new Set(errors)].slice(0, 5)); bad++; }
  }
  await browser.close();
} finally { await cleanup(); console.log("dados de demonstração removidos"); }
if (bad) { console.log(`PROBLEMAS: ${bad}`); process.exit(1); }
console.log("sem rolagem horizontal da página e sem erros de console nas telas novas");
