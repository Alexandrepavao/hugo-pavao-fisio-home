// NOVO — N32: formulário de parceria com resumo da experiência (opcional, última pergunta) + captura progressiva (o que foi marcado/digitado grava sem clicar em Continuar),
// e a tag de área de atuação + o resumo do parceiro nos cards do CRM (ficha, Kanban, Gestão de leads) e da Captação; origem “quiz:academy” aparece como “Quiz: Academy”.
// Dados próprios (runId), removidos no fim.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };
const tag = runId.toLowerCase(); const phone = () => `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
const nome = `Marina Resumo N32 ${runId}`; const emailA = `marina.n32.${tag}@example.com`; const nomeB = `Bruno Parou N32 ${runId}`; const emailB = `bruno.n32.${tag}@example.com`;
const RESUMO = "8 anos em neurologia adulta, 3 deles em atendimento domiciliar; pós-graduação em neurofuncional.";
const next = (p: Page) => p.getByRole("button", { name: "Continuar" }).click();
const lead = async (email: string) => ((await devSql(`select status, answers, city, state_uf, person_id from public.quiz_leads where email = '${email}'`)) as { status: string; answers: Record<string, { value: unknown; label: string; detalhe?: string }>; city: string | null; state_uf: string | null; person_id: string }[])[0];
const contato = async (p: Page, n: string, email: string) => {
  await p.getByLabel("Nome completo").fill(n); await p.getByLabel("E-mail", { exact: true }).fill(email); await p.getByLabel("WhatsApp com DDD").fill(phone());
  await p.getByRole("checkbox").click(); await next(p); await expect(p.getByText("Em qual cidade e estado")).toBeVisible();
};

test.describe.serial("@novos Resumo do parceiro: formulário e cards", () => {
  test.setTimeout(300_000);
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.interactions where person_id in (select id from public.people where full_name like '% N32 ${runId}');
      delete from public.crm_tasks where person_id in (select id from public.people where full_name like '% N32 ${runId}');
      delete from public.opportunities where person_id in (select id from public.people where full_name like '% N32 ${runId}');
      delete from public.quiz_leads where full_name like '% N32 ${runId}';
      delete from public.person_contacts where person_id in (select id from public.people where full_name like '% N32 ${runId}');
      delete from public.person_kinds where person_id in (select id from public.people where full_name like '% N32 ${runId}');
      delete from public.person_tags where person_id in (select id from public.people where full_name like '% N32 ${runId}');
      delete from public.people where full_name like '% N32 ${runId}';`).catch(() => null);
  };
  test.beforeAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("formulário: a última pergunta pede o resumo da experiência (opcional) e o que está sendo digitado já é gravado, sem clicar em Continuar", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/seja-parceiro"); await expect(page.getByText(/Etapa 1 de 12/)).toBeVisible(); await contato(page, nome, emailA);
    await page.getByLabel("Cidade").fill("Campinas"); await page.getByLabel("UF").selectOption("SP"); await next(page);
    await page.getByRole("radio", { name: "Fisioterapeuta em atuação" }).click(); await next(page);
    await page.getByRole("radio", { name: "Ainda não possuo" }).click(); await next(page);
    // captura progressiva em pergunta de múltipla escolha: marcou a área e NÃO clicou em Continuar
    await page.getByRole("radio", { name: "Neurológica" }).click();
    await expect.poll(async () => (await lead(emailA))?.answers?.area_atuacao?.value, { timeout: 15_000, message: "a área marcada é gravada sozinha" }).toBe("neurologica");
    await next(page);
    await page.getByRole("radio", { name: "Atendimento domiciliar" }).click(); await next(page);
    await page.getByRole("checkbox").nth(0).click(); await next(page);
    await page.getByRole("checkbox").nth(5).click(); await next(page);
    await page.getByRole("radio", { name: "Quero entender melhor como funcionaria" }).click(); await next(page);
    await page.getByRole("radio", { name: "Entre 3 e 6 meses" }).click(); await next(page);
    // última pergunta
    await expect(page.getByRole("heading", { name: /conte, em poucas linhas, sua experiência profissional/ })).toBeVisible(); await expect(page.getByText(/Etapa 11 de 12/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled();   // opcional
    const caixa = page.getByLabel(/Resumo da sua experiência profissional/); await expect(caixa).toHaveJSProperty("tagName", "TEXTAREA");
    await caixa.fill(RESUMO); await expect(page.getByText(`${RESUMO.length}/1000`)).toBeVisible(); await shot(page, "form-parceiro-resumo");
    await expect.poll(async () => (await lead(emailA))?.answers?.resumo_experiencia?.value, { timeout: 15_000, message: "o texto digitado é gravado sozinho" }).toBe(RESUMO);
    expect((await lead(emailA)).status, "ainda não concluiu").not.toBe("completed");
    await next(page); await expect(page.getByRole("heading", { name: "Quase lá" })).toBeVisible();
    await page.getByRole("button", { name: "Concluir" }).click(); await expect(page.getByText(/Recebemos suas respostas/)).toBeVisible({ timeout: 30_000 });
    const l = await lead(emailA); expect(l.status).toBe("completed"); expect(l.answers.resumo_experiencia.value).toBe(RESUMO); expect(l.answers.area_atuacao.label).toBe("Neurológica");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("quem para no meio é captado com o que respondeu: marcou a experiência, digitou o CREFITO e fechou a página sem continuar", async ({ page }) => {
    await page.goto("/seja-parceiro"); await contato(page, nomeB, emailB);
    await page.getByLabel("Cidade").fill("Santos"); await page.getByLabel("UF").selectOption("SP"); await next(page);
    await page.getByRole("radio", { name: "Estudante" }).click(); await next(page);
    await page.getByRole("radio", { name: "Ativo" }).click(); await next(page);
    await expect(page.getByRole("heading", { name: "Qual é o número do seu CREFITO?" })).toBeVisible();
    await page.getByLabel("Número do CREFITO").fill("CREFITO-3/777777-F");
    await expect.poll(async () => (await lead(emailB))?.answers?.crefito?.value, { timeout: 15_000 }).toBe("CREFITO-3/777777-F");
    const l = await lead(emailB); expect(l.status).not.toBe("completed"); expect(l.city).toBe("Santos"); expect(l.answers.momento_profissional.value).toBe("estudante"); expect(l.answers.situacao_registro.value).toBe("ativo");
    await page.close();   // fecha sem continuar
    expect((await lead(emailB)).answers.crefito.value).toBe("CREFITO-3/777777-F");
  });

  test("CRM: a ficha do lead mostra a tag da área e o resumo do parceiro; a origem vira “Quiz: Academy”", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    const [o] = await devSql(`select o.id, o.pipeline_id from public.opportunities o where o.person_id = '${(await lead(emailA)).person_id}' and o.source = 'quiz:academy'`) as { id: string; pipeline_id: string }[];
    await page.goto(`/admin/crm/oportunidades?funil=${o.pipeline_id}&abrir=${o.id}`);
    const ficha = page.getByRole("dialog"); await expect(ficha).toBeVisible({ timeout: 40_000 });
    await expect(ficha.getByText("Quiz: Academy", { exact: true })).toBeVisible(); await expect(ficha).not.toContainText("quiz:academy");
    await expect(ficha.getByTestId("partner-area-tag").first()).toHaveText("Neurológica");
    const resumo = ficha.getByTestId("partner-summary"); await expect(resumo).toBeVisible();
    await expect(resumo).toContainText("Fisioterapeuta em atuação"); await expect(resumo).toContainText("Neurológica"); await expect(resumo).toContainText("Ainda não possuo"); await expect(resumo).toContainText("Atendimento domiciliar");
    await expect(resumo.getByTestId("partner-resumo")).toHaveText(RESUMO); await shot(page, "crm-ficha-parceiro-resumo");
    await page.keyboard.press("Escape");
    // card no Kanban do funil da Academy
    const card = page.getByRole("button", { name: new RegExp(nome) }).first(); await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("card-resumo-parceiro")).toContainText("Neurológica"); await expect(card.getByTestId("card-resumo-parceiro")).toContainText("8 anos em neurologia");
    await expect(card).toContainText("Quiz: Academy"); await expect(card).not.toContainText("quiz:academy"); await shot(page, "crm-kanban-parceiro");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("CRM › Gestão de leads e Captação › Respostas de captação: tag de área e resumo em cada registro; status em português", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/leads"); const linhas = page.getByRole("row").filter({ hasText: nome }); await expect(linhas).toHaveCount(2, { timeout: 40_000 });   // a mesma pessoa está nos funis de Equipe e de HP Academy
    for (const i of [0, 1]) { await expect(linhas.nth(i).getByTestId("partner-area-tag")).toHaveText("Neurológica"); await expect(linhas.nth(i)).toContainText("Fisioterapeuta em atuação · Neurológica"); }
    await expect(linhas.filter({ hasText: "Quiz: Academy" })).toHaveCount(1); await expect(linhas.filter({ hasText: "Quiz: Parceria" })).toHaveCount(1); await shot(page, "gestao-leads-parceiro");
    // Captação › Indicadores › Respostas
    await page.goto("/admin/captacao-leads"); await page.getByRole("tab", { name: "Indicadores" }).click();
    await page.getByRole("button", { name: /^Respostas/ }).first().click();
    const folha = page.getByRole("dialog"); await expect(folha).toContainText("Respostas de captação", { timeout: 30_000 });
    const rMarina = folha.getByRole("listitem").filter({ hasText: nome }); await expect(rMarina).toBeVisible({ timeout: 20_000 });
    await expect(rMarina.getByTestId("captacao-resumo-parceiro")).toContainText("Neurológica"); await expect(rMarina.getByTestId("captacao-resumo-parceiro")).toContainText("8 anos em neurologia"); await expect(rMarina).toContainText("Concluído");
    const rBruno = folha.getByRole("listitem").filter({ hasText: nomeB }); await expect(rBruno).toBeVisible(); await expect(rBruno).toContainText("Estudante"); await expect(rBruno).toContainText("Parou no meio");
    await expect(folha).not.toContainText(/\b(started|partial|completed)\b/); await shot(page, "captacao-respostas-parceiro");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
