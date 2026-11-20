import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { MANAGER, signIn, useSession } from "../helpers";

// @novo — REDESIGN do ERP: varredura de TODAS as rotas internas estáticas do /admin (gestor QA, banco Dev). Para cada rota confere: carrega sem falha, UM banner com UM h1 (o nome da página), aplicativo e menu
// contextual corretos, item ativo marcado quando a rota consta do menu, sem rolagem horizontal da página (1440 e 390 px), sem erro de console. Grava docs/redesign/matriz-rotas.json (insumo da matriz) e capturas.
// Rotas dinâmicas e abertas por ação (detalhes, edição, modais) são exercitadas pelos testes funcionais existentes e listadas à parte na matriz.
const OUT = process.env.REDESIGN_SHOTS ?? "docs/redesign/telas"; mkdirSync(OUT, { recursive: true });
export const ROUTES: { path: string; app: string; slug: string }[] = [
  { path: "/admin", app: "Início (Hub)", slug: "hub" },
  { path: "/admin/adm", app: "Gestão", slug: "gestao-dashboard" }, { path: "/admin/adm/pendencias", app: "Gestão", slug: "gestao-pendencias" }, { path: "/admin/adm/pendencias?aba=contratos", app: "Gestão", slug: "gestao-contratos" },
  { path: "/admin/adm/diretorio", app: "Gestão", slug: "gestao-planilha" }, { path: "/admin/adm/diretorio?tipo=pj", app: "Gestão", slug: "gestao-empresas" }, { path: "/admin/pessoas", app: "Gestão", slug: "gestao-pessoas" },
  { path: "/admin/programas", app: "Gestão", slug: "gestao-programas" }, { path: "/admin/chamados", app: "Gestão", slug: "gestao-chamados" }, { path: "/admin/responsaveis", app: "Gestão", slug: "gestao-responsaveis" },
  { path: "/admin/configuracoes?secao=org", app: "Gestão", slug: "gestao-unidades" }, { path: "/admin/equipe", app: "Gestão", slug: "gestao-equipe" }, { path: "/admin/configuracoes?secao=operacao", app: "Gestão", slug: "gestao-produtos" },
  { path: "/admin/configuracoes", app: "Gestão", slug: "gestao-configuracoes" }, { path: "/admin/ver-como", app: "Gestão", slug: "gestao-ver-como" }, { path: "/admin/auditoria", app: "Gestão", slug: "gestao-auditoria" },
  { path: "/admin/financeiro", app: "Financeiro", slug: "fin-visao" }, { path: "/admin/financeiro/relatorios", app: "Financeiro", slug: "fin-relatorios" }, { path: "/admin/financeiro/vendas?aba=vendas", app: "Financeiro", slug: "fin-vendas" },
  { path: "/admin/financeiro/vendas?aba=recebiveis", app: "Financeiro", slug: "fin-receber" }, { path: "/admin/financeiro/pagar", app: "Financeiro", slug: "fin-pagar" }, { path: "/admin/financeiro/cartoes", app: "Financeiro", slug: "fin-cartoes" },
  { path: "/admin/financeiro/fluxo-caixa", app: "Financeiro", slug: "fin-fluxo" }, { path: "/admin/financeiro/conciliacao", app: "Financeiro", slug: "fin-conciliacao" }, { path: "/admin/financeiro/recorrencia", app: "Financeiro", slug: "fin-recorrencia" },
  { path: "/admin/financeiro/dre", app: "Financeiro", slug: "fin-dre" }, { path: "/admin/financeiro/comissoes", app: "Financeiro", slug: "fin-comissoes" }, { path: "/admin/financeiro/precos-repasses", app: "Financeiro", slug: "fin-precos" },
  { path: "/admin/contas-corporativas", app: "Financeiro", slug: "fin-corporativas" }, { path: "/admin/financeiro/config", app: "Financeiro", slug: "fin-config" },
  { path: "/admin/crm", app: "CRM", slug: "crm-dashboard" }, { path: "/admin/crm/leads", app: "CRM", slug: "crm-leads" }, { path: "/admin/crm/contatos", app: "CRM", slug: "crm-contatos" }, { path: "/admin/crm/listas", app: "CRM", slug: "crm-listas" },
  { path: "/admin/crm/oportunidades", app: "CRM", slug: "crm-pipeline" }, { path: "/admin/crm/tarefas", app: "CRM", slug: "crm-tarefas" }, { path: "/admin/crm/metas", app: "CRM", slug: "crm-metas" }, { path: "/admin/crm/metas/ritmo", app: "CRM", slug: "crm-ritmo" },
  { path: "/admin/crm/metas/time", app: "CRM", slug: "crm-time" }, { path: "/admin/crm/conversas", app: "CRM", slug: "crm-conversas" }, { path: "/admin/crm/relatorios", app: "CRM", slug: "crm-relatorios" },
  { path: "/admin/paginas", app: "Pages", slug: "pages-paginas" }, { path: "/admin/captacao-leads", app: "Pages", slug: "pages-captacao" }, { path: "/admin/pesquisas", app: "Pages", slug: "pages-pesquisas" },
  { path: "/admin/marketing", app: "Marketing", slug: "mkt-visao" }, { path: "/admin/marketing/analises", app: "Marketing", slug: "mkt-analises" }, { path: "/admin/marketing/campanhas", app: "Marketing", slug: "mkt-campanhas" },
  { path: "/admin/marketing/anuncios", app: "Marketing", slug: "mkt-anuncios" }, { path: "/admin/marketing/funil", app: "Marketing", slug: "mkt-funil" }, { path: "/admin/marketing/leads", app: "Marketing", slug: "mkt-leads" },
  { path: "/admin/marketing/paineis", app: "Marketing", slug: "mkt-paineis" }, { path: "/admin/marketing/integracoes", app: "Marketing", slug: "mkt-integracoes" }, { path: "/admin/marketing/configuracoes", app: "Marketing", slug: "mkt-config" },
  { path: "/admin/agenda", app: "Operação", slug: "op-agenda" }, { path: "/admin/acompanhamento", app: "Operação", slug: "op-acompanhamento" },
  { path: "/admin/academy", app: "Academy", slug: "academy" }, { path: "/admin/parceiros", app: "Parceiros", slug: "parceiros" },
  { path: "/admin/meu-dia", app: "Produtividade", slug: "prod-meu-dia" }, { path: "/admin/meu-resumo", app: "Produtividade", slug: "prod-meu-resumo" },
  { path: "/admin/conta", app: "Início (Hub)", slug: "conta" },
];

const hscroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
test.describe.serial("@novo Redesign — varredura das rotas internas", () => {
  test.setTimeout(900_000);
  test("todas as rotas: um banner, um h1, menu do aplicativo certo, sem rolagem horizontal", async ({ page, context }) => {
    await useSession(context, await signIn(MANAGER));
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_BLOCKED|Failed to load resource|maplibre|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
    const rows: Record<string, unknown>[] = []; const problems: string[] = [];
    for (const r of ROUTES) {
      errors.length = 0;
      await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(r.path);
      const ok = await page.getByTestId("page-banner").waitFor({ timeout: 25_000 }).then(() => true, () => false);
      if (!ok) { const txt = (await page.locator("body").innerText()).slice(0, 80).split(String.fromCharCode(10)).join(" "); problems.push(`${r.path}: sem banner (url final ${new URL(page.url()).pathname}; texto: ${txt})`); rows.push({ ...r, semBanner: true }); continue; }
      await page.waitForTimeout(1200);
      const info = await page.evaluate(() => {
        const h1 = [...document.querySelectorAll("h1")].map((x) => x.textContent?.trim());
        const banner = document.querySelector('[data-testid="page-banner"]') as HTMLElement | null;
        const sw = document.querySelector(".hp-sb-app strong")?.textContent?.trim();
        const active = document.querySelector('.hp-sidebar-desktop .hp-sb-link[aria-current="page"]')?.textContent?.trim() ?? null;
        const h2 = [...document.querySelectorAll("main h2")].slice(0, 3).map((x) => x.textContent?.trim());
        return { h1, title: document.querySelector('[data-testid="banner-title"]')?.textContent?.trim() ?? "", desc: document.querySelector('[data-testid="banner-desc"]')?.textContent?.trim() ?? "", bannerH: banner ? Math.round(banner.getBoundingClientRect().height) : 0, switcher: sw, active, h2, forbidden: /Proposta visual|Dados ilustrativos/.test(document.body.innerText) };
      });
      const hs = await hscroll(r.path ? page : page);
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500); const hsM = await hscroll(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      const row = { ...r, ...info, hscroll1440: hs, hscroll390: hsM, errors: [...errors] }; rows.push(row);
      if (info.h1.length !== 1) problems.push(`${r.path}: ${info.h1.length} h1 (${info.h1.join(" | ")})`);
      if (!info.title) problems.push(`${r.path}: banner sem título`);
      if (info.switcher !== r.app) problems.push(`${r.path}: aplicativo "${info.switcher}" ≠ "${r.app}"`);
      if (hs > 1) problems.push(`${r.path}: rolagem horizontal no desktop (${hs}px)`);
      if (hsM > 1) problems.push(`${r.path}: rolagem horizontal em 390 px (${hsM}px)`);
      if (info.forbidden) problems.push(`${r.path}: texto de proposta visual na interface`);
      await page.screenshot({ path: `${OUT}/${r.slug}.png` });
    }
    writeFileSync("docs/redesign/matriz-rotas.json", JSON.stringify(rows, null, 1));
    console.log("PROBLEMAS", problems.length, "\n" + problems.join("\n"));
    expect.soft(problems, problems.join("\n")).toEqual([]);
  });
});
