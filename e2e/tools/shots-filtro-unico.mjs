// Capturas desta etapa: filtro único em Agenda, Academy, Parceiros, Contas a pagar, Conciliação e Planilha administrativa (popover/gaveta abertos) e o diálogo “Editar cartão” — desktop (1440 px) e celular (390 px).
// Cria um cartão de DEMONSTRAÇÃO no Dev pelas funções do sistema, captura e REMOVE tudo ao final (inclusive se a captura falhar). Confere rolagem lateral e erros de console em cada tela.
// Uso: HP_QA_PASSWORD=... SUPABASE_ACCESS_TOKEN=... node e2e/tools/shots-filtro-unico.mjs <baseUrl> <pastaSaida>
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) throw new Error("uso: shots-filtro-unico.mjs <baseUrl> <pastaSaida>");
mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const URL_ = env.VITE_SUPABASE_URL; const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY; const REF = new globalThis.URL(URL_).hostname.split(".")[0];
if (REF !== "fsvtzowcwhvwtluwrhnb") throw new Error(`recusado: o projeto ${REF} não é o Dev`);
const storageKey = `sb-${REF}-auth-token`;
const login = async (email) => { const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.HP_QA_PASSWORD }) }); const j = await r.json(); if (!j.access_token) throw new Error("login falhou"); return j; };
const sql = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) }); const t = await r.json(); if (!r.ok) throw new Error(JSON.stringify(t)); return t; };
const TAG = "Demonstração filtro";
const cleanup = async () => {
  await sql(`delete from public.card_purchases where card_id in (select id from public.corporate_cards where nickname like '%${TAG}%')`);
  await sql(`delete from public.card_invoices where card_id in (select id from public.corporate_cards where nickname like '%${TAG}%')`);
  await sql(`delete from public.payables where description like '%${TAG}%'`);
  await sql(`delete from public.corporate_cards where nickname like '%${TAG}%'`);
};
const mgr = await login("qa.manager@hp-test.dev");
const rpc = async (fn, body) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${mgr.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${fn}: ${t}`); return t ? JSON.parse(t) : null; };
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
let bad = 0;
try {
  await cleanup();
  const [unit] = await sql(`select id from public.units where slug = 'sao-paulo'`);
  const card = await rpc("card_create", { p_unit: unit.id, p_nickname: `Marketing — ${TAG}`, p_issuer: "Banco Horizonte", p_brand: "visa", p_limit_cents: 800000, p_closing_day: 8, p_due_day: 18, p_last4: "4821", p_holder: null, p_account: null });
  await rpc("card_purchase_create", { p_card: card, p_date: day(-33), p_amount_cents: 34990, p_description: `Licença de software — ${TAG}`, p_merchant: "Loja Soft", p_category: null, p_line: "shared" });
  await rpc("card_purchase_create", { p_card: card, p_date: day(-2), p_amount_cents: 25500, p_description: `Assinatura de ferramenta — ${TAG}`, p_merchant: "Cloud Tools", p_category: null, p_line: "physio" });

  const browser = await chromium.launch({ channel: "msedge" });
  for (const [sn, w, h] of [["1440", 1440, 900], ["390", 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: sn === "390", isMobile: sn === "390" });
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(mgr)]);
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const check = async (name) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) { console.log(`OVERFLOW ${name} @${sn}: ${o}px`); bad++; } };
    const shot = async (name) => { await page.waitForTimeout(900); await check(name); await page.screenshot({ path: `${outDir}/${name}-${sn}.png`, fullPage: false }); };
    const openFilters = async () => { await page.getByRole("button", { name: /^Filtros|^Filtrar/ }).first().click(); await page.waitForTimeout(500); };
    const visit = async (path, name, withPopover = true) => {
      await page.goto(base + path, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
      await shot(name);
      if (withPopover) { await openFilters(); await page.screenshot({ path: `${outDir}/${name}-filtros-${sn}.png` }); await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
    };
    await visit("/admin/agenda", "agenda");
    await visit("/admin/academy", "academy");
    await visit("/admin/parceiros", "parceiros");
    await page.goto(base + "/admin/parceiros", { waitUntil: "networkidle" }); await page.getByRole("tab", { name: "Repasses" }).click(); await shot("parceiros-repasses");
    await visit("/admin/financeiro/pagar", "contas-a-pagar");
    await visit("/admin/financeiro/conciliacao", "conciliacao");
    await visit("/admin/adm/diretorio", "planilha-administrativa");
    await page.goto(base + "/admin/financeiro/cartoes", { waitUntil: "networkidle" }); await page.getByRole("button", { name: /^Cartão Marketing/ }).click(); await shot("cartoes");
    await page.getByRole("button", { name: "Editar cartão" }).click(); await page.waitForTimeout(600);
    await page.locator("#ce-limit").fill("9.000,00"); await page.locator("#ce-close").fill("25"); await page.locator("#ce-due").fill("5"); await page.locator("#ce-reason").fill("Reajuste de limite pelo banco");
    await page.screenshot({ path: `${outDir}/cartoes-editar-${sn}.png` });
    await page.getByRole("button", { name: "Salvar alterações" }).click(); await page.waitForTimeout(1200); await page.screenshot({ path: `${outDir}/cartoes-editado-${sn}.png` });
    if (errors.length) { console.log(`ERROS DE CONSOLE @${sn}:`, [...new Set(errors)].slice(0, 5)); bad++; }
    await ctx.close();
  }
  await browser.close();
} finally { await cleanup(); console.log("dados de demonstração removidos"); }
if (bad) { console.log(`PROBLEMAS: ${bad}`); process.exit(1); }
console.log("sem rolagem horizontal da página e sem erros de console nas telas capturadas");
