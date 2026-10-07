// ACEITE da release v1 — MAPA DO SITE (seção “Cobertura nacional”): geometria real dos 26 estados + DF, as 16 cidades da rede como pontos, destaque ao escolher uma cidade
// e sem rolagem lateral no celular. Sem login e sem banco.
import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe("@release Mapa do site", () => {
  for (const [nome, viewport] of [["desktop", { width: 1280, height: 900 }], ["celular", { width: 390, height: 844 }]] as const) {
    test(`${nome}: 27 estados, 16 cidades, destaque da cidade escolhida e sem rolagem lateral`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport, timezoneId: "America/Sao_Paulo", locale: "pt-BR", isMobile: nome === "celular", hasTouch: nome === "celular" });
      const p = await ctx.newPage(); const errors = collectErrors(p);
      await p.goto("/"); const mapa = p.getByRole("img", { name: /Mapa do Brasil com as cidades/ }); await mapa.scrollIntoViewIfNeeded(); await expect(mapa).toBeVisible();
      expect(await mapa.locator("path").count(), "26 estados + Distrito Federal").toBe(27);
      expect(await mapa.locator("g[role=img]").count(), "cidades da rede").toBe(16);
      for (const c of ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Salvador", "Recife", "Fortaleza", "Belém", "Manaus", "Brasília", "Goiânia", "Campo Grande", "Curitiba", "Florianópolis", "Porto Alegre", "Cuiabá", "Rio Branco"])
        await expect(p.getByRole("img", { name: new RegExp(`^${c}, [A-Z]{2}$`) })).toHaveCount(1);
      const recife = p.getByRole("button", { name: /^Recife/ }); await recife.click();
      await expect(recife).toHaveAttribute("aria-pressed", "true"); await expect(mapa.locator("text")).toHaveText("Recife");   // etiqueta no mapa
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sem rolagem lateral").toBe(true);
      await p.waitForTimeout(500); await mapa.screenshot({ path: `docs/screenshots/mapa-site/mapa-${nome}.png` });
      expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
    });
  }
});
