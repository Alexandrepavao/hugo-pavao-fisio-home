// ACEITE da release v1 — CAPTAÇÃO PELOS BOTÕES DO SITE: nenhum botão abre o WhatsApp direto. Todos levam ao quiz da jornada certa (paciente ou fisioterapeuta),
// cuja 1ª etapa captura NOME COMPLETO, e-mail e WhatsApp (o lead é gravado ali). Paciente → quiz de avaliação; fisioterapeuta → quiz de parceria, que termina
// com as perguntas sobre um futuro programa de ensino para ter a própria clínica (interesse e prazo; o programa ainda não existe, nada é vendido).
// Dados próprios (runId, e-mails example.com); o WhatsApp é interceptado (nenhuma mensagem real).
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
const phone = () => `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const contact = async (p: Page, name: string, email: string) => {
  await p.getByLabel("Nome completo").fill(name); await p.getByLabel("E-mail", { exact: true }).fill(email); await p.getByLabel("WhatsApp com DDD").fill(phone());
  await p.getByRole("checkbox").click(); await p.getByRole("button", { name: "Continuar" }).click();
};
const next = (p: Page) => p.getByRole("button", { name: "Continuar" }).click();

test.describe.serial("@release Captação: botões do site → quiz (nome completo, e-mail e WhatsApp antes de tudo)", () => {
  test.setTimeout(180_000);

  test("nenhum botão do site abre o WhatsApp direto: paciente vai para /avaliacao e fisioterapeuta para /seja-parceiro, com a página de origem", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
    await ctx.route(/wa\.me|api\.whatsapp\.com/, (r) => r.abort());
    const p = await ctx.newPage(); const errors = collectErrors(p);
    let opened = 0; ctx.on("page", () => { opened++; });                              // só janelas abertas DEPOIS da página do teste
    const direct = () => p.locator('a[href*="wa.me"], a[href*="whatsapp.com"]').count();
    const check = async (path: string, action: () => Promise<void>, dest: RegExp) => {
      await p.goto(path); await p.waitForLoadState("networkidle"); expect(await direct(), `${path}: nenhum link direto para o WhatsApp`).toBe(0);
      await action(); await expect(p).toHaveURL(dest); await expect(p.getByLabel("Nome completo")).toBeVisible({ timeout: 20_000 });
      await expect(p.getByLabel("E-mail", { exact: true })).toBeVisible(); await expect(p.getByLabel("WhatsApp com DDD")).toBeVisible();
    };
    const paciente = /\/avaliacao\?from=%2F$/; const fisio = /\/seja-parceiro\?from=%2Ftrabalhe-conosco$/;
    await check("/", () => p.getByRole("button", { name: "Agendar Avaliação", exact: true }).click(), paciente);
    await check("/", () => p.getByRole("button", { name: /Agendar minha avaliação/ }).click(), paciente);
    await check("/", () => p.getByRole("button", { name: /Consultar disponibilidade na minha cidade/ }).click(), paciente);
    await check("/", () => p.getByRole("link", { name: /Agendar avaliação: falar com a HP/ }).click(), paciente);
    await check("/", () => p.getByRole("link", { name: /Pacientes \/ Agendamentos/ }).click(), paciente);
    await check("/trabalhe-conosco", () => p.getByRole("button", { name: "Quero fazer parte" }).first().click(), fisio);
    await check("/trabalhe-conosco", () => p.getByRole("button", { name: "Quero fazer parte" }).nth(1).click(), fisio);
    await check("/trabalhe-conosco", () => p.getByRole("link", { name: /Quero fazer parte: falar com a HP/ }).click(), fisio);
    await check("/trabalhe-conosco", () => p.getByRole("link", { name: /Fisioterapeutas \/ Trabalhe Conosco/ }).click(), fisio);
    expect(opened, "nenhuma janela do WhatsApp foi aberta").toBe(0);
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });

  test("nome completo é obrigatório: só o primeiro nome é recusado na 1ª etapa e nada é gravado", async ({ page }) => {
    await page.goto("/avaliacao"); await page.getByLabel("Nome completo").fill("Maria");
    await page.getByLabel("E-mail", { exact: true }).fill(`so.nome.${runId.toLowerCase()}@example.com`); await page.getByLabel("WhatsApp com DDD").fill(phone());
    await page.getByRole("checkbox").click(); await next(page);
    await expect(page.getByRole("alert")).toContainText("nome completo"); await expect(page.getByLabel("Nome completo")).toBeVisible();
    const g = api(await signIn(QA.manager)); const r = await g.rpc("list_quiz_leads", { p_journey: "atendimento", p_search: `so.nome.${runId.toLowerCase()}`, p_limit: 5, p_offset: 0 });
    expect((r.body as unknown[]).length, "nenhum lead gravado sem nome completo").toBe(0);
  });

  test("fisioterapeuta: quiz de parceria termina com o programa de ensino para ter a própria clínica (interesse e prazo), Voltar preserva a resposta e o lead guarda tudo", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p = await ctx.newPage(); const errors = collectErrors(p);
    await ctx.route(/wa\.me|api\.whatsapp\.com/, (r) => r.abort());
    const email = `fisio.clinica.${runId.toLowerCase()}@example.com`;
    await p.goto("/seja-parceiro?from=%2Ftrabalhe-conosco"); await expect(p.getByText(/Etapa 1 de 11/)).toBeVisible();
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/parceria-1-contato-desktop.png" });
    await contact(p, `Fisio Clínica E2E ${runId}`, email);
    await p.getByLabel("Cidade").fill("Campinas"); await p.getByLabel("UF").selectOption("SP"); await next(p);
    await p.getByRole("radio", { name: "Fisioterapeuta em atuação" }).click(); await next(p);
    await p.getByRole("radio", { name: "Ativo" }).click(); await next(p);
    await p.getByRole("radio", { name: "Ortopedia" }).click(); await next(p);
    await p.getByRole("radio", { name: "Atendimento domiciliar" }).click(); await next(p);
    await expect(p.getByText("O que você busca na parceria")).toBeVisible(); await p.getByRole("checkbox").nth(3).click(); await next(p);        // desenvolver meu negócio
    await expect(p.getByText("Em quais áreas você gostaria")).toBeVisible(); await p.getByRole("checkbox").nth(1).click(); await p.getByRole("checkbox").nth(4).click(); await next(p);   // posicionamento de marca + gestão

    // pergunta do programa: explicação clara, sem prometer resultado
    await expect(p.getByRole("heading", { name: /programa de ensino para você ter a sua própria clínica/ })).toBeVisible();
    const expl = p.getByTestId("quiz-explicacao");
    for (const t of [/posicionamento da sua marca/, /sistema de gestão 360/, /5 dígitos/, /ainda não existe/, /não há garantia de faturamento/, /Implementação do sistema/]) await expect(expl).toContainText(t);
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/parceria-programa-clinica-desktop.png", fullPage: true });
    await expect(p.getByRole("radio")).toHaveCount(3);
    await p.getByRole("radio", { name: "Quero entender melhor como funcionaria" }).click(); await next(p);

    // pergunta de prazo só aparece quando há interesse
    await expect(p.getByRole("heading", { name: /quando você gostaria de começar/ })).toBeVisible();
    await expect(p.getByText(/Etapa 10 de 11/)).toBeVisible();
    await p.getByRole("button", { name: "Voltar" }).click();                            // Voltar mantém a resposta anterior
    await expect(p.getByRole("radio", { name: "Quero entender melhor como funcionaria" })).toHaveAttribute("aria-checked", "true");
    await next(p);
    await p.getByRole("radio", { name: "Entre 3 e 6 meses" }).click(); await next(p);

    await p.getByRole("button", { name: "Concluir" }).click(); await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible({ timeout: 30_000 });
    const preview = p.getByLabel("Prévia da mensagem (você pode editar)");
    await expect(preview).toHaveValue(/Interesse em programa para ter a própria clínica: Quero entender melhor como funcionaria/); await expect(preview).toHaveValue(/Quando gostaria de começar: Entre 3 e 6 meses/);
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/parceria-concluido-desktop.png", fullPage: true });
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();

    const g = api(await signIn(QA.manager)); const list = await g.rpc("list_quiz_leads", { p_journey: "parceria", p_search: email, p_limit: 5, p_offset: 0 });
    expect(list.body).toHaveLength(1); expect(list.body[0]).toMatchObject({ status: "completed", origin_path: "/trabalhe-conosco" });
    const full = await g.rpc("get_quiz_lead_detail", { p_id: list.body[0].id }); const a = full.body.answers;
    expect(a.interesse_programa_clinica).toMatchObject({ value: "quero_entender", label: "Quero entender melhor como funcionaria" });
    expect(a.prazo_programa_clinica).toMatchObject({ value: "tres_seis_meses", label: "Entre 3 e 6 meses" });
  });

  test("fisioterapeuta sem interesse no programa: a pergunta de prazo é dispensada e o total de etapas diminui", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p = await ctx.newPage(); const errors = collectErrors(p);
    await ctx.route(/wa\.me|api\.whatsapp\.com/, (r) => r.abort());
    await p.goto("/seja-parceiro"); await contact(p, `Fisio Sem Programa E2E ${runId}`, `fisio.sem.${runId.toLowerCase()}@example.com`);
    await p.getByLabel("Cidade").fill("Santos"); await p.getByLabel("UF").selectOption("SP"); await next(p);
    await p.getByRole("radio", { name: "Estudante" }).click(); await next(p); await p.getByRole("radio", { name: "Ainda não possuo" }).click(); await next(p);
    await p.getByRole("radio", { name: "Geriátrica" }).click(); await next(p); await p.getByRole("radio", { name: "Ainda não atendo" }).click(); await next(p);
    await expect(p.getByText("O que você busca na parceria")).toBeVisible(); await p.getByRole("checkbox").nth(0).click(); await next(p);
    await expect(p.getByText("Em quais áreas você gostaria")).toBeVisible(); await p.getByRole("checkbox").nth(5).click(); await next(p);
    await expect(p.getByText(/Etapa 9 de 11/)).toBeVisible();
    await p.getByRole("radio", { name: "Não neste momento" }).click(); await next(p);
    await expect(p.getByRole("heading", { name: "Quase lá" })).toBeVisible(); await expect(p.getByText(/Etapa 10 de 10/)).toBeVisible();
    await expect(p.getByRole("heading", { name: /quando você gostaria de começar/ })).toHaveCount(0);
    await p.getByRole("button", { name: "Concluir" }).click(); await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible({ timeout: 30_000 });
    await expect(p.getByLabel("Prévia da mensagem (você pode editar)")).not.toHaveValue(/Quando gostaria de começar/);
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });

  test("paciente no celular: o quiz tem a interface nova (Voltar, progresso, escala 0–10 e opções em cartões), cabe na tela e conclui", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR", isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errors = collectErrors(p);
    await ctx.route(/wa\.me|api\.whatsapp\.com/, (r) => r.abort());
    await p.goto("/avaliacao?from=%2F"); await expect(p.getByText(/Etapa 1 de 9/)).toBeVisible(); expect(await noOverflow(p), "contato sem rolagem lateral").toBe(true);
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/paciente-1-contato-celular.png" });
    await contact(p, `Paciente Quiz E2E ${runId}`, `paciente.quiz.${runId.toLowerCase()}@example.com`);
    await p.getByLabel("Cidade").fill("São Paulo"); await p.getByLabel("UF").selectOption("SP"); await next(p);
    await p.getByRole("button", { name: "Concordo, continuar" }).click();
    await expect(p.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d+/);
    await p.getByRole("radio", { name: "7", exact: true }).click(); expect(await noOverflow(p), "escala sem rolagem lateral").toBe(true);
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/paciente-escala-celular.png" });
    await next(p); await expect(p.getByRole("heading", { name: /deseja melhorar/ })).toBeVisible(); await p.getByRole("radio", { name: "9", exact: true }).click(); await next(p);
    await expect(p.getByRole("heading", { name: /qualidade de vida melhoraria/ })).toBeVisible();
    await p.getByRole("button", { name: "Voltar" }).click(); await expect(p.getByRole("heading", { name: /deseja melhorar/ })).toBeVisible();
    await expect(p.getByRole("radio", { name: "9", exact: true })).toHaveAttribute("aria-checked", "true"); await next(p);   // Voltar preserva a nota
    await expect(p.getByRole("heading", { name: /qualidade de vida melhoraria/ })).toBeVisible(); await p.getByRole("radio", { name: "6", exact: true }).click(); await next(p);
    await expect(p.getByRole("heading", { name: /Qual atividade/ })).toBeVisible(); await p.getByRole("radio", { name: "Praticar esporte" }).click(); expect(await noOverflow(p), "opções sem rolagem lateral").toBe(true);
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/paciente-opcoes-celular.png" }); await next(p);
    await expect(p.getByRole("heading", { name: /Você teria interesse/ })).toBeVisible(); await p.getByRole("radio", { name: "Sim", exact: true }).click(); await next(p);
    await expect(p.getByRole("heading", { name: /qual investimento por sessão/ })).toBeVisible(); await p.getByRole("radio", { name: "Até R$ 250" }).click(); await next(p);
    await expect(p.getByText("não prometemos cura")).toBeVisible(); await p.getByRole("button", { name: "Concluir" }).click();
    await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible({ timeout: 30_000 }); expect(await noOverflow(p), "conclusão sem rolagem lateral").toBe(true);
    await p.waitForTimeout(500); await p.screenshot({ path: "docs/screenshots/quiz/paciente-concluido-celular.png", fullPage: true });
    expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
