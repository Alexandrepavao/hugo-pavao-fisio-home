// ACEITE da release v1 — telefone e Instagram únicos do site (27/10/2026): (11) 91363-4424 e @hpfisiogroup.
//  · rodapé (todas as páginas públicas), dados estruturados do Google (index.html) e o WhatsApp aberto no fim do quiz usam o número novo; nada do número/Instagram antigo sobra
import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe("@release Contato do site: telefone e Instagram", () => {
  test("rodapé mostra (11) 91363-4424 nos dois contatos e o Instagram @hpfisiogroup com link para o perfil", async ({ page }) => {
    const errors = collectErrors(page);
    for (const rota of ["/", "/trabalhe-conosco"]) {
      await page.goto(rota); const rodape = page.locator("footer");
      await expect(rodape.getByText("(11) 91363-4424")).toHaveCount(2);
      await expect(rodape).not.toContainText("95907-5351"); await expect(rodape).not.toContainText("@hpfisioterapia");
      const insta = rodape.getByRole("link", { name: /Instagram @hpfisiogroup/ }); await expect(insta).toHaveAttribute("href", "https://instagram.com/hpfisiogroup");
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("dados estruturados da página (JSON-LD) usam o telefone novo", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain('"telephone": "+5511913634424"'); expect(html).not.toContain("5907");
  });
});
