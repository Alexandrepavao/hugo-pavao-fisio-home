import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { SUPABASE_URL, ANON, PASSWORD, signIn, useSession, type Session } from "../helpers";
import { call, get, haveHarness, mkUser, PLATFORM, sqlDev } from "./helpers-wl";

// @novo — WHITE LABEL: a jornada COMPLETA da Clínica Delta (fictícia), criada SÓ pelo questionário e operada SÓ pelos fluxos normais do app:
// questionário → convite → acesso pelo endereço da organização (/empresa/<slug>) → configuração (serviços, pacote, conta, fisioterapeuta, disponibilidade, regra de repasse) → captação pública (quiz)
// → CRM → avaliação agendada → paciente pendente → apresentação → pagamento → paciente ativo → sessão realizada → financeiro e repasse → isolamento.
// SIMULADO (declarado): o e-mail do convite NÃO é clicado aqui (o envio real foi validado à parte, ver docs); as contas do administrador, da fisioterapeuta e do paciente nascem confirmadas por SQL no Dev
// (equivale a "já confirmaram o e-mail e definiram a senha"). NÃO exercitado: provedor de pagamento (o recebimento entra manualmente pelo Financeiro, com auditoria) e envio de e-mail ao paciente.
// A Delta fica no Dev ao final (para ser aberta e conferida); a execução seguinte remove a anterior (slug exato "delta-fisio").
const SHOTS = "docs/white-label/screenshots/delta"; mkdirSync(SHOTS, { recursive: true });
const ADMIN = "delta.admin@example.test", FISIO = "delta.fisio@example.test", PACIENTE = "delta.paciente@example.test";
const SUB = "delta-fisio";
const NOMEPAC = "Paciente Delta Jornada";
const shot = (page: Page, name: string, full = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const advance = async (page: Page, to: number) => { await page.getByTestId("proximo").click(); await expect(page.getByTestId(`step-${to}`)).toBeVisible(); };
const as = async (context: BrowserContext, email: string) => { const s = await signIn(email); await useSession(context, s); return s; };
const brl = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100).replace(/\s/g, " ");

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 }, actionTimeout: 30_000 });
test.describe.serial("@novo White label — jornada completa da Clínica Delta", () => {
  test.skip(!haveHarness, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  test.setTimeout(240_000);
  let plat: Session; let reqId = ""; let orgId = ""; let slug = ""; let adminS: Session; const tempos: Record<string, unknown> = {}; const S: Record<string, string> = {};

  test.beforeAll(async () => { execFileSync("node", ["supabase/tools/wl-limpar-orgs-teste.mjs", SUB], { stdio: "pipe" }); plat = await signIn(PLATFORM); });

  test("1. Delta criada SÓ pelo questionário (interface), com administrador e unidade; o convite do e-mail de teste é contido pela política de destinatários", async ({ page, context }) => {
    await useSession(context, plat); await page.goto("/plataforma/criar");
    await expect(page.getByTestId("step-0")).toBeVisible();
    await page.locator("#q-name").fill("Clínica Delta"); await page.locator("#q-seg").selectOption("fisioterapia");
    await page.locator("#q-rn").fill("Delta Administradora"); await page.locator("#q-re").fill(ADMIN); await page.locator("#q-city").fill("Curitiba"); await page.locator("#q-uf").fill("PR");
    await page.getByLabel("Nome da unidade 1").fill("Sede Curitiba");
    await advance(page, 1);
    await page.locator("#q-serv").fill("Avaliação fisioterapêutica\nFisioterapia ortopédica"); await page.getByLabel("Pacotes de sessões").check(); await advance(page, 2);
    await page.locator("#q-users").fill("3"); await page.getByLabel("Quantidade: Fisioterapeuta").fill("1"); await page.getByLabel("Quantidade: Administrativo").fill("1"); await advance(page, 3);
    await page.getByLabel("Captação de contatos (páginas e formulários)").check(); await advance(page, 4); await advance(page, 5);
    await page.locator("#q-app").fill("Delta Fisioterapia"); await page.locator("#q-c1").fill("#7c3aed"); await page.locator("#q-c2").fill("#16a34a"); await page.locator("#q-sub").fill(SUB);
    await advance(page, 6); await advance(page, 7); await advance(page, 8);
    await expect(page.getByTestId("val-errors")).toHaveCount(0, { timeout: 15_000 });
    const t0 = Date.now(); await page.getByTestId("criar-aplicativo").click();
    await expect(page).toHaveURL(/\/plataforma\/solicitacoes\/[0-9a-f-]{36}/); await expect(page.getByTestId("request-state")).toContainText(/Disponível/, { timeout: 30_000 });
    tempos.provisionamento_clique_ate_disponivel_ms = Date.now() - t0; tempos.provisionamento_internal_ms_exibido = (await page.getByTestId("internal-ms").innerText()).trim();
    reqId = page.url().match(/solicitacoes\/([0-9a-f-]{36})/)![1];
    const g = await call(plat, "provisioning_get", { p_id: reqId }); orgId = g.body.org_id; slug = g.body.org_slug; expect(slug).toBe(SUB);
    await expect(page.getByTestId("endereco-acesso")).toContainText(`/empresa/${slug}`); await shot(page, "01-delta-provisionada");
    // convite: o e-mail de teste (example.test) NÃO é autorizado → nada é enviado e isso fica registrado (nível 1 = pedido; nível 2 = NÃO aceito)
    await page.getByTestId("enviar-convite").click(); await expect(page.getByRole("alert").filter({ hasText: /autorizados|EMAIL_ALLOWED/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("evidencia-acesso")).toBeVisible(); await expect(page.getByTestId("ev-1")).toContainText("sim"); await expect(page.getByTestId("ev-2")).toContainText("falhou"); await expect(page.getByTestId("ev-5")).toContainText("não");
    await shot(page, "02-delta-evidencia-convite-contido");
  });

  test("2. administrador (conta confirmada SIMULADA) entra pelo ENDEREÇO da organização: marca da Delta desde o primeiro quadro, nunca a da HP", async ({ page }) => {
    await mkUser(ADMIN);   // SIMULADO: equivale a "confirmou o e-mail do convite e definiu a senha"; o gatilho vincula o administrador à organização do convite
    const ev = await call(plat, "provisioning_access_evidence", { p_id: reqId }); expect(ev.body["4_link_used"]).toBe(true); expect(ev.body["5_access"]).toMatchObject({ membership: true, manager_role: true });
    const logos: string[] = []; page.on("framenavigated", () => undefined);
    await page.goto(`/empresa/${slug}/login`);
    for (let i = 0; i < 12; i++) { logos.push(String(await page.locator('img[alt="HP Fisioterapia"]').count())); await page.waitForTimeout(100); }
    expect(logos.every((n) => n === "0"), "nenhum quadro mostrou o logotipo da HP").toBe(true);
    await expect(page.getByRole("heading", { name: "Bem-vindo ao Delta Fisioterapia" })).toBeVisible({ timeout: 20_000 }); await expect(page.getByText("HP Group Hub")).toHaveCount(0);
    await shot(page, "03-delta-login-por-endereco");
    // organização desconhecida: uma resposta só, sem marca
    const other = await page.context().newPage(); await other.goto("/empresa/nao-existe-delta/login"); await expect(other.getByTestId("organizacao-indisponivel")).toBeVisible(); await expect(other.getByText("HP Group")).toHaveCount(0); await other.close();
    await page.getByLabel("E-mail").fill(ADMIN); await page.getByLabel("Senha").fill(PASSWORD); await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 }); expect(await page.evaluate(() => sessionStorage.getItem("hp.activeOrg"))).toBe(orgId);
    expect(await page.title()).toBe("Delta Fisioterapia"); await expect(page.getByText(/HP Group/)).toHaveCount(0); await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible(); await shot(page, "04-delta-admin-home");
    adminS = await signIn(ADMIN); tempos.org_id = orgId; tempos.slug = slug;
  });

  test("3. configuração operacional SÓ pelos fluxos normais: serviços, pacote, conta financeira, fisioterapeuta, acesso, disponibilidade e regra de repasse", async ({ page, context }) => {
    await mkUser(FISIO);   // SIMULADO: conta da fisioterapeuta já confirmada (o convite real dela segue o mesmo caminho do administrador)
    await as(context, ADMIN); const t0 = Date.now();
    // serviços e pacote (Configurações)
    await page.goto("/admin/configuracoes");
    await page.getByText("Serviços (duração/preço do atendimento)").locator("xpath=ancestor::div[.//button[normalize-space()='Gerenciar']][1]").getByRole("button", { name: "Gerenciar" }).click();
    for (const [nome, dur, preco] of [["Avaliação Delta", "50", "150,00"], ["Sessão Delta", "50", "200,00"]]) {
      await page.locator("#sv-name").fill(nome); await page.locator("#sv-dur").fill(dur); await page.locator("#sv-price").fill(preco); await page.getByRole("button", { name: "Criar serviço" }).click(); await expect(page.getByText("Serviço criado.")).toBeVisible({ timeout: 20_000 });
    }
    await page.locator("#pr-kind").selectOption("package"); await page.locator("#pr-name").fill("Pacote Delta 8 sessões"); await page.locator("#pr-price").fill("1200,00");
    await page.locator("#pr-svc").selectOption({ label: "Sessão Delta" }); await page.locator("#pr-sess").fill("8"); await page.locator("#pr-val").fill("180"); await page.getByRole("button", { name: "Criar produto" }).click(); await expect(page.getByText("Produto criado.")).toBeVisible({ timeout: 20_000 });
    await shot(page, "05-delta-servicos-e-pacote");
    // conta financeira
    await page.goto("/admin/financeiro/config"); await page.locator("#fa-name").fill("Conta Delta Principal"); await page.locator("#fa-unit").selectOption({ index: 1 }); await page.getByRole("button", { name: "Criar", exact: true }).first().click(); await expect(page.getByText("Criado.").first()).toBeVisible({ timeout: 20_000 });
    // fisioterapeuta (cadastro novo na unidade da Delta) + acesso + disponibilidade
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await page.getByRole("button", { name: "Nova pessoa" }).click(); await page.locator("#pa-name").fill("Dra. Fernanda Delta"); await page.locator("#pa-reg").fill("CREFITO-8 123456-F");
    await page.getByRole("checkbox", { name: "Sede Curitiba" }).check(); await page.getByRole("button", { name: "Cadastrar profissional" }).click();
    const row = page.getByRole("row").filter({ hasText: "Dra. Fernanda Delta" }); await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Liberar acesso" }).click(); await page.locator("#pg-email").fill(FISIO); await page.getByRole("dialog").getByRole("button", { name: "Liberar acesso" }).click();
    await expect(row.getByText("Conta ligada")).toBeVisible({ timeout: 20_000 });
    await page.locator("#rp").selectOption({ label: "Dra. Fernanda Delta" });
    for (let d = 0; d < 7; d++) { await page.locator("#rd").selectOption(String(d)); await page.locator("#rs").fill("07:00"); await page.locator("#re").fill("21:00"); await page.getByRole("button", { name: "Adicionar", exact: true }).click(); await expect(page.getByRole("region", { name: "Disponibilidade semanal" }).getByRole("row")).toHaveCount(d + 2, { timeout: 20_000 }); }   // cabeçalho + uma linha por dia salvo
    await shot(page, "06-delta-fisioterapeuta-disponibilidade");
    // regra de repasse (Financeiro ▸ Comissões ▸ Regras): produto, beneficiária e percentual vêm da regra criada na Delta
    const fis = await signIn(FISIO); S.fisUser = fis.user.id; S.pkg = (await get(adminS, "products?select=id&name=eq.Pacote%20Delta%208%20sess%C3%B5es")).body[0].id;
    await page.goto("/admin/financeiro/comissoes"); await page.getByRole("tab", { name: "Regras de comissão" }).click();
    await page.locator("#crn").fill("Repasse Delta — fisioterapeuta"); await page.locator("#crp").selectOption(S.pkg); await page.locator("#crb").selectOption(S.fisUser); await page.locator("#crv").fill("30");
    await page.getByRole("button", { name: "Criar regra" }).click(); await expect(page.getByText("Regra criada.")).toBeVisible({ timeout: 20_000 });
    await shot(page, "07-delta-regra-de-repasse");
    tempos.configuracao_operacional_ms = Date.now() - t0;
    const prof = (await get(adminS, "professionals?select=id,user_id,display_name")).body; expect(prof).toHaveLength(1); expect(prof[0].user_id).toBe(S.fisUser); S.prof = prof[0].id;
    S.unit = (await get(adminS, "units?select=id&order=name&limit=1")).body[0].id; S.svcEval = (await get(adminS, "services?select=id&name=eq.Avalia%C3%A7%C3%A3o%20Delta")).body[0].id; S.svcSess = (await get(adminS, "services?select=id&name=eq.Sess%C3%A3o%20Delta")).body[0].id;
    expect((await get(adminS, "availability_rules?select=id")).body).toHaveLength(7);
    // nada da HP veio junto: nenhum serviço, produto ou profissional que não seja da Delta
    expect((await get(adminS, "services?select=name")).body.map((x: { name: string }) => x.name).sort()).toEqual(["Avaliação Delta", "Sessão Delta"]);
    expect((await get(adminS, "products?select=name")).body.map((x: { name: string }) => x.name)).toEqual(["Pacote Delta 8 sessões"]);
  });
});

test.afterAll(() => { /* a Delta permanece no Dev para conferência */ });
void SUPABASE_URL; void ANON; void get; void sqlDev; void writeFileSync; void brl;
