// NOVO — N24: zonas de São Paulo capital — quiz pergunta bairro e zona só em São Paulo/SP; cadastro de onboarding exige a zona; o CRM mostra a distribuição por zona.
// Dados próprios (runId), removidos no fim.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`), fullPage: true }); };

test.describe.serial("@novos Zonas de São Paulo", () => {
  test.setTimeout(240_000);
  const nome = `Lead Zona N24 ${runId}`; const email = `lead.zona.n24.${runId.toLowerCase()}@example.com`; const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
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
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("quiz: bairro e zona só aparecem em São Paulo/SP, são obrigatórios e vão para o cadastro", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/avaliacao"); await expect(page.getByRole("heading", { name: "Avaliação inicial gratuita" })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Nome completo").fill(nome); await page.getByLabel("E-mail", { exact: true }).fill(email); await page.getByLabel("WhatsApp com DDD").fill(phone);
    await page.getByRole("checkbox").click(); await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Em qual cidade e estado")).toBeVisible();
    // fora da capital: nada de bairro/zona
    await page.getByLabel("Cidade").fill("Campinas"); await page.getByLabel("UF").selectOption("SP");
    await expect(page.getByTestId("quiz-sp-zona")).toHaveCount(0);
    // São Paulo (qualquer grafia): aparecem e são obrigatórios
    await page.getByLabel("Cidade").fill("sao paulo");
    await expect(page.getByTestId("quiz-sp-zona")).toBeVisible();
    await expect(page.getByLabel("Zona de São Paulo").locator("option")).toHaveText(["Escolha…", "Zona Sul", "Zona Norte", "Zona Leste", "Zona Oeste", "Centro"]);
    await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText("bairro");
    await page.getByLabel("Bairro").fill("Tatuapé"); await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText("zona");
    await shot(page, "quiz-bairro-zona");
    await page.getByLabel("Zona de São Paulo").selectOption("leste"); await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText(/dado de saúde/)).toBeVisible({ timeout: 20_000 });
    const [lead] = await devSql(`select city, state_uf, neighborhood, zone from public.quiz_leads where full_name = '${nome}'`) as { city: string; state_uf: string; neighborhood: string; zone: string }[];
    expect(lead).toMatchObject({ state_uf: "SP", neighborhood: "Tatuapé", zone: "leste" });
    const [pe] = await devSql(`select neighborhood, zone from public.people where full_name = '${nome}'`) as { neighborhood: string; zone: string }[];
    expect(pe).toMatchObject({ neighborhood: "Tatuapé", zone: "leste" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM: bloco “Zonas de São Paulo” conta o lead na zona leste e lista o contato com o bairro", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/contatos"); await expect(page.getByTestId("crm-zonas")).toBeVisible({ timeout: 40_000 });
    const leste = page.getByTestId("crm-zona-leste"); await expect(leste).toBeVisible();
    await expect(leste.locator("p").nth(1)).not.toHaveText("0"); await expect(page.getByTestId("crm-zona-none")).toContainText("cadastros anteriores");
    await leste.click(); const lista = page.getByTestId("crm-zona-contatos"); await expect(lista).toContainText(nome, { timeout: 20_000 }); await expect(lista).toContainText("Tatuapé");
    await shot(page, "crm-zonas");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Distribuição geográfica: clicar em São Paulo desce um painel logo abaixo da linha, com o mapa das zonas e a zona que cada contato cadastrou", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/contatos"); await expect(page.getByTestId("crm-geo")).toBeVisible({ timeout: 40_000 });
    const linha = page.getByTestId("geo-cidade").filter({ hasText: "São Paulo" }).first(); await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.getByRole("button", { name: "São Paulo" }).click();
    // o painel é a linha seguinte da mesma tabela (abaixo da cidade clicada), não um bloco depois da tabela inteira
    const painel = page.getByTestId("geo-cidade-painel"); await expect(painel).toBeVisible({ timeout: 30_000 });
    expect(await linha.evaluate((tr) => (tr.nextElementSibling as HTMLElement | null)?.dataset.testid), "painel logo abaixo da linha de São Paulo").toBe("geo-cidade-painel");
    const lb = await linha.boundingBox(); const pb = await painel.boundingBox(); expect(pb && lb && pb.y >= lb.y + lb.height - 1).toBe(true);
    // mapa de São Paulo com as 5 zonas
    const mapa = painel.getByTestId("sp-mapa"); await expect(mapa).toBeVisible(); for (const z of ["sul", "norte", "leste", "oeste", "centro"]) await expect(mapa.getByTestId(`sp-mapa-${z}`)).toBeVisible();
    const box = await mapa.boundingBox(); expect(box && box.height > 150 && box.width > 150, "mapa com tamanho útil").toBe(true);
    // a lista mostra a zona de cada contato; o lead do teste cadastrou Zona Leste e Tatuapé
    const meu = painel.getByTestId("sp-contato").filter({ hasText: nome }); await expect(meu).toBeVisible({ timeout: 20_000 }); await expect(meu).toContainText("Zona Leste"); await expect(meu).toContainText("Tatuapé");
    await shot(page, "crm-sao-paulo-mapa");
    // clicar numa zona do mapa filtra a lista
    const total = await painel.getByTestId("sp-contato").count();
    await mapa.getByTestId("sp-mapa-leste").click(); await expect(mapa.getByTestId("sp-mapa-leste")).toHaveAttribute("aria-pressed", "true");
    await expect(meu).toBeVisible(); const zonas = await painel.getByTestId("sp-contato").evaluateAll((trs) => trs.map((r) => r.textContent ?? "")); expect(zonas.length).toBeGreaterThan(0); expect(zonas.every((z) => z.includes("Zona Leste"))).toBe(true);
    await painel.getByTestId("sp-filtro-none").click(); const sem = await painel.getByTestId("sp-contato").evaluateAll((trs) => trs.map((r) => r.textContent ?? "")); expect(sem.every((z) => z.includes("Não informada"))).toBe(true); await expect(meu).toHaveCount(0);
    await painel.getByTestId("sp-filtro-todas").click(); await expect(painel.getByTestId("sp-contato")).toHaveCount(total);
    // clicar no nome abre o formulário; fechar recolhe o painel
    await meu.getByRole("button", { name: new RegExp(nome) }).click(); await expect(page.getByTestId("geo-contato-detalhe")).toContainText(nome); await page.keyboard.press("Escape");
    await painel.getByRole("button", { name: "fechar" }).click(); await expect(page.getByTestId("geo-cidade-painel")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("onboarding do paciente: em São Paulo/SP pede a zona; em outra cidade não", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/onboarding-paciente"); await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: 40_000 });
    await page.locator("#ob-name").fill("Paciente Zona Teste N24"); await page.locator("#ob-pref").fill("Paciente"); await page.locator("#ob-birth").fill("1950-03-02"); await page.locator("#ob-cpf").fill("111.444.777-35");
    await page.getByRole("button", { name: /^Continuar/ }).click(); await expect(page.getByTestId("onboarding-etapa")).toContainText("Etapa 2 de 4");
    const cidade = page.locator("#ob-city");
    await page.locator("#ob-neigh").fill("Bela Vista"); await page.locator("#ob-street").fill("Avenida Teste"); await page.locator("#ob-number").fill("1"); await page.locator("#ob-cep").fill("01310-100");
    await cidade.fill("São Paulo"); await page.locator("#ob-uf").selectOption("SP"); await expect(page.locator("#ob-zone")).toBeVisible();
    await cidade.fill("Santo André"); await expect(page.locator("#ob-zone")).toHaveCount(0);
    await cidade.fill("São Paulo"); await page.getByRole("button", { name: /^Continuar/ }).click(); await expect(page.getByText("Escolha a zona de São Paulo.")).toBeVisible();
    await page.locator("#ob-zone").selectOption("sul"); await page.getByRole("button", { name: /^Continuar/ }).click(); await expect(page.getByText("Escolha a zona de São Paulo.")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
