// Capturas de tela (evidência visual) do ADM e do Contábil. Uso:
//   HP_QA_PASSWORD=... node e2e/tools/shots-etapa.mjs <baseUrl> <pastaSaida> [usuario-qa]
// Autentica por token no Supabase DEV (mesmo fluxo do supabase-js), mede overflow horizontal e reporta erros de console.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir, who = "qa.manager"] = process.argv.slice(2);
if (!base || !outDir) throw new Error("uso: shots-etapa.mjs <baseUrl> <pastaSaida> [qa.manager|qa.contador|qa.financeiro]");
mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("=")));
const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: `${who}@hp-test.dev`, password: process.env.HP_QA_PASSWORD }),
});
const session = await res.json();
if (!session.access_token) throw new Error(`login de QA falhou (${res.status})`);
const storageKey = `sb-${new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

const M = "m=2026-09-01";
const ROUTES = [
  ["adm-planilha", "/admin/adm/diretorio"],
  ["contabil-visao-geral", `/admin/contabil?${M}`], ["contabil-competencias", `/admin/contabil/competencias?${M}`],
  ["contabil-lancamentos", `/admin/contabil/lancamentos?${M}`], ["contabil-lancamentos-caixa", `/admin/contabil/lancamentos?${M}&basis=caixa`],
  ["contabil-documentos", `/admin/contabil/documentos?${M}`], ["contabil-pendencias", `/admin/contabil/pendencias?${M}`],
  ["contabil-fechamentos", `/admin/contabil/fechamentos?${M}`], ["contabil-exportacoes", `/admin/contabil/exportacoes?${M}`],
  ["contabil-configuracoes", "/admin/contabil/configuracoes"],
];
const SIZES = [["1440", 1440, 900], ["390", 390, 844]];
const browser = await chromium.launch({ channel: "msedge" });
let bad = 0;
for (const [sn, w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "pt-BR" });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(session)]);
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  for (const [name, path] of ROUTES) {
    await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${outDir}/${name}-${sn}.png`, fullPage: false });
    if (overflow > 0) bad++;
    console.log(`${name} @${sn}: overflow horizontal = ${overflow}px`);
  }
  console.log(`erros de console @${sn}: ${errors.length ? JSON.stringify(errors) : "nenhum"}`);
  if (errors.length) bad++;
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
