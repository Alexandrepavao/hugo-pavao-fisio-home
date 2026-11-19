import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { SUPABASE_URL, ANON, PASSWORD, signIn, runId, useSession, MANAGER, type Session } from "../helpers";
import { call, get, haveHarness, mkUser, PLATFORM } from "./helpers-wl";

// @novo — WHITE LABEL pela INTERFACE: painel da plataforma, questionário A–I e a "Clínica Gama" criada SÓ pelo questionário (sem editar código, sem SQL manual, sem clonar repositório, sem novo projeto Supabase).
// A conta do administrador da Gama é criada por SQL no Dev APENAS para simular a confirmação do e-mail do convite (o envio real exige PUBLIC_SITE_URL no Dev). Só Dev.
const SHOTS = "docs/white-label/screenshots"; mkdirSync(SHOTS, { recursive: true });
const SUB = `gama-${runId}`; const ADMIN = `gama.admin.${runId}@example.test`;
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5180";
const hostUrl = (sub: string, path = "/") => { const u = new URL(BASE); return `${u.protocol}//${sub}.localhost:${u.port}${path}`; };
/** Avança o questionário uma etapa por vez, esperando a etapa seguinte aparecer (o salvamento automático é assíncrono). */
const advance = async (page: Page, to: number) => { await page.getByTestId("proximo").click(); await expect(page.getByTestId(`step-${to}`)).toBeVisible(); };
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

