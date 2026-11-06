// ACEITE — Portais F4: chamados internos para quem já pagou (Suporte Humanizado da HP, 1ª resposta em 24 h). Usa o paciente e a fisioterapeuta de QA e limpa o que cria. Somente Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Chamados internos", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {}; let createdLink = false; let t0 = "";
  const adm = `Remarcar sessão R38 ${runId}`; const cli = `Dor no exercício R38 ${runId}`;

  test("preparo: pagamento confirmado do paciente de QA e vínculo com a fisioterapeuta", async () => {
    const g = api(await signIn(QA.manager)); const fis = await signIn(QA.fisio); const pac = await signIn(QA.paciente);
    t0 = ((await devSql("select clock_timestamp()::text as t")) as { t: string }[])[0].t;
    const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    S.person = ((await api(pac).get("people?select=id")).body as { id: string }[])[0].id; S.fisioId = fis.user.id;
    const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${fis.user.id}&revoked_at=is.null`)).body as { id: string }[];
    if (rel.length === 0) { const l = await g.rpc("care_link", { p_person: S.person, p_professional: fis.user.id, p_unit: unit }); expect(l.status, JSON.stringify(l.body)).toBeLessThan(300); createdLink = true; }
    await devSql(`with p as (select org_id, unit_id, id from public.people where id = '${S.person}'),
      s as (insert into public.sales (org_id, unit_id, person_id, status, subtotal_cents, total_cents, sold_at, notes) select org_id, unit_id, id, 'confirmed', 50000, 50000, now(), 'R38 ${runId}' from p returning id, org_id, unit_id, person_id),
      r as (insert into public.receivables (org_id, unit_id, sale_id, person_id, installment_no, installments_total, due_date, competence_month, amount_cents, status) select org_id, unit_id, id, person_id, 1, 1, current_date, date_trunc('month', current_date)::date, 50000, 'paid' from s returning id, org_id, unit_id)
      insert into public.payments (org_id, unit_id, receivable_id, kind, amount_cents, idempotency_key) select org_id, unit_id, id, 'payment', 50000, 'r38-${runId}' from r`);
  });

  test("paciente abre um chamado administrativo pela tela; a equipe responde; o paciente vê a resposta", async ({ page, context, browser }) => {
    const errors = collectErrors(page); await loginAs(context, QA.paciente);
    await page.goto("/paciente/mais"); await page.getByTestId("link-chamados").click(); await expect(page).toHaveURL(/\/paciente\/chamados$/);
    await expect(page.getByText("Este canal não é para urgências. Em emergência, ligue 192 (SAMU).")).toBeVisible({ timeout: 30_000 });
    const form = page.getByRole("form", { name: "Novo chamado" }); await expect(form).toBeVisible();
    await form.getByLabel("Assunto geral").selectOption("agenda"); await form.getByLabel("Título").fill(adm); await form.getByLabel("Mensagem").fill("Preciso remarcar a sessão de quinta para sexta.");
    await form.getByRole("button", { name: "Abrir chamado" }).click(); await expect(page.getByText(/Chamado aberto\. Respondemos em até 24 horas/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ticket-sheet")).toContainText("Preciso remarcar"); await page.keyboard.press("Escape");
    // equipe (gestor) responde pela fila
    const ctx = await browser.newContext({ locale: "pt-BR" }); const mp = await ctx.newPage(); await loginAs(ctx, QA.manager);
    await mp.goto("/admin/chamados"); const row = mp.getByTestId("queue-row").filter({ hasText: adm }); await expect(row).toBeVisible({ timeout: 40_000 }); await expect(row).toContainText("No prazo");
    await row.getByRole("button", { name: "Abrir" }).click(); const sheet = mp.getByTestId("ticket-sheet");
    await sheet.getByLabel("Responder").fill("Remarcado para sexta às 10h."); await sheet.getByRole("button", { name: "Enviar" }).click(); await expect(sheet.getByTestId("ticket-messages")).toContainText("Remarcado para sexta", { timeout: 20_000 });
    await sheet.getByLabel("Responder").fill("nota interna R38"); await sheet.getByLabel("Nota interna (só a equipe vê)").check(); await sheet.getByRole("button", { name: "Salvar nota" }).click(); await expect(sheet.getByTestId("ticket-messages")).toContainText("nota interna R38", { timeout: 20_000 });
    await ctx.close();
    await page.reload(); await page.getByTestId("my-ticket").filter({ hasText: adm }).getByRole("button", { name: "Abrir" }).click();
    await expect(page.getByTestId("ticket-messages")).toContainText("Remarcado para sexta", { timeout: 20_000 }); await expect(page.getByTestId("ticket-messages")).not.toContainText("nota interna R38");
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("chamado clínico: a equipe administrativa vê que existe, sem o conteúdo; o fisio vinculado lê e responde pela tela", async ({ page, context, browser }) => {
    const p = api(await signIn(QA.paciente));
    const t = await p.rpc("my_ticket_open", { p_category: "clinica", p_subject: cli, p_body: "Senti dor forte no joelho ontem.", p_key: `r38c-${runId}` }); expect(t.status, JSON.stringify(t.body)).toBe(200); S.cli = t.body;
    const q = (await api(await signIn(QA.gestorUnidade)).rpc("support_queue")).body as { id: string; masked: boolean; subject: string }[];
    const mine = q.find((x) => x.id === S.cli); expect(mine?.masked, "gestor de unidade vê só a existência").toBe(true); expect(JSON.stringify(mine)).not.toContain("joelho"); expect(mine?.subject).toContain("Chamado clínico");
    expect((await api(await signIn(QA.gestorUnidade)).rpc("support_ticket", { p_id: S.cli })).body.messages).toEqual([]);
    expect((await api(await signIn(QA.comercial)).rpc("support_queue")).status).not.toBe(200);
    await page.setViewportSize({ width: 1280, height: 800 }); await loginAs(context, QA.fisio);
    await page.goto("/fisio"); await expect(page.getByTestId("physio-alerts")).toContainText("Chamado clínico", { timeout: 40_000 });
    await page.goto("/fisio/chamados"); const row = page.getByTestId("queue-row").filter({ hasText: cli }); await expect(row).toBeVisible({ timeout: 40_000 });
    await row.getByRole("button", { name: "Abrir" }).click(); const sheet = page.getByTestId("ticket-sheet"); await expect(sheet.getByTestId("ticket-messages")).toContainText("dor forte no joelho", { timeout: 20_000 });
    await sheet.getByLabel("Responder").fill("Evite o exercício 2 até a próxima sessão."); await sheet.getByRole("button", { name: "Enviar" }).click(); await expect(sheet.getByTestId("ticket-messages")).toContainText("Evite o exercício 2", { timeout: 20_000 });
    const back = (await p.rpc("my_ticket", { p_id: S.cli })).body; expect(JSON.stringify(back)).toContain("Evite o exercício 2");
    void browser;
  });

  test("quem não pagou vê o aviso, sem formulário; no celular a página cabe na tela", async ({ page, context }) => {
    await loginAs(context, QA.aluno); await page.goto("/paciente/chamados");
    await expect(page.getByTestId("ticket-ineligible").or(page.getByText(/não está disponível/))).toBeVisible({ timeout: 40_000 }); await expect(page.getByRole("form", { name: "Novo chamado" })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 }); await loginAs(context, QA.paciente); await page.goto("/paciente/chamados"); await expect(page.getByRole("form", { name: "Novo chamado" })).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
  });

  test("limpeza: chamados, tarefas, pagamento de teste e vínculo criados pelo teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await devSql(`delete from public.crm_tasks where dedupe_key in (select 'ticket:' || id from public.support_tickets where person_id = '${S.person}' and created_at >= '${t0}');
      delete from public.clinical_access_log where person_id = '${S.person}' and at >= '${t0}';
      delete from public.support_tickets where person_id = '${S.person}' and created_at >= '${t0}';
      delete from public.payments where idempotency_key = 'r38-${runId}';
      delete from public.receivables where sale_id in (select id from public.sales where notes = 'R38 ${runId}');
      delete from public.sales where notes = 'R38 ${runId}'`);
    if (createdLink) { const g = api(await signIn(QA.manager)); const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${S.fisioId}&revoked_at=is.null`)).body as { id: string }[]; for (const r of rel) await g.rpc("care_unlink", { p_id: r.id }); }
    const n = (await devSql(`select count(*)::int n from public.support_tickets where person_id = '${S.person}' and created_at >= '${t0}'`)) as { n: number }[]; expect(n[0].n).toBe(0);
  });
});
