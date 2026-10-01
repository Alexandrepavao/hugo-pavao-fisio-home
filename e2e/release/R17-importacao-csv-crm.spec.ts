// ACEITE da release v1 — IMPORTAÇÃO CSV DO CRM pela tela: modelo, arquivo com `;` e acentos, mapeamento de colunas, prévia, validação por linha, deduplicação no servidor,
// conflito com decisão explícita (nada é sobrescrito sozinho), reimportação do MESMO arquivo sem duplicar, relatório, origem/campanha/unidade/lista/etapa, permissões e celular.
// Dados próprios (runId), removidos no fim. (Kanban/drag and drop: R06; KPIs do CRM: R07 e SQL S17; listas/tarefas/metas: R07 e R12.)
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Importação CSV do CRM", () => {
  test.setTimeout(180_000);
  const rid = runId.toLowerCase(); const file = `r17-${rid}.csv`; const listName = `Lista R17 ${runId}`;
  const mail = (k: string) => `${k}.r17.${rid}@example.com`;
  const nJoana = `Joana Quasar ${runId}`; const nMaria = `Maria Existente ${runId}`; const nMariaX = `Maria E. Silva ${runId}`;
  let unitId = ""; let unitName = ""; let orgId = ""; let pipeId = ""; let listId = ""; let mariaId = "";
  const csv = ["Nome Completo;E-mail;Celular;Canal;Campanha;Observações",
    `${nJoana};${mail("joana")};(11) 97777-2222;Instagram;Feira de saúde 2026;primeira linha`,
    `${nMaria};${mail("maria")};11988881111;;;`,
    `${nMariaX};${mail("maria")};(11) 95555-3333;;;`,
    `Sem Contato ${runId};;;;;`,
    `Email Ruim ${runId};sem-arroba;(11) 96666-5555;;;`].join("\n");
  const clean = async () => {
    const people = `select id from public.people where full_name in ('${nJoana}', '${nMaria}', '${nMariaX}') or id in (select person_id from public.person_contacts where value like '%.r17.${rid}@example.com')`;
    await devSql(`delete from public.opportunities where person_id in (${people})`);
    await devSql(`delete from public.crm_lead_list_members where person_id in (${people})`);
    await devSql(`delete from public.crm_lead_lists where name = '${listName}'`);
    await devSql(`delete from public.crm_imports where filename = '${file}'`);
    await devSql(`delete from public.person_kinds where person_id in (${people})`).catch(() => null);
    await devSql(`delete from public.person_contacts where person_id in (${people})`).catch(() => null);
    await devSql(`delete from public.people where full_name in ('${nJoana}', '${nMaria}', '${nMariaX}')`).catch(() => null);
  };
  const countOpps = async (name: string) => ((await devSql(`select count(*)::int n from public.opportunities o join public.people p on p.id = o.person_id where p.full_name = '${name}'`)) as { n: number }[])[0].n;
  const countPeople = async () => ((await devSql(`select count(*)::int n from public.people where full_name in ('${nJoana}', '${nMaria}', '${nMariaX}')`)) as { n: number }[])[0].n;

  /** Abre o diálogo, envia o arquivo, escolhe os padrões do lote, confere o mapeamento e chega à prévia. */
  const toPreview = async (page: Page) => {
    await page.goto("/admin/crm/leads"); await page.getByRole("button", { name: "Importar CSV" }).click();
    const dlg = page.getByRole("dialog"); await expect(dlg.getByText("Passo 1 de 4")).toBeVisible({ timeout: 30_000 });
    await dlg.locator("#crmi-file").setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from("﻿" + csv, "utf8") });
    await expect(dlg.getByText(/5 linha\(s\), 6 coluna\(s\)/)).toBeVisible();
    await dlg.locator("#crmi-unit").selectOption(unitId); await dlg.locator("#crmi-pipe").selectOption(pipeId); await dlg.locator("#crmi-list").selectOption(listId);
    await dlg.locator("#crmi-source").fill("Importação de teste"); await dlg.locator("#crmi-campaign").fill("Campanha padrão R17");
    await dlg.getByRole("button", { name: "Continuar" }).click(); await expect(dlg.getByText("Passo 2 de 4")).toBeVisible();
    // o sistema sugeriu o mapeamento pelos cabeçalhos (acentos, “Canal”→Origem, “Celular”→Telefone); “Observações” não é mapeada
    for (const [k, i] of [["name", "0"], ["email", "1"], ["phone", "2"], ["source", "3"], ["campaign", "4"]]) await expect(dlg.locator(`#crmi-map-${k}`)).toHaveValue(i);
    for (const k of ["unit", "owner", "list", "stage", "value", "title"]) await expect(dlg.locator(`#crmi-map-${k}`)).toHaveValue("");
    await dlg.getByRole("button", { name: "Verificar (prévia)" }).click(); await expect(dlg.getByText("Passo 3 de 4")).toBeVisible({ timeout: 30_000 });
    return dlg;
  };

  test("fixtures: lista, uma pessoa já cadastrada (Maria, com e-mail e telefone) e o funil de pacientes", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    await clean();
    const u = (await devSql(`select id, name, org_id from public.units where slug = 'sao-paulo'`)) as { id: string; name: string; org_id: string }[]; unitId = u[0].id; unitName = u[0].name; orgId = u[0].org_id;
    pipeId = ((await devSql(`select id from public.pipelines where active and kind = 'patients' order by created_at limit 1`)) as { id: string }[])[0].id;
    expect(((await devSql(`select count(*)::int n from public.pipeline_stages where pipeline_id = '${pipeId}' and kind = 'open'`)) as { n: number }[])[0].n).toBeGreaterThan(0);
    listId = ((await devSql(`insert into public.crm_lead_lists (org_id, name) values ('${orgId}', '${listName}') returning id`)) as { id: string }[])[0].id;
    mariaId = ((await devSql(`insert into public.people (org_id, unit_id, full_name) values ('${orgId}', '${unitId}', '${nMaria}') returning id`)) as { id: string }[])[0].id;
    await devSql(`insert into public.person_kinds (person_id, kind) values ('${mariaId}', 'lead')`);
    await devSql(`insert into public.person_contacts (org_id, person_id, type, value, is_primary) values ('${orgId}', '${mariaId}', 'email', '${mail("maria")}', true), ('${orgId}', '${mariaId}', 'phone', '(11) 98888-1111', true)`);
  });

  test("modelo para baixar: só o cabeçalho, com as colunas que a importação entende", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/crm/leads"); await page.getByRole("button", { name: "Importar CSV" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar modelo (CSV)" }).click()]);
    expect(dl.suggestedFilename()).toBe("modelo-importacao-crm.csv");
    const txt = (await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8")).replace(/^﻿/, "");
    expect(txt.trim().split("\n")).toHaveLength(1); expect(txt).toMatch(/^nome,email,telefone,origem,campanha,unidade,responsavel,lista,etapa,valor,titulo/);
  });

  test("prévia: nova, existente, conflito, inválidas — com o motivo de cada linha; nada é gravado", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    const before = await countPeople();
    const dlg = await toPreview(page);
    const row = (n: number) => dlg.locator(`tr[data-status]`).nth(n);
    await expect(dlg.getByLabel("Resumo da prévia")).toContainText("1 novas"); await expect(dlg.getByLabel("Resumo da prévia")).toContainText("1 já cadastradas"); await expect(dlg.getByLabel("Resumo da prévia")).toContainText("1 conflitos"); await expect(dlg.getByLabel("Resumo da prévia")).toContainText("2 inválidas");
    await expect(row(0)).toHaveAttribute("data-status", "new"); await expect(row(1)).toHaveAttribute("data-status", "existing"); await expect(row(2)).toHaveAttribute("data-status", "conflict");
    await expect(row(2)).toContainText(/Mesma pessoa \(mesmo contato\), com dados diferentes/); await expect(row(2)).toContainText(/nome: cadastro “.*” × arquivo “.*”/i); await expect(row(2)).toContainText(/telefone: cadastro/i);
    await expect(row(3)).toContainText(/informe e-mail ou telefone/); await expect(row(4)).toContainText(/e-mail inválido/);
    await expect(row(0).getByText(/Linha|^2$/).first()).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Importar 2 linha(s)" })).toBeEnabled();                    // o conflito sem decisão não conta
    expect(await countPeople()).toBe(before); expect(await countOpps(nJoana)).toBe(0);                      // a prévia não grava
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("importar: cria a pessoa nova, vincula a existente, deixa o conflito pendente (sem sobrescrever) e registra origem, campanha, lista e etapa inicial", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    const dlg = await toPreview(page);
    await dlg.getByRole("button", { name: "Importar 2 linha(s)" }).click();
    await expect(dlg.getByText("Passo 4 de 4")).toBeVisible({ timeout: 40_000 });
    const res = dlg.getByRole("status"); await expect(res).toContainText("1 criadas"); await expect(res).toContainText("1 vinculadas a cadastros existentes"); await expect(res).toContainText("1 pendentes"); await expect(res).toContainText("2 com erro");
    await expect(dlg.getByLabel("Resultado por linha")).toContainText("Linha 4"); await expect(dlg.getByLabel("Resultado por linha")).toContainText("Pendente");   // linha física do arquivo
    // relatório CSV
    const [dl] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Baixar relatório (CSV)" }).click()]);
    const rep = (await (await import("node:fs/promises")).readFile((await dl.path())!, "utf8")); expect(rep).toContain("linha_do_arquivo"); expect(rep).toContain("Inválida"); expect(rep).toContain("Conflito"); expect(rep).toContain("Criada");
    // banco
    expect(await countOpps(nJoana)).toBe(1); expect(await countOpps(nMaria)).toBe(1); expect(await countPeople()).toBe(2);              // Joana + Maria; a “Maria E. Silva” NÃO foi criada
    const j = (await devSql(`select o.source, o.campaign, o.pipeline_id, st.position, o.unit_id, o.owner_user_id is not null as owner, (select count(*) from public.crm_lead_list_members m where m.list_id = '${listId}' and m.person_id = o.person_id)::int in_list,
        (select count(*) from public.person_kinds k where k.person_id = o.person_id and k.kind = 'lead')::int lead_kind from public.opportunities o join public.people p on p.id = o.person_id join public.pipeline_stages st on st.id = o.stage_id where p.full_name = '${nJoana}'`)) as { source: string; campaign: string; pipeline_id: string; position: number; unit_id: string; owner: boolean; in_list: number; lead_kind: number }[];
    expect(j[0]).toMatchObject({ source: "Instagram", campaign: "Feira de saúde 2026", pipeline_id: pipeId, unit_id: unitId, owner: true, in_list: 1, lead_kind: 1 });      // coluna da linha vale mais que o padrão
    const m = (await devSql(`select o.source, o.campaign from public.opportunities o where o.person_id = '${mariaId}'`)) as { source: string; campaign: string }[];
    expect(m[0]).toEqual({ source: "Importação de teste", campaign: "Campanha padrão R17" });                                         // sem coluna: valem os padrões do lote
    const maria = (await devSql(`select p.full_name, (select string_agg(c.value, ',' order by c.value) from public.person_contacts c where c.person_id = p.id) contacts from public.people p where p.id = '${mariaId}'`)) as { full_name: string; contacts: string }[];
    expect(maria[0].full_name).toBe(nMaria); expect(maria[0].contacts).not.toContain("95555-3333");                                    // nada sobrescrito
    const imp = (await devSql(`select row_count, summary from public.crm_imports where filename = '${file}'`)) as { row_count: number; summary: Record<string, number> }[];
    expect(imp).toHaveLength(1); expect(imp[0].row_count).toBe(5); expect(imp[0].summary).toMatchObject({ created: 1, linked: 1, pending: 1, invalid: 2 });
    await dlg.getByRole("button", { name: "Fechar" }).click();
    await expect(page.getByText(nJoana).first()).toBeVisible({ timeout: 30_000 });                                                     // a oportunidade aparece na fila de leads
    const mail1 = await page.locator("body").innerText(); expect(mail1).not.toContain(nMariaX);
  });

  test("reimportar o MESMO arquivo não duplica pessoas, oportunidades nem participações de lista", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    const dlg = await toPreview(page);
    await expect(dlg.getByLabel("Resumo da prévia")).toContainText("0 novas"); await expect(dlg.getByLabel("Resumo da prévia")).toContainText("2 já importadas"); await expect(dlg.getByLabel("Resumo da prévia")).toContainText("1 conflitos");
    await dlg.getByRole("button", { name: /^Importar \d+ linha\(s\)$/ }).click(); await expect(dlg.getByText("Passo 4 de 4")).toBeVisible({ timeout: 40_000 });
    await expect(dlg.getByRole("status")).toContainText("0 criadas"); await expect(dlg.getByRole("status")).toContainText("2 já existiam");
    expect(await countOpps(nJoana)).toBe(1); expect(await countOpps(nMaria)).toBe(1); expect(await countPeople()).toBe(2);
    expect(((await devSql(`select count(*)::int n from public.crm_lead_list_members where list_id = '${listId}'`)) as { n: number }[])[0].n).toBe(2);
  });

  test("conflito com decisão explícita: atualizar só o telefone acrescenta o contato, mantém o nome e não duplica a oportunidade", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    const dlg = await toPreview(page);
    await expect(dlg.getByRole("button", { name: "Importar 2 linha(s)" })).toBeEnabled();                    // sem decisão, o conflito não entra
    await dlg.getByLabel("Decisão da linha 4").selectOption("update_existing");
    await expect(dlg.getByRole("button", { name: "Importar 3 linha(s)" })).toBeEnabled();
    await dlg.getByLabel(/^Atualizar nome para/).uncheck();                                                   // só o telefone
    await dlg.getByRole("button", { name: "Importar 3 linha(s)" }).click(); await expect(dlg.getByText("Passo 4 de 4")).toBeVisible({ timeout: 40_000 });
    await expect(dlg.getByRole("status")).toContainText("1 vinculadas a cadastros existentes"); await expect(dlg.getByRole("status")).toContainText("0 pendentes");
    const maria = (await devSql(`select p.full_name, (select string_agg(c.value, ',' order by c.value) from public.person_contacts c where c.person_id = p.id and c.type = 'phone') phones from public.people p where p.id = '${mariaId}'`)) as { full_name: string; phones: string }[];
    expect(maria[0].full_name).toBe(nMaria); expect(maria[0].phones).toContain("(11) 98888-1111"); expect(maria[0].phones).toContain("(11) 95555-3333");
    expect(await countOpps(nMaria)).toBe(1); expect(await countPeople()).toBe(2);
    const aud = (await devSql(`select count(*)::int n from public.audit_log where entity_type = 'people' and entity_id = '${mariaId}' and action = 'update'`)) as { n: number }[]; expect(aud[0].n).toBe(0);   // o nome não foi tocado
  });

  test("permissões: fisioterapeuta e paciente não importam (servidor e rotas); comercial importa", async ({ page, context }) => {
    for (const mailQa of [QA.fisio, QA.paciente]) {
      const a = api(await signIn(mailQa));
      const r = await a.rpc("crm_import_check", { p_defaults: { unit_id: unitId, pipeline_id: pipeId }, p_rows: [{ name: "Intruso R17", email: "intruso.r17@example.com" }] }); expect(r.status, mailQa).not.toBe(200);
      const c = await a.rpc("crm_import_commit", { p_defaults: { unit_id: unitId, pipeline_id: pipeId }, p_rows: [{ name: "Intruso R17", email: "intruso.r17@example.com" }], p_decisions: {}, p_filename: "x" }); expect(c.status, mailQa).not.toBe(200);
    }
    expect(((await devSql(`select count(*)::int n from public.people where full_name = 'Intruso R17'`)) as { n: number }[])[0].n).toBe(0);
    const s = await signIn(QA.comercial); const ok = await api(s).rpc("crm_import_check", { p_defaults: { unit_id: unitId, pipeline_id: pipeId }, p_rows: [{ name: "Teste Comercial R17", email: `comercial.r17.${rid}@example.com` }] }); expect(ok.status).toBe(200);
    await loginAs(context, QA.fisio); await page.goto("/admin/crm/leads"); await expect(page.getByText(/Sem permissão/).first()).toBeVisible({ timeout: 30_000 });
    expect(((await devSql(`select count(*)::int n from public.people where full_name = 'Teste Comercial R17'`)) as { n: number }[])[0].n).toBe(0);    // a prévia nunca grava
  });

  test("celular: o assistente de importação cabe na tela", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/crm/leads"); await page.getByRole("button", { name: "Importar CSV" }).click(); await expect(page.getByRole("dialog").getByText("Passo 1 de 4")).toBeVisible({ timeout: 30_000 });
    const dlg = page.getByRole("dialog"); const box = await dlg.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(-1); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw).toBeLessThanOrEqual(w.iw + 1);
    await expectNoFatal(page);
  });

  test("limpeza: pessoas, oportunidades, lista e registros de importação de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    const n = (await devSql(`select (select count(*) from public.people where full_name in ('${nJoana}', '${nMaria}', '${nMariaX}'))::int p, (select count(*) from public.crm_lead_lists where name = '${listName}')::int l, (select count(*) from public.crm_imports where filename = '${file}')::int i`)) as { p: number; l: number; i: number }[];
    expect(n[0]).toEqual({ p: 0, l: 0, i: 0 });
  });
});
