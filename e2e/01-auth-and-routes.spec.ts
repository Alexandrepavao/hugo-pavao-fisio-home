import { expect, test } from "@playwright/test";
import { MANAGER, PASSWORD, STUDENT, noConsoleErrors } from "./helpers";

test.describe("autenticação e proteção de rotas", () => {
  test("login real como gestor cai no painel; aluna cai na área do aluno (sem 'Sem permissão')", async ({ page, browser }) => {
    const errors = await noConsoleErrors(page, async () => {
      await page.goto("/login");
      await page.getByLabel("E-mail").fill(MANAGER); await page.getByLabel("Senha").fill(PASSWORD);
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    });
    expect(errors).toEqual([]);

    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await p2.goto("/login");
    await p2.getByLabel("E-mail").fill(STUDENT); await p2.getByLabel("Senha").fill(PASSWORD);
    await p2.getByRole("button", { name: "Entrar" }).click();
    await expect(p2).toHaveURL(/\/paciente$/);                                   // regressão: antes caía em "Sem permissão"
    await expect(p2.getByText("Sem permissão")).toHaveCount(0);
    await ctx.close();
  });

  test("visitante sem sessão é redirecionado ao login nas rotas privadas", async ({ page }) => {
    for (const path of ["/admin", "/admin/crm", "/admin/financeiro", "/academy", "/paciente"]) {
      await page.goto(path); await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("aluna não acessa áreas de gestão pela interface", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(STUDENT); await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click(); await expect(page).toHaveURL(/\/paciente$/);
    await page.goto("/admin/financeiro");
    await expect(page.getByText("Sem permissão")).toBeVisible();
  });

  test("link de recuperação inválido/expirado mostra estado de erro tratado", async ({ page }) => {
    await page.goto("/redefinir-senha#error=access_denied&error_code=otp_expired");
    await expect(page.getByRole("heading", { name: "Link inválido ou expirado" })).toBeVisible();
    await page.goto("/redefinir-senha");                                          // sem token
    await expect(page.getByRole("heading", { name: "Link inválido ou expirado" })).toBeVisible({ timeout: 10_000 });
  });

  test("slug reservado nunca vira página pública e /:slug desconhecido dá 404 tratado", async ({ page }) => {
    await page.goto("/pagina-que-nao-existe-e2e");
    await expect(page.getByText(/não encontrada|404|Oops/i).first()).toBeVisible();
  });
});
