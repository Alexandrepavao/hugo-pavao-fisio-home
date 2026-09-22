// Gera capturas de tela (antes/depois) das mesmas rotas e larguras. Uso:
//   HP_QA_PASSWORD=... node e2e/tools/shots.mjs <baseUrl> <pastaSaida> [perfil]
// Usa o Edge já instalado (sem baixar navegador). Autentica por token (mesmo fluxo do supabase-js) no Supabase DEV.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir, profile = "manager"] = process.argv.slice(2);
if (!base || !outDir) throw new Error("uso: shots.mjs <baseUrl> <pastaSaida> [manager|aluno]");
mkdirSync(outDir, { recursive: true });

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("=")));
const email = profile === "aluno" ? "qa.aluno@hp-test.dev" : "qa.manager@hp-test.dev";
const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email, password: process.env.HP_QA_PASSWORD }),
});
const session = await res.json();
if (!session.access_token) throw new Error(`login de QA falhou (${res.status})`);
const storageKey = `sb-${new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

const ROUTES = profile === "aluno"
  ? [["academy", "/academy"], ["curso", "/academy/curso-qa"], ["paciente", "/paciente"]]
  : [["dashboard", "/admin"], ["crm", "/admin/crm"], ["pessoas", "/admin/pessoas"], ["paginas", "/admin/paginas"], ["agenda", "/admin/agenda"], ["financeiro", "/admin/financeiro"], ["academy-admin", "/admin/academy"], ["equipe", "/admin/equipe"]];
const SIZES = [["1440", 1440, 900], ["1024", 1024, 768], ["768", 768, 1024], ["390", 390, 844]];

const browser = await chromium.launch({ channel: "msedge" });
for (const [sn, w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(session)]);
  const page = await ctx.newPage();
  for (const [name, path] of ROUTES) {
    if (sn !== "1440" && !["dashboard", "crm", "pessoas", "financeiro", "academy", "curso"].includes(name)) continue;
    await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${outDir}/${name}-${sn}.png` });
    console.log(`${name} @${sn}: overflow horizontal do documento = ${overflow}px`);
  }
  await ctx.close();
}
await browser.close();
