// ACEITE — Portais do paciente e do fisio (F1 do plano docs/plano-portais-paciente-e-fisio.md): casca com barra inferior (celular) e lateral (computador),
// Início de cada um, destino do login por papel, isolamento de rotas e base do app instalável (PWA). Somente Dev.
import { expect, test } from "@playwright/test";
import { collectErrors, QA, uiLogin } from "./helpers-release";

const PASS = process.env.HP_QA_PASSWORD ?? "";
test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

test.describe.serial("@release Portais do paciente e do fisio", () => {
  test.setTimeout(120_000);

  test("paciente: login cai no Início; no celular a barra inferior tem 5 abas e não há rolagem lateral; as abas navegam", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, QA.paciente, PASS); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    await expect(page.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
    const bar = page.getByRole("navigation", { name: "Seções" });
    for (const t of ["Início", "Evolução", "Treinos", "Agenda", "Mais"]) await expect(bar.getByRole("link", { name: t })).toBeVisible();
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
    await bar.getByRole("link", { name: "Agenda" }).click(); await expect(page).toHaveURL(/\/paciente\/agenda$/); await expect(page.getByRole("heading", { name: "Meus atendimentos" })).toBeVisible();
    await bar.getByRole("link", { name: "Evolução" }).click(); await expect(page.getByRole("region", { name: "Minha jornada" })).toBeVisible({ timeout: 30_000 });
    await bar.getByRole("link", { name: "Mais" }).click(); await expect(page.getByRole("heading", { name: "Meus pacotes" })).toBeVisible();
    await bar.getByRole("link", { name: "Início" }).click(); await expect(page.getByTestId("patient-home")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("paciente no computador: barra lateral (e não a inferior); sair leva ao login", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await uiLogin(page, QA.paciente, PASS); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    const side = page.getByRole("complementary", { name: "Menu Meu acompanhamento" }); await expect(side).toBeVisible();
    await expect(side.getByRole("link", { name: "Treinos" })).toBeVisible();
    await expect(page.locator("nav.fixed")).toBeHidden();
    await page.getByRole("button", { name: "Menu do usuário" }).click(); await page.getByRole("menuitem", { name: "Sair" }).click(); await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test("fisio: login cai no portal dele com Início, números e menu próprio; as telas existentes abrem dentro da casca", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await uiLogin(page, QA.fisio, PASS); await expect(page).toHaveURL(/\/fisio$/, { timeout: 40_000 });
    await expect(page.getByTestId("physio-home")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pacientes ativos")).toBeVisible();
    for (const [name, url, heading] of [["Agenda", /\/fisio\/agenda$/, /Agenda/], ["Meu dia", /\/fisio\/dia$/, /Meu dia/], ["Desempenho", /\/fisio\/desempenho$/, /Meu resumo/]] as const) {
      await page.getByRole("complementary", { name: "Menu Portal do fisioterapeuta" }).getByRole("link", { name }).click(); await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 30_000 });
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("fisio no celular: barra inferior com 5 abas e sem rolagem lateral", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, QA.fisio, PASS); await expect(page).toHaveURL(/\/fisio$/, { timeout: 40_000 });
    await expect(page.getByTestId("physio-home")).toBeVisible({ timeout: 30_000 });
    const bar = page.getByRole("navigation", { name: "Seções" });
    for (const t of ["Início", "Pacientes", "Agenda", "Meu dia", "Desempenho"]) await expect(bar.getByRole("link", { name: t })).toBeVisible();
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
  });

  test("isolamento de rotas: paciente não abre /fisio nem /admin; fisio não abre /paciente; anônimo vai ao login", async ({ page, browser }) => {
    await uiLogin(page, QA.paciente, PASS); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    for (const p of ["/fisio", "/admin"]) { await page.goto(p); await expect(page.getByText("Sem permissão").first(), p).toBeVisible({ timeout: 30_000 }); }
    const ctx = await browser.newContext(); const p2 = await ctx.newPage();
    await uiLogin(p2, QA.fisio, PASS); await expect(p2).toHaveURL(/\/fisio$/, { timeout: 40_000 });
    await p2.goto("/paciente"); await expect(p2.getByText("Sem permissão").first()).toBeVisible({ timeout: 30_000 });
    await ctx.close();
    const anon = await browser.newContext(); const p3 = await anon.newPage();
    for (const p of ["/paciente", "/fisio"]) { await p3.goto(p); await expect(p3, p).toHaveURL(/\/login/, { timeout: 20_000 }); }
    await anon.close();
  });

  test("app instalável (PWA): manifesto, ícones e service worker são servidos; o service worker não guarda dado de API", async ({ request }) => {
    const m = await request.get("/manifest.webmanifest"); expect(m.status()).toBe(200);
    const mj = await m.json(); expect(mj.display).toBe("standalone"); expect(mj.start_url).toBe("/app"); expect(mj.icons.length).toBeGreaterThanOrEqual(3);
    for (const i of mj.icons as { src: string }[]) expect((await request.get(i.src)).status(), i.src).toBe(200);
    const sw = await request.get("/sw.js"); expect(sw.status()).toBe(200); const code = await sw.text();
    expect(code).toContain("url.origin !== self.location.origin");   // Supabase/outras origens passam direto, sem cache
    expect(code).not.toMatch(/caches\.put\([^)]*supabase/i);
  });
});
