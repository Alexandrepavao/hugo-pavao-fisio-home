// ACEITE da release v1 (escopo ampliado, etapa 4) — "Meu dia" com visões Dia/Semana/Mês, bloco "Conectar calendários": assinatura .ics somente leitura com link
// mostrado uma vez e revogável (o link baixado de verdade), e Google Calendar claramente pendente de configuração. Não testa o Google (sem credenciais).
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoFatal, loginAs, QA } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Calendários (Meu dia e assinatura .ics)", () => {
  test.setTimeout(150_000);

  test("Meu dia: visões Dia, Semana e Mês e navegação", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    await page.goto("/admin/meu-dia");
    const views = page.getByRole("group", { name: "Visualização" });
    await expect(views.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await views.getByRole("button", { name: "Semana" }).click();
    await expect(views.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");
    const week = page.getByRole("grid", { name: "Semana" }); await expect(week).toBeVisible({ timeout: 30_000 });
    await expect(week.getByRole("region")).toHaveCount(7);                                          // sete dias
    const title1 = (await page.locator("[aria-live=polite]").filter({ hasText: /\d/ }).first().textContent())!;
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.locator("[aria-live=polite]").filter({ hasText: /\d/ }).first()).not.toHaveText(title1);
    await page.getByRole("button", { name: "Anterior" }).click();
    await expect(page.locator("[aria-live=polite]").filter({ hasText: /\d/ }).first()).toHaveText(title1);
    await views.getByRole("button", { name: "Mês" }).click();
    const month = page.getByRole("grid", { name: "Mês" }); await expect(month).toBeVisible({ timeout: 30_000 });
    expect(await month.getByRole("button").count()).toBeGreaterThanOrEqual(28);                      // um botão por dia do mês
    await month.getByRole("button").nth(10).click();                                                 // escolher um dia volta para a visão Dia
    await expect(views.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true");
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("assinatura .ics: gerar link (mostrado uma vez), baixar o calendário de verdade, gerar outro derruba o antigo e revogar derruba o novo", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    await page.goto("/admin/meu-dia");
    const box = page.getByRole("region", { name: "Conectar calendários" });
    await expect(box.getByText("Somente leitura").first()).toBeVisible({ timeout: 30_000 });
    await expect(box.getByText(/não sincronização bidirecional/i)).toBeVisible();
    // gerar
    const first = box.getByRole("button", { name: /Gerar link de assinatura|Gerar novo link/ });
    const wasActive = /novo/.test(await first.innerText());
    await first.click();
    if (wasActive) await page.getByRole("button", { name: "Gerar novo link" }).last().click();       // confirmação de troca
    const linkInput = box.getByLabel("Link de assinatura (https)"); await expect(linkInput).toBeVisible({ timeout: 20_000 });
    const link1 = await linkInput.inputValue(); expect(link1).toMatch(/\/functions\/v1\/calendar-feed\?t=[0-9a-f]{64}$/);
    await expect(box.getByText(/mostrado uma única vez/i)).toBeVisible();
    // baixar de verdade
    const r1 = await fetch(link1); const ics = await r1.text();
    expect(r1.status).toBe(200); expect(r1.headers.get("content-type")).toMatch(/text\/calendar/);
    expect(ics).toContain("BEGIN:VCALENDAR"); expect(ics).toContain("VERSION:2.0");
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]); expect(new Set(uids).size).toBe(uids.length);
    expect([...ics.matchAll(/^SUMMARY:(.+)$/gm)].every((m) => /^Atendimento HP/.test(m[1]))).toBe(true);   // conteúdo mínimo
    // o link desaparece ao recarregar (não é mostrado de novo)
    await page.reload(); await expect(box.getByLabel("Link de assinatura (https)")).toHaveCount(0);
    await expect(box.getByText(/Link ativo desde/)).toBeVisible({ timeout: 30_000 });
    // gerar outro: o antigo deixa de funcionar na hora
    await box.getByRole("button", { name: "Gerar novo link" }).click();
    await page.getByRole("button", { name: "Gerar novo link" }).last().click();
    const link2 = await box.getByLabel("Link de assinatura (https)").inputValue(); expect(link2).not.toBe(link1);
    expect((await fetch(link1)).status).toBe(404); expect((await fetch(link2)).status).toBe(200);
    // revogar
    await box.getByRole("button", { name: "Revogar link" }).click();
    await page.getByRole("button", { name: "Revogar" }).last().click();
    await expect(box.getByText("Link revogado.")).toBeVisible({ timeout: 20_000 });
    expect((await fetch(link2)).status).toBe(404);
    await expect(box.getByRole("button", { name: "Gerar link de assinatura" })).toBeVisible();
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Google Calendar: sem credenciais no servidor, a tela diz 'indisponível por configuração' e não finge conexão", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.goto("/admin/meu-dia");
    const box = page.getByRole("region", { name: "Conectar calendários" });
    await expect(box.getByRole("heading", { name: /Google Calendar \(sincronização\)/ })).toBeVisible({ timeout: 30_000 });
    await expect(box.getByText(/nunca no principal/i).first()).toBeVisible();          // alcance informado: escreve só no calendário criado pelo app
    await box.getByRole("button", { name: "Conectar Google Calendar" }).click();
    await expect(box.getByText(/indispon[ií]vel por configuração/i)).toBeVisible({ timeout: 20_000 });
    await expect(box.getByText("Conectado")).toHaveCount(0);
    expect(page.url()).not.toContain("accounts.google.com");
  });
});
