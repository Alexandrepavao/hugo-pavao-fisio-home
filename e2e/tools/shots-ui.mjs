// Capturas da interface dos apps (Hub, Administrativo, CRM, Financeiro) em 1440 px e 390 px, como gestor. Uso:
//   HP_QA_PASSWORD=... node e2e/tools/shots-ui.mjs <baseUrl> <pastaSaida>
// Mede rolagem horizontal da PÁGINA e erros de console; sai com código 1 se algum aparecer.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir, theme] = process.argv.slice(2);   // theme opcional: "dark"
if (!base || !outDir) throw new Error("uso: shots-ui.mjs <baseUrl> <pastaSaida>");
mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const key = `sb-${new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const login = async (email) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.HP_QA_PASSWORD }) });
  const s = await r.json(); if (!s.access_token) throw new Error(`login ${email}: ${r.status}`); return s;
};
const ROUTES = [["hub", "/admin"], ["adm-dashboard", "/admin/adm"], ["adm-pendencias", "/admin/adm/pendencias"], ["crm-dashboard", "/admin/crm"], ["crm-relatorios", "/admin/crm/relatorios"],
  ["financeiro-visao-geral", "/admin/financeiro"], ["financeiro-relatorios", "/admin/financeiro/relatorios"], ["financeiro-dre", "/admin/financeiro/dre"], ["financeiro-recorrencia", "/admin/financeiro/recorrencia"], ["meu-dia", "/admin/meu-dia"]];
const SIZES = [["1440", 1440, 900], ["390", 390, 844]];
const session = await login("qa.manager@hp-test.dev");
const browser = await chromium.launch({ channel: "msedge" }); let bad = 0;
for (const [sn, w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)]);
  if (theme === "dark") await ctx.addInitScript(() => localStorage.setItem("hp-theme", "dark"));
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  for (const [name, path] of ROUTES) {
    await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {}); await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${outDir}/${name}-${sn}.png`, fullPage: true });
    if (overflow > 0) { bad++; console.log(`OVERFLOW ${name} @${sn}: ${overflow}px`); }
  }
  if (errors.length) { bad++; console.log(`ERROS DE CONSOLE @${sn}: ${JSON.stringify(errors).slice(0, 500)}`); }
  await ctx.close();
}
await browser.close(); console.log(bad ? `PROBLEMAS: ${bad}` : "sem rolagem horizontal da página e sem erros de console em todas as telas");
process.exit(bad ? 1 : 0);
