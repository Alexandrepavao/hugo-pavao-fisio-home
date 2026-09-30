// ACEITE da release v1 (escopo ampliado, etapa 3) — jornada do paciente: objetivos e plano definidos pelo fisioterapeuta vinculado, avaliações com data e autoria,
// vídeo PRIVADO (nunca público; sem a chave do Bunny a tela diz "indisponível por configuração"), pedido de renovação sem cobrança e privacidade clínica
// (gestor não lê). Usa o paciente e a fisioterapeuta de QA; limpa o que cria (objetivo encerrado, vídeo revogado).
import { expect, test } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, rest, runId, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Jornada do paciente (objetivos, evolução, vídeo privado, renovação)", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {}; let createdLink = false;
  const goalTitle = `Objetivo E2E R09 ${runId}`;

  test("preparo: vínculo assistencial, objetivo, plano, avaliação e vídeo atribuídos pela fisioterapeuta", async () => {
    const mgr = await signIn(QA.manager); const g = api(mgr); const fis = await signIn(QA.fisio); const pac = await signIn(QA.paciente);
    const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    S.person = ((await api(pac).get("people?select=id")).body as { id: string }[])[0].id; S.fisioId = fis.user.id;
    const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${fis.user.id}&revoked_at=is.null`)).body as { id: string }[];
    if (rel.length === 0) { const l = await g.rpc("care_link", { p_person: S.person, p_professional: fis.user.id, p_unit: unit }); expect(l.status, JSON.stringify(l.body)).toBeLessThan(300); createdLink = true; S.rel = "novo"; }
    // pedido aberto de execução interrompida impediria um novo (o sistema mantém um só): trata antes
    for (const r of ((await g.rpc("renewal_requests_open")).body as { id: string }[]) ?? []) await g.rpc("renewal_request_set_status", { p_id: r.id, p_status: "contacted" });
    const f = api(fis);
    const goal = await f.rpc("patient_goal_save", { p_person: S.person, p_id: null, p_title: goalTitle, p_details: "Voltar a subir escadas sem dor", p_target_date: null, p_status: "active" });
    expect(goal.status, JSON.stringify(goal.body)).toBe(200); S.goal = goal.body;
    const plan = await f.rpc("patient_plan_save", { p_person: S.person, p_planned_sessions: 10, p_client_package: null, p_notes: `plano E2E ${runId}` }); expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const as = await f.rpc("professional_assessment_add", { p_person: S.person, p_kind: "dor", p_score: 7, p_note: `avaliação E2E ${runId}`, p_assessed_at: null }); expect(as.status, JSON.stringify(as.body)).toBe(200);
    S.videoTitle = `Vídeo E2E R09 ${runId}`;
    const v = await f.rpc("patient_video_assign", { p_person: S.person, p_title: S.videoTitle, p_description: "exercício de teste", p_library_id: "999001", p_video_id: crypto.randomUUID(), p_expires_at: null });
    expect(v.status, JSON.stringify(v.body)).toBe(200); S.video = v.body;
  });

  test("paciente: vê a própria jornada, o vídeo não abre sem a chave do Bunny (e nunca fica público) e pedir contato não cobra nada", async ({ page, context }) => {
    const pac = await loginAs(context, QA.paciente); const errors = collectErrors(page);
    const salesBefore = ((await api(await signIn(QA.manager)).get(`sales?select=id&person_id=eq.${S.person}`)).body as unknown[]).length;
    await page.goto("/paciente");
    const box = page.getByRole("region", { name: "Minha jornada" });
    await expect(box.getByRole("heading", { name: "Minha jornada" })).toBeVisible({ timeout: 30_000 });
    await expect(box.getByText(goalTitle)).toBeVisible();
    await expect(box.getByRole("heading", { name: "Plano de sessões" })).toBeVisible();
    await expect(box.getByRole("progressbar")).toBeVisible();
    await expect(box.getByRole("img", { name: /Gráfico de evolução/ })).toBeVisible();
    await expect(box.getByText(/Registrado por|Dor 7/).first()).toBeVisible();
    // vídeo privado
    const vid = box.locator("li").filter({ hasText: S.videoTitle });
    await expect(vid).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);                                           // nada de player público
    await vid.getByRole("button", { name: "Assistir" }).click();
    await expect(vid.getByText(/Reprodução indisponível por configuração/)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("iframe")).toHaveCount(0);
    // o navegador não recebe o identificador do vídeo no Bunny
    const mj = await api(pac).rpc("my_journey"); expect(mj.status).toBe(200);
    expect(JSON.stringify(mj.body)).not.toMatch(/bunny_video_id|library_id|999001/);
    // o paciente registra "como estou hoje"
    await box.getByLabel("O que registrar").selectOption("dor"); await box.getByLabel("Nota (0 a 10)").fill("4");
    await box.getByLabel("Observação (opcional)").fill(`paciente E2E ${runId}`); await box.getByRole("button", { name: "Registrar" }).click();
    await expect(box.getByText(/Dor 4/).first()).toBeVisible({ timeout: 20_000 });
    // pedir contato: sem cobrança automática
    await box.getByRole("button", { name: "Quero falar com a equipe" }).click();
    await expect(box.getByText(/nenhuma cobrança é feita automaticamente/i).first()).toBeVisible({ timeout: 20_000 });
    const salesAfter = ((await api(await signIn(QA.manager)).get(`sales?select=id&person_id=eq.${S.person}`)).body as unknown[]).length;
    expect(salesAfter).toBe(salesBefore);
    await expectNoFatal(page);
    expect(errors.filter((e) => !/bunny-playback|503/.test(e)), errors.join("\n")).toEqual([]);
  });

  test("fisioterapeuta vinculada: vê o painel da jornada com o que o paciente registrou", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    await page.goto("/admin/acompanhamento");
    await page.getByRole("tab", { name: "Meus pacientes" }).click();
    const nm = ((await api(await signIn(QA.paciente)).get("people?select=full_name")).body as { full_name: string }[])[0].full_name;
    await page.getByRole("button", { name: nm }).first().click();
    const panel = page.getByRole("region", { name: "Jornada do paciente" });
    await expect(panel.getByRole("heading", { name: "Jornada do paciente" })).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(goalTitle)).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Evolução (avaliações reais)" })).toBeVisible();
    await expect(panel.getByRole("img", { name: /Gráfico de evolução/ })).toBeVisible();
    // o que o paciente registrou chega à fisioterapeuta, identificado como autorrelato do paciente (data e autoria)
    const pj = await api(await signIn(QA.fisio)).rpc("professional_journey", { p_person: S.person }); expect(pj.status, JSON.stringify(pj.body)).toBe(200);
    const asm = (pj.body as { assessments: { by_role: string; note: string | null; score: number }[] }).assessments;
    expect(asm.some((a) => a.by_role === "patient" && a.note?.includes(`paciente E2E ${runId}`) && Number(a.score) === 4)).toBe(true);
    expect(asm.some((a) => a.by_role === "professional" && Number(a.score) === 7)).toBe(true);
    await expect(panel.getByText(S.videoTitle)).toBeVisible();
    await expectNoFatal(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("privacidade: gestor não lê objetivos, avaliações nem a jornada; vê só o pedido administrativo", async ({ page, context }) => {
    const mgr = await signIn(QA.manager); const g = api(mgr);
    expect(((await g.get(`patient_goals?select=id&person_id=eq.${S.person}`)).body as unknown[]).length).toBe(0);
    expect(((await g.get(`patient_assessments?select=id&person_id=eq.${S.person}`)).body as unknown[]).length).toBe(0);
    expect((await g.rpc("professional_journey", { p_person: S.person })).status).toBeGreaterThanOrEqual(400);
    const q = await g.rpc("renewal_requests_open"); expect(q.status).toBe(200);
    const mine = (q.body as { id: string; message?: string }[]); expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(q.body)).not.toContain(goalTitle);                       // a fila administrativa não carrega dado clínico
    await loginAs(context, QA.manager); await page.goto("/admin/acompanhamento");
    await page.getByRole("tab", { name: "Pedidos de renovação" }).click();
    await expect(page.getByText("Nenhum pedido em aberto.")).toHaveCount(0);
    await expect(page.getByText(goalTitle)).toHaveCount(0);
    // outro paciente (aluno QA) não enxerga a jornada desse paciente
    const outro = await signIn(QA.aluno); const mj = await api(outro).rpc("my_journey");
    expect(JSON.stringify(mj.body)).not.toContain(goalTitle);
  });

  test("limpeza: objetivo encerrado, vídeo revogado, pedido tratado e vínculo criado pelo teste desfeito", async () => {
    const fis = await signIn(QA.fisio); const f = api(fis); const mgr = await signIn(QA.manager); const g = api(mgr);
    await f.rpc("patient_goal_save", { p_person: S.person, p_id: S.goal, p_title: goalTitle, p_details: null, p_target_date: null, p_status: "dropped" });
    await f.rpc("patient_video_revoke", { p_id: S.video });
    // resíduos de execuções anteriores interrompidas (só os criados por este spec)
    const pj = (await f.rpc("professional_journey", { p_person: S.person })).body as { goals?: { id: string; title: string; status: string }[]; videos?: { id: string; title: string; revoked_at: string | null }[] };
    for (const gl of pj.goals ?? []) if (gl.title.startsWith("Objetivo E2E R09") && gl.status === "active") await f.rpc("patient_goal_save", { p_person: S.person, p_id: gl.id, p_title: gl.title, p_details: null, p_target_date: null, p_status: "dropped" });
    for (const v of pj.videos ?? []) if (v.title.startsWith("Vídeo E2E R09") && !v.revoked_at) await f.rpc("patient_video_revoke", { p_id: v.id });
    const open = (await g.rpc("renewal_requests_open")).body as { id: string }[];
    for (const r of open) await g.rpc("renewal_request_set_status", { p_id: r.id, p_status: "contacted" });
    if (createdLink) { const rel = (await g.get(`care_relationships?select=id&person_id=eq.${S.person}&professional_user_id=eq.${S.fisioId}&revoked_at=is.null`)).body as { id: string }[]; for (const r of rel) await g.rpc("care_unlink", { p_id: r.id }); }
    void rest;
  });
});
