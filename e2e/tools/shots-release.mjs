// Revisão visual da release v1: telas operacionais e portais em 1440 px e 390 px, por papel. Uso:
//   HP_QA_PASSWORD=... node e2e/tools/shots-release.mjs <baseUrl> <pastaSaida>
// Mede overflow horizontal e erros de console em cada tela; sai com código 1 se algum aparecer.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) throw new Error("uso: shots-release.mjs <baseUrl> <pastaSaida>");
mkdirSync(outDir, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("=")));
const key = `sb-${new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const login = async (email) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: process.env.HP_QA_PASSWORD }) });
  const s = await r.json(); if (!s.access_token) throw new Error(`login ${email}: ${r.status}`); return s;
};
const PLAN = [
  ["publico", null, [["login", "/login"], ["quiz", "/avaliacao"]]],
  ["gestor", "qa.manager@hp-test.dev", [["inicio", "/admin"], ["crm-leads", "/admin/crm/leads"], ["crm-funil", "/admin/crm/oportunidades"], ["pessoas", "/admin/pessoas"], ["adm", "/admin/adm/diretorio"], ["agenda", "/admin/agenda"], ["vendas", "/admin/financeiro/vendas"], ["financeiro", "/admin/financeiro"], ["contas-pagar", "/admin/financeiro/pagar"], ["comissoes", "/admin/financeiro/comissoes"], ["equipe", "/admin/equipe"], ["configuracoes", "/admin/configuracoes"], ["captacao", "/admin/captacao-leads"]]],
  ["fisio", "qa.fisio@hp-test.dev", [["agenda", "/admin/agenda"], ["acompanhamento", "/admin/acompanhamento"]]],
  ["paciente", "qa.aluno@hp-test.dev", [["portal", "/paciente"]]],
  ["parceiro", "qa.parceiro@hp-test.dev", [["portal", "/parceiro"]]],
];
const SIZES = [["1440", 1440, 900], ["390", 390, 844]];
const browser = await chromium.launch({ channel: "msedge" }); let bad = 0;
for (const [role, email, routes] of PLAN) {
  const session = email ? await login(email) : null;
  for (const [sn, w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "pt-BR" });
    if (session) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)]);
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    for (const [name, path] of routes) {
      await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {}); await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: `${outDir}/${role}-${name}-${sn}.png` });
      if (overflow > 0) { bad++; console.log(`OVERFLOW ${role}/${name} @${sn}: ${overflow}px`); }
    }
    if (errors.length) { bad++; console.log(`ERROS DE CONSOLE ${role} @${sn}: ${JSON.stringify(errors).slice(0, 400)}`); }
    await ctx.close();
  }
}
await browser.close(); console.log(bad ? `PROBLEMAS: ${bad}` : "sem overflow horizontal e sem erros de console em todas as telas");
process.exit(bad ? 1 : 0);
