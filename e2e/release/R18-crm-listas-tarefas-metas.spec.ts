// ACEITE da release v1 — CRM pela tela: listas, oportunidade (histórico e tarefas), Tarefas, metas (gestor define, comercial vê o progresso) e permissões no SERVIDOR sobre as tabelas do CRM.
// (Arrastar e soltar no Kanban: R06 · cartões e detalhamentos dos KPIs: R07 · fórmulas dos KPIs por recálculo independente: SQL S17 · importação CSV: R17.)
// Dados próprios (runId), removidos no fim; a meta do comercial QA é restaurada ao estado anterior.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release CRM: listas, oportunidades, tarefas e metas", () => {
  test.setTimeout(180_000);
  const person = `Lead R18 ${runId}`; const title = `Oportunidade R18 ${runId}`; const listName = `Lista R18 ${runId}`; const taskTitle = `Ligar para ${person}`;
  let unitId = ""; let pipeId = ""; let personId = ""; let oppId = ""; let comUser = ""; let goalBackup: { id: string; target_value_cents: number; expected_conversion_rate: number }[] = [];
  const month = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 8) + "01";
  const clean = async () => {
    await devSql(`delete from public.crm_tasks where person_id in (select id from public.people where full_name = '${person}')`);
    await devSql(`delete from public.interactions where person_id in (select id from public.people where full_name = '${person}')`);
    await devSql(`delete from public.opportunities where person_id in (select id from public.people where full_name = '${person}')`);
    await devSql(`delete from public.crm_lead_lists where name = '${listName}'`);
    await devSql(`delete from public.person_contacts where person_id in (select id from public.people where full_name = '${person}')`).catch(() => null);
    await devSql(`delete from public.person_kinds where person_id in (select id from public.people where full_name = '${person}')`).catch(() => null);
    await devSql(`delete from public.people where full_name = '${person}'`).catch(() => null);
  };

  test("fixtures: lead com oportunidade do comercial QA na primeira etapa do funil de pacientes", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    await clean();
    const mgr = await signIn(QA.manager); const g = api(mgr); const com = await signIn(QA.comercial); comUser = com.user.id;
    unitId = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id; pipeId = (await g.get("pipelines?select=id&kind=eq.patients&active=eq.true&limit=1")).body[0].id;
    const p = await g.rpc("create_person", { p_full_name: person, p_unit_id: unitId, p_kinds: ["lead"], p_email: `lead.r18.${runId.toLowerCase()}@example.com`, p_phone: null, p_notes: null, p_force: true }); expect(p.status, JSON.stringify(p.body)).toBe(200); personId = p.body.id;
    const o = await g.rpc("crm_create_opportunity", { p_person_id: personId, p_pipeline_id: pipeId, p_unit_id: unitId, p_title: title, p_value_cents: 250_000, p_owner: comUser, p_source: "Indicação", p_campaign: "R18" }); expect(o.status, JSON.stringify(o.body)).toBe(200); oppId = o.body;
    goalBackup = (await devSql(`select id, target_value_cents::bigint::int target_value_cents, expected_conversion_rate::float expected_conversion_rate from public.crm_goals where user_id = '${comUser}' and period_start = '${month()}'`)) as typeof goalBackup;
  });

  test("Listas: criar, abrir, adicionar pessoa pelo cadastro central (sem copiar dados), remover e excluir", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/listas"); await page.locator("#lst-name").fill(listName); await page.getByRole("button", { name: "Criar lista" }).click();
    await expect(page.getByText("Lista criada.")).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("row").filter({ hasText: listName }); await expect(row.getByRole("cell").nth(1)).toHaveText("0");
    await row.getByRole("button", { name: "Abrir" }).click(); await page.locator("#lst-search").fill(person);
    await page.getByRole("button", { name: person, exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: listName }).getByRole("cell").nth(1)).toHaveText("1", { timeout: 20_000 });
    const m = (await devSql(`select count(*)::int n, (select count(*)::int from public.people where full_name = '${person}') people from public.crm_lead_list_members m join public.crm_lead_lists l on l.id = m.list_id where l.name = '${listName}' and m.person_id = '${personId}'`)) as { n: number; people: number }[];
    expect(m[0]).toEqual({ n: 1, people: 1 });                                                                    // a lista só referencia a pessoa: não duplicou o cadastro
    await page.getByRole("button", { name: /Remover/ }).first().click(); await expect(page.getByRole("row").filter({ hasText: listName }).getByRole("cell").nth(1)).toHaveText("0", { timeout: 20_000 });
    await page.getByRole("row").filter({ hasText: listName }).getByRole("button", { name: "Excluir" }).click();
    await expect(page.getByText(/Lista removida/)).toBeVisible({ timeout: 20_000 });
    expect(((await devSql(`select count(*)::int n from public.people where full_name = '${person}'`)) as { n: number }[])[0].n).toBe(1);   // a pessoa continua cadastrada
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Oportunidade: abrir pelo funil, registrar contato (histórico) e criar tarefa; a tarefa aparece em Tarefas e some ao concluir", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/crm/oportunidades"); await page.getByRole("region", { name: "Quadro do funil" }).waitFor({ timeout: 40_000 });
    await page.getByPlaceholder("Pessoa ou título").fill(title);
    const card = page.getByRole("button", { name: new RegExp(`^${person}, `) }); await expect(card).toHaveCount(1, { timeout: 30_000 }); await card.click();
    const sheet = page.getByRole("dialog"); await expect(sheet).toContainText(person); await expect(sheet).toContainText("Indicação"); await expect(sheet).toContainText("R18");     // origem e campanha
    await sheet.getByRole("tab", { name: "Histórico" }).click(); await expect(sheet.getByText("Oportunidade criada")).toBeVisible();
    await sheet.locator("#ch").selectOption("call"); await sheet.locator("#nt").fill(`Contato por telefone R18 ${runId}`); await sheet.getByRole("button", { name: "Registrar" }).click();
    await expect(sheet.getByText("Registro salvo.")).toBeVisible({ timeout: 20_000 }); await expect(sheet.getByText(`Contato por telefone R18 ${runId}`)).toBeVisible();
    expect(((await devSql(`select count(*)::int n from public.interactions where opportunity_id = '${oppId}' and channel = 'call'`)) as { n: number }[])[0].n).toBe(1);
    expect(((await devSql(`select last_contact_at is not null as c from public.opportunities where id = '${oppId}'`)) as { c: boolean }[])[0].c).toBe(true);       // o contato atualiza o “último contato”
    await sheet.getByRole("tab", { name: /^Tarefas/ }).click(); await sheet.locator("#tk").fill(taskTitle); await sheet.getByRole("button", { name: "Adicionar tarefa" }).click();
    await expect(sheet.getByText("Tarefa criada.")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await page.goto("/admin/crm/tarefas"); const trow = page.getByRole("row").filter({ hasText: taskTitle }); await expect(trow).toHaveCount(1, { timeout: 30_000 });
    await trow.getByRole("button", { name: "Concluir" }).click(); await expect(page.getByRole("row").filter({ hasText: taskTitle })).toHaveCount(0, { timeout: 20_000 });
    expect(((await devSql(`select done_at is not null as d from public.crm_tasks where title = '${taskTitle}'`)) as { d: boolean }[])[0].d).toBe(true);
  });

  test("Metas: o gestor define a meta do comercial; o comercial vê o progresso real (ganhos do mês) igual ao do servidor", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/crm/metas/time"); await expect(page.getByRole("heading", { name: "Time" }).first()).toBeVisible({ timeout: 40_000 });
    await page.locator("#tg-user").selectOption(comUser); await page.locator("#tg-target").fill("10000,00"); await page.getByRole("button", { name: "Salvar meta" }).click();
    await expect(page.getByText("Meta salva.")).toBeVisible({ timeout: 20_000 });
    expect(((await devSql(`select target_value_cents::bigint::int t from public.crm_goals where user_id = '${comUser}' and period_start = '${month()}'`)) as { t: number }[])[0].t).toBe(1_000_000);
    // negócio ganho do comercial neste mês (valor R$ 2.500,00)
    await devSql(`update public.opportunities set status = 'won', stage_id = (select id from public.pipeline_stages where pipeline_id = '${pipeId}' and kind = 'won' order by position limit 1), closed_at = now() where id = '${oppId}'`);
    const com = await signIn(QA.comercial); const prog = (await api(com).rpc("crm_goal_progress", { p_user: null, p_month: null })).body as { has_goal: boolean; won_value_cents: number; target_value_cents: number; progress_pct: number; won_deals: number };
    expect(prog.has_goal).toBe(true); expect(prog.target_value_cents).toBe(1_000_000); expect(prog.won_value_cents).toBeGreaterThanOrEqual(250_000); expect(prog.won_deals).toBeGreaterThanOrEqual(1);
    await loginAs(context, QA.comercial);
    const p2 = await context.newPage(); await p2.goto("/admin/crm/metas"); await expect(p2.getByText("Progresso da meta")).toBeVisible({ timeout: 40_000 });
    await expect(p2.getByText(`${prog.progress_pct}%`).first()).toBeVisible();
    await expect(p2.getByText(/vendido de R\$\s*10\.000,00/)).toBeVisible();
    // o comercial NÃO abre a tela do time nem grava meta de outra pessoa
    await p2.goto("/admin/crm/metas/time"); await expect(p2.getByText(/Sem permissão/).first()).toBeVisible({ timeout: 30_000 });
    const w = await api(com).post("crm_goals", { org_id: (await api(com).get("organizations?select=id")).body[0].id, user_id: comUser, period_start: month(), target_value_cents: 99_999_999, expected_conversion_rate: 20 }); expect(w.status).not.toBeLessThan(400);
    expect(((await devSql(`select target_value_cents::bigint::int t from public.crm_goals where user_id = '${comUser}' and period_start = '${month()}'`)) as { t: number }[])[0].t).toBe(1_000_000);
  });

  test("permissões no servidor: paciente e fisioterapeuta não leem nem escrevem listas, oportunidades, tarefas, interações ou metas do CRM", async () => {
    const org = (await api(await signIn(QA.manager)).get("organizations?select=id")).body[0].id as string;
    for (const mail of [QA.paciente, QA.fisio, QA.parceiro]) {
      const a = api(await signIn(mail));
      for (const t of ["opportunities", "crm_tasks", "interactions", "crm_goals", "crm_lead_lists", "crm_lead_list_members", "crm_imports"]) {
        const r = await a.get(`${t}?select=${t === "crm_lead_list_members" ? "list_id" : t === "crm_goals" || t === "crm_imports" ? "id" : "id"}&limit=1`); expect(Array.isArray(r.body) ? r.body.length : -1, `${mail} lê ${t}`).toBe(0);
      }
      expect((await a.post("crm_lead_lists", { org_id: org, name: `Intruso ${runId}` })).status, `${mail} cria lista`).toBeGreaterThanOrEqual(400);
      expect((await a.post("crm_tasks", { org_id: org, unit_id: unitId, person_id: personId, kind: "follow_up", title: `Intruso ${runId}`, due_at: new Date().toISOString() })).status, `${mail} cria tarefa`).toBeGreaterThanOrEqual(400);
      expect((await a.post("interactions", { org_id: org, person_id: personId, unit_id: unitId, channel: "note", summary: `Intruso ${runId}` })).status, `${mail} cria interação`).toBeGreaterThanOrEqual(400);
      expect((await a.rpc("crm_create_opportunity", { p_person_id: personId, p_pipeline_id: pipeId, p_unit_id: unitId, p_title: `Intruso ${runId}` })).status, `${mail} cria oportunidade`).toBeGreaterThanOrEqual(400);
      expect((await a.rpc("crm_analytics", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date().toISOString() })).status, `${mail} lê indicadores do CRM`).toBeGreaterThanOrEqual(400);
    }
    expect(((await devSql(`select (select count(*) from public.crm_lead_lists where name like 'Intruso ${runId}%')::int l, (select count(*) from public.crm_tasks where title like 'Intruso ${runId}%')::int t, (select count(*) from public.opportunities where title like 'Intruso ${runId}%')::int o`)) as { l: number; t: number; o: number }[])[0]).toEqual({ l: 0, t: 0, o: 0 });
  });

  test("celular: listas, funil e metas do CRM cabem na tela", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, wait] of [["/admin/crm/listas", "Listas"], ["/admin/crm/tarefas", "Tarefas"], ["/admin/crm/metas/time", "Time"]] as const) {
      await page.goto(path); await expect(page.getByRole("heading", { name: wait }).first()).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(500);
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `${path}: rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
    }
  });

  test("limpeza: lead, oportunidade, tarefa, interações e lista removidos; meta do comercial QA restaurada", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    if (goalBackup.length) await devSql(`update public.crm_goals set target_value_cents = ${goalBackup[0].target_value_cents}, expected_conversion_rate = ${goalBackup[0].expected_conversion_rate} where id = '${goalBackup[0].id}'`);
    else await devSql(`delete from public.crm_goals where user_id = '${comUser}' and period_start = '${month()}'`);
    const n = (await devSql(`select (select count(*) from public.people where full_name = '${person}')::int p, (select count(*) from public.crm_lead_lists where name = '${listName}')::int l, (select count(*) from public.opportunities where title = '${title}')::int o`)) as { p: number; l: number; o: number }[];
    expect(n[0]).toEqual({ p: 0, l: 0, o: 0 });
  });
});
