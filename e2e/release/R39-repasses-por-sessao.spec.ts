// ACEITE — Portais F5: o admin define o repasse por sessão (pela tela), cada sessão atendida gera um lançamento, o admin autoriza e marca como pago, o fisio vê o extrato SEM nome de paciente,
// e o resíduo (sessões pagas e não atendidas) vai ao fisio responsável. Usa o paciente e a fisioterapeuta de QA e limpa o que cria. Somente Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Repasse do fisio por sessão atendida", () => {
  test.setTimeout(180_000);
  const OFF = Math.floor(Math.random() * 15); const S: Record<string, string> = {}; const prodName = `Pacote R39 ${runId}`; let patientName = "";

  test("preparo: pacote de 10 sessões (R$ 1.600) totalmente pago pelo paciente de QA", async () => {
    const pac = await signIn(QA.paciente); const fis = await signIn(QA.fisio);
    S.person = ((await api(pac).get("people?select=id,full_name")).body as { id: string; full_name: string }[])[0].id; patientName = ((await api(pac).get("people?select=full_name")).body as { full_name: string }[])[0].full_name;
    S.prof = ((await devSql(`select id from public.professionals where user_id = '${fis.user.id}'`)) as { id: string }[])[0].id;
    await devSql(`with p as (select org_id, unit_id, id from public.people where id = '${S.person}'),
      sv as (select id from public.services limit 1),
      pr as (insert into public.products (org_id, kind, name, price_cents, sessions_count, validity_days, service_id) select p.org_id, 'package', '${prodName}', 160000, 10, 90, (select id from sv) from p returning id),
      s as (insert into public.sales (org_id, unit_id, person_id, status, subtotal_cents, total_cents, sold_at, notes) select org_id, unit_id, id, 'confirmed', 160000, 160000, now(), 'R39 ${runId}' from p returning id, org_id, unit_id, person_id),
      r as (insert into public.receivables (org_id, unit_id, sale_id, person_id, product_id, installment_no, installments_total, due_date, competence_month, amount_cents, status) select s.org_id, s.unit_id, s.id, s.person_id, (select id from pr), 1, 1, current_date, date_trunc('month', current_date)::date, 160000, 'paid' from s returning id, org_id, unit_id),
      py as (insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key) select org_id, unit_id, id, 'payment', 160000, 'r39-${runId}' from r returning id),
      cp as (insert into public.client_packages (org_id, unit_id, person_id, product_id, sale_id, total_sessions) select s.org_id, s.unit_id, s.person_id, (select id from pr), s.id, 10 from s returning id, org_id)
      insert into public.session_ledger (org_id, client_package_id, delta, reason) select org_id, id, 10, 'grant' from cp`);
    S.pkg = ((await devSql(`select cp.id from public.client_packages cp join public.products p on p.id = cp.product_id where p.name = '${prodName}'`)) as { id: string }[])[0].id;
  });

  test("admin define o repasse pela tela: sessão R$ 160 → fisio R$ 100 / HP R$ 60", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.manager);
    await page.goto("/admin/financeiro/precos-repasses"); await expect(page.getByRole("heading", { name: "Preços e repasses" }).first()).toBeVisible({ timeout: 40_000 });
    const row = page.getByTestId("price-row").filter({ hasText: prodName }); await expect(row).toContainText("Sem regra"); await expect(row).toContainText(/R\$\s?160,00/);
    await row.getByRole("button", { name: "Definir repasse" }).click(); await page.getByLabel(/Valor por sessão para o fisioterapeuta/).fill("100,00"); await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Repasse salvo/)).toBeVisible({ timeout: 20_000 }); await expect(row).toContainText(/R\$\s?100,00/); await expect(row).toContainText(/R\$\s?60,00/);
    // acima do valor da sessão: o servidor recusa
    await row.getByRole("button", { name: "Definir repasse" }).click(); await page.getByLabel(/Valor por sessão para o fisioterapeuta/).fill("170,00"); await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/não pode superar o valor da sessão/)).toBeVisible({ timeout: 20_000 });
    expect(errors.filter((e) => !/400|403/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("3 sessões atendidas geram 3 lançamentos pendentes; o admin autoriza e marca um como pago", async ({ page, context }) => {
    for (const i of [1, 2, 3]) await devSql(`with a as (insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status, notes)
        select p.org_id, p.unit_id, '${S.prof}', p.id, (select id from public.services limit 1), '${S.pkg}', tstzrange(date_trunc('minute', now()) - interval '${10 + i} days' + interval '${11 + i * 3 + OFF} minutes', date_trunc('minute', now()) - interval '${10 + i} days' + interval '${41 + i * 3 + OFF} minutes'), 'attended', 'R39 ${runId}' from public.people p where p.id = '${S.person}' returning id)
      insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) select (select org_id from public.client_packages where id = '${S.pkg}'), '${S.pkg}', id, -1, 'consume' from a`);
    await loginAs(context, QA.manager); await page.goto("/admin/financeiro/precos-repasses"); await page.getByRole("tab", { name: "Lançamentos" }).or(page.getByRole("button", { name: "Lançamentos" })).first().click();
    const rows = page.getByTestId("payout-row").filter({ hasText: prodName }); await expect(rows).toHaveCount(3, { timeout: 30_000 }); await expect(rows.first()).toContainText("Pendente"); await expect(rows.first()).toContainText(/R\$\s?100,00/); await expect(rows.first()).toContainText("Sessão atendida");
    await rows.first().getByRole("button", { name: "Autorizar" }).click(); await expect(page.getByText("Autorizado.")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Situação").selectOption("authorized"); const auth = page.getByTestId("payout-row").filter({ hasText: prodName }); await expect(auth).toHaveCount(1, { timeout: 20_000 });
    await auth.getByRole("button", { name: "Marcar pago" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Marcar como pago" }).click(); await expect(page.getByText("Marcado como pago.")).toBeVisible({ timeout: 20_000 });
  });

  test("fisio vê o desempenho e o extrato (R$ 100 pago + R$ 200 pendente), sem o nome do paciente; no celular cabe na tela", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.fisio); await page.goto("/fisio/desempenho");
    await expect(page.getByTestId("physio-kpis")).toBeVisible({ timeout: 40_000 });
    const rows = page.getByTestId("stmt-row").filter({ hasText: prodName }); await expect(rows).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByTestId("physio-kpis")).toContainText("Repasse pendente"); await expect(page.getByText(patientName)).toHaveCount(0);
    expect(await page.content()).not.toContain(patientName);
    const st = (await api(await signIn(QA.fisio)).rpc("prof_commission_statement", { p_from: null, p_to: null })).body; expect(JSON.stringify(st)).not.toContain(patientName);
    expect((await api(await signIn(QA.fisio)).rpc("physio_payout_authorize", { p_id: (st as { entries: { id: string }[] }).entries[0].id })).status, "o fisio não autoriza o próprio repasse").not.toBe(200);
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await expect(page.getByTestId("physio-kpis")).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("admin escolhe o fisio responsável e encerra o pacote: as 7 sessões pagas e não atendidas (R$ 700) vão para ele", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.goto("/admin/financeiro/precos-repasses"); await page.getByRole("tab", { name: "Fisio responsável" }).or(page.getByRole("button", { name: "Fisio responsável" })).first().click();
    const row = page.getByTestId("pkg-row").filter({ hasText: prodName }); await expect(row).toBeVisible({ timeout: 30_000 }); await expect(row).toContainText("3 de 10 atendidas");
    await row.getByRole("combobox").selectOption({ label: ((await devSql(`select display_name from public.professionals where id = '${S.prof}'`)) as { display_name: string }[])[0].display_name });
    await expect(page.getByText("Fisioterapeuta responsável atualizado.")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Mostrar só pacotes sem responsável").uncheck(); const row2 = page.getByTestId("pkg-row").filter({ hasText: prodName }); await expect(row2).toBeVisible();
    await row2.getByRole("button", { name: "Encerrar e lançar resíduo" }).click(); await expect(page.getByText(/Resíduo lançado/)).toBeVisible({ timeout: 20_000 });
    const res = (await devSql(`select amount_cents::int a, kind from public.physio_payouts where client_package_id = '${S.pkg}' and kind = 'residual'`)) as { a: number; kind: string }[]; expect(res).toEqual([{ a: 70000, kind: "residual" }]);
    const tot = (await devSql(`select sum(amount_cents)::int s from public.physio_payouts where client_package_id = '${S.pkg}' and status <> 'void'`)) as { s: number }[]; expect(tot[0].s, "total do pacote = 10 × R$ 100").toBe(100000);
  });

  test("limpeza: pacote, vendas, lançamentos, regra e atendimentos de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await devSql(`delete from public.physio_payouts where client_package_id = '${S.pkg}';
      delete from public.session_ledger where client_package_id = '${S.pkg}';
      delete from public.appointments where notes = 'R39 ${runId}';
      delete from public.client_packages where id = '${S.pkg}';
      delete from public.payments where idempotency_key = 'r39-${runId}';
      delete from public.receivables where sale_id in (select id from public.sales where notes = 'R39 ${runId}');
      delete from public.sales where notes = 'R39 ${runId}';
      delete from public.product_physio_share where product_id in (select id from public.products where name = '${prodName}');
      delete from public.products where name = '${prodName}'`);
    const n = (await devSql(`select count(*)::int n from public.products where name = '${prodName}'`)) as { n: number }[]; expect(n[0].n).toBe(0);
  });
});
