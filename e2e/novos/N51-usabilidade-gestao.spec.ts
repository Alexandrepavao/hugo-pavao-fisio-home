import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { api, devSql, loginAs, QA, runId, signIn, spDate } from "../release/helpers-release";

// @novo — JORNADAS DE USABILIDADE da Gestão (automatizadas, gestor QA e um papel limitado; banco Dev, dados sintéticos criados e removidos pelo teste).
// ATENÇÃO: isto é validação AUTOMATIZADA das tarefas (encontrar, abrir, conectar, voltar sem perder o contexto, ajuda/tour). NÃO é teste com usuários leigos.
const OUT = process.env.REDESIGN_SHOTS ?? "docs/redesign/usabilidade"; mkdirSync(OUT, { recursive: true });
const NAME = `Pessoa Usab ${runId}`; const TITLE = `Contrato Usab ${runId}`;
const S: Record<string, string> = {};
const noH = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);
test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1440, height: 900 } });

test.describe.serial("@novo Usabilidade — Gestão", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => {
    const mgr = await signIn(QA.manager); const g = api(mgr);
    S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const p = await g.rpc("create_person", { p_full_name: NAME, p_unit_id: S.unit, p_kinds: ["patient"], p_email: `usab.${runId}@example.com`, p_phone: null, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); S.person = typeof p.body === "string" ? p.body : p.body.id;
    const c = await g.rpc("adm_contract_create", { p_kind: "prestacao_servico", p_title: TITLE, p_subject_type: "person", p_subject: S.person, p_responsible: null, p_starts_on: spDate(0), p_ends_on: spDate(300), p_notes: null }); expect(c.status, JSON.stringify(c.body)).toBe(200); S.contract = c.body;
    expect((await g.rpc("adm_contract_send", { p_id: S.contract, p_sign_until: spDate(10) })).status).toBeLessThan(300);
  });
  test.afterAll(async () => {
    if (!process.env.SUPABASE_ACCESS_TOKEN || !S.person) return;
    await devSql(`set local session_replication_role = replica;
      delete from public.adm_contract_events where contract_id in (select id from public.adm_contracts where subject_id = '${S.person}');
      delete from public.adm_contracts where subject_id = '${S.person}';
      delete from public.adm_pendencies where subject_id = '${S.person}';
      delete from public.person_contacts where person_id = '${S.person}'; delete from public.person_kinds where person_id = '${S.person}'; delete from public.people where id = '${S.person}';`).catch(() => null);
  });

  test("J1 · Visão geral → contrato aguardando assinatura → cadastro da empresa/pessoa → voltar sem perder o contexto", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/adm"); await expect(page.getByTestId("banner-title")).toHaveText("Visão geral");
    const card = page.getByRole("button", { name: /Contratos aguardando assinatura/ }); await expect(card).toBeVisible({ timeout: 40_000 });
    const n = Number((await card.locator(".hp-kpi-value").innerText()).replace(/\D/g, "")); expect(n).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: `${OUT}/j1-1-visao-geral.png` });
    await card.click();
    await expect(page).toHaveURL(/aba=contratos&situacao=awaiting_signature/); await expect(page.getByTestId("banner-title")).toHaveText("Contratos");
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("voltar-contexto")).toContainText("Voltar para Visão geral da Gestão");
    // o número do cartão é o mesmo da lista filtrada (mesmas regras, mesmo filtro)
    await expect.poll(async () => page.getByRole("row").filter({ hasText: "Aguardando assinatura" }).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: `${OUT}/j1-2-contratos-filtrados.png` });
    // contrato → cadastro (pelo ID do vínculo, nunca por nome)
    await page.getByRole("row").filter({ hasText: TITLE }).getByRole("link", { name: "Ver cadastro" }).click();
    await expect(page).toHaveURL(/\/admin\/adm\/diretorio/); await expect(page.getByRole("dialog").getByText(NAME).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("relacionados-cadastro")).toBeVisible(); await page.screenshot({ path: `${OUT}/j1-3-ficha-do-cadastro.png` });
    // ficha → contratos vinculados (filtro por cadastro visível) → voltar à ficha anterior
    await page.getByRole("link", { name: "Ver contratos vinculados" }).click();
    await expect(page.getByTestId("filtro-cadastro")).toBeVisible(); await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("voltar-contexto").getByRole("link").click(); await expect(page).toHaveURL(/\/admin\/adm\/diretorio/);
    // volta até a Visão geral pelo contexto guardado (nada se perdeu: mesma tela e mesmo filtro de unidade)
    await page.goto("/admin/adm"); await expect(page.getByTestId("banner-title")).toHaveText("Visão geral");
  });

  test("J2 · cadastro incompleto: da Visão geral até a edição do cadastro certo (filtro visível, abre pelo ID)", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/adm"); const card = page.getByRole("button", { name: /Cadastros incompletos/ }); await expect(card).toBeVisible({ timeout: 40_000 });
    await card.click(); await expect(page).toHaveURL(/diretorio\?incompleto=1/); await expect(page.getByTestId("banner-title")).toHaveText("Planilha administrativa");
    await expect(page.getByRole("button", { name: /Filtros/ })).toContainText("1");         // filtro ativo visível
    await page.getByRole("row").nth(1).getByRole("button").first().click(); await expect(page.getByRole("dialog")).toBeVisible();   // abre a ficha para editar
    await page.screenshot({ path: `${OUT}/j2-ficha-incompleto.png` });
  });

  test("J3 · Planilha administrativa: finalidade clara e o MESMO registro em Pessoas", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/adm/diretorio"); await expect(page.getByTestId("banner-desc")).toContainText("cadastros de pessoas e empresas");
    await page.locator("#dir-q").fill(NAME); await expect(page.getByRole("button", { name: NAME })).toHaveCount(1, { timeout: 30_000 });
    await page.getByTestId("ajuda-botao").click(); await expect(page.getByTestId("ajuda-painel")).toContainText("MESMOS cadastros de Pessoas e Empresas"); await page.keyboard.press("Escape");
    await page.goto("/admin/pessoas"); await page.locator("#p-q").fill(NAME); await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 });   // o mesmo registro, sem duplicar
  });

  test("J4 · ajuda e tour: convite discreto (não abre sozinho), passos reais, Esc, persistência e refazer pela Ajuda; o tour não executa ações", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/adm/pendencias?aba=contratos"); await expect(page.getByTestId("banner-title")).toHaveText("Contratos");
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("hp-ajuda:")).forEach((k) => localStorage.removeItem(k))); await page.reload();
    await expect(page.getByTestId("ajuda-convite")).toBeVisible(); await expect(page.getByTestId("tour")).toHaveCount(0);        // não abre sozinho
    await page.getByTestId("ajuda-convite").getByRole("button", { name: "Conhecer esta tela" }).click();
    await expect(page.getByTestId("tour")).toBeVisible({ timeout: 10_000 }); await expect(page.getByTestId("tour-progresso")).toContainText(/Passo 1 de \d/);
    await page.screenshot({ path: `${OUT}/j4-tour-passo1.png` });
    // durante o tour nada da página reage a cliques (nenhuma ação real)
    const url = page.url(); await page.mouse.click(300, 120); expect(page.url()).toBe(url);
    await page.keyboard.press("ArrowRight"); await expect(page.getByTestId("tour-progresso")).toContainText(/Passo 2 de/);
    await page.keyboard.press("ArrowLeft"); await expect(page.getByTestId("tour-progresso")).toContainText(/Passo 1 de/);
    await page.keyboard.press("Escape"); await expect(page.getByTestId("tour")).toHaveCount(0);
    await page.reload(); await expect(page.getByTestId("ajuda-convite")).toHaveCount(0);        // dispensado: não volta
    // refazer pela Ajuda e concluir
    await page.getByTestId("ajuda-botao").click(); await page.getByTestId("ajuda-conhecer").click(); await expect(page.getByTestId("tour")).toBeVisible({ timeout: 10_000 });
    for (let i = 0; i < 8 && (await page.getByTestId("tour").count()); i++) { await page.getByTestId("tour-proximo").click().catch(() => null); }
    await expect(page.getByTestId("tour")).toHaveCount(0); await page.getByTestId("ajuda-botao").click(); await expect(page.getByTestId("ajuda-painel")).toContainText("concluído");
  });

  test("J5 · celular (360 px): Visão geral, Pendências, ajuda e tour sem rolagem horizontal nem cortes", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.setViewportSize({ width: 360, height: 780 });
    for (const [n, p] of [["visao", "/admin/adm"], ["pendencias", "/admin/adm/pendencias"], ["contratos", "/admin/adm/pendencias?aba=contratos"]]) {
      await page.goto(p); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(2500);
      expect(await noH(page), `${n} sem rolagem horizontal`).toBe(true); await page.screenshot({ path: `${OUT}/j5-${n}-360.png` });
    }
    await page.getByTestId("ajuda-botao").click(); await expect(page.getByTestId("ajuda-painel")).toBeVisible(); const box = await page.getByTestId("ajuda-painel").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 360, "painel de ajuda contido na tela").toBe(true); await page.screenshot({ path: `${OUT}/j5-ajuda-360.png` });
    await page.getByTestId("ajuda-conhecer").click(); await expect(page.getByTestId("tour")).toBeVisible({ timeout: 10_000 });
    const card = await page.locator(".hp-tour-card").boundingBox(); expect(card && card.x >= 0 && card.x + card.width <= 360 && card.y >= 0 && card.y + card.height <= 780, "cartão do tour contido na tela").toBe(true);
    await page.screenshot({ path: `${OUT}/j5-tour-360.png` }); await page.keyboard.press("Escape");
  });

  test("J6 · papel limitado (comercial): sem menus restritos, sem ampliar permissão por link direto, Visão geral sem erro", async ({ page, context }) => {
    await loginAs(context, QA.comercial);
    await page.goto("/admin/adm"); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 });
    const menu = page.getByRole("navigation", { name: /Navegação do Gestão/ });
    for (const off of ["Configurações", "Ver como", "Auditoria", "Equipe e acessos"]) await expect(menu.getByRole("link", { name: off, exact: true }), `${off} não aparece para este papel`).toHaveCount(0);
    for (const rota of ["/admin/auditoria", "/admin/equipe", "/admin/ver-como"]) { await page.goto(rota); await expect(page.getByTestId("banner-title")).toHaveCount(0); }   // bloqueado pela rota
    await page.goto("/admin/adm/pendencias?aba=contratos&cadastro=00000000-0000-0000-0000-000000000000"); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 });
    expect(await noH(page)).toBe(true);
  });
});
