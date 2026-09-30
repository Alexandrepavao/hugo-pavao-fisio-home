// NOVO (etapa ADM+Contábil) — navegação entre aplicativos: Hub ⇄ Contábil ⇄ ADM ⇄ CRM ⇄ Financeiro, sidebar exclusiva do Contábil,
// todas as telas do menu com funcionalidade real, cards do dashboard levando à tela filtrada. Não faz parte da regressão (01–09).
import { expect, test } from "@playwright/test";
import { collectErrors, loginAs, QA } from "./helpers-novos";

const MENU: [string, RegExp, string][] = [
  ["Visão geral", /\/admin\/contabil$/, "Jornada da competência"],
  ["Competências", /\/contabil\/competencias/, "Fechamento"],
  ["Lançamentos e classificações", /\/contabil\/lancamentos/, "Base"],
  ["Documentos e comprovantes", /\/contabil\/documentos/, "Anexar documento da competência"],
  ["Pendências", /\/contabil\/pendencias/, "Alteração após o fechamento"],
  ["Fechamentos", /\/contabil\/fechamentos/, "Condições para fechar"],
  ["Exportações", /\/contabil\/exportacoes/, "Gerar pacote (ZIP)"],
  ["Configurações contábeis", /\/contabil\/configuracoes/, "Regras de fechamento"],
];

test.describe("@novo Contábil — navegação entre aplicativos", () => {
  test("Hub → Contábil com sidebar exclusiva; troca de app; retorno ao Hub; todas as telas do menu abrem sem erro", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin");
    await page.getByRole("link", { name: "Contábil", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/contabil$/);

    const side = page.getByRole("navigation", { name: "Navegação do Contábil" });
    for (const [label] of MENU) await expect(side.getByRole("link", { name: label })).toBeVisible();
    await expect(side.getByRole("link")).toHaveCount(MENU.length);                                 // só o menu do Contábil
    await expect(page.getByRole("link", { name: "Pessoas", exact: true })).toHaveCount(0);          // a sidebar geral do Hub não aparece junto
    await expect(page.getByRole("link", { name: "Voltar ao Hub" }).first()).toBeVisible();

    for (const [label, url, marker] of MENU) {                                                      // cada menu entregue tem tela real
      await side.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(url); await expect(page.getByText(marker).first()).toBeVisible();
      await expect(page.getByText("Sem permissão")).toHaveCount(0);
    }

    // seletor de aplicativos: Contábil → ADM → CRM → Financeiro → Contábil
    const swap = async (app: string) => { await page.getByRole("button", { name: "Trocar de aplicativo" }).click(); await page.getByRole("menuitem", { name: app }).click(); };
    await swap("ADM"); await expect(page).toHaveURL(/\/admin\/adm/); await expect(page.getByRole("navigation", { name: "Navegação do ADM" })).toBeVisible();
    await page.getByRole("button", { name: "Trocar de aplicativo" }).click(); await expect(page.getByRole("menuitem", { name: "Contábil" })).toBeVisible(); await page.keyboard.press("Escape");
    await page.goto("/admin/crm"); await page.getByRole("button", { name: "Trocar de aplicativo" }).click(); await page.getByRole("menuitem", { name: "Contábil" }).click();
    await expect(page).toHaveURL(/\/admin\/contabil/);
    await swap("Financeiro"); await expect(page).toHaveURL(/\/admin\/financeiro/);
    await page.goto("/admin/contabil"); await page.getByRole("link", { name: "Voltar ao Hub" }).first().click();
    await expect(page).toHaveURL(/\/admin$/); await expect(page.getByRole("navigation", { name: "Navegação do Contábil" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("cards do dashboard levam à tela já filtrada; escopo (unidade/competência) acompanha os links", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/contabil?m=2026-09-01");
    await expect(page.locator("#acc-month")).toHaveValue("2026-09-01");
    const cards: [RegExp, RegExp][] = [
      [/Situação da competência/, /\/fechamentos/], [/Receitas — competência/, /\/lancamentos.*kind=income/], [/Despesas — competência/, /\/lancamentos.*kind=expense/],
      [/Sem classificação/, /\/lancamentos.*f=unclassified/], [/Despesas pagas sem comprovante/, /\/lancamentos.*f=missing_receipt/],
      [/Alterações após o fechamento/, /\/pendencias.*tipo=changed_after_close/], [/Documentos da competência/, /\/documentos/], [/Competências encerradas em aberto/, /\/competencias/],
    ];
    for (const [card, url] of cards) {
      await page.goto("/admin/contabil?m=2026-09-01");
      await page.getByRole("button", { name: card }).click();
      await expect(page).toHaveURL(url); await expect(page).toHaveURL(/m=2026-09-01/);           // a competência escolhida foi preservada
    }
    // trocar a competência numa tela filtrada mantém a tela e muda o escopo
    await page.goto("/admin/contabil/lancamentos?m=2026-09-01&basis=caixa");
    await expect(page.getByRole("button", { name: "Caixa", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.locator("#acc-month").selectOption("2026-08-01");
    await expect(page).toHaveURL(/lancamentos.*m=2026-08-01/); await expect(page).toHaveURL(/basis=caixa/);
    expect(errors).toEqual([]);
  });

  test("caixa e competência aparecem separados nos mesmos dados (nunca somados)", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/contabil/lancamentos?m=2026-09-01&basis=competencia");
    await expect(page.getByText(/Receitas — competência/).first()).toBeVisible();
    await page.getByRole("button", { name: "Caixa", exact: true }).click();
    await expect(page.getByText(/Receitas — caixa/).first()).toBeVisible();
    await expect(page.getByText(/Receitas — competência/)).toHaveCount(0);
    await expect(page.getByText(/Pela data em que o dinheiro entrou ou saiu/)).toBeVisible();
  });

  test("navegação em celular (390px): menu em gaveta, sem rolagem horizontal", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ["", "/lancamentos", "/fechamentos", "/configuracoes"]) {
      await page.goto(`/admin/contabil${p}?m=2026-09-01`);
      await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    }
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Exportações" })).toBeVisible();
  });
});
