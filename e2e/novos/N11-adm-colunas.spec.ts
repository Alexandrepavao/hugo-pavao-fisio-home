// NOVO (etapa ADM+Contábil) — personalização da planilha ADM: selecionar/ocultar/reordenar colunas, salvar por usuário,
// restaurar padrão e permissão de campo (consulta e exportação). Não faz parte da regressão (01–09).
import { expect, test, type Page } from "@playwright/test";
import { api, loginAs, QA, collectErrors, shot } from "./helpers-novos";

const headers = async (page: Page) => (await page.locator('[data-testid="adm-table"] thead th').allInnerTexts()).map((t) => t.replace(/[▲▼]/g, "").trim());
const DEFAULT = ["Nome / razão social", "Tipo (PF/PJ)", "Documento", "Cidade/UF", "Unidade(s)", "Status", "Completo", "Criado em"];

test.describe("@novo ADM — colunas da planilha", () => {
  test("gestor: oculta, adiciona, reordena, salva por usuário, persiste ao recarregar e restaura o padrão", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    await api(s).rpc("adm_view_reset");
    await page.goto("/admin/adm/diretorio");
    await expect(page.locator('[data-testid="adm-table"]')).toBeVisible();
    expect(await headers(page)).toEqual(DEFAULT);

    await page.getByRole("button", { name: "Colunas" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Ocultar Cidade/UF" }).click();
    await dlg.getByRole("button", { name: "Mostrar E-mail", exact: true }).click();
    await dlg.getByRole("button", { name: "Mostrar Regime tributário (PJ)" }).click();            // gestor pode ver colunas restritas
    await dlg.getByRole("button", { name: "Mover Status para cima" }).click(); await shot(page, "15-adm-colunas-dialogo-reordenar");
    await dlg.getByRole("button", { name: "Salvar preferência" }).click();
    await expect(page.getByText("Preferência de colunas salva para o seu usuário.")).toBeVisible();
    const expected = ["Nome / razão social", "Tipo (PF/PJ)", "Documento", "Status", "Unidade(s)", "Completo", "Criado em", "E-mail", "Regime tributário (PJ)"];
    expect(await headers(page)).toEqual(expected); await shot(page, "16-adm-planilha-colunas-personalizadas");

    await page.reload(); await expect(page.locator('[data-testid="adm-table"]')).toBeVisible();
    expect(await headers(page)).toEqual(expected);                                                // persistiu no servidor, por usuário
    expect((await api(s).rpc("adm_view_get")).body.columns).toContain("tax_regime");

    // exportação respeita as colunas escolhidas
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar CSV" }).click()]);
    const csv = (await import("node:fs")).readFileSync(await dl.path()!, "utf8");
    expect(csv.split("\n")[0]).toContain("Regime tributário (PJ)"); expect(csv.split("\n")[0]).not.toContain("Cidade/UF");

    // "nome" é fixa
    await page.getByRole("button", { name: "Colunas" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Ocultar Nome / razão social" })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Restaurar padrão" }).click();
    await expect(page.getByText("Colunas restauradas para o padrão.")).toBeVisible();
    expect(await headers(page)).toEqual(DEFAULT);
    expect((await api(s).rpc("adm_view_get")).body.is_default).toBe(true);
    expect(errors).toEqual([]);
  });

  test("comercial: preferência é só dele, colunas restritas bloqueadas (interface E servidor), exportação sem campos sensíveis", async ({ page, context }) => {
    const s = await loginAs(context, QA.comercial); const errors = collectErrors(page);
    await api(s).rpc("adm_view_reset");
    await page.goto("/admin/adm/diretorio"); await expect(page.locator('[data-testid="adm-table"]')).toBeVisible();
    expect(await headers(page)).toEqual(DEFAULT);                                                 // não herdou as colunas do gestor

    await page.getByRole("button", { name: "Colunas" }).click();
    const dlg = page.getByRole("dialog");
    const restrita = dlg.locator('[data-col-hidden="tax_regime"]');
    await expect(restrita).toContainText("Somente gestor / administrador operacional"); await shot(page, "17-adm-colunas-restritas-para-comercial");
    await expect(restrita.getByRole("button", { name: /Mostrar/ })).toHaveCount(0);
    await dlg.getByRole("button", { name: "Mostrar Telefone", exact: true }).click(); await dlg.getByRole("button", { name: "Salvar preferência" }).click();
    await expect(page.getByText("Preferência de colunas salva")).toBeVisible();
    expect(await headers(page)).toContain("Telefone");

    // servidor: tentar forçar coluna restrita ao salvar e ao exportar
    const forced = await api(s).rpc("adm_view_save", { p_columns: ["name", "tax_regime", "state_registration", "phone"] });
    expect(forced.body.columns).toEqual(["name", "phone"]);
    const exp = await api(s).rpc("adm_export", { p_columns: ["name", "document", "tax_regime", "email_finance"] });
    expect(exp.status).toBe(200); expect(exp.body.columns).toEqual(["name", "document"]); expect(exp.body.masked_document).toBe(true);
    expect(exp.body.rows.every((r: Record<string, unknown>) => !("tax_regime" in r) && !("email_finance" in r))).toBe(true);
    const list = await api(s).rpc("adm_directory", { p_page_size: 5 });
    expect(list.body.rows.every((r: Record<string, unknown>) => r.tax_regime === null && r.state_registration === null && r.email_finance === null)).toBe(true);

    await api(s).rpc("adm_view_reset");
    expect(errors).toEqual([]);
  });
});
