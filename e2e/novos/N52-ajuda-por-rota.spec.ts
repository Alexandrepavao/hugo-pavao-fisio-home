import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { MANAGER, signIn, useSession } from "../helpers";
import { ROUTES } from "./rotas-redesign";

// @novo — AJUDA E TOUR em TODAS as rotas estáticas do /admin (gestor QA): painel “Ajuda” com conteúdo da tela, “Conhecer esta tela” abre um tour com passos reais (≥ 2),
// Esc encerra, nenhum erro de console. Grava docs/redesign/ajuda-por-rota.json (passos do tour por rota) para a matriz.
test.use({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
test("ajuda e tour em todas as rotas", async ({ page, context }) => {
  test.setTimeout(1_200_000);
  await useSession(context, await signIn(MANAGER));
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const out: { path: string; titulo: string; passos: number; finalidade?: string; tarefa?: string; relacionadas?: string[]; titulosPassos?: string[]; semAjuda?: boolean }[] = []; const problems: string[] = [];
  for (const r of ROUTES) {
    await page.goto(r.path); await expect(page.getByTestId("page-banner")).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(1500);
    await page.getByTestId("ajuda-botao").click(); const painel = page.getByTestId("ajuda-painel");
    if (!(await painel.isVisible())) { problems.push(`${r.path}: painel de ajuda não abriu`); out.push({ path: r.path, titulo: "", passos: 0, semAjuda: true }); continue; }
    const titulo = (await painel.locator("h2").innerText()).trim(); const finalidade = (await painel.locator("p.text-muted-foreground").first().innerText()).trim();
    if (finalidade.length < 15) problems.push(`${r.path}: finalidade vazia`);
    await page.getByTestId("ajuda-conhecer").click();
    const ok = await page.getByTestId("tour").waitFor({ timeout: 15_000 }).then(() => true, () => false);
    if (!ok) { problems.push(`${r.path}: o tour não encontrou nenhum elemento real`); out.push({ path: r.path, titulo, passos: 0 }); continue; }
    const prog = (await page.getByTestId("tour-progresso").innerText()).match(/de (\d+)/i); const n = prog ? Number(prog[1]) : 0;
    if (n < 2) problems.push(`${r.path}: tour com só ${n} passo(s)`);
    const tarefa = (await painel.locator("section").first().locator("p").first().innerText().catch(() => "")).trim(); const rel = await painel.locator("a").allInnerTexts();
    const titulos: string[] = []; for (let k = 0; k < n; k++) { titulos.push((await page.locator(".hp-tour-title").innerText()).trim()); if (k < n - 1) await page.getByTestId("tour-proximo").click(); }
    out.push({ path: r.path, titulo, passos: n, finalidade, tarefa, relacionadas: rel, titulosPassos: titulos });
    await page.keyboard.press("Escape"); await expect(page.getByTestId("tour")).toHaveCount(0);
  }
  writeFileSync("docs/redesign/ajuda-por-rota.json", JSON.stringify(out, null, 1));
  console.log("AJUDA problemas:", problems.length, "\n" + problems.join("\n"), "\nerros de página:", errors.length);
  expect.soft(problems, problems.join("\n")).toEqual([]); expect(errors).toEqual([]);
});
