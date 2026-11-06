import { expect, test, type Page } from "@playwright/test";

// Preview iOS (protótipo navegável, dados fictícios, sem rede). Não usa Supabase nem login.
const hoje = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const url = (extra = "") => `/preview-ios?entrar=1&now=${hoje()}T12:00${extra}`;
const dev = (p: Page) => p.getByTestId("device");
const tab = (p: Page, nome: string) => p.getByRole("navigation", { name: "Navegação principal" }).getByRole("button", { name: nome });
const trocar = async (p: Page, quem: "Paciente" | "Fisioterapeuta") => p.getByRole("complementary").getByRole("group", { name: "Experiência" }).getByRole("button", { name: quem }).click();
const semOverflow = async (p: Page) => {
  const r = await p.evaluate(() => { const s = document.querySelector(".ios-root")!; const bad: string[] = []; s.querySelectorAll("*").forEach((el) => { const b = (el as HTMLElement).getBoundingClientRect(); const root = s.getBoundingClientRect(); if (el.closest(".ios-chips")) return; if (b.width > 0 && (b.right > root.right + 1 || b.left < root.left - 1)) bad.push(`${el.tagName}.${(el as HTMLElement).className}`); }); return { bad: bad.slice(0, 5), sw: (s as HTMLElement).scrollWidth, cw: (s as HTMLElement).clientWidth }; });
  expect(r.bad, "elementos vazando na horizontal").toEqual([]); expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
};

test.use({ viewport: { width: 1400, height: 1000 } });
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.removeItem("hp-ios-preview-demo-v1"); } catch { /* */ } }); });

test("N20.1 entrada: aviso de demonstração e sem login real", async ({ page }) => {
  await page.goto(`/preview-ios?now=${hoje()}T12:00`);
  await expect(page.getByTestId("welcome")).toContainText("fictícios");
  await page.getByRole("button", { name: "Entrar na demonstração" }).click();
  await expect(tab(page, "Minha jornada")).toBeVisible();
});

test("N20.2 fluxo completo: fisio atribui rotina, paciente executa, fisio revisa, paciente vê a evolução compartilhada", async ({ page }) => {
  await page.goto(url("&role=physio"));
  await tab(page, "Pacientes").click();
  await page.getByText("Marina Duarte").first().click();
  await expect(page.getByTestId("patient-file")).toBeVisible();
  await page.getByRole("group", { name: "Seções da ficha" }).getByRole("button", { name: "Rotina" }).click();
  await page.getByRole("button", { name: /Criar nova rotina/ }).click();
  const ed = page.getByTestId("routine-editor");
  await ed.getByLabel("Nome da rotina").fill("Rotina Teste Z");
  const chips = ed.getByRole("group", { name: "Dias da rotina" }).getByRole("button");
  for (let i = 0; i < 7; i++) { const c = chips.nth(i); if ((await c.getAttribute("aria-pressed")) !== "true") await c.click(); }
  await ed.getByLabel("Orientação ao paciente").first().fill("Vá devagar, sem dor.");
  await ed.getByRole("button", { name: "Publicar rotina" }).click();
  await expect(dev(page)).toContainText("Rotina publicada");
  await expect(dev(page)).toContainText("Rotina Teste Z");

  // paciente executa
  await trocar(page, "Paciente");
  await expect(dev(page)).toContainText("Marina");
  await expect(dev(page)).toContainText("Rotina Teste Z");
  await dev(page).getByRole("button", { name: "Iniciar minha rotina" }).click();
  const run = page.getByTestId("runner");
  await expect(run.getByTestId("video-slot")).toContainText(/indispon/i);
  await run.getByRole("button", { name: "Ver passo a passo" }).click();
  await expect(run.getByTestId("steps")).toBeVisible();
  await run.getByRole("radio", { name: "Fiz parcialmente" }).click();
  await run.getByLabel("O que dificultou?").fill("Cansaço no final");
  await run.getByLabel(/Tem alguma dúvida/).fill("Posso diminuir as repetições hoje?");
  await run.getByRole("button", { name: /Concluir/ }).click();
  // terminar os demais exercícios da rotina, se houver
  for (let g = 0; g < 6; g++) {
    if (await page.getByTestId("runner-done").isVisible()) break;
    await page.getByTestId("runner").getByRole("radio", { name: "Concluído" }).click();
    await page.getByTestId("runner").getByRole("button", { name: /Concluir/ }).click();
  }
  await expect(page.getByTestId("runner-done")).toContainText("declarou");
  await page.getByRole("button", { name: "Voltar para Hoje" }).click();

  // fisio vê o feedback e responde; registra evolução com nota compartilhada + interna
  await trocar(page, "Fisioterapeuta");
  await tab(page, "Pacientes").click();
  await page.getByText("Marina Duarte").first().click();
  await page.getByRole("group", { name: "Seções da ficha" }).getByRole("button", { name: "Feedbacks" }).click();
  await expect(dev(page)).toContainText("Posso diminuir as repetições hoje?");
  await expect(dev(page)).toContainText("Fiz parcialmente (autodeclarado)");
  await dev(page).getByRole("button", { name: "Responder" }).first().click();
  await page.getByLabel(/Resposta \(o paciente vê\)/).fill("Pode reduzir para duas séries hoje.");
  await page.getByRole("button", { name: "Enviar resposta" }).click();
  await page.getByRole("group", { name: "Seções da ficha" }).getByRole("button", { name: "Evolução" }).click();
  await dev(page).getByRole("button", { name: "Registrar evolução" }).click();
  await page.getByLabel(/Mensagem para o paciente/).fill("Evolução compartilhada de teste: ótimo avanço.");
  await page.getByLabel(/Nota interna/).fill("NOTA-INTERNA-SIGILOSA-XYZ");
  await page.getByRole("button", { name: "Salvar evolução" }).click();
  await expect(dev(page)).toContainText("NOTA-INTERNA-SIGILOSA-XYZ");   // o fisio vê a interna

  // paciente vê resposta e a nota compartilhada, mas nunca a interna
  await trocar(page, "Paciente");
  await expect(dev(page)).toContainText("Pode reduzir para duas séries hoje.");
  await tab(page, "Minha jornada").click();
  await page.getByRole("group", { name: "Seções da jornada" }).getByRole("button", { name: "Metas" }).click();
  await expect(dev(page)).toContainText("Evolução compartilhada de teste");
  await expect(dev(page)).not.toContainText("NOTA-INTERNA-SIGILOSA-XYZ");
  await page.getByRole("complementary").getByRole("button", { name: "Restaurar demonstração" }).click();
});

