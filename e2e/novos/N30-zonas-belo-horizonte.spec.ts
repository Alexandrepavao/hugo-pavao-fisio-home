// NOVO — N30: Belo Horizonte liberada como capital (9 regionais, bairro digitado). O quiz pede bairro + regional só em BH (Contagem, que não é capital, continua só com a cidade);
// o CRM mostra o painel de BH com o mapa das regionais e a regional de cada contato. Dados próprios (runId), removidos no fim.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };
const REGIONAIS = ["bh-barreiro", "bh-centrosul", "bh-leste", "bh-nordeste", "bh-noroeste", "bh-norte", "bh-oeste", "bh-pampulha", "bh-vendanova"];

test.describe.serial("@novos Regionais: Belo Horizonte", () => {
  test.setTimeout(240_000);
  const nome = `Lead BH N30 ${runId}`; const email = `lead.bh.n30.${runId.toLowerCase()}@example.com`; const phone = `(31) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.interactions where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.crm_tasks where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.quiz_leads where full_name = '${nome}';
      delete from public.opportunities where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.person_contacts where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.person_kinds where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.person_tags where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.people where full_name = '${nome}';`).catch(() => null);
  };
  test.beforeAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("quiz: em BH o bairro é digitado e a regional é escolhida (as 9); Contagem não pergunta; São Paulo e Rio seguem como estavam", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/avaliacao"); await expect(page.getByRole("heading", { name: "Avaliação inicial gratuita" })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Nome completo").fill(nome); await page.getByLabel("E-mail", { exact: true }).fill(email); await page.getByLabel("WhatsApp com DDD").fill(phone);
    await page.getByRole("checkbox").click(); await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Em qual cidade e estado")).toBeVisible();
    await page.getByLabel("Cidade").fill("Contagem"); await page.getByLabel("UF").selectOption("MG"); await expect(page.getByTestId("quiz-sp-zona")).toHaveCount(0);   // não é capital
    await page.getByLabel("Cidade").fill("São Paulo"); await page.getByLabel("UF").selectOption("SP"); await expect(page.getByLabel("Zona de São Paulo")).toBeEnabled();
    await page.getByLabel("Cidade").fill("rio de janeiro"); await page.getByLabel("UF").selectOption("RJ"); await expect(page.locator("#q-neigh")).toHaveJSProperty("tagName", "SELECT");
    // Belo Horizonte
    await page.getByLabel("Cidade").fill("belo horizonte"); await page.getByLabel("UF").selectOption("MG");
    await expect(page.getByTestId("quiz-sp-zona")).toBeVisible(); await expect(page.locator("#q-neigh")).toHaveJSProperty("tagName", "INPUT");
    const regional = page.getByLabel("Regional de Belo Horizonte"); await expect(regional).toBeEnabled();
    await expect(regional.locator("option")).toHaveText(["Escolha…", "Regional Barreiro", "Regional Centro-Sul", "Regional Leste", "Regional Nordeste", "Regional Noroeste", "Regional Norte", "Regional Oeste", "Regional Pampulha", "Regional Venda Nova"]);
    await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText(/bairro|regional/i);
    await page.locator("#q-neigh").fill("Savassi"); await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText("regional de Belo Horizonte");
    await regional.selectOption({ label: "Regional Centro-Sul" }); await shot(page, "quiz-bh-regional");
    await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByText(/dado de saúde/)).toBeVisible({ timeout: 20_000 });
    const [pe] = await devSql(`select city, state_uf, neighborhood, zone from public.people where full_name = '${nome}'`) as { city: string; state_uf: string; neighborhood: string; zone: string }[];
    expect(pe).toMatchObject({ state_uf: "MG", neighborhood: "Savassi", zone: "bh-centrosul" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Distribuição geográfica: clicar em Belo Horizonte desce o painel logo abaixo da linha, com o mapa das 9 regionais e a regional de cada contato", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/contatos"); await expect(page.getByTestId("crm-geo")).toBeVisible({ timeout: 40_000 });
    const linha = page.getByTestId("geo-cidade").filter({ hasText: /Belo Horizonte/i }).first(); await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.getByRole("button").click();
    const painel = page.getByTestId("geo-cidade-painel"); await expect(painel).toBeVisible({ timeout: 30_000 });
    expect(await linha.evaluate((tr) => (tr.nextElementSibling as HTMLElement | null)?.dataset.testid), "painel logo abaixo da linha de BH").toBe("geo-cidade-painel");
    await expect(painel).toContainText("Belo Horizonte/MG");
    const mapa = painel.getByTestId("sp-mapa"); await expect(mapa).toBeVisible({ timeout: 20_000 });
    for (const z of REGIONAIS) await expect(mapa.getByTestId(`sp-mapa-${z}`)).toBeVisible();
    await expect(mapa.getByTestId("sp-mapa-sul")).toHaveCount(0); await expect(mapa.getByTestId("sp-mapa-rj-sul")).toHaveCount(0);   // zonas de outras cidades não aparecem no mapa de BH
    await expect(painel).toContainText("Belo Horizonte"); await expect(painel).toContainText("dados.pbh.gov.br");
    const meu = painel.getByTestId("sp-contato").filter({ hasText: nome }); await expect(meu).toBeVisible({ timeout: 20_000 }); await expect(meu).toContainText("Regional Centro-Sul"); await expect(meu).toContainText("Savassi");
    await shot(page, "crm-bh-mapa");
    await mapa.evaluate((el) => el.scrollIntoView({ block: "center" }));   // o cabeçalho fixo não pode cobrir o mapa durante o clique
    await mapa.getByTestId("sp-mapa-bh-centrosul").dispatchEvent("click"); await expect(mapa.getByTestId("sp-mapa-bh-centrosul")).toHaveAttribute("aria-pressed", "true"); await expect(meu).toBeVisible();
    const textos = await painel.getByTestId("sp-contato").evaluateAll((trs) => trs.map((r) => r.textContent ?? "")); expect(textos.length).toBeGreaterThan(0); expect(textos.every((x) => x.includes("Regional Centro-Sul"))).toBe(true);
    await mapa.getByTestId("sp-mapa-bh-norte").dispatchEvent("click"); await expect(meu).toHaveCount(0);
    await painel.getByRole("button", { name: "fechar" }).click(); await expect(page.getByTestId("geo-cidade-painel")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("busca global: “regional centro-sul” e “fisioterapeuta regional norte” entendem a regional; a regional aparece em “o que foi entendido”", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin"); await page.waitForLoadState("networkidle"); await page.keyboard.press("Control+k"); const dlg = page.getByRole("dialog"); await expect(dlg).toBeVisible();
    const i = page.getByPlaceholder(/Buscar pessoa/); await i.fill(`regional centro-sul savassi ${runId}`);
    const rows = dlg.getByTestId("cmd-pessoa"); await expect(rows).toHaveCount(1, { timeout: 20_000 }); await expect(rows.first()).toContainText(nome); await expect(rows.first()).toContainText("Regional Centro-Sul");
    await expect(dlg.getByTestId("cmd-entendi")).toContainText("Regional Centro-Sul");
    await i.fill(`regional norte ${runId}`); await expect(dlg.getByTestId("cmd-vazio")).toBeVisible({ timeout: 20_000 });   // a pessoa de teste é do Centro-Sul
    await shot(page, "busca-regional"); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px: o mapa de BH no CRM cabe na tela e não gera rolagem horizontal", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto("/admin/crm/contatos"); await expect(p.getByTestId("crm-geo")).toBeVisible({ timeout: 40_000 });
    await p.getByTestId("geo-cidade").filter({ hasText: /Belo Horizonte/i }).first().getByRole("button").click(); await expect(p.getByTestId("geo-cidade-painel").getByTestId("sp-mapa")).toBeVisible({ timeout: 30_000 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); await shot(p, "crm-bh-mobile");
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
