// NOVO — N28: zonas e bairros nas capitais — Rio de Janeiro liberado (além de São Paulo). O quiz e o cadastro do paciente pedem o bairro ESCOLHIDO de uma lista (a zona vem junto) só em capital liberada;
// Niterói (não é capital) continua só com a cidade; o CRM mostra o painel do Rio com mapa e a zona de cada contato. Dados próprios (runId), removidos no fim.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };

test.describe.serial("@novos Zonas e bairros: Rio de Janeiro", () => {
  test.setTimeout(240_000);
  const nome = `Lead Rio N28 ${runId}`; const email = `lead.rio.n28.${runId.toLowerCase()}@example.com`; const phone = `(21) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
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

  test("quiz: no Rio o bairro é escolhido da lista e a zona vem junto; “Outro bairro” abre campo livre; Niterói não pergunta; São Paulo segue com bairro digitado", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/avaliacao"); await expect(page.getByRole("heading", { name: "Avaliação inicial gratuita" })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Nome completo").fill(nome); await page.getByLabel("E-mail", { exact: true }).fill(email); await page.getByLabel("WhatsApp com DDD").fill(phone);
    await page.getByRole("checkbox").click(); await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Em qual cidade e estado")).toBeVisible();
    // Niterói não é capital: nada de bairro/zona
    await page.getByLabel("Cidade").fill("Niterói"); await page.getByLabel("UF").selectOption("RJ"); await expect(page.getByTestId("quiz-sp-zona")).toHaveCount(0);
    // São Paulo: bairro digitado e zona escolhida (como sempre foi)
    await page.getByLabel("Cidade").fill("São Paulo"); await page.getByLabel("UF").selectOption("SP"); await expect(page.getByTestId("quiz-sp-zona")).toBeVisible();
    await expect(page.locator("#q-neigh")).toHaveJSProperty("tagName", "INPUT"); await expect(page.getByLabel("Zona de São Paulo")).toBeEnabled();
    // Rio de Janeiro: lista de bairros
    await page.getByLabel("Cidade").fill("rio de janeiro"); await page.getByLabel("UF").selectOption("RJ");
    const zona = page.getByTestId("quiz-sp-zona"); await expect(zona).toBeVisible(); const bairro = page.locator("#q-neigh");
    await expect(bairro).toHaveJSProperty("tagName", "SELECT"); await expect(bairro.locator("option")).not.toHaveCount(2, { timeout: 20_000 });   // lista carregada
    expect(await bairro.locator("option").count()).toBeGreaterThan(160);
    const zonaSel = page.getByLabel("Zona do Rio de Janeiro"); await expect(zonaSel).toBeDisabled(); await expect(zonaSel.locator("option")).toHaveText(["Preenchida pelo bairro", "Zona Sul", "Zona Norte", "Zona Oeste", "Centro"]);
    await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText("bairro");
    await bairro.selectOption({ label: "Copacabana" }); await expect(zonaSel).toHaveValue("rj-sul"); await expect(zonaSel).toBeDisabled();
    await bairro.selectOption({ label: "Barra da Tijuca" }); await expect(zonaSel).toHaveValue("rj-oeste");
    await bairro.selectOption({ label: "Tijuca" }); await expect(zonaSel).toHaveValue("rj-norte");
    // “Outro bairro”: campo livre + zona escolhida na lista
    await bairro.selectOption({ label: "Outro bairro (não está na lista)" }); await expect(page.locator("#q-neigh-outro")).toBeVisible(); await expect(zonaSel).toBeEnabled();
    await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText(/bairro|zona/i);
    await page.locator("#q-neigh-outro").fill("Bairro Fora da Lista"); await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByRole("alert")).toContainText("zona do Rio de Janeiro");
    await shot(page, "quiz-rio-outro-bairro");
    // volta para a lista e escolhe Copacabana
    await bairro.selectOption({ label: "Copacabana" }); await expect(page.locator("#q-neigh-outro")).toHaveCount(0); await expect(zonaSel).toHaveValue("rj-sul");
    await shot(page, "quiz-rio-bairro-zona");
    await page.getByRole("button", { name: "Continuar" }).click(); await expect(page.getByText(/dado de saúde/)).toBeVisible({ timeout: 20_000 });
    const [lead] = await devSql(`select city, state_uf, neighborhood, zone from public.quiz_leads where full_name = '${nome}'`) as { city: string; state_uf: string; neighborhood: string; zone: string }[];
    expect(lead).toMatchObject({ state_uf: "RJ", neighborhood: "Copacabana", zone: "rj-sul" });
    const [pe] = await devSql(`select neighborhood, zone from public.people where full_name = '${nome}'`) as { neighborhood: string; zone: string }[];
    expect(pe).toMatchObject({ neighborhood: "Copacabana", zone: "rj-sul" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Distribuição geográfica: clicar em Rio de Janeiro desce o painel logo abaixo da linha, com o mapa do Rio, a zona e o bairro de cada contato", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/contatos"); await expect(page.getByTestId("crm-geo")).toBeVisible({ timeout: 40_000 });
    const linha = page.getByTestId("geo-cidade").filter({ hasText: "Rio De Janeiro" }).or(page.getByTestId("geo-cidade").filter({ hasText: "Rio de Janeiro" })).first(); await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.getByRole("button").click();
    const painel = page.getByTestId("geo-cidade-painel"); await expect(painel).toBeVisible({ timeout: 30_000 });
    expect(await linha.evaluate((tr) => (tr.nextElementSibling as HTMLElement | null)?.dataset.testid), "painel logo abaixo da linha do Rio").toBe("geo-cidade-painel");
    await expect(painel).toContainText("Rio de Janeiro/RJ");
    const mapa = painel.getByTestId("sp-mapa"); await expect(mapa).toBeVisible({ timeout: 20_000 }); for (const z of ["rj-sul", "rj-norte", "rj-oeste", "rj-centro"]) await expect(mapa.getByTestId(`sp-mapa-${z}`)).toBeVisible();
    await expect(mapa.getByTestId("sp-mapa-sul")).toHaveCount(0);   // zonas de São Paulo não aparecem no mapa do Rio
    await expect(painel).toContainText("Data.Rio");
    const meu = painel.getByTestId("sp-contato").filter({ hasText: nome }); await expect(meu).toBeVisible({ timeout: 20_000 }); await expect(meu).toContainText("Zona Sul"); await expect(meu).toContainText("Copacabana");
    await shot(page, "crm-rio-mapa");
    await mapa.evaluate((el) => el.scrollIntoView({ block: "center" }));   // o cabeçalho fixo não pode cobrir o mapa durante o clique
    await mapa.getByTestId("sp-mapa-rj-sul").dispatchEvent("click"); await expect(mapa.getByTestId("sp-mapa-rj-sul")).toHaveAttribute("aria-pressed", "true"); await expect(meu).toBeVisible();
    const textos = await painel.getByTestId("sp-contato").evaluateAll((trs) => trs.map((r) => r.textContent ?? "")); expect(textos.length).toBeGreaterThan(0); expect(textos.every((x) => x.includes("Zona Sul"))).toBe(true);
    await mapa.getByTestId("sp-mapa-rj-norte").dispatchEvent("click"); await expect(meu).toHaveCount(0);
    await painel.getByRole("button", { name: "fechar" }).click(); await expect(page.getByTestId("geo-cidade-painel")).toHaveCount(0);
    // São Paulo continua com o próprio mapa
    await page.getByTestId("geo-cidade").filter({ hasText: "São Paulo" }).first().getByRole("button").click(); const sp = page.getByTestId("geo-cidade-painel"); await expect(sp.getByTestId("sp-mapa-sul")).toBeVisible({ timeout: 20_000 }); await expect(sp.getByTestId("sp-mapa-rj-sul")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("onboarding do paciente: no Rio escolhe o bairro e a zona vem junto; em Niterói só o bairro digitado", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/onboarding-paciente"); await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: 40_000 });
    await page.locator("#ob-name").fill("Paciente Rio Teste N28"); await page.locator("#ob-pref").fill("Paciente"); await page.locator("#ob-birth").fill("1950-03-02"); await page.locator("#ob-cpf").fill("111.444.777-35");
    await page.getByRole("button", { name: /^Continuar/ }).click(); await expect(page.getByTestId("onboarding-etapa")).toContainText("Etapa 2 de 4");
    // CEP sem endereço no serviço externo (assíncrono): não preenche nada, e a espera garante que nenhuma resposta tardia sobrescreva cidade/bairro durante o teste
    await page.locator("#ob-cep").fill("00000-000"); await page.locator("#ob-street").click(); await expect(page.getByText("Buscando endereço…")).toHaveCount(0, { timeout: 20_000 }); await page.waitForTimeout(500);
    await page.locator("#ob-street").fill("Avenida Teste"); await page.locator("#ob-number").fill("1");
    await page.locator("#ob-city").fill("Niterói"); await page.locator("#ob-uf").selectOption("RJ"); await expect(page.locator("#ob-neigh")).toHaveJSProperty("tagName", "INPUT"); await expect(page.locator("#ob-zone")).toHaveCount(0);
    await page.locator("#ob-city").fill("Rio de Janeiro"); await expect(page.locator("#ob-neigh")).toHaveJSProperty("tagName", "SELECT"); await expect(page.locator("#ob-zone")).toBeDisabled();
    await expect(page.locator("#ob-neigh option")).not.toHaveCount(2, { timeout: 20_000 });
    await page.getByRole("button", { name: /^Continuar/ }).click(); await expect(page.getByText("Informe o bairro.")).toBeVisible();
    await page.locator("#ob-neigh").selectOption({ label: "Botafogo" }); await expect(page.locator("#ob-zone")).toHaveValue("rj-sul");
    await page.locator("#ob-neigh").selectOption({ label: "Santa Cruz" }); await expect(page.locator("#ob-zone")).toHaveValue("rj-oeste");
    await page.locator("#ob-neigh").selectOption({ label: "Madureira" }); await expect(page.locator("#ob-zone")).toHaveValue("rj-norte");
    await shot(page, "onboarding-rio");
    await page.getByRole("button", { name: /^Continuar/ }).click(); await expect(page.getByText("Escolha a zona")).toHaveCount(0); await expect(page.getByText("Informe o bairro.")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
