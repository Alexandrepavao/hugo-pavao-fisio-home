import { expect, test, type Page } from "@playwright/test";

// Preview iOS · experiência do Administrador (dados fictícios, sem rede). Mesmo estado dos apps do paciente e do fisioterapeuta.
const hoje = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const url = (extra = "") => `/preview-ios?entrar=1&now=${hoje()}T12:00${extra}`;
const dev = (p: Page) => p.getByTestId("device");
const tab = (p: Page, nome: string) => p.getByRole("navigation", { name: "Navegação principal" }).getByRole("button", { name: nome });
const trocar = async (p: Page, quem: "Paciente" | "Fisioterapeuta" | "Administrador") => p.getByRole("complementary").getByRole("group", { name: "Experiência" }).getByRole("button", { name: quem }).click();
const kpi = (p: Page, label: string, valor: RegExp) => dev(p).getByRole("button", { name: new RegExp(`${label}: ${valor.source}`) });
const semOverflow = async (p: Page) => {
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState === "finished" || (a.effect?.getTiming().iterations === Infinity)));
  const r = await p.evaluate(() => { const s = document.querySelector(".ios-root")!; const bad: string[] = []; const root = s.getBoundingClientRect(); s.querySelectorAll("*").forEach((el) => { if (el.closest(".ios-chips")) return; const b = (el as HTMLElement).getBoundingClientRect(); if (b.width > 0 && (b.right > root.right + 1 || b.left < root.left - 1)) bad.push(`${el.tagName}.${(el as HTMLElement).className}`); }); return { bad: bad.slice(0, 5), sw: (s as HTMLElement).scrollWidth, cw: (s as HTMLElement).clientWidth }; });
  expect(r.bad, "elementos vazando na horizontal").toEqual([]); expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
};

test.use({ viewport: { width: 1400, height: 1000 } });
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.removeItem("hp-ios-preview-demo-v1"); } catch { /* */ } }); });

