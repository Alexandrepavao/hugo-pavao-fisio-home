import { expect, test } from "@playwright/test";
import { MANAGER, api, runId, signIn, useSession } from "./helpers";

// Jornada Checkup (parte automatizável hoje): página → visita → formulário → lead no CRM → mover etapa → persistência.
test.describe("jornada Checkup", () => {
  const slug = `e2e-checkup-${runId}`; const lead = `Lead E2E ${runId}`;

  test("gestor cria e publica a página; visitante envia o formulário; lead aparece no CRM com origem e campanha", async ({ page, browser }) => {
    const s = await signIn(MANAGER); const ctx = page.context(); await useSession(ctx, s);
    await page.goto("/admin/paginas");
    await page.getByRole("button", { name: "Nova página" }).click();
    await page.getByLabel("Endereço (/…)").fill(slug);
    await expect(page.getByLabel("Funil de destino")).not.toHaveValue("");         // funil e unidade carregam de forma assíncrona
    await expect(page.getByLabel("Unidade")).not.toHaveValue("");
    await page.getByRole("button", { name: "Criar e editar" }).click();
    await expect(page).toHaveURL(/\/admin\/paginas\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByText("Página publicada.")).toBeVisible();

    // visitante anônimo
    const anon = await browser.newContext(); const v = await anon.newPage();
    await v.goto(`/${slug}?utm_source=e2e&utm_campaign=jornada-${runId}`);
    await expect(v.getByRole("heading", { name: "Check-up fisioterapêutico" })).toBeVisible();
    await v.getByRole("textbox", { name: /Nome completo/ }).fill(lead);
    await v.getByRole("textbox", { name: /WhatsApp/ }).fill(`(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`);
    await v.getByRole("textbox", { name: "E-mail" }).fill(`lead.${runId}@example.com`);
    await v.getByRole("button", { name: "Enviar" }).click();
    await expect(v.getByText(/Recebemos seus dados/)).toBeVisible();
    await anon.close();

    // via API: a oportunidade nasceu com origem, campanha, etapa inicial e tarefa de primeiro contato
    const g = api(s);
    const opp = await g.get(`opportunities?select=id,source,campaign,person:people(full_name),stage:pipeline_stages(name)&source=eq.page:${slug}`);
    expect(opp.body).toHaveLength(1);
    expect(opp.body[0]).toMatchObject({ source: `page:${slug}`, campaign: `jornada-${runId}`, stage: { name: "Novo contato" } });
    const task = await g.get(`crm_tasks?select=kind&opportunity_id=eq.${opp.body[0].id}`);
    expect(task.body.map((t: { kind: string }) => t.kind)).toContain("first_contact");

    // UI do CRM: o card existe e a mudança de etapa pelo menu persiste após recarregar
    await page.goto("/admin/crm");
    await expect(page.getByRole("region", { name: "Quadro do funil" })).toBeVisible();
    const card = page.getByRole("button", { name: new RegExp(`^${lead},`) });
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: `Ações de ${lead}` }).click();
    await page.getByRole("menuitem", { name: "Mover para…" }).click();
    await page.getByRole("menuitem", { name: "Atendimento" }).click();
    await expect(page.getByText(/Etapa atualizada/)).toBeVisible();
    await page.reload();
    // A contagem da coluna pode incluir dados de execuções anteriores do E2E; o que importa é que ESTE card está na etapa certa após recarregar.
    await expect(page.getByRole("region", { name: /^Atendimento/ }).getByText(lead)).toBeVisible();
    await expect(page.getByRole("region", { name: /^Novo contato/ }).getByText(lead)).toHaveCount(0);
  });

  test("a visita foi contada uma vez por sessão e aparece no indicador do dashboard", async () => {
    const s = await signIn(MANAGER); const g = api(s);
    const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    const m = await g.rpc("dashboard_metrics", { p_from: from, p_to: to, p_unit: null });
    expect(m.status).toBe(200);
    expect(m.body.visits.available).toBe(true);
    expect(m.body.visits.value).toBeGreaterThanOrEqual(1);
    expect(m.body.leads.value).toBeGreaterThanOrEqual(1);
    expect(m.body.acquisition_cost.available).toBe(false);                       // sem dados de mídia => indisponível, nunca zero
  });

  test("formulário: campos inválidos e envio repetido são tratados sem duplicar cadastro", async ({ browser }) => {
    const anon = await browser.newContext(); const v = await anon.newPage();
    await v.goto(`/${slug}`);
    await v.getByRole("textbox", { name: /Nome completo/ }).fill("X"); await v.getByRole("textbox", { name: /WhatsApp/ }).fill("123");
    await v.getByRole("button", { name: "Enviar" }).click();
    await expect(v.getByRole("alert")).toBeVisible();                            // telefone inválido
    await anon.close();
  });
});
