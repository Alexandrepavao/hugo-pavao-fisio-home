// ACEITE — Portais F3: o fisio faz o REGISTRO RÁPIDO pós-sessão (dor antes/depois, resumo, nota clínica restrita, medida de amplitude) e o paciente vê a EVOLUÇÃO
// (início × agora, linha do tempo por consulta, o que quer voltar a fazer), sem nunca ver a nota clínica. Usa o paciente e a fisioterapeuta de QA e limpa o que cria. Somente Dev.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, QA, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Evolução do paciente (registro rápido, linha do tempo, medidas)", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {}; let createdLink = false; let t0 = ""; const appts: string[] = [];
  const resumo = `Mobilização e treino de marcha ${runId}`; const nota = `nota clínica restrita R37 ${runId}`;

  test("preparo: vínculo, plano com especialidade e 3 atendimentos realizados", async () => {
    const g = api(await signIn(QA.manager)); const fis = await signIn(QA.fisio); const pac = await signIn(QA.paciente);
    t0 = ((await devSql("select clock_timestamp()::text as t")) as { t: string }[])[0].t;
    const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    S.person = ((await api(pac).get("people?select=id")).body as { id: string }[])[0].id; S.fisioId = fis.user.id;
    const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${fis.user.id}&revoked_at=is.null`)).body as { id: string }[];
    if (rel.length === 0) { const l = await g.rpc("care_link", { p_person: S.person, p_professional: fis.user.id, p_unit: unit }); expect(l.status, JSON.stringify(l.body)).toBeLessThan(300); createdLink = true; }
    const f = api(fis);
    const plan = await f.rpc("patient_plan_save", { p_person: S.person, p_planned_sessions: 10, p_client_package: null, p_notes: `plano R37 ${runId}` }); expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const sp = await f.rpc("patient_plan_specialty_set", { p_person: S.person, p_specialty: "ortopedica" }); expect(sp.status, JSON.stringify(sp.body)).toBeLessThan(300);
    await devSql(`update public.patient_plans set started_on = current_date - 90 where person_id = '${S.person}' and status = 'active'`);
    const prof = ((await devSql(`select id from public.professionals where user_id = '${fis.user.id}'`)) as { id: string }[])[0].id;
    for (const [i, days] of [20, 14, 8].entries()) {
      const r = (await devSql(`insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status, notes)
        select p.org_id, p.unit_id, '${prof}', p.id, (select id from public.services where org_id = p.org_id limit 1), tstzrange(date_trunc('minute', now()) - interval '${days} days' + interval '${3 + i * 7} minutes', date_trunc('minute', now()) - interval '${days} days' + interval '${33 + i * 7} minutes'), 'attended', 'R37 ${runId}'
        from public.people p where p.id = '${S.person}' returning id`)) as { id: string }[]; appts.push(r[0].id);
    }
  });

  test("fisio: registro rápido pela tela (dor antes/depois, resumo, nota restrita, goniometria) e a evolução aparece para ele", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.fisio);
    await page.goto(`/fisio/pacientes?pessoa=${S.person}`);
    const box = page.getByRole("region", { name: "Evolução do paciente" }); await expect(box).toBeVisible({ timeout: 40_000 });
    const form = box.getByRole("form", { name: "Registro rápido da sessão" });
    await form.getByLabel("Atendimento").selectOption(appts[2]);
    await form.getByLabel("Dor antes (0–10)").fill("7"); await form.getByLabel("Dor depois (0–10)").fill("4");
    await form.getByLabel("O que foi feito (o paciente vê)").fill(resumo); await form.getByLabel("Próxima conduta (o paciente vê)").fill("Manter exercícios em casa");
    await form.getByLabel("Nota clínica (restrita)").fill(nota);
    await form.getByRole("button", { name: "+ Adicionar medida" }).click();
    await form.getByLabel("Medida").selectOption("goniometria"); await form.getByLabel("Movimento / atividade").fill("Flexão do joelho"); await form.getByLabel("Lado").selectOption("D"); await form.getByLabel(/Valor/).fill("95");
    await form.getByRole("button", { name: "Salvar registro" }).click(); await expect(box.getByText("Registro salvo.")).toBeVisible({ timeout: 20_000 });
    await expect(box.getByTestId("timeline")).toContainText(resumo, { timeout: 20_000 }); await expect(box.getByTestId("timeline")).toContainText(nota);   // o fisio vê a nota restrita
    await expect(box.getByTestId("series-card").filter({ hasText: "Flexão do joelho" })).toContainText("95");
    // mesmas medidas pela API (registros do dia do atendimento, imutáveis)
    const rows = (await devSql(`select instrument_key, value::float v, phase from public.patient_measurements where person_id = '${S.person}' and created_at >= '${t0}' order by instrument_key, phase`)) as { instrument_key: string; v: number; phase: string }[];
    expect(rows.map((r) => `${r.instrument_key}:${r.phase}:${r.v}`)).toEqual(["goniometria:assessment:95", "nprs:after:4", "nprs:before:7"]);
    // outro registro (primeira sessão) pela API, para formar a série
    const f = api(await signIn(QA.fisio));
    const r2 = await f.rpc("prof_session_record", { p_person: S.person, p_appointment: appts[0], p_summary: "Avaliação inicial", p_next_step: null, p_clinical_note: null, p_measures: [{ instrument: "nprs", value: 9, phase: "before" }, { instrument: "goniometria", label: "Flexão do joelho", side: "D", value: 80, phase: "assessment" }], p_key: `r37-${runId}` });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("paciente: vê início × agora, linha do tempo e o resumo; NUNCA a nota clínica; registra dor e atividade", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.paciente);
    await page.goto("/paciente/evolucao"); const box = page.getByRole("region", { name: "Minha evolução" }); await expect(box).toBeVisible({ timeout: 40_000 });
    const joelho = box.getByTestId("series-card").filter({ hasText: "Flexão do joelho" }); await expect(joelho).toContainText("80 → 95"); await expect(joelho).toContainText("graus");
    const dor = box.getByTestId("series-card").filter({ hasText: /^Dor/ }).first(); await expect(dor).toBeVisible();
    await expect(box.getByTestId("timeline")).toContainText(resumo); await expect(box.getByTestId("timeline")).toContainText("Dor: 7 antes → 4 depois"); await expect(box.getByTestId("timeline")).toContainText(/Sessão \d+/);
    await expect(page.getByText(nota)).toHaveCount(0); expect(await page.content()).not.toContain(nota);
    const raw = (await api(await signIn(QA.paciente)).rpc("my_evolution")).body; expect(JSON.stringify(raw)).not.toContain(nota);
    await box.getByLabel("Como está a sua dor hoje? (0 a 10)").fill("2"); await box.getByRole("button", { name: "Registrar dor" }).click(); await expect(box.getByText("Dor registrada.")).toBeVisible({ timeout: 20_000 });
    await box.getByLabel("Uma atividade que quero voltar a fazer").fill(`Subir escada ${runId}`); await box.getByLabel(/o quanto consigo/).fill("3"); await box.getByRole("button", { name: "Registrar atividade" }).click();
    await expect(box.getByText("Atividade registrada.")).toBeVisible({ timeout: 20_000 }); await expect(box.getByTestId("goals")).toContainText(`Subir escada ${runId}`);
    // a goniometria é do fisio: a API recusa se o paciente tentar
    expect((await api(await signIn(QA.paciente)).rpc("my_measurement_add", { p_instrument: "goniometria", p_label: "x", p_value: 100, p_note: null, p_key: null })).status).not.toBe(200);
    expect(errors.filter((e) => !/403|42501/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("celular: a evolução cabe na tela; admin (gestor) lê pelo caminho registrado e comercial não", async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await loginAs(context, QA.paciente);
    await page.goto("/paciente/evolucao"); await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(600);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
    const adm = await api(await signIn(QA.manager)).rpc("admin_patient_evolution", { p_person: S.person }); expect(adm.status, JSON.stringify(adm.body)).toBe(200); expect(JSON.stringify(adm.body)).toContain(nota);
    expect((await api(await signIn(QA.comercial)).rpc("admin_patient_evolution", { p_person: S.person })).status).not.toBe(200);
    expect((await api(await signIn(QA.comercial)).rpc("prof_patient_evolution", { p_person: S.person })).status).not.toBe(200);
  });

  test("limpeza: medidas, notas, atendimentos e vínculo criados pelo teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await devSql(`delete from public.patient_measurements where person_id = '${S.person}' and created_at >= '${t0}';
      delete from public.session_notes where person_id = '${S.person}' and created_at >= '${t0}';
      delete from public.clinical_access_log where person_id = '${S.person}' and at >= '${t0}';
      delete from public.appointments where notes = 'R37 ${runId}'`);
    if (createdLink) { const g = api(await signIn(QA.manager)); const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${S.fisioId}&revoked_at=is.null`)).body as { id: string }[]; for (const r of rel) await g.rpc("care_unlink", { p_id: r.id }); }
    const n = (await devSql(`select count(*)::int n from public.patient_measurements where person_id = '${S.person}' and created_at >= '${t0}'`)) as { n: number }[]; expect(n[0].n).toBe(0);
  });
});
