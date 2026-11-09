// ACEITE — Portais F6: o fisio cadastra o exercício e prescreve pela tela; o paciente vê o treino de hoje, registra esforço e dor; a adesão aparece para o fisio e a dor alta vira alerta.
// Sem vídeo (o Hugo grava depois): instruções escritas. Usa o paciente e a fisioterapeuta de QA e limpa o que cria. Somente Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Treinos em casa", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {}; let createdLink = false; let t0 = ""; const ex = `Agachamento R40 ${runId}`; const plano = `Plano R40 ${runId}`;

  test("preparo: vínculo entre a fisioterapeuta e o paciente de QA", async () => {
    const g = api(await signIn(QA.manager)); const fis = await signIn(QA.fisio); const pac = await signIn(QA.paciente);
    t0 = ((await devSql("select clock_timestamp()::text as t")) as { t: string }[])[0].t;
    const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string; S.person = ((await api(pac).get("people?select=id")).body as { id: string }[])[0].id; S.fisioId = fis.user.id;
    const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${fis.user.id}&revoked_at=is.null`)).body as { id: string }[];
    if (rel.length === 0) { const l = await g.rpc("care_link", { p_person: S.person, p_professional: fis.user.id, p_unit: unit }); expect(l.status, JSON.stringify(l.body)).toBeLessThan(300); createdLink = true; }
  });

  test("fisio cadastra o exercício na biblioteca e prescreve ao paciente pela tela", async ({ page, context }) => {
    const errors = collectErrors(page); await page.setViewportSize({ width: 1280, height: 900 }); await loginAs(context, QA.fisio);
    await page.goto("/fisio/treinos"); await expect(page.getByRole("heading", { name: "Biblioteca de exercícios" }).first()).toBeVisible({ timeout: 40_000 });
    const f = page.getByRole("form", { name: "Exercício" }); await f.getByLabel("Nome").fill(ex); await f.getByLabel("Região do corpo").fill("Membros inferiores"); await f.getByLabel("Nível").selectOption("iniciante");
    await f.getByLabel("Como fazer (o paciente vê)").fill("Pés na largura dos ombros; desça até 90° com a coluna reta."); await f.getByLabel("Contraindicações (só o fisio vê)").fill("Evitar com dor aguda no joelho");
    await f.getByRole("button", { name: "Cadastrar" }).click(); await expect(page.getByText("Exercício cadastrado.")).toBeVisible({ timeout: 20_000 }); await expect(page.getByTestId("exercise-row").filter({ hasText: ex })).toBeVisible();
    await page.goto(`/fisio/pacientes?pessoa=${S.person}`); const box = page.getByRole("region", { name: "Treinos em casa do paciente" }); await expect(box).toBeVisible({ timeout: 40_000 });
    const form = box.getByRole("form", { name: "Nova prescrição" }); await form.getByLabel("Nome", { exact: true }).fill(plano); await form.getByLabel("Meta (treinos por semana)").fill("3");
    await form.getByLabel("Exercício", { exact: true }).selectOption({ label: ex }); await form.getByLabel("Séries").fill("3"); await form.getByLabel("Repetições").fill("10");
    await form.getByRole("button", { name: "Salvar e liberar" }).click(); await expect(box.getByText("Prescrição salva e liberada ao paciente.")).toBeVisible({ timeout: 20_000 });
    await expect(box.getByTestId("prescription").filter({ hasText: plano })).toContainText(ex);
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("paciente vê o treino de hoje, marca o que fez, informa esforço e dor e conclui; o Início mostra o resultado", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.paciente); await page.goto("/paciente/treinos");
    const today = page.getByTestId("training-today"); await expect(today).toBeVisible({ timeout: 40_000 }); const it = today.getByTestId("training-item").filter({ hasText: ex }); await expect(it).toContainText("3 × 10 repetições");
    await expect(page.getByText("Evitar com dor aguda")).toHaveCount(0);                     // contraindicação é do fisio
    await it.getByText("Como fazer").click(); await expect(it).toContainText("desça até 90°");
    await page.getByRole("button", { name: "Concluir treino" }).click(); await expect(page.getByText("Marque ao menos um exercício que você fez.")).toBeVisible();
    await page.getByLabel(`Fiz: ${ex}`).check(); await page.getByLabel(/Esforço/).fill("6"); await page.getByLabel(/Dor durante o treino/).fill("2"); await page.getByRole("button", { name: "Concluir treino" }).click();
    await expect(page.getByText("Treino registrado. Parabéns!")).toBeVisible({ timeout: 20_000 }); await expect(today).toContainText("Feito"); await expect(today).toContainText("Você já registrou o treino de hoje");
    await page.goto("/paciente"); await expect(page.getByTestId("patient-home")).toContainText(/1 de 1 hoje/, { timeout: 30_000 });
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("fisio vê a adesão e os registros; dor alta durante o treino vira alerta no Início; no celular cabe na tela", async ({ page, context }) => {
    const pres = ((await devSql(`select id from public.exercise_prescriptions where person_id = '${S.person}' and title = '${plano}'`)) as { id: string }[])[0].id;
    await devSql(`insert into public.workout_logs (org_id, person_id, prescription_id, workout, done_on, items_done, pain_during, effort, note, logged_by)
      select p.org_id, p.id, '${pres}', 'A', private.today_sp() - 1, '{}', 9, 7, 'doeu muito no final', null from public.people p where p.id = '${S.person}'`);
    await loginAs(context, QA.fisio); await page.goto(`/fisio/pacientes?pessoa=${S.person}`);
    const box = page.getByRole("region", { name: "Treinos em casa do paciente" }); await expect(box.getByTestId("adherence-line")).toContainText("de 3 treinos", { timeout: 40_000 }); await expect(box).toContainText("doeu muito no final");
    await page.goto("/fisio"); await expect(page.getByTestId("physio-alerts")).toContainText("Dor 9/10 durante o treino", { timeout: 40_000 });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/fisio/pacientes?pessoa=${S.person}`); await expect(box).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
    // privacidade: outro paciente/papel não lê a prescrição
    expect((await api(await signIn(QA.comercial)).rpc("prof_training", { p_person: S.person })).status).not.toBe(200);
    expect(JSON.stringify((await api(await signIn(QA.aluno)).rpc("my_training")).body)).not.toContain(plano);
  });

  test("limpeza: prescrição, registros, exercício e vínculo criados pelo teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await devSql(`delete from public.exercise_prescriptions where person_id = '${S.person}' and title = '${plano}';
      delete from public.exercise_library where title = '${ex}';
      delete from public.clinical_access_log where person_id = '${S.person}' and at >= '${t0}'`);
    if (createdLink) { const g = api(await signIn(QA.manager)); const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${S.fisioId}&revoked_at=is.null`)).body as { id: string }[]; for (const r of rel) await g.rpc("care_unlink", { p_id: r.id }); }
    const n = (await devSql(`select (select count(*) from public.exercise_prescriptions where title = '${plano}')::int a, (select count(*) from public.exercise_library where title = '${ex}')::int b`)) as { a: number; b: number }[]; expect(n[0]).toEqual({ a: 0, b: 0 });
  });
});
