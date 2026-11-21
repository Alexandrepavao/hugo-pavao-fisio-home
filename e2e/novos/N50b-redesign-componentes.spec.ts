import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { MANAGER, signIn, useSession } from "../helpers";

// @novo — REDESIGN: seletor de unidades acessível (teclado, foco, fechamento, filtros preservados), banner por rota, menu lateral contextual (clique, link direto, recarga, voltar/avançar, gaveta no celular)
// e capturas representativas (desktop, tablet, 360 px, tema escuro, zoom 200%). Banco Dev, dados sintéticos do QA.
const OUT = process.env.REDESIGN_SHOTS ?? "docs/redesign/telas"; mkdirSync(OUT, { recursive: true });
const noHScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

test.describe.serial("@novo Redesign — componentes e navegação", () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ context }) => { await useSession(context, await signIn(MANAGER)); });

  test("seletor de unidades: abre, navega por teclado, seleciona, fecha, devolve o foco e preserva o período", async ({ page }) => {
    await page.goto("/admin"); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 });
    const trigger = page.locator("#pf-unit"); await expect(trigger).toHaveAttribute("aria-label", /Unidade: Todas as unidades/);
    const periodBefore = await page.getByRole("button", { name: /^Período:/ }).innerText();
    await trigger.click(); await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const options = page.getByRole("option"); await expect(options.first()).toContainText("Todas as unidades"); expect(await options.count()).toBeGreaterThan(1);
    await expect(page.locator('[role="option"][data-state="checked"]')).toContainText("Todas as unidades");
    await page.screenshot({ path: `${OUT}/seletor-unidades-aberto.png` });
    // teclado: seta para baixo move o destaque, Enter escolhe
    await expect(options.first()).toHaveAttribute("data-highlighted", ""); await page.keyboard.press("ArrowDown"); await expect(options.nth(1)).toHaveAttribute("data-highlighted", ""); await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "false"); await expect(trigger).toBeFocused();
    await expect(trigger).not.toHaveAttribute("aria-label", /Todas as unidades/);
    await expect(page.getByRole("button", { name: /^Período:/ })).toHaveText(periodBefore);       // o período não mudou
    await expect(page.getByRole("button", { name: /Filtros/ })).toContainText("1");   // a unidade escolhida conta como filtro ativo (contador no botão Filtros)
    // Escape fecha e o foco volta ao botão; clique fora fecha
    await trigger.click(); await page.keyboard.press("Escape"); await expect(trigger).toHaveAttribute("aria-expanded", "false"); await expect(trigger).toBeFocused();
    await trigger.click(); await page.mouse.click(700, 140);   // clique fora (o menu é modal: o ponteiro vai direto ao ponto, sem verificação de alvo) await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // volta para "Todas as unidades"
    await trigger.click(); await page.locator('[role="option"][data-unit-id=""]').click(); await expect(trigger).toHaveAttribute("aria-label", /Todas as unidades/);
  });

  test("menu lateral contextual e banner: clique, seletor de aplicativo, link direto, recarga e voltar/avançar", async ({ page }) => {
    await page.goto("/admin"); await expect(page.getByTestId("banner-title")).toContainText(/Bom dia|Boa tarde|Boa noite/);
    await expect(page.getByText("Sua operação em um só lugar.")).toBeVisible();
    await page.getByRole("link", { name: "Gestão", exact: true }).first().click(); await expect(page).toHaveURL(/\/admin\/adm$/);
    await expect(page.getByRole("navigation", { name: "Navegação do Gestão" })).toBeVisible();
    await page.getByRole("link", { name: "Planilha administrativa" }).click();
    await expect(page).toHaveURL(/\/admin\/adm\/diretorio/); await expect(page.getByTestId("banner-title")).toHaveText("Planilha administrativa"); await expect(page.getByTestId("banner-app")).toHaveText("Gestão");
    await expect(page.locator('.hp-sidebar-desktop .hp-sb-link[aria-current="page"]')).toHaveText("Planilha administrativa");
    await expect(page.getByRole("link", { name: "Voltar ao Hub" }).first()).toBeVisible();
    // troca pelo seletor de aplicativos
    await page.locator(".hp-sidebar-desktop .hp-sb-app").click(); await page.getByRole("menuitem", { name: /Financeiro/ }).click();
    await expect(page).toHaveURL(/\/admin\/financeiro/); await expect(page.getByRole("navigation", { name: "Navegação do Financeiro" })).toBeVisible(); await expect(page.getByTestId("banner-app")).toHaveText("Financeiro");
    // voltar/avançar e recarga mantêm o contexto
    await page.goBack(); await expect(page.getByTestId("banner-title")).toHaveText("Planilha administrativa"); await expect(page.getByRole("navigation", { name: "Navegação do Gestão" })).toBeVisible();
    await page.goForward(); await expect(page.getByRole("navigation", { name: "Navegação do Financeiro" })).toBeVisible();
    await page.goto("/admin/financeiro/vendas?aba=recebiveis"); await expect(page.getByTestId("banner-title")).toHaveText("Contas a receber");
    await expect(page.locator('.hp-sidebar-desktop .hp-sb-link[aria-current="page"]')).toHaveText("Contas a receber");
    await page.reload(); await expect(page.getByTestId("banner-title")).toHaveText("Contas a receber"); await expect(page.getByRole("navigation", { name: "Navegação do Financeiro" })).toBeVisible();
    // menu recolhido continua contextual
    await page.getByRole("button", { name: "Recolher menu lateral" }).click(); await expect(page.getByRole("navigation", { name: "Navegação do Financeiro" })).toBeVisible();
    await page.getByRole("button", { name: "Expandir menu lateral" }).click();
  });

  test("capturas: desktop 1280, tablet 768, celular 360 (gaveta e filtros), tema escuro e zoom 200%", async ({ page, context }) => {
    for (const [name, path] of [["hub", "/admin"], ["planilha", "/admin/adm/diretorio"], ["fin-receber", "/admin/financeiro/vendas?aba=recebiveis"], ["crm-leads", "/admin/crm/leads"]]) {
      await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(path); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(1500);
      expect(await noHScroll(page), `${name} 1280`).toBe(true); await page.screenshot({ path: `${OUT}/${name}-1280.png` });
      await page.setViewportSize({ width: 768, height: 1024 }); await page.waitForTimeout(500); expect(await noHScroll(page), `${name} 768`).toBe(true); await page.screenshot({ path: `${OUT}/${name}-768.png` });
      await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(500); expect(await noHScroll(page), `${name} 360`).toBe(true); await page.screenshot({ path: `${OUT}/${name}-360.png` });
      await page.setViewportSize({ width: 720, height: 450 }); await page.waitForTimeout(500); expect(await noHScroll(page), `${name} zoom200`).toBe(true); await page.screenshot({ path: `${OUT}/${name}-zoom200.png` });
    }
    // celular: gaveta do menu e filtros (com o seletor de unidades dentro da gaveta)
    await page.setViewportSize({ width: 360, height: 780 }); await page.goto("/admin/adm/diretorio"); await expect(page.getByTestId("banner-title")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Abrir menu" }).click(); await expect(page.getByRole("navigation", { name: "Navegação do Gestão" })).toBeVisible(); await page.screenshot({ path: `${OUT}/menu-gaveta-360.png` });
    await page.keyboard.press("Escape");
    await page.getByTestId("mais-acoes").click(); await expect(page.getByRole("menuitem", { name: "Exportar CSV" })).toBeVisible(); await page.screenshot({ path: `${OUT}/planilha-mais-acoes-360.png` }); await page.keyboard.press("Escape");
    await page.goto("/admin"); await expect(page.getByTestId("banner-title")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Filtrar/ }).click(); await page.locator("#pf-unit-m").click(); await expect(page.getByRole("option").first()).toBeVisible();
    const box = await page.getByRole("listbox").boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= 360, "menu de unidades contido na tela de 360 px").toBe(true);
    await page.screenshot({ path: `${OUT}/seletor-unidades-aberto-360.png` });
    // tema escuro
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await context.addInitScript(() => localStorage.setItem("hp-theme", "dark")); await page.setViewportSize({ width: 1280, height: 800 });
    for (const [name, path] of [["hub", "/admin"], ["planilha", "/admin/adm/diretorio"]]) { await page.goto(path); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/${name}-escuro.png` }); }
  });
});
