// ACEITE — Portais F7: check-in semanal do paciente (dor alta avisa o fisio) e programas/ofertas decididos pelo ADMIN: cria o programa, vê candidatos, oferece; o paciente (com consentimento comercial)
// responde "tenho interesse" — só avisa a equipe, sem venda; o admin marca como aceita; sem consentimento a oferta some. Usa o paciente e a fisioterapeuta de QA e limpa o que cria. Somente Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Retenção e ofertas", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {}; let createdLink = false; let t0 = ""; let name = ""; const prog = `Manutenção R41 ${runId}`;

  test("preparo: vínculo, consentimento comercial do paciente de QA e nenhum check-in nesta semana", async () => {
    const g = api(await signIn(QA.manager)); const fis = await signIn(QA.fisio); const pac = await signIn(QA.paciente);
    t0 = ((await devSql("select clock_timestamp()::text as t")) as { t: string }[])[0].t;
    const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string; const me = ((await api(pac).get("people?select=id,full_name")).body as { id: string; full_name: string }[])[0]; S.person = me.id; name = me.full_name; S.fisioId = fis.user.id;
    const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${fis.user.id}&revoked_at=is.null`)).body as { id: string }[];
    if (rel.length === 0) { const l = await g.rpc("care_link", { p_person: S.person, p_professional: fis.user.id, p_unit: unit }); expect(l.status, JSON.stringify(l.body)).toBeLessThan(300); createdLink = true; }
    const f = api(fis); const plan = await f.rpc("patient_plan_save", { p_person: S.person, p_planned_sessions: 10, p_client_package: null, p_notes: `plano R41 ${runId}` }); expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    await devSql(`update public.patient_plans set started_on = current_date - 30 where person_id = '${S.person}' and status = 'active';
      delete from public.weekly_checkins where person_id = '${S.person}';
      insert into public.consents (org_id, person_id, kind, granted, version, text_snapshot) select org_id, id, 'comunicacao_comercial', true, 'v0-minuta', 'R41 ${runId}' from public.people where id = '${S.person}'`);
  });

  test("paciente responde o check-in da semana (dor 9, bem-estar 2) e o fisio recebe o alerta", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.paciente); await page.goto("/paciente");
    await expect(page.getByTestId("patient-home")).toContainText("Check-in da semana", { timeout: 40_000 });
    await page.goto("/paciente/evolucao"); const form = page.getByRole("form", { name: "Check-in da semana" }); await expect(form).toBeVisible({ timeout: 40_000 });
    await form.getByLabel(/Dor nesta semana/).fill("9"); await form.getByLabel(/O quanto consegui fazer/).fill("3"); await form.getByLabel(/Como me senti/).fill("2"); await form.getByRole("button", { name: "Enviar check-in" }).click();
    await expect(page.getByTestId("checkin-done")).toBeVisible({ timeout: 20_000 }); await expect(page.getByTestId("checkin-form")).toHaveCount(0);
    const rows = (await devSql(`select count(*)::int n from public.weekly_checkins where person_id = '${S.person}'`)) as { n: number }[]; expect(rows[0].n).toBe(1);
    const ctx = await context.browser()!.newContext({ locale: "pt-BR" }); const fp = await ctx.newPage(); await loginAs(ctx, QA.fisio); await fp.goto("/fisio");
    await expect(fp.getByTestId("physio-alerts")).toContainText("Check-in da semana: dor 9/10, bem-estar 2/10", { timeout: 40_000 }); await ctx.close();
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("admin cria o programa, vê o candidato e faz a oferta pela tela", async ({ page, context }) => {
    await loginAs(context, QA.manager); await page.goto("/admin/programas"); await expect(page.getByRole("heading", { name: "Programas e ofertas" }).first()).toBeVisible({ timeout: 40_000 });
    const f = page.getByRole("form", { name: "Novo programa" }); await f.getByLabel("Nome").fill(prog); await f.getByLabel("Resumo (o paciente vê)").fill("Sessão mensal para manter os ganhos"); await f.getByLabel(/Detalhes/).fill("Uma sessão por mês, com reavaliação rápida.");
    await f.getByRole("button", { name: "Criar programa" }).click(); await expect(page.getByText("Programa criado.")).toBeVisible({ timeout: 20_000 });
    const row = page.getByTestId("program-row").filter({ hasText: prog }); await expect(row).toBeVisible(); await row.getByRole("button", { name: "Ver candidatos" }).click();
    const cands = page.getByTestId("candidates"); await expect(cands).toContainText(name, { timeout: 30_000 });
    await cands.locator("li").filter({ hasText: name }).getByRole("button", { name: "Oferecer" }).click(); await page.getByLabel("Anotação interna (opcional)").fill("R41"); await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(cands.getByText(`Oferta enviada a ${name}.`)).toBeVisible({ timeout: 20_000 });
    expect((await api(await signIn(QA.comercial)).rpc("program_candidates", { p_program: "00000000-0000-0000-0000-000000000000" })).status, "comercial não vê candidatos").not.toBe(200);
  });

  test("paciente vê o “Próximo passo para você” e demonstra interesse: avisa a equipe, sem venda; o admin marca como aceita", async ({ page, context, browser }) => {
    const errors = collectErrors(page); await loginAs(context, QA.paciente); await page.goto("/paciente"); await expect(page.getByTestId("patient-home")).toContainText(prog, { timeout: 40_000 });
    await page.goto("/paciente/mais"); const card = page.getByTestId("offer-card").filter({ hasText: prog }); await expect(card).toBeVisible({ timeout: 30_000 }); await expect(card).toContainText("Uma sessão por mês");
    await card.getByRole("button", { name: "Tenho interesse" }).click(); await expect(page.getByText(/nenhuma cobrança é feita automaticamente/).first()).toBeVisible({ timeout: 20_000 }); await expect(card).toContainText("a equipe vai falar com você");
    const tasks = (await devSql(`select count(*)::int n from public.crm_tasks t join public.program_offers o on t.dedupe_key = 'offer:' || o.id where o.person_id = '${S.person}'`)) as { n: number }[]; expect(tasks[0].n).toBe(1);
    const sales = (await devSql(`select count(*)::int n from public.sales where person_id = '${S.person}' and created_at >= '${t0}'`)) as { n: number }[]; expect(sales[0].n, "interesse não cria venda").toBe(0);
    const ctx = await browser.newContext({ locale: "pt-BR" }); const ap = await ctx.newPage(); await loginAs(ctx, QA.manager); await ap.goto("/admin/programas"); await ap.getByRole("tab", { name: "Ofertas" }).or(ap.getByRole("button", { name: "Ofertas" })).first().click();
    const orow = ap.getByTestId("offer-row").filter({ hasText: prog }); await expect(orow).toContainText("Paciente tem interesse", { timeout: 30_000 }); await orow.getByRole("button", { name: "Marcar como aceita" }).click(); await expect(orow).toContainText("Aceita", { timeout: 20_000 });
    await ap.getByRole("tab", { name: "Indicadores" }).or(ap.getByRole("button", { name: "Indicadores" })).first().click(); await expect(ap.getByTestId("retention-kpis")).toContainText("Conversão das ofertas", { timeout: 30_000 }); await ctx.close();
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("consentimento revogado: a oferta some; no celular a página cabe na tela", async ({ page, context }) => {
    await devSql(`insert into public.consents (org_id, person_id, kind, granted, version, text_snapshot) select org_id, id, 'comunicacao_comercial', false, 'v0-minuta', 'R41 revogado ${runId}' from public.people where id = '${S.person}'`);
    await page.setViewportSize({ width: 390, height: 844 }); await loginAs(context, QA.paciente); await page.goto("/paciente/mais"); await expect(page.getByRole("heading", { name: "Meus pacotes" })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("offer-card")).toHaveCount(0); await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
  });

  test("limpeza: programa, ofertas, consentimentos, check-in e vínculo criados pelo teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await devSql(`delete from public.crm_tasks where dedupe_key in (select 'offer:' || o.id from public.program_offers o join public.care_programs g on g.id = o.program_id where g.title = '${prog}');
      delete from public.care_programs where title = '${prog}';
      delete from public.consents where person_id = '${S.person}' and text_snapshot like 'R41%';
      delete from public.weekly_checkins where person_id = '${S.person}';
      delete from public.patient_measurements where person_id = '${S.person}' and created_at >= '${t0}';
      delete from public.clinical_access_log where person_id = '${S.person}' and at >= '${t0}'`);
    if (createdLink) { const g = api(await signIn(QA.manager)); const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${S.fisioId}&revoked_at=is.null`)).body as { id: string }[]; for (const r of rel) await g.rpc("care_unlink", { p_id: r.id }); }
    const n = (await devSql(`select (select count(*) from public.care_programs where title = '${prog}')::int a, (select count(*) from public.consents where text_snapshot like 'R41%')::int b`)) as { a: number; b: number }[]; expect(n[0]).toEqual({ a: 0, b: 0 });
  });
});
