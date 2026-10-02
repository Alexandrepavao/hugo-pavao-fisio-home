// ACEITE da release v1 — (1) edição de limite/fechamento/vencimento do cartão (com motivo, auditoria e faturas existentes preservadas) e
// (2) filtro único em Agenda, Academy, Parceiros, Contas a pagar, Conciliação e Planilha administrativa. Só cria fixtures próprias (prefixo do runId) e as remove no fim.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, devSql, expectNoFatal, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const noHScroll = async (page: Page, where: string) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `${where}: a página não pode rolar na horizontal (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
};
const openFilters = async (page: Page) => { await page.getByRole("button", { name: /^Filtros/ }).first().click(); };
const closeFilters = async (page: Page) => { await page.keyboard.press("Escape"); };
const spDay = (days: number) => new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

test.describe.serial("@release Edição de cartão corporativo", () => {
  test.setTimeout(240_000);
  const nick = `Cartão Edição E2E ${runId}`; const d1 = `Compra antiga edição E2E ${runId}`; const d2 = `Compra atual edição E2E ${runId}`;
  let unitId = ""; let accId = ""; let cardId = "";
  const clean = async () => {
    await devSql(`delete from public.card_purchases where card_id in (select id from public.corporate_cards where nickname = '${nick}')`);
    await devSql(`delete from public.card_invoices where card_id in (select id from public.corporate_cards where nickname = '${nick}')`);
    await devSql(`delete from public.payables where description in ('${d1}', '${d2}')`);
    await devSql(`delete from public.corporate_cards where nickname = '${nick}'`);
    await devSql(`delete from public.financial_accounts where name = 'Conta edição E2E ${runId}'`);
  };
  const invoicesSnapshot = async () => JSON.stringify(await devSql(`select id, cycle_start, closing_date, due_date, status, paid_total_cents from public.card_invoices where card_id = '${cardId}' order by closing_date`));
  const payablesSnapshot = async () => JSON.stringify(await devSql(`select id, due_date, competence_month, status, amount_cents from public.payables where description in ('${d1}', '${d2}') order by description`));

  test("fixtures: conta, cartão (fechamento 10 / vencimento 20) e duas compras (fatura antiga paga e fatura corrente aberta)", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    const u = (await devSql(`select id, org_id from public.units where slug = 'sao-paulo'`)) as { id: string; org_id: string }[]; unitId = u[0].id;
    accId = ((await devSql(`insert into public.financial_accounts (org_id, unit_id, name, kind) values ('${u[0].org_id}', '${unitId}', 'Conta edição E2E ${runId}', 'bank') returning id`)) as { id: string }[])[0].id;
    const s = await signIn(QA.manager); const g = api(s);
    const c = await g.rpc("card_create", { p_unit: unitId, p_nickname: nick, p_issuer: "Banco E2E", p_brand: "visa", p_limit_cents: 500_000, p_closing_day: 10, p_due_day: 20, p_last4: "9876" });
    expect(c.status, JSON.stringify(c.body)).toBe(200); cardId = c.body as string;
    const p1 = await g.rpc("card_purchase_create", { p_card: cardId, p_date: spDay(-45), p_amount_cents: 12_345, p_description: d1, p_line: "physio" }); expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    const p2 = await g.rpc("card_purchase_create", { p_card: cardId, p_date: spDay(0), p_amount_cents: 20_000, p_description: d2, p_line: "academy" }); expect(p2.status, JSON.stringify(p2.body)).toBe(200);
    const inv = (await devSql(`select i.id from public.card_invoices i where i.card_id = '${cardId}' and i.closing_date < current_date`)) as { id: string }[];
    expect(inv.length).toBe(1);
    const pay = await g.rpc("card_invoice_pay", { p_invoice: inv[0].id, p_account: accId }); expect([200, 204], JSON.stringify(pay.body)).toContain(pay.status);
  });

  test("Editar cartão: abre com os valores atuais, exige motivo e recusa limite abaixo do que está em aberto", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/cartoes"); await page.getByRole("button", { name: `Cartão ${nick}` }).click();
    await page.getByRole("button", { name: "Editar cartão" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.locator("#ce-limit")).toHaveValue(/5\.000,00/); await expect(dlg.locator("#ce-close")).toHaveValue("10"); await expect(dlg.locator("#ce-due")).toHaveValue("20");
    await expect(dlg).toContainText(/faturas que ainda não existem/); await expect(dlg).toContainText(/mantêm/);
    await expect(dlg.getByText(/Em aberto no cartão: R\$\s*200,00/)).toBeVisible();
    // sem motivo
    await dlg.locator("#ce-limit").fill("6.000,00"); await dlg.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText(/Informe o motivo da alteração/)).toBeVisible();
    // limite abaixo do em aberto (R$ 200,00)
    await dlg.locator("#ce-limit").fill("150,00"); await dlg.locator("#ce-reason").fill("Teste de limite baixo E2E"); await dlg.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText(/abaixo do que já está em aberto/)).toBeVisible({ timeout: 20_000 });
    const row = (await devSql(`select credit_limit_cents::int l, closing_day, due_day from public.corporate_cards where id = '${cardId}'`)) as { l: number; closing_day: number; due_day: number }[];
    expect(row[0]).toEqual({ l: 500_000, closing_day: 10, due_day: 20 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("salvar: novo limite e novos dias valem; faturas e despesas existentes ficam idênticas; a auditoria tem o motivo", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    const invBefore = await invoicesSnapshot(); const payBefore = await payablesSnapshot();
    await page.goto("/admin/financeiro/cartoes"); await page.getByRole("button", { name: `Cartão ${nick}` }).click();
    await page.getByRole("button", { name: "Editar cartão" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("#ce-limit").fill("9.000,00"); await dlg.locator("#ce-close").fill("25"); await dlg.locator("#ce-due").fill("5"); await dlg.locator("#ce-reason").fill(`Reajuste E2E ${runId}`);
    await dlg.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText(/Cartão atualizado\. Os novos dias valem para faturas ainda não criadas/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/as faturas existentes mantêm as datas/)).toBeVisible();
    const visual = page.getByRole("button", { name: `Cartão ${nick}` });
    await expect(visual).toContainText("Fecha dia 25"); await expect(visual).toContainText("Vence dia 5"); await expect(visual).toContainText(/Limite R\$\s*9\.000,00/);
    const row = (await devSql(`select credit_limit_cents::int l, closing_day, due_day from public.corporate_cards where id = '${cardId}'`)) as { l: number; closing_day: number; due_day: number }[];
    expect(row[0]).toEqual({ l: 900_000, closing_day: 25, due_day: 5 });
    expect(await invoicesSnapshot()).toBe(invBefore);                         // faturas existentes (paga e corrente) intactas
    expect(await payablesSnapshot()).toBe(payBefore);                         // despesas das compras existentes intactas
    // o resumo da tela continua mostrando a fatura corrente que já existia (fechamento antigo)
    await expect(page.getByText(/fatura atual fecha em/)).toBeVisible();
    const audit = (await devSql(`select actor_user_id is not null as actor, changed_columns, old_values, new_values from public.audit_log where entity_type = 'corporate_cards' and entity_id = '${cardId}' and new_values ->> 'reason' = 'Reajuste E2E ${runId}'`)) as { actor: boolean; changed_columns: string[]; old_values: Record<string, number>; new_values: Record<string, unknown> }[];
    expect(audit).toHaveLength(1); expect(audit[0].actor).toBe(true);
    expect([...audit[0].changed_columns].sort()).toEqual(["closing_day", "credit_limit_cents", "due_day"]);
    expect(audit[0].old_values).toMatchObject({ credit_limit_cents: 500_000, closing_day: 10, due_day: 20 }); expect(audit[0].new_values).toMatchObject({ credit_limit_cents: 900_000, closing_day: 25, due_day: 5, existing_invoices_kept: true });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões (servidor): comercial, fisioterapeuta e paciente não editam; nada muda", async () => {
    for (const email of [QA.comercial, QA.fisio, QA.paciente]) {
      const a = api(await signIn(email));
      const r = await a.rpc("card_update", { p_card: cardId, p_limit_cents: 1_000_000, p_closing_day: 3, p_due_day: 9, p_reason: "Tentativa não autorizada" });
      expect(r.status, email).not.toBe(200); expect(JSON.stringify(r.body), email).toMatch(/sem permissão|42501/);
    }
    const row = (await devSql(`select credit_limit_cents::int l, closing_day, due_day from public.corporate_cards where id = '${cardId}'`)) as { l: number; closing_day: number; due_day: number }[];
    expect(row[0]).toEqual({ l: 900_000, closing_day: 25, due_day: 5 });
  });

  test("limpeza: cartão, faturas, compras, despesas e conta de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    const n = (await devSql(`select (select count(*) from public.corporate_cards where nickname = '${nick}')::int c, (select count(*) from public.payables where description in ('${d1}', '${d2}'))::int p`)) as { c: number; p: number }[];
    expect(n[0]).toEqual({ c: 0, p: 0 });
  });
});