test("N20.3 agenda e saldo: cancelamento mostra a consequência antes e descontos separados", async ({ page }) => {
  await page.goto(url());
  await tab(page, "Agenda").click();
  await expect(dev(page)).toContainText(/contratad/i);
  await dev(page).getByRole("button", { name: /Agendado/ }).first().click();
  await dev(page).getByRole("button", { name: "Cancelar atendimento" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(/menos de 24|descontad/i);
  await page.getByRole("alertdialog").getByRole("button", { name: /Manter|Voltar|Não/ }).first().click();
});

test("N20.4 ganhos: 4 buckets separados, regra fictícia e 12 × R$ 100 = R$ 1.200", async ({ page }) => {
  await page.goto(url("&role=physio"));
  await tab(page, "Ganhos").click();
  for (const l of ["Estimativa (futuro)", "Apurados", "Liberados", "Pagos"]) await expect(dev(page).getByRole("button", { name: new RegExp(l.replace(/[()]/g, "\\$&")) })).toBeVisible();
  await expect(dev(page)).toContainText("1.200");
  await expect(dev(page)).toContainText(/fictícia/i);
  await expect(dev(page)).not.toContainText(/faturamento da HP|receita da HP/i);
});

test("N20.5 telas: sem overflow nos 3 tamanhos, tema escuro e texto maior", async ({ page }) => {
  for (const size of ["se", "std", "max"]) for (const role of ["patient", "physio"]) {
    await page.goto(url(`&role=${role}&size=${size}&theme=dark&text=1.3`));
    const nomes = role === "patient" ? ["Hoje", "Minha jornada", "Exercícios", "Agenda", "Perfil"] : ["Hoje", "Pacientes", "Agenda", "Ganhos", "Perfil"];
    for (const n of nomes) { await tab(page, n).click(); await semOverflow(page); }
  }
});

test("N20.6 celular: tela cheia sem moldura e sem rolagem horizontal", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const page = await ctx.newPage(); await page.goto(url());
  await expect(page.getByTestId("fullscreen")).toBeVisible(); await expect(page.getByTestId("device")).toHaveCount(0);
  for (const n of ["Hoje", "Minha jornada", "Exercícios", "Agenda", "Perfil"]) await tab(page, n).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});