test("N21.1 painel: indicadores com detalhamento e atenção agora", async ({ page }) => {
  await page.goto(url("&role=admin"));
  await expect(dev(page).getByTestId("admin-kpis")).toContainText("Receita contratada");
  await expect(dev(page)).toContainText("Atenção agora");
  await expect(dev(page)).toContainText(/chamado\(s\) com prazo em risco/);
  await dev(page).getByRole("button", { name: /^Receita contratada/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Definição");
  await expect(page.getByRole("dialog")).toContainText("Período");
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();
});

test("N21.2 financeiro: autorizar e pagar repasses reflete em Ganhos do fisioterapeuta", async ({ page }) => {
  await page.goto(url("&role=physio"));
  await tab(page, "Ganhos").click();
  await expect(kpi(page, "Apurados", /R\$ 300,00/)).toBeVisible(); await expect(kpi(page, "Liberados", /R\$ 350,00/)).toBeVisible();
  await trocar(page, "Administrador");
  await tab(page, "Financeiro").click();
  await dev(page).getByText("Dr. Rafael Moreira").first().click();
  await dev(page).getByRole("button", { name: /Autorizar apurados/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Autorizar" }).click();
  await expect(dev(page)).toContainText("Repasses autorizados");
  await dev(page).getByRole("button", { name: /Marcar liberados como pagos/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Marcar como pagos" }).click();
  await trocar(page, "Fisioterapeuta");
  await tab(page, "Ganhos").click();
  await expect(kpi(page, "Pagos", /R\$ 1\.150,00/)).toBeVisible(); await expect(kpi(page, "Apurados", /R\$ 0,00/)).toBeVisible();
});

test("N21.3 repasse por produto vale daqui para frente e o ajuste aparece para o fisioterapeuta", async ({ page }) => {
  await page.goto(url("&role=admin"));
  await tab(page, "Financeiro").click();
  await dev(page).getByText("Cuidado com a lombar").first().click();
  const f = page.getByTestId("product-form"); await f.getByLabel(/Repasse por sessão/).fill("120,00");
  await f.getByRole("button", { name: "Revisar e salvar" }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar" }).click();
  await dev(page).getByText("Dr. Rafael Moreira").first().click();
  await dev(page).getByRole("button", { name: "Lançar ajuste ou estorno" }).click();
  await page.getByLabel("Valor (R$)").fill("30,00"); await page.getByLabel(/Motivo/).fill("Deslocamento extra aprovado");
  await page.getByRole("button", { name: "Lançar", exact: true }).click();
  await trocar(page, "Fisioterapeuta");
  await dev(page).getByRole("button", { name: "Confirmar atendimento" }).first().click();   // 1ª sessão do dia ainda aberta
  await tab(page, "Ganhos").click();
  await expect(dev(page)).toContainText("Deslocamento extra aprovado");
  await expect(dev(page)).toContainText(/Repasse por sessão, definido por produto|por sessão elegível/);
});

test("N21.4 chamado do paciente chega ao admin com SLA e a resposta volta ao paciente", async ({ page }) => {
  await page.goto(url());
  await tab(page, "Perfil").click();
  await page.getByLabel("Nova mensagem").fill("Preciso da segunda via do recibo da parcela 2.");
  await page.getByRole("button", { name: /Enviar à equipe/ }).click();
  await trocar(page, "Administrador");
  await tab(page, "Gestão").click();
  await dev(page).getByText("Chamados", { exact: true }).click();
  await dev(page).getByText(/Marina Duarte · Preciso da segunda via/).click();
  await expect(page.getByTestId("ticket")).toContainText("No prazo");
  await page.getByLabel(/Resposta \(o paciente vê\)/).fill("Enviamos o recibo por e-mail hoje.");
  await page.getByRole("button", { name: "Enviar resposta" }).click();
  await expect(page.getByTestId("ticket")).toContainText("Respondido em");
  await trocar(page, "Paciente");
  await tab(page, "Perfil").click();
  await expect(dev(page)).toContainText("Enviamos o recibo por e-mail hoje.");
});

test("N21.5 gestor lê a ficha só em leitura, com registro que o paciente enxerga", async ({ page }) => {
  await page.goto(url("&role=admin"));
  await tab(page, "Pacientes").click();
  await dev(page).getByText("Marina Duarte").first().click();
  await expect(page.getByTestId("admin-read-banner")).toContainText("SOMENTE LEITURA");
  await page.getByRole("group", { name: "Seções da ficha" }).getByRole("button", { name: "Evolução" }).click();
  await expect(dev(page).getByRole("button", { name: "Registrar evolução" })).toHaveCount(0);
  await expect(dev(page)).toContainText("Interna");       // vê a nota interna
  await trocar(page, "Paciente"); await tab(page, "Perfil").click();
  await expect(dev(page)).toContainText("Quem acessou meu prontuário");
  await expect(dev(page)).toContainText("Administração (gestor)");
});

test("N21.6 responsáveis, programas e restaurar demonstração", async ({ page }) => {
  await page.goto(url("&role=admin"));
  await tab(page, "Gestão").click();
  await dev(page).getByText("Responsáveis e cuidadores").click();
  await dev(page).getByText(/Carla Almeida/).click();
  await page.getByRole("button", { name: "Verificar vínculo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();
  await dev(page).getByRole("button", { name: "Voltar" }).click();
  await dev(page).getByText("Programas e ofertas").click();
  await dev(page).getByTestId("program-card").first().getByRole("button", { name: "Editar preço" }).click();
  await page.getByLabel("Preço final (R$)").fill("600,00"); await page.getByRole("button", { name: "Revisar e salvar" }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar" }).click();
  await expect(dev(page)).toContainText("R$ 600,00");
  await page.getByRole("complementary").getByRole("button", { name: "Restaurar demonstração" }).click();
  await tab(page, "Gestão").click(); await dev(page).getByText("Programas e ofertas").click();
  await expect(dev(page)).toContainText("R$ 560,00");
});

test("N21.7 admin: sem overflow nos 3 tamanhos, escuro e texto maior; e em celular", async ({ page, browser }) => {
  test.setTimeout(180_000);
  for (const size of ["se", "std", "max"]) {
    await page.goto(url(`&role=admin&size=${size}&theme=dark&text=1.3`));
    for (const n of ["Painel", "Pacientes", "Agenda", "Financeiro", "Gestão"]) { await tab(page, n).click(); await semOverflow(page); }
    await tab(page, "Gestão").click(); await dev(page).getByText("Chamados", { exact: true }).click(); await semOverflow(page);
  }
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const m = await ctx.newPage(); await m.goto(url("&role=admin"));
  await expect(m.getByTestId("fullscreen")).toBeVisible();
  for (const n of ["Painel", "Pacientes", "Agenda", "Financeiro", "Gestão"]) await tab(m, n).click();
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});
