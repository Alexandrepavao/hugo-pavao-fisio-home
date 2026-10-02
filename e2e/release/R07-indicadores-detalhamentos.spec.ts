// ACEITE da release v1 (escopo ampliado, etapa 1) — indicadores do Administrativo, do CRM e da Captação: os cartões mostram o que o servidor calculou,
// cada cartão clicável abre um detalhamento cuja contagem é a MESMA do cartão, e o acesso respeita o papel. Não altera dados.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const cardValue = async (page: Page, label: string | RegExp) => (await page.getByRole("button", { name: label }).first().locator("p.tabular").innerText()).trim();
/** Clica no cartão, confere que o detalhamento abriu com a MESMA contagem e fecha. Devolve a contagem. */
async function openAndCompare(page: Page, label: string | RegExp) {
  const shown = await cardValue(page, label);
  await page.getByRole("button", { name: label }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("p.tabular").first()).toHaveText(shown);               // a contagem do detalhamento = a do cartão
  await expect(dlg.getByRole("link", { name: "Abrir a lista completa" })).toBeVisible();
  await expect(dlg.getByText(/Sem permissão ou falha/)).toHaveCount(0);
  await dlg.getByRole("button", { name: "Fechar" }).first().click();
  await expect(dlg).toHaveCount(0);
  return shown;
}

test.describe.serial("@release Indicadores e detalhamentos (Administrativo, CRM, Captação)", () => {
  test.setTimeout(120_000);

  test("Administrativo: cartões batem com o servidor e os detalhamentos reconciliam", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/adm");
    await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Total de cadastros/ })).toBeVisible();
    await expectNoFatal(page);
    const from = new Date(Date.now() - 400 * 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    const srv = await api(s).rpc("adm_dashboard", { p_from: from, p_to: to, p_unit: null });
    expect(srv.status, JSON.stringify(srv.body)).toBe(200);
    // o total não depende do período: tem de ser o do servidor, formatado em pt-BR
    expect(await cardValue(page, /Total de cadastros/)).toBe(Number(srv.body.total.value).toLocaleString("pt-BR"));
    expect(await cardValue(page, /Pessoas físicas/)).toBe(Number(srv.body.pf.value).toLocaleString("pt-BR"));
    expect(await cardValue(page, /Pessoas jurídicas/)).toBe(Number(srv.body.pj.value).toLocaleString("pt-BR"));
    for (const label of [/Total de cadastros/, /Pessoas físicas/, /Pessoas jurídicas/, /Cadastros incompletos/, /^Ativos/, /^Inativos/, /Novos no período/]) await openAndCompare(page, label);
    // PF + PJ = total (nada inventado nem duplicado)
    expect(Number(srv.body.pf.value) + Number(srv.body.pj.value)).toBe(Number(srv.body.total.value));
    // as seções de gráficos existem e dizem o que medem
    await expect(page.getByText("Campos faltantes", { exact: true })).toBeVisible();
    await expect(page.getByText("Distribuição por vínculo (pessoas físicas)")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Relatórios: cartões e detalhamentos; fórmula explicada no cartão", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/relatorios");
    await expect(page.getByRole("heading", { name: "Relatórios" })).toBeVisible();
    await expect(page.getByText("Conversão entre etapas")).toBeVisible();
    await expectNoFatal(page);
    await expect(page.getByText("Criadas no período").first()).toBeVisible();
    await openAndCompare(page, /Criadas no período/);
    await openAndCompare(page, /Em aberto agora/);
    await openAndCompare(page, /Ganhas no período/);
    // cada cartão traz a fórmula/base (texto explicativo), inclusive o de conversão, que não abre registros em lista própria
    await expect(page.getByText(/ganhas ÷ criadas|ganhas.*criadas/i).first()).toBeVisible();
    await page.getByRole("tab", { name: "Desempenho comercial" }).click();
    await expect(page.getByText("Por responsável")).toBeVisible();
    await expect(page.getByText("Por origem")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Captação › Indicadores: respostas, pessoas e oportunidades são coisas diferentes; clique no WhatsApp não é mensagem", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/captacao-leads");
    await page.getByRole("tab", { name: "Indicadores" }).click();
    await expect(page.getByText("Conversão das pessoas captadas")).toBeVisible();
    await expectNoFatal(page);
    for (const l of ["Respostas", "Pessoas distintas", "Oportunidades distintas"]) await expect(page.getByRole("button", { name: new RegExp(`^${l}`) }).first()).toBeVisible();
    await openAndCompare(page, /^Respostas/);
    await openAndCompare(page, /Cliques no WhatsApp/);
    await expect(page.getByText(/clique.*não.*mensagem|não é mensagem enviada|não significa mensagem/i).first()).toBeVisible();
    const resp = Number((await cardValue(page, /^Respostas/)).replace(/\./g, "")), ppl = Number((await cardValue(page, /^Pessoas distintas/)).replace(/\./g, ""));
    expect(ppl).toBeLessThanOrEqual(resp);                          // pessoas distintas nunca passam do número de respostas
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: papel sem acesso ao cadastro não abre o Administrativo; comercial abre a Captação", async ({ page, context }) => {
    await loginAs(context, QA.aluno);
    await page.goto("/admin/adm");
    await expect(page.getByRole("heading", { name: "Sem permissão" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Visão geral" })).toHaveCount(0);
    const ctx2 = await page.context().browser()!.newContext(); const p2 = await ctx2.newPage();
    await loginAs(ctx2, QA.comercial); await p2.goto("/admin/captacao-leads");
    await p2.getByRole("tab", { name: "Indicadores" }).click();
    await expect(p2.getByText("Conversão das pessoas captadas")).toBeVisible();
    await ctx2.close();
  });
});