test.describe.serial("@novo White label — painel, questionário e Clínica Gama", () => {
  test.skip(!haveHarness, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  let plat: Session; const tempos: Record<string, unknown> = {};

  test.beforeAll(async () => { execFileSync("node", ["supabase/tools/wl-limpar-orgs-teste.mjs", "gama-"], { stdio: "pipe" }); plat = await signIn(PLATFORM); });

  test("gestor de clínica NÃO entra no painel da plataforma; administrador da plataforma entra", async ({ page, context }) => {
    const mgr = await signIn(MANAGER); await useSession(context, mgr);
    await page.goto("/plataforma"); await expect(page.getByText("Esta área é exclusiva da administração da plataforma")).toBeVisible();
    await expect(page.getByTestId("platform-area")).toHaveCount(0);
    const ctx2 = await page.context().browser()!.newContext({ locale: "pt-BR" }); const p2 = await ctx2.newPage(); await useSession(ctx2, plat);
    await p2.goto("/plataforma"); await expect(p2.getByTestId("platform-area")).toBeVisible(); await expect(p2.getByTestId("orgs-table")).toBeVisible();
    for (const n of ["HP Group", "Clínica Alfa", "Clínica Beta"]) await expect(p2.getByTestId("orgs-table").getByText(n, { exact: false }).first()).toBeVisible();
    await shot(p2, "01-plataforma-organizacoes");
    await p2.getByTestId("org-clinica-beta").getByRole("button", { name: "Detalhes" }).click(); await expect(p2.getByText("Consumo e limites")).toBeVisible(); await expect(p2.getByTestId("usage-list")).toBeVisible();
    await shot(p2, "02-plataforma-detalhe-organizacao");
    await p2.goto("/plataforma/modelos"); await expect(p2.getByText("Modelos e módulos").first()).toBeVisible(); await expect(p2.getByText("planejado").first()).toBeVisible(); await shot(p2, "03-plataforma-modelos");
    await p2.goto("/plataforma/planos"); await expect(p2.getByTestId("plans-table")).toBeVisible(); await expect(p2.getByText("a definir").first()).toBeVisible(); await shot(p2, "04-plataforma-planos");
    await ctx2.close();
  });

  test("questionário: validação no servidor, rascunho retomável e criação da Clínica Gama", async ({ page, context }) => {
    await useSession(context, plat); await page.goto("/plataforma/criar"); 
    // A — empresa
    await expect(page.getByTestId("step-0")).toBeVisible();
    await page.locator("#q-name").fill("Clínica Gama"); await page.locator("#q-seg").selectOption("fisioterapia");
    // segmentos planejados não podem ser escolhidos
    await expect(page.locator("#q-seg option[value='odontologia']")).toBeDisabled();
    await page.locator("#q-rn").fill("Gama Administradora"); await page.locator("#q-re").fill(ADMIN); await page.locator("#q-city").fill("Campinas"); await page.locator("#q-uf").fill("SP");
    await page.getByRole("button", { name: "Adicionar unidade" }).click(); await page.getByLabel("Nome da unidade 1").fill("Sede Campinas"); await page.getByLabel("Nome da unidade 2").fill("Unidade Norte");
    await shot(page, "10-questionario-A-empresa");
    await advance(page, 1);
    // B — operação
    await expect(page.getByTestId("step-1")).toBeVisible(); await page.locator("#q-serv").fill("Fisioterapia ortopédica\nPilates clínico\nFisioterapia domiciliar");
    await page.getByLabel("Domiciliar").check(); await page.getByLabel("Pacotes de sessões").check(); await advance(page, 2);
    // C — equipe
    await expect(page.getByTestId("step-2")).toBeVisible(); await page.locator("#q-users").fill("6"); await page.getByLabel("Quantidade: Fisioterapeuta").fill("3"); await page.getByLabel("Quantidade: Administrativo").fill("1"); await advance(page, 3);
    // D — clientes
    await expect(page.getByTestId("step-3")).toBeVisible(); await page.getByLabel("Captação de contatos (páginas e formulários)").check(); await advance(page, 4);
    // E — módulos (domiciliar sugere rota)
    await expect(page.getByTestId("step-4")).toBeVisible(); await expect(page.getByText("sugerido pelas suas respostas").first()).toBeVisible();
    await page.getByLabel(/Rota domiciliar|Rota e deslocamento|Rota/).first().check(); await shot(page, "11-questionario-E-modulos");
    // salvar rascunho e retomar depois
    await page.getByTestId("salvar-rascunho").click(); await expect(page.getByText("Rascunho salvo")).toBeVisible();
    await page.goto("/plataforma/solicitacoes"); await page.getByRole("link", { name: "Continuar" }).first().click(); await expect(page.locator("#q-name")).toHaveValue("Clínica Gama");
    await expect(page.locator("#q-re")).toHaveValue(ADMIN);
    // F — marca com subdomínio INVÁLIDO primeiro (a revisão deve recusar no servidor)
    for (let i = 1; i <= 5; i++) await advance(page, i);
    await page.locator("#q-app").fill("Gama Fisio"); await page.locator("#q-c1").fill("#0e7490"); await page.locator("#q-c2").fill("#f97316"); await page.locator("#q-sub").fill("Ab");
    await advance(page, 6); await advance(page, 7); await advance(page, 8);   // G, H, I
    await expect(page.getByTestId("step-8")).toBeVisible(); await expect(page.getByTestId("val-errors")).toContainText("subdomínio"); await expect(page.getByTestId("criar-aplicativo")).toBeDisabled();
    await shot(page, "12-questionario-I-erro-validacao");
    // corrige pelo link do erro e confirma
    await page.getByTestId("val-errors").getByRole("button").first().click(); await expect(page.getByTestId("step-5")).toBeVisible(); await page.locator("#q-sub").fill(SUB);
    await advance(page, 6); await page.getByLabel("E-mail próprio").check(); await advance(page, 7); await advance(page, 8);
    await expect(page.getByTestId("val-errors")).toHaveCount(0, { timeout: 15_000 }); await expect(page.getByTestId("val-warnings")).toContainText("não ficam conectadas");
    await shot(page, "13-questionario-I-revisao");
    const t0 = Date.now(); await page.getByTestId("criar-aplicativo").click();
    await expect(page).toHaveURL(/\/plataforma\/solicitacoes\/[0-9a-f-]{36}/); await expect(page.getByTestId("request-state")).toContainText(/Disponível/, { timeout: 30_000 });
    tempos.criar_aplicativo_ate_disponivel_ms = Date.now() - t0;
    await expect(page.getByTestId("steps")).toContainText("Verificações"); await expect(page.getByTestId("pendencias")).toContainText("Cadastrar serviços e preços");
    tempos.interno_ms_exibido = (await page.getByTestId("internal-ms").innerText()).trim(); await shot(page, "14-gama-provisionada");
    await expect(page.getByTestId("enviar-convite")).toBeVisible();
    // sem PUBLIC_SITE_URL no Dev o envio é recusado com mensagem clara e NADA é desfeito
    await page.getByTestId("enviar-convite").click(); await expect(page.getByRole("alert").filter({ hasText: /PUBLIC_SITE_URL|configurado/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("request-state")).toContainText(/Disponível/); await expect(page.getByTestId("invite-state")).toContainText("Falha no envio");
    await shot(page, "15-gama-convite-sem-site-url");
  });

  test("Clínica Gama: acesso pelo endereço próprio, marca, módulos e jornada básica — sem dados da HP", async ({ page }) => {
    await mkUser(ADMIN);   // simula a confirmação do e-mail do convite (o gatilho vincula o administrador à organização do convite)
    await page.goto(hostUrl(SUB, "/login"));
    await expect(page.getByRole("heading", { name: "Bem-vindo ao Gama Fisio" })).toBeVisible({ timeout: 20_000 });   // marca resolvida pelo ENDEREÇO verificado
    await expect(page.getByText("HP Group Hub")).toHaveCount(0);
    await shot(page, "20-gama-login-marca-por-endereco");
    await page.getByLabel("E-mail").fill(ADMIN); await page.getByLabel("Senha").fill(PASSWORD); await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: /Gama Fisio/ }).first()).toBeVisible(); expect(await page.title()).toBe("Gama Fisio");
    const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()); expect(primary).toMatch(/^1\d\d \d+% \d+%$/);   // 0e7490 → matiz ~192
    await expect(page.getByText(/HP Group/)).toHaveCount(0);
    const menu = page.getByRole("navigation", { name: "Navegação principal" }); await expect(menu.getByRole("link", { name: "CRM" })).toBeVisible();
    for (const off of ["Marketing", "Academy", "Parceiros"]) await expect(menu.getByRole("link", { name: off }), `${off} não contratado`).toHaveCount(0);   // só visual: o bloqueio real é no servidor
    await shot(page, "21-gama-admin-home");
    // jornada básica: gestor da Gama cadastra uma pessoa e vê só ela (sem as 8 pessoas de exemplo da HP)
    const s = await signIn(ADMIN); const unit = (await get(s, "units?select=id&order=name&limit=1")).body[0].id;
    const r = await call(s, "create_person", { p_full_name: "Paciente Gama Jornada", p_unit_id: unit, p_kinds: ["patient"], p_email: "gama.paciente@example.test", p_phone: "19999990001", p_notes: null }); expect(r.status).toBeLessThan(300);
    await page.goto(hostUrl(SUB, "/admin/pessoas")); await expect(page.getByText("Paciente Gama Jornada").first()).toBeVisible({ timeout: 20_000 }); await expect(page.getByText("Exemplo Paciente")).toHaveCount(0);
    await shot(page, "22-gama-pessoas-isoladas");
    // módulos do modelo: Marketing/Academy NÃO foram contratados → bloqueados no servidor
    const ctx = (await call(s, "org_context")).body; expect(ctx.modules).toContain("rota_domiciliar"); expect(ctx.modules).not.toContain("marketing");
    expect((await get(s, "mkt_campaigns?select=id&limit=1")).status).toBe(403);
    // configurações da organização: marca, consumo e exportação
    await page.goto(hostUrl(SUB, "/admin/organizacao")); await expect(page.getByRole("heading", { name: "Organização" })).toBeVisible();
    await expect(page.getByLabel("Nome do aplicativo")).toHaveValue("Gama Fisio"); await shot(page, "23-gama-organizacao-marca");
    await page.getByRole("tab", { name: "Módulos e consumo" }).click(); await expect(page.getByTestId("usage-list")).toContainText("Unidades"); await shot(page, "24-gama-organizacao-consumo");
    await page.getByRole("tab", { name: "Exportação de dados" }).click();
    const dl = page.waitForEvent("download", { timeout: 60_000 }); await page.getByTestId("gerar-exportacao").click(); const d = await dl; expect(d.suggestedFilename()).toMatch(/\.zip$/i);
    await shot(page, "25-gama-exportacao");
    // histórico do provisionamento no banco: nada copiado da HP
    const hpPeople = await call(plat, "platform_org_usage", { p_org: ctx.org.id }); expect(hpPeople.body.usage.active_patients).toBe(0);
    writeFileSync("test-results/wl-gama-tempos.json", JSON.stringify(tempos, null, 2)); console.log("GAMA", JSON.stringify(tempos));
  });

  test("duas empresas, duas marcas: troca de organização na mesma sessão (Alfa ↔ Beta)", async ({ page, context }) => {
    const s = await signIn("alfa.admin@example.test"); await useSession(context, s);
    await page.goto("/admin"); await expect(page.getByRole("link", { name: /Clínica Alfa/ }).first()).toBeVisible({ timeout: 20_000 });
    const pa = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()); await shot(page, "30-alfa-marca");
    await page.getByRole("button", { name: "Menu do usuário" }).click(); await expect(page.getByTestId("switch-clinica-beta")).toBeVisible(); await shot(page, "31-troca-de-organizacao");
    await page.getByTestId("switch-clinica-beta").click();
    await expect(page.getByRole("link", { name: /Clínica Beta/ }).first()).toBeVisible({ timeout: 20_000 });
    const pb = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()); expect(pb).not.toBe(pa); expect(await page.title()).toBe("Clínica Beta");
    expect(await page.evaluate(() => sessionStorage.getItem("hp.activeOrg"))).toBeTruthy();
    await page.goto("/admin/pessoas"); await expect(page.getByText("Paciente Beta Isolamento").first()).toBeVisible({ timeout: 20_000 }); await expect(page.getByText("Paciente Alfa Isolamento")).toHaveCount(0);
    await shot(page, "32-beta-apos-troca");
  });
});
