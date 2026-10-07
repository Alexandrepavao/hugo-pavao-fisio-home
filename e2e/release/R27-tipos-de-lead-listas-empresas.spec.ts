// ACEITE da release v1 — CRM com TIPOS DE LEAD: paciente, fisioterapeuta (equipe), fisioterapeuta (HP Academy) e empresa (B2B).
//  · Listas têm tipo obrigatório; lista de empresas guarda empresas (cadastradas ali mesmo, sem duplicar); a planilha administrativa separa Pessoas físicas × Empresas.
//  · O mesmo lead (Junior) tem oportunidades em mais de um funil e cada uma anda sozinha (avançar uma não move a outra).
//  · Funil de empresas: a oportunidade é da EMPRESA (contato = pessoa) e não se abre outra da mesma empresa.
// Dados próprios (runId, "R27"); não precisa de token de gestão do Dev. Listas e oportunidades são apagadas no fim quando as permissões do QA deixam; empresas ficam (o cadastro não tem exclusão).
import { expect, test } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, rest, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const cnpj = () => {
  const d = [...Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)), 0, 0, 0, 1];
  const dv = (n: number[]) => { const w = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = n.reduce((a, v, i) => a + v * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(d); const d2 = dv([...d, d1]); return [...d, d1, d2].join("");
};

test.describe.serial("@release CRM: tipos de lead, listas com tipo, empresas e várias oportunidades por lead", () => {
  test.setTimeout(240_000);
  const company = `Empresa R27 ${runId}`; const listP = `Lista R27 pacientes ${runId}`; const listC = `Lista R27 empresas ${runId}`; const junior = `Junior Santos R27 ${runId}`; const contactName = `Contato Compras R27 ${runId}`;
  const S: Record<string, string> = {}; let pipes: { id: string; kind: string; name: string }[] = []; let stages: { id: string; pipeline_id: string; position: number; kind: string }[] = [];
  const pipeOf = (kind: string) => pipes.find((p) => p.kind === kind)!;
  const openStages = (pid: string) => stages.filter((s) => s.pipeline_id === pid && s.kind === "open").sort((a, b) => a.position - b.position);

  test("fixtures: funis por tipo e um lead (Junior) cadastrado como pessoa", async () => {
    const g = api(await signIn(QA.manager));
    pipes = (await g.get("pipelines?select=id,kind,name&active=eq.true")).body; stages = (await g.get("pipeline_stages?select=id,pipeline_id,position,kind")).body;
    for (const k of ["patients", "partners", "education", "companies"]) { expect(pipes.some((p) => p.kind === k), `existe funil do tipo ${k}`).toBe(true); expect(openStages(pipeOf(k).id).length, `funil ${k} tem 2+ etapas abertas`).toBeGreaterThanOrEqual(2); }
    S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const p = await g.rpc("create_person", { p_full_name: junior, p_unit_id: S.unit, p_kinds: ["lead"], p_email: `junior.r27.${runId.toLowerCase()}@example.com`, p_phone: null, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); S.junior = p.body.id;
  });

  test("Listas: tipo obrigatório, selo e filtro por tipo; lista de empresas guarda empresas (cadastro novo, sem duplicar)", async ({ page, context }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page);
    await page.goto("/admin/crm/listas"); await expect(page.getByRole("heading", { name: "Listas", exact: true })).toBeVisible({ timeout: 40_000 });
    await page.locator("#lst-name").fill(listP); await page.getByRole("button", { name: "Criar lista" }).click(); await expect(page.getByText(/Escolha o tipo da lista/)).toBeVisible();     // sem tipo: recusa na tela
    await page.locator("#lst-kind").selectOption("patients"); await page.getByRole("button", { name: "Criar lista" }).click(); await expect(page.getByText("Lista criada.")).toBeVisible();
    await page.locator("#lst-name").fill(listC); await page.locator("#lst-kind").selectOption("companies"); await page.getByRole("button", { name: "Criar lista" }).click(); await expect(page.getByText("Lista criada.")).toBeVisible({ timeout: 20_000 });
    const rowP = page.getByTestId("lista-linha").filter({ hasText: listP }); const rowC = page.getByTestId("lista-linha").filter({ hasText: listC });
    await expect(rowP.locator('[data-kind="patients"]')).toContainText("Paciente"); await expect(rowC.locator('[data-kind="companies"]')).toContainText("Empresa · B2B");
    await page.getByTestId("lista-filtros").getByRole("button", { name: /^Empresas/ }).click(); await expect(rowC).toHaveCount(1); await expect(rowP).toHaveCount(0);
    await page.getByTestId("lista-filtros").getByRole("button", { name: /^Todas/ }).click();
    // lista de empresas: a empresa é cadastrada ali mesmo (com contato) e entra na lista
    await rowC.getByRole("button", { name: "Abrir" }).click(); await page.getByRole("button", { name: "Nova empresa" }).click();
    const dlg = page.getByRole("dialog"); await dlg.locator("#co-name").fill(company); await dlg.locator("#co-cnpj").fill(cnpj()); await dlg.locator("#co-unit").selectOption({ index: 1 });
    await dlg.locator("#co-cname").fill(contactName); await dlg.locator("#co-crole").fill("Compras"); await dlg.locator("#co-cemail").fill(`compras.r27.${runId.toLowerCase()}@example.com`);
    await dlg.getByRole("button", { name: "Cadastrar empresa" }).click();
    // contato de rodadas anteriores com nome parecido: o cadastro pede decisão (comportamento esperado) e o teste escolhe “outra pessoa”
    const dupBox = dlg.getByTestId("contact-dup"); if (await dupBox.waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false)) await dupBox.getByRole("button", { name: "Criar como outra pessoa" }).click();
    await expect(page.getByRole("row").filter({ hasText: company })).toHaveCount(1, { timeout: 30_000 });
    const g = api(await signIn(QA.comercial)); const co = (await g.get(`legal_entities?select=id,origin&legal_name=eq.${encodeURIComponent(company)}`)).body; expect(co).toHaveLength(1); expect(co[0].origin).toBe("CRM (B2B)"); S.company = co[0].id;
    const reps = (await g.get(`legal_entity_representatives?select=role_title,is_primary,person:people(full_name)&legal_entity_id=eq.${S.company}`)).body; expect(reps).toHaveLength(1); expect(reps[0]).toMatchObject({ role_title: "Compras", is_primary: true });
    // repetir o cadastro com o mesmo nome pede decisão: não duplica
    await page.getByRole("button", { name: "Nova empresa" }).click(); await dlg.locator("#co-name").fill(company.toLowerCase()); await dlg.locator("#co-unit").selectOption({ index: 1 }); await dlg.getByRole("button", { name: "Cadastrar empresa" }).click();
    await expect(dlg.getByTestId("company-dup")).toContainText("Já existe uma empresa com este nome"); await dlg.getByRole("button", { name: "Cancelar" }).click();
    expect(((await g.get(`legal_entities?select=id&legal_name=ilike.${encodeURIComponent(company)}`)).body as unknown[]).length, "continua UMA empresa").toBe(1);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Planilha administrativa separa Pessoas físicas × Empresas, e o menu Cadastro tem “Empresas”", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/adm/diretorio"); const abas = page.getByTestId("adm-abas-tipo"); await expect(abas.getByRole("tab", { name: /^Pessoas físicas/ })).toBeVisible({ timeout: 40_000 });
    await page.getByRole("link", { name: "Empresas", exact: true }).first().click(); await expect(page).toHaveURL(/tipo=pj/); await expect(page.getByRole("heading", { name: "Empresas", exact: true })).toBeVisible();
    await page.locator("#dir-q").fill(company); await expect(page.getByTestId("adm-table").getByRole("row").filter({ hasText: company })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("adm-table").getByRole("row").filter({ hasText: company })).toContainText("PJ");
    await abas.getByRole("tab", { name: /^Pessoas físicas/ }).click(); await expect(page).toHaveURL(/tipo=pf/); await expect(page.getByRole("row").filter({ hasText: company })).toHaveCount(0);     // empresa não aparece na aba de pessoas
    await abas.getByRole("tab", { name: /^Empresas/ }).click(); await expect(page.getByRole("button", { name: "Nova empresa" })).toBeVisible(); await expect(page.getByRole("row").filter({ hasText: company })).toHaveCount(1, { timeout: 30_000 });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("um lead, várias oportunidades: Junior entra na equipe e na HP Academy; avançar uma NÃO move a outra", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const eq = pipeOf("partners"); const ac = pipeOf("education");
    await page.goto(`/admin/crm/oportunidades?funil=${eq.id}`); await expect(page.getByTestId("funis-tipos")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("funis-tipos").locator(`[data-funil="${eq.id}"]`)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Nova oportunidade" }).click(); const dlg = page.getByRole("dialog");
    await dlg.locator("#no-p").fill(junior); await dlg.getByRole("button", { name: junior }).click(); await dlg.locator("#no-t").fill("Junior — quer trabalhar conosco"); await dlg.getByRole("button", { name: "Criar oportunidade" }).click();
    await expect(page.getByText("Oportunidade criada.")).toBeVisible({ timeout: 20_000 });
    await page.locator("#f-q").fill(junior); await page.getByRole("button", { name: new RegExp(`^${junior}`) }).first().click();
    const sheet = page.getByRole("dialog"); const lista = sheet.getByTestId("opps-da-pessoa"); await expect(lista.getByTestId("opp-irma")).toHaveCount(1);
    await lista.locator("#add-funil").selectOption({ label: "Fisioterapeuta · HP Academy" }); await lista.getByRole("button", { name: "Adicionar" }).click();
    await expect(lista.getByTestId("opp-irma")).toHaveCount(2, { timeout: 20_000 }); await expect(lista.locator(`[data-pipeline="${ac.id}"]`)).toContainText("HP Academy");
    // avançar SÓ a de equipe
    const second = openStages(eq.id)[1]; const rowEq = lista.locator(`[data-pipeline="${eq.id}"]`); await rowEq.locator("select").selectOption(second.id);
    await expect(page.getByText(/as outras oportunidades não mudaram/)).toBeVisible({ timeout: 20_000 });
    const g = api(await signIn(QA.manager)); const opps = (await g.get(`opportunities?select=id,pipeline_id,stage_id,status&person_id=eq.${S.junior}`)).body as { pipeline_id: string; stage_id: string; status: string }[];
    expect(opps).toHaveLength(2); expect(opps.every((o) => o.status === "open")).toBe(true);
    expect(opps.find((o) => o.pipeline_id === eq.id)!.stage_id, "a de equipe avançou").toBe(second.id); expect(opps.find((o) => o.pipeline_id === ac.id)!.stage_id, "a da Academy continua na 1ª etapa").toBe(openStages(ac.id)[0].id);
    // a ficha de cada funil abre pelo link “Abrir” (mesma pessoa, outra oportunidade)
    await lista.locator(`[data-pipeline="${ac.id}"]`).getByRole("link", { name: "Abrir" }).click(); await expect(page).toHaveURL(new RegExp(`funil=${ac.id}`)); await expect(page.getByTestId("funis-tipos").locator(`[data-funil="${ac.id}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("dialog").getByTestId("opps-da-pessoa").locator('[data-testid="opp-irma"]').filter({ hasText: "Esta" })).toContainText("HP Academy", { timeout: 20_000 });
    // painel: contagem por tipo de lead
    await page.goto("/admin/crm"); const cards = page.getByTestId("tipos-de-lead"); await expect(cards.locator('[data-kind="partners"]')).toContainText("Fisioterapeuta · Equipe", { timeout: 40_000 }); await expect(cards.locator('[data-kind="education"]')).toContainText("HP Academy");
    expect(Number(await cards.locator('[data-kind="partners"] [data-testid="tipo-abertas"]').innerText())).toBeGreaterThanOrEqual(1);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("funil de empresas: a oportunidade é da empresa (contato = pessoa) e não se abre outra da mesma empresa; Gestão de leads mostra o tipo", async ({ page, context }) => {
    await loginAs(context, QA.comercial); const errors = collectErrors(page); const emp = pipeOf("companies");
    await page.goto(`/admin/crm/oportunidades?funil=${emp.id}`); await expect(page.getByTestId("funis-tipos").locator(`[data-funil="${emp.id}"]`)).toHaveAttribute("aria-pressed", "true", { timeout: 40_000 });
    await page.getByRole("button", { name: "Nova oportunidade" }).click(); const dlg = page.getByRole("dialog");
    await dlg.locator("#no-c").fill(company.slice(0, 14)); await dlg.getByRole("button", { name: company }).click();
    await expect(dlg.locator("#no-p")).toHaveValue(contactName, { timeout: 20_000 });                                // o contato principal da empresa já vem escolhido
    await dlg.getByRole("button", { name: "Criar oportunidade" }).click(); await expect(page.getByText("Oportunidade criada.")).toBeVisible({ timeout: 20_000 });
    const card = page.getByRole("button", { name: new RegExp(`^${company}`) }).first(); await expect(card).toBeVisible({ timeout: 20_000 }); await expect(page.getByText(`Contato: ${contactName}`).first()).toBeVisible();   // o card mostra a EMPRESA e o contato
    const g = api(await signIn(QA.comercial)); const o = (await g.get(`opportunities?select=id,legal_entity_id,person:people(full_name)&legal_entity_id=eq.${S.company}`)).body; expect(o).toHaveLength(1); expect(o[0].person.full_name).toBe(contactName);
    // segunda oportunidade da mesma empresa é recusada, com mensagem clara
    await page.getByRole("button", { name: "Nova oportunidade" }).click(); await dlg.locator("#no-c").fill(company.slice(0, 14)); await dlg.getByRole("button", { name: company }).click();
    await expect(dlg.locator("#no-p")).toHaveValue(contactName, { timeout: 20_000 }); await dlg.getByRole("button", { name: "Criar oportunidade" }).click();
    await expect(dlg.getByRole("alert")).toContainText(/já existe uma oportunidade aberta/); await dlg.getByRole("button", { name: "Cancelar" }).click();
    expect(((await g.get(`opportunities?select=id&legal_entity_id=eq.${S.company}`)).body as unknown[]).length, "continua UMA oportunidade da empresa").toBe(1);
    // Gestão de leads: coluna de tipo e filtro por tipo
    await page.goto("/admin/crm/leads"); const filtros = page.getByTestId("leads-tipos"); await expect(filtros.getByRole("button", { name: /^Empresa · B2B/ })).toBeVisible({ timeout: 40_000 });
    await filtros.getByRole("button", { name: /^Empresa · B2B/ }).click(); const row = page.getByRole("row").filter({ hasText: company }); await expect(row).toHaveCount(1, { timeout: 20_000 }); await expect(row.locator('[data-kind="companies"]')).toContainText("Empresas");
    await filtros.getByRole("button", { name: /^Paciente/ }).click(); await expect(page.getByRole("row").filter({ hasText: company })).toHaveCount(0);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões: fisioterapeuta e paciente não veem listas, empresas das listas nem a visão por funil; e limpeza das listas", async () => {
    for (const mail of [QA.fisio, QA.paciente]) {
      const a = api(await signIn(mail));
      expect(((await a.get("crm_lead_lists?select=id")).body as unknown[]).length, mail).toBe(0);
      expect(((await a.get("crm_lead_list_companies?select=list_id")).body as unknown[]).length, mail).toBe(0);
      const ov = await a.rpc("crm_pipeline_overview", {}); const total = ov.status === 200 ? (ov.body as { open_count: number }[]).reduce((n, r) => n + r.open_count, 0) : 0;
      expect(total, `${mail} não enxerga oportunidades pela visão por funil`).toBe(0);
      expect((await a.rpc("crm_company_create", { p_legal_name: `Empresa intrusa ${runId}` })).status, mail).not.toBe(200);
    }
    const cs = await signIn(QA.comercial); const c = api(cs);
    for (const n of [listP, listC]) await rest(cs, "DELETE", `crm_lead_lists?name=eq.${encodeURIComponent(n)}`);
    for (const n of [listP, listC]) expect(((await c.get(`crm_lead_lists?select=id&name=eq.${encodeURIComponent(n)}`)).body as unknown[]).length, `lista ${n} removida`).toBe(0);
  });
});