test.describe.serial("@release Filtro único: Agenda, Academy, Parceiros, Contas a pagar, Conciliação e Planilha administrativa", () => {
  test.setTimeout(180_000);
  const course = `Curso filtro E2E ${runId}`; const pay1 = `Conta aberta filtro E2E ${runId}`; const pay2 = `Conta paga filtro E2E ${runId}`; const fileName = `extrato filtro E2E ${runId}`; const lIn = `ENTRADA FILTRO E2E ${runId}`; const lOut = `SAIDA FILTRO E2E ${runId}`;
  let unitId = ""; let accId = "";
  const clean = async () => {
    await devSql(`delete from public.bank_statement_lines where description in ('${lIn}', '${lOut}')`);
    await devSql(`delete from public.bank_statement_imports where filename = '${fileName}'`);
    await devSql(`delete from public.payables where description in ('${pay1}', '${pay2}')`);
    await devSql(`delete from public.courses where title = '${course}'`);
    await devSql(`delete from public.financial_accounts where name = 'Conta filtro E2E ${runId}'`);
  };

  test("fixtures: curso, duas contas a pagar (uma aberta, uma paga) e duas linhas de extrato (entrada e saída)", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    const u = (await devSql(`select id, org_id from public.units where slug = 'sao-paulo'`)) as { id: string; org_id: string }[]; unitId = u[0].id; const org = u[0].org_id;
    accId = ((await devSql(`insert into public.financial_accounts (org_id, unit_id, name, kind) values ('${org}', '${unitId}', 'Conta filtro E2E ${runId}', 'bank') returning id`)) as { id: string }[])[0].id;
    await devSql(`insert into public.courses (org_id, title, slug, kind, status) values ('${org}', '${course}', 'curso-filtro-e2e-${runId.toLowerCase().replace(/[^a-z0-9]/g, "")}', 'mentoring', 'draft')`);
    await devSql(`insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status) values ('${org}', '${unitId}', '${pay1}', 1111, current_date, date_trunc('month', current_date)::date, 'open')`);
    await devSql(`insert into public.payables (org_id, unit_id, description, amount_cents, due_date, competence_month, status, paid_at) values ('${org}', '${unitId}', '${pay2}', 2222, current_date, date_trunc('month', current_date)::date, 'paid', now())`);
    const imp = (await devSql(`insert into public.bank_statement_imports (org_id, unit_id, account_id, filename, row_count) values ('${org}', '${unitId}', '${accId}', '${fileName}', 2) returning id`)) as { id: string }[];
    await devSql(`insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents, external_ref) values ('${org}', '${unitId}', '${imp[0].id}', current_date, '${lIn}', 3333, 'E2E'), ('${org}', '${unitId}', '${imp[0].id}', current_date, '${lOut}', -4444, 'E2E')`);
  });

  test("Agenda: unidade e dia sempre visíveis; profissional e estado no botão Filtros, com contador e “Limpar filtros”; o formulário de agendamento continua com profissional e serviço", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/agenda");
    await expect(page.locator("#pf-unit")).toBeVisible({ timeout: 40_000 }); await expect(page.locator("#pf-day")).toBeVisible();
    await expect(page.locator("#pf-unit option", { hasText: "Todas as unidades" })).toHaveCount(0);       // a agenda exige uma unidade
    await expect(page.getByRole("button", { name: /^Filtros/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);                    // nada ativo
    await expect(page.locator("#ap")).toBeVisible(); await expect(page.locator("#as")).toBeVisible();     // campos do agendamento, fora do filtro
    // trocar o dia pelas setas e voltar
    const d0 = await page.locator("#pf-day").inputValue();
    await page.getByRole("button", { name: "Próximo dia" }).click(); expect(await page.locator("#pf-day").inputValue()).not.toBe(d0);
    await page.getByRole("button", { name: "Dia anterior" }).click(); expect(await page.locator("#pf-day").inputValue()).toBe(d0);
    await openFilters(page); await page.locator("#af-status").selectOption("cancelled_by_clinic"); await closeFilters(page);
    await expect(page.getByRole("button", { name: /^Filtros/ })).toContainText("1");
    await expect(page.getByLabel("Filtros ativos")).toContainText("Estado: Cancelado (clínica)");
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Academy: busca à vista; tipo e estado no botão Filtros; a lista responde e “Limpar filtros” restaura", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/academy");
    await expect(page.locator("#ac-q")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("row").filter({ hasText: course })).toHaveCount(1, { timeout: 30_000 });
    await page.locator("#ac-q").fill(`${runId} inexistente`); await expect(page.getByText(/Nenhum curso com os filtros escolhidos/)).toBeVisible();
    await page.locator("#ac-q").fill(course); await expect(page.getByRole("row").filter({ hasText: course })).toHaveCount(1);
    await openFilters(page); await page.locator("#acf-kind").selectOption("course"); await closeFilters(page);          // o fixture é mentoria
    await expect(page.getByRole("row").filter({ hasText: course })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Filtros/ })).toContainText("1");
    await openFilters(page); await page.locator("#acf-kind").selectOption("mentoring"); await closeFilters(page);
    await expect(page.getByRole("row").filter({ hasText: course })).toHaveCount(1);
    await openFilters(page); await page.locator("#acf-status").selectOption("archived"); await closeFilters(page);
    await expect(page.getByRole("row").filter({ hasText: course })).toHaveCount(0);
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.locator("#ac-q")).toHaveValue(""); await expect(page.getByRole("row").filter({ hasText: course })).toHaveCount(1);
    await page.getByRole("tab", { name: "Trilhas" }).click(); await expect(page.locator("#at-q")).toBeVisible();
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Parceiros: busca em todas as abas; unidade, estado e parceiro em Repasses; Indicações só com busca", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/parceiros");
    await expect(page.locator("#pf-q")).toBeVisible({ timeout: 40_000 });
    await expect(page.locator("#pf-unit")).toHaveCount(0);                                                   // parceiros não têm unidade
    await openFilters(page); await expect(page.locator("#pff-status")).toBeVisible(); await closeFilters(page);
    await page.getByRole("tab", { name: "Repasses" }).click();
    await expect(page.locator("#pf-unit")).toBeVisible(); await openFilters(page); await expect(page.locator("#pff-status")).toBeVisible(); await expect(page.locator("#pff-partner")).toBeVisible(); await closeFilters(page);
    await page.locator("#pf-q").fill(`${runId} sem resultado`);
    await page.getByRole("tab", { name: "Indicações" }).click();
    await expect(page.locator("#pf-q")).toHaveValue("");                                                      // trocar de aba limpa os filtros
    await expect(page.getByRole("button", { name: /^Filtros/ })).toHaveCount(0);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Contas a pagar: busca e unidade à vista; estado, linha, origem e vencimento no botão Filtros; filtros anteriores (linha) preservados", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/pagar");
    await expect(page.locator("#pay-q")).toBeVisible({ timeout: 40_000 }); await expect(page.locator("#pf-unit")).toBeVisible();
    await page.locator("#pay-q").fill(runId);
    await expect(page.getByRole("row").filter({ hasText: pay1 })).toHaveCount(1, { timeout: 30_000 }); await expect(page.getByRole("row").filter({ hasText: pay2 })).toHaveCount(1);
    await openFilters(page); await page.locator("#pf-status").selectOption("paid"); await closeFilters(page);
    await expect(page.getByRole("row").filter({ hasText: pay1 })).toHaveCount(0); await expect(page.getByRole("row").filter({ hasText: pay2 })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Filtros/ })).toContainText("1");
    await expect(page.getByLabel("Filtros ativos")).toContainText("Estado: Paga");
    await openFilters(page); await page.locator("#pf-status").selectOption(""); await page.locator("#pfilter").selectOption("physio"); await closeFilters(page);   // linha de negócio: o mesmo filtro de antes
    await expect(page.getByRole("row").filter({ hasText: pay1 })).toHaveCount(0);                              // as contas do teste não são da Fisioterapia
    await openFilters(page); await page.locator("#pfilter").selectOption(""); await page.locator("#pf-source").selectOption("cartao"); await closeFilters(page);
    await expect(page.getByRole("row").filter({ hasText: pay1 })).toHaveCount(0);                              // nenhuma é compra de cartão
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.getByRole("row").filter({ hasText: pay1 })).toHaveCount(1); await expect(page.locator("#pay-q")).toHaveValue("");
    // permissão preservada: quem não é do financeiro continua sem a tela (rota)
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Conciliação: busca e unidade à vista; tipo e estado no botão Filtros; a conta do envio do extrato continua um campo do formulário; BankByLine usa o filtro de período", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/financeiro/conciliacao");
    await expect(page.locator("#rec-q")).toBeVisible({ timeout: 40_000 }); await expect(page.locator("#rec-acc")).toBeVisible();
    await page.locator("#rec-q").fill(runId);
    await expect(page.getByText(lIn)).toBeVisible({ timeout: 30_000 }); await expect(page.getByText(lOut)).toBeVisible();
    await openFilters(page); await page.locator("#rec-kind").selectOption("out"); await closeFilters(page);
    await expect(page.getByText(lIn)).toHaveCount(0); await expect(page.getByText(lOut)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Pendentes de conciliação \(1\)/ })).toBeVisible();
    await page.getByRole("button", { name: "Limpar filtros" }).first().click();
    await expect(page.getByText(lIn)).toBeVisible();
    // o relatório “Movimentos bancários por linha de negócio” usa o mesmo filtro (período à vista, conta no botão Filtros) e mantém a conta como filtro
    const bbl = page.getByRole("region", { name: "Movimentos bancários por linha de negócio" });
    await expect(bbl.getByRole("button", { name: /Mês atual/ })).toBeVisible();
    await bbl.getByRole("button", { name: /^Filtros/ }).click(); await expect(page.locator("#bbl-acc")).toBeVisible(); await page.locator("#bbl-acc").selectOption(accId); await closeFilters(page);
    await expect(bbl.getByRole("status", { name: "Situação do extrato no período" })).toContainText(/2 movimento\(s\)/, { timeout: 30_000 });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Planilha administrativa: busca e unidade à vista; tipo, vínculo, status, estado e “só incompletos” no botão Filtros; mesmo parâmetro de URL de antes", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/adm/diretorio");
    await expect(page.locator("#dir-q")).toBeVisible({ timeout: 40_000 }); await expect(page.locator("#pf-unit")).toBeVisible();
    await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);
    await openFilters(page);
    for (const id of ["#dir-f-tipo", "#dir-f-vinculo", "#dir-f-status", "#dir-f-uf"]) await expect(page.locator(id)).toBeVisible();
    await page.locator("#dir-f-tipo").selectOption("pj"); await page.getByLabel("Só incompletos").check(); await closeFilters(page);
    await expect(page.getByRole("button", { name: /^Filtros/ })).toContainText("2");
    await expect(page.getByLabel("Filtros ativos")).toContainText("Tipo: Pessoa jurídica");
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);
    await page.goto("/admin/adm/diretorio?tipo=pf&incompleto=1");                                             // links antigos continuam valendo
    await openFilters(page); await expect(page.locator("#dir-f-tipo")).toHaveValue("pf"); await expect(page.getByLabel("Só incompletos")).toBeChecked(); await closeFilters(page);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("permissões preservadas: quem não tem o papel continua sem as telas (rota) e sem os dados (servidor)", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    for (const path of ["/admin/financeiro/pagar", "/admin/financeiro/conciliacao", "/admin/adm/diretorio", "/admin/parceiros", "/admin/academy"]) {
      await page.goto(path);
      await expect(page.getByText(/Sem permissão/).first(), path).toBeVisible({ timeout: 30_000 });
    }
    const f = api(await signIn(QA.fisio));
    expect(((await f.get("payables?select=id&limit=1")).body as unknown[]).length).toBe(0);
    expect(((await f.get("bank_statement_lines?select=id&limit=1")).body as unknown[]).length).toBe(0);
  });

  test("celular: Agenda, Contas a pagar, Conciliação e Planilha cabem na tela com o filtro em gaveta", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, where] of [["/admin/agenda", "agenda"], ["/admin/financeiro/pagar", "contas a pagar"], ["/admin/financeiro/conciliacao", "conciliação"], ["/admin/adm/diretorio", "planilha"], ["/admin/academy", "academy"], ["/admin/parceiros", "parceiros"]] as const) {
      await page.goto(path); await expect(page.getByRole("button", { name: /^Filtrar|^Filtros/ }).first(), where).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(500);
      await noHScroll(page, where);
    }
  });

  test("limpeza: fixtures removidas", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    const n = (await devSql(`select (select count(*) from public.courses where title = '${course}')::int c, (select count(*) from public.payables where description in ('${pay1}', '${pay2}'))::int p, (select count(*) from public.bank_statement_lines where description in ('${lIn}', '${lOut}'))::int l`)) as { c: number; p: number; l: number }[];
    expect(n[0]).toEqual({ c: 0, p: 0, l: 0 });
  });
});
