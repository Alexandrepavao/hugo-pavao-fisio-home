// NOVO — N34: reformulação visual da área do paciente (jornada) + demonstração interativa para o fisioterapeuta. Somente Dev.
//  · portal com dados reais (objetivo, jornada definida pelo fisioterapeuta, dor, atividades, rotina, semana, sessões, conteúdos) e sem dados (início de acompanhamento, sem gráficos inventados)
//  · o que o fisioterapeuta registra aparece para o paciente; isolamento entre pacientes
//  · demonstração: navegável, tour guiado, isolada (nenhuma gravação, nada em armazenamento do navegador), "Preparar acompanhamento real" abre o fluxo existente
//  · desktop, tablet e celular sem rolagem lateral; tema escuro e contraste; movimento reduzido; teclado
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { ANON, SUPABASE_URL } from "../helpers";
import { api, collectErrors, createConfirmedUser, devSql, loginAs, QA, runId, signIn, signInWith, uiLogin } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: Page, name: string, full = false) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`), fullPage: full }); };
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const pass = `Tmp-${runId}-aA1!`; const goalTxt = `Subir escadas sem dor ${runId}`;
const A = { name: `Marina Jornada N34 ${runId}`, email: `marina.n34.${runId}@hp-test.dev`, id: "", user: "" };   // com dados
const B = { name: `Bruno Novo N34 ${runId}`, email: `bruno.n34.${runId}@hp-test.dev`, id: "", user: "" };      // sem nenhum registro
const ids = { physioUser: "", prof: "", service: "", unit: "" };

const makePatient = async (p: typeof A, g: ReturnType<typeof api>, unit: string) => {
  const r = await g.rpc("create_person", { p_full_name: p.name, p_unit_id: unit, p_kinds: ["patient"], p_email: p.email, p_phone: null, p_notes: null, p_force: true }); expect(r.status, JSON.stringify(r.body)).toBe(200); p.id = r.body.id;
  p.user = await createConfirmedUser(p.email, pass); const l = await g.rpc("person_portal_access", { p_person: p.id, p_email: p.email }); expect(l.status, JSON.stringify(l.body)).toBe(200);
  await devSql(`update public.people set birth_date = date '1978-04-10' where id = '${p.id}'; insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id) select org_id, unit_id, '${ids.physioUser}', id from public.people where id = '${p.id}' on conflict do nothing`);
};
const counts = async (person: string) => (await devSql(`select (select count(*)::int from public.appointments where person_id = '${person}') appts, (select count(*)::int from public.patient_measurements where person_id = '${person}') meas,
  (select count(*)::int from public.workout_logs where person_id = '${person}') logs, (select count(*)::int from public.session_notes where person_id = '${person}') notes, (select count(*)::int from public.patient_assessments where person_id = '${person}') assess,
  (select count(*)::int from public.interactions where person_id = '${person}') inter, (select count(*)::int from public.crm_tasks where person_id = '${person}') tasks, (select count(*)::int from public.sales where person_id = '${person}') sales,
  (select count(*)::int from public.plan_stage_events where person_id = '${person}') stages, (select count(*)::int from public.patient_education where person_id = '${person}') edu`)) as Record<string, number>[];

test.describe.serial("@novos Jornada visual do paciente e demonstração", () => {
  test.setTimeout(300_000);
  const clean = async () => {
    for (const p of [A, B]) if (p.id) await devSql(`set local session_replication_role = replica;
      delete from public.workout_logs where person_id = '${p.id}'; delete from public.prescription_items where prescription_id in (select id from public.exercise_prescriptions where person_id = '${p.id}'); delete from public.exercise_prescriptions where person_id = '${p.id}';
      delete from public.exercise_library where title like '% N34 ${runId}'; delete from public.appointments where person_id = '${p.id}'; delete from public.patient_measurements where person_id = '${p.id}'; delete from public.patient_assessments where person_id = '${p.id}';
      delete from public.patient_goals where person_id = '${p.id}'; delete from public.plan_stage_events where person_id = '${p.id}'; delete from public.patient_education where person_id = '${p.id}'; delete from public.patient_plans where person_id = '${p.id}';
      delete from public.care_relationships where person_id = '${p.id}'; delete from public.clinical_access_log where person_id = '${p.id}'; delete from public.interactions where person_id = '${p.id}'; delete from public.person_contacts where person_id = '${p.id}'; delete from public.person_kinds where person_id = '${p.id}';
      delete from public.user_accounts where person_id = '${p.id}'; delete from public.role_assignments where user_id = '${p.user}'; delete from public.people where id = '${p.id}'; delete from auth.users where id = '${p.user}';`).catch(() => null);
  };
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixtures: paciente com dados (plano, objetivo, dor, atividades, rotina, consultas) e paciente novo sem nada, ambos vinculados ao fisioterapeuta de QA", async () => {
    const g = api(await signIn(QA.manager)); const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string; ids.unit = unit;
    const r = (await devSql(`select (select id from auth.users where email = '${QA.fisio}') u, (select p.id from public.professionals p join auth.users u on u.id = p.user_id where u.email = '${QA.fisio}' limit 1) prof, (select id from public.services order by created_at limit 1) svc`)) as { u: string; prof: string; svc: string }[];
    ids.physioUser = r[0].u; ids.prof = r[0].prof; ids.service = r[0].svc; expect(ids.physioUser && ids.prof && ids.service).toBeTruthy();
    await makePatient(A, g, unit); await makePatient(B, g, unit);
    await devSql(`do $$ declare v_org uuid; ex1 uuid; ex2 uuid; pr uuid; pl uuid;
      begin select org_id into v_org from public.people where id = '${A.id}';
        insert into public.patient_plans (org_id, unit_id, person_id, planned_sessions, started_on, specialty) values (v_org, '${unit}', '${A.id}', 10, current_date - 20, 'ortopedica') returning id into pl;
        insert into public.patient_goals (org_id, unit_id, person_id, title) values (v_org, '${unit}', '${A.id}', '${goalTxt}');
        insert into public.patient_measurements (org_id, unit_id, person_id, plan_id, instrument_key, value, recorded_by_role, measured_at) values
          (v_org, '${unit}', '${A.id}', pl, 'nprs', 8, 'professional', now() - interval '12 days'), (v_org, '${unit}', '${A.id}', pl, 'nprs', 6, 'patient', now() - interval '6 days'), (v_org, '${unit}', '${A.id}', pl, 'nprs', 4, 'patient', now() - interval '1 day');
        insert into public.patient_measurements (org_id, unit_id, person_id, plan_id, instrument_key, label, value, recorded_by_role, measured_at) values
          (v_org, '${unit}', '${A.id}', pl, 'psfs', 'Caminhar', 3, 'professional', now() - interval '12 days'), (v_org, '${unit}', '${A.id}', pl, 'psfs', 'Caminhar', 6, 'professional', now() - interval '1 day'), (v_org, '${unit}', '${A.id}', pl, 'psfs', 'Subir escadas', 2, 'professional', now() - interval '1 day');
        insert into public.exercise_library (org_id, title, instructions) values (v_org, 'Ponte de glúteos N34 ${runId}', 'Deite de costas e eleve o quadril sem arquear a lombar.') returning id into ex1;
        insert into public.exercise_library (org_id, title, instructions) values (v_org, 'Extensão de joelho N34 ${runId}', 'Sentado, estenda o joelho devagar.') returning id into ex2;
        insert into public.exercise_prescriptions (org_id, unit_id, person_id, professional_user_id, title, weekly_target) values (v_org, '${unit}', '${A.id}', '${ids.physioUser}', 'Rotina N34', 3) returning id into pr;
        insert into public.prescription_items (prescription_id, workout, position, exercise_id, sets, reps, notes) values (pr, 'A', 1, ex1, 3, 10, 'Sem dor forte'), (pr, 'A', 2, ex2, 3, 12, null);
        insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, status) values
          (v_org, '${unit}', '${ids.prof}', '${A.id}', '${ids.service}', tstzrange(now() - interval '12 days' + interval '7 minutes', now() - interval '12 days' + interval '37 minutes'), 'attended'),
          (v_org, '${unit}', '${ids.prof}', '${A.id}', '${ids.service}', tstzrange(now() - interval '6 days' + interval '9 minutes', now() - interval '6 days' + interval '39 minutes'), 'attended'),
          (v_org, '${unit}', '${ids.prof}', '${A.id}', '${ids.service}', tstzrange(now() - interval '2 days' + interval '11 minutes', now() - interval '2 days' + interval '41 minutes'), 'cancelled_by_patient'),
          (v_org, '${unit}', '${ids.prof}', '${A.id}', '${ids.service}', tstzrange(now() + interval '3 days' + interval '13 minutes', now() + interval '3 days' + interval '43 minutes'), 'scheduled');
      end $$;`);
  });

  test("fisioterapeuta define a jornada e publica um conteúdo; o paciente vê exatamente isso, e nada avança por número de sessões", async ({ page, context, browser }) => {
    const errors = collectErrors(page); await loginAs(context, QA.fisio);
    await page.goto(`/fisio/pacientes?pessoa=${A.id}`); const ed = page.getByTestId("journey-editor"); await expect(ed).toBeVisible({ timeout: 40_000 });
    await expect(ed.getByRole("button", { name: "Salvar jornada" })).toBeEnabled({ timeout: 20_000 });
    await ed.getByLabel("Etapa atual: Movimento").check(); await ed.getByRole("button", { name: "Salvar jornada" }).click(); await expect(page.getByText(/Jornada salva/)).toBeVisible({ timeout: 20_000 });
    await ed.getByLabel("Título").fill("Por que a rotina em casa importa"); await ed.getByLabel(/Texto \(você escreve/).fill("A rotina prescrita complementa as consultas e é ajustada a cada reavaliação."); await ed.getByRole("button", { name: "Publicar para o paciente" }).click(); await expect(page.getByText(/Conteúdo publicado/)).toBeVisible({ timeout: 20_000 });
    await shot(page, "fisio-editor-jornada");
    // paciente
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p = await ctx.newPage(); const e2 = collectErrors(p);
    await uiLogin(p, A.email, pass); await expect(page.url()).toBeTruthy(); await p.goto("/paciente"); await expect(p.getByTestId("patient-home")).toBeVisible({ timeout: 40_000 }); await p.waitForLoadState("networkidle");
    await expect(p.getByTestId("jr-goal")).toContainText(goalTxt); await expect(p.getByTestId("jr-hero")).toContainText(`Olá, Marina`);
    const etapas = p.getByTestId("jr-stage"); await expect(etapas).toHaveCount(5); await expect(etapas.nth(2)).toHaveAttribute("data-state", "atual"); await expect(etapas.nth(0)).toHaveAttribute("data-state", "concluida"); await expect(etapas.nth(4)).toHaveAttribute("data-state", "pendente");
    await expect(etapas.nth(2)).toContainText("Movimento"); await expect(p.getByTestId("jr-journey")).toContainText("Etapa atual");
    const dor = p.getByTestId("jr-pain"); await expect(dor).toContainText("De 8 para 4 em 3 registros"); await expect(dor).toContainText("queda de 4"); await expect(dor).toContainText("Não são uma previsão de recuperação"); await expect(dor).toContainText("0 = sem dor");
    const fn = p.getByTestId("jr-functional-item"); await expect(fn).toHaveCount(2); await expect(fn.filter({ hasText: "Caminhar" })).toContainText(/Início 3.*agora 6/); await expect(fn.filter({ hasText: "Subir escadas" })).toContainText("1 registro"); await expect(fn.filter({ hasText: "Subir escadas" })).not.toContainText("agora");
    await expect(p.getByTestId("jr-exercise")).toHaveCount(2); await expect(p.getByTestId("jr-exercises")).toContainText("Ponte de glúteos"); await expect(p.getByTestId("jr-exercises")).toContainText("Assistir ao vídeo e registrar que fez");
    await expect(p.getByTestId("jr-exercises").getByRole("button", { name: "Vídeo indisponível" }).first()).toBeDisabled();
    const sess = p.getByTestId("jr-sessions"); await expect(sess).toContainText("Plano clínico"); await expect(sess).toContainText("Realizadas"); await expect(sess).toContainText("Consumidas sem atendimento"); await expect(sess).toContainText("Saldo do pacote"); await expect(sess).toContainText("não mede recuperação");
    await expect(p.getByTestId("jr-week")).toBeVisible(); await expect(p.getByTestId("jr-week-appt").first()).toBeVisible();
    await expect(p.getByTestId("jr-education")).toContainText("Por que a rotina em casa importa");
    await expect(p.getByTestId("patient-home")).not.toContainText(/\d+\s?%/); await expect(p.getByTestId("patient-home")).not.toContainText(/recuperado/i);
    await expect(p.getByTestId("jr-next-appt")).toContainText("Agendado"); await expect(p.getByTestId("jr-next-appt").getByRole("button", { name: "Cancelar" })).toBeVisible();
    await shot(p, "inicio-com-acompanhamento-desktop", true);
    // fisioterapeuta avança a etapa → o paciente vê (mesmo com mais sessões nada muda sozinho)
    await ed.getByLabel("Etapa atual: Atividades").check(); await ed.getByRole("button", { name: "Salvar jornada" }).click(); await expect(page.getByText(/Jornada salva/).first()).toBeVisible({ timeout: 20_000 });
    await p.reload(); await expect(p.getByTestId("jr-stage").nth(3)).toHaveAttribute("data-state", "atual", { timeout: 30_000 }); await expect(p.getByTestId("jr-stage").nth(2)).toHaveAttribute("data-state", "concluida");
    // abas do portal reaproveitam os mesmos componentes
    await p.goto("/paciente/evolucao"); await expect(p.getByTestId("live-parts").getByTestId("jr-pain")).toBeVisible({ timeout: 30_000 }); await shot(p, "evolucao-desktop", true);
    await p.goto("/paciente/agenda"); await expect(p.getByTestId("live-parts").getByTestId("jr-week")).toBeVisible({ timeout: 30_000 }); await shot(p, "agenda-desktop", true);
    expect(errors, errors.join("\n")).toEqual([]); expect(e2, e2.join("\n")).toEqual([]); await ctx.close();
  });

  test("paciente sem nenhum registro: início de acompanhamento honesto, sem gráficos, metas ou zeros inventados", async ({ browser }) => {
    for (const [tag, vp, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["celular", { width: 390, height: 844 }, true]] as const) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p = await ctx.newPage(); const errors = collectErrors(p);
      await uiLogin(p, B.email, pass); await p.goto("/paciente"); const home = p.getByTestId("patient-home"); await expect(home).toBeVisible({ timeout: 40_000 }); await p.waitForLoadState("networkidle");
      await expect(p.getByTestId("jr-start")).toContainText("Seu acompanhamento está começando"); await expect(p.getByTestId("jr-start")).toContainText("Avaliação inicial");
      await expect(p.getByTestId("jr-goal")).toHaveCount(0); await expect(p.getByTestId("jr-hero")).toContainText("Seu objetivo será definido na avaliação");
      await expect(p.getByTestId("jr-journey")).toHaveCount(0);   // sem etapas inventadas
      await expect(p.getByTestId("jr-pain")).toHaveCount(0); await expect(p.getByTestId("jr-functional")).toHaveCount(0);
      await expect(p.getByTestId("jr-exercises")).toContainText("Nenhum exercício liberado"); await expect(p.getByTestId("jr-sessions")).toContainText("ainda não definido"); await expect(p.getByTestId("jr-sessions")).toContainText("sem pacote contratado"); await expect(p.getByTestId("jr-sessions").locator("strong")).toHaveText(["—", "—", "—", "—"]);
      await expect(home.locator("svg.recharts-surface")).toHaveCount(0); await expect(home).not.toContainText(/\b0 de 10\b/); await expect(home).not.toContainText(/\d+\s?%/);
      await expect(p.getByTestId("jr-next-action")).toContainText("Sua avaliação define o plano");
      expect(await noOverflow(p), `${tag}: sem rolagem horizontal`).toBe(true); await shot(p, `inicio-sem-dados-${tag}`, true); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
    }
  });

  test("isolamento: cada paciente só lê a própria jornada e os próprios conteúdos (pela API)", async () => {
    const tA = (await signInWith(A.email, pass)).access_token; const tB = (await signInWith(B.email, pass)).access_token; const tQa = (await signIn(QA.paciente)).access_token;
    const call = async (t: string, fn: string, body: unknown = {}) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const a = await call(tA, "my_journey_plan"); expect(a.body.goal.title).toBe(goalTxt); expect(a.body.stages).toHaveLength(5);
    expect((await call(tA, "my_education")).body).toHaveLength(1);
    for (const t of [tB, tQa]) { const o = await call(t, "my_journey_plan"); expect(JSON.stringify(o.body)).not.toContain(goalTxt); expect(JSON.stringify((await call(t, "my_education")).body)).not.toContain("rotina em casa importa"); }
    expect(JSON.stringify((await call(tB, "my_home")).body)).not.toContain(A.name.split(" ")[0] + " Jornada");
    const phy = await signIn(QA.paciente); expect((await call(phy.access_token, "plan_journey_set", { p_person: A.id, p_stages: ["A1", "B2", "C3"], p_current: 0 })).status, "paciente não define jornada de ninguém").toBe(403);
  });

  test("demonstração: abre pela ficha, é navegável, tem tour guiado e fica ISOLADA (nenhuma gravação, nada guardado no navegador)", async ({ page, context }) => {
    const errors = collectErrors(page); await loginAs(context, QA.fisio); const antes = await counts(A.id);
    await page.goto(`/fisio/pacientes?pessoa=${A.id}`); await page.getByTestId("apresentar").click(); await expect(page).toHaveURL(/\/fisio\/apresentar$/, { timeout: 30_000 }); await expect(page.getByTestId("demo-root")).toBeVisible();
    // gravações = qualquer chamada não-GET para a API do Supabase (REST, funções, auth/admin) depois que a demonstração abriu
    const writes: string[] = []; page.on("request", (r) => { const u = r.url(); if (u.startsWith(SUPABASE_URL) && r.method() !== "GET" && !/\/auth\/v1\/token/.test(u)) writes.push(`${r.method()} ${u.replace(SUPABASE_URL, "")}`); });
    await expect(page.getByTestId("demo-banner")).toContainText("DEMONSTRAÇÃO — Dados ilustrativos"); await expect(page.getByTestId("demo-badge-app")).toContainText("Dados ilustrativos");
    await expect(page.getByTestId("demo-stage").getByTestId("jr-hero")).toContainText("Olá, Marina"); await expect(page.getByTestId("demo-phone")).toBeVisible();   // moldura de celular no computador
    await expect(page.getByTestId("demo-stage")).not.toContainText(goalTxt);   // objetivo real NÃO entra na demonstração (exemplo ilustrativo)
    await shot(page, "demonstracao-moldura-celular");
    for (const sc of ["inicio", "acompanhamento", "reavaliacao"]) { await page.getByTestId(`demo-sc-${sc}`).click(); await expect(page.getByTestId(`demo-sc-${sc}`)).toHaveAttribute("aria-pressed", "true"); await expect(page.getByTestId("demo-banner")).toBeVisible(); }
    await page.getByTestId("demo-sc-acompanhamento").click();
    for (const t of ["evolucao", "exercicios", "agenda", "mais", "inicio"]) { await page.getByTestId(`demo-tab-${t}`).click(); await expect(page.getByTestId(`demo-tab-${t}`)).toHaveAttribute("aria-current", "page"); }
    // interações simuladas
    await page.getByTestId("demo-tab-exercicios").click(); await shot(page, "demonstracao-exercicios"); const ex = page.getByTestId("demo-stage").getByTestId("jr-exercise").first(); await ex.getByRole("button", { name: "Registrar que fiz" }).click(); await expect(ex.getByRole("button", { name: "Registrado como feito" })).toBeVisible();
    await ex.getByRole("button", { name: "Assistir" }).click(); await expect(page.getByRole("dialog")).toContainText("Vídeo de demonstração (ilustrativo)"); await expect(page.getByRole("dialog")).toContainText("Assistir não registra o exercício como feito"); await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).first().click();
    await page.getByTestId("demo-tab-agenda").click(); await shot(page, "demonstracao-agenda"); await page.getByTestId("demo-stage").getByRole("button", { name: "Confirmar presença" }).click(); await expect(page.getByTestId("demo-note")).toContainText("Simulação"); await expect(page.getByTestId("demo-stage").getByTestId("jr-next-appt")).toContainText("Confirmado");
    await page.getByTestId("demo-stage").getByRole("button", { name: "Cancelar" }).click(); await expect(page.getByTestId("demo-note")).toContainText("nenhuma sessão foi descontada");
    // tour guiado: Avançar, Voltar e Sair
    await page.getByTestId("demo-tour-start").click(); const tour = page.getByTestId("demo-tour"); await expect(tour).toContainText("passo 1 de 8");
    await page.getByTestId("demo-next").click(); await expect(tour).toContainText("passo 2 de 8"); await expect(page.locator(".jr-tour-hl")).toHaveAttribute("data-testid", "jr-journey");
    await page.getByRole("button", { name: "Voltar" }).click(); await expect(tour).toContainText("passo 1 de 8");
    for (let i = 0; i < 4; i++) await page.getByTestId("demo-next").click(); await expect(tour).toContainText("passo 5 de 8"); await expect(page.getByTestId("demo-tab-exercicios")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("demo-tour-exit").click(); await expect(page.getByTestId("demo-tour-start")).toBeVisible();
    // personalização só em memória
    await page.getByText("Personalizar (só nesta tela)").click(); await page.getByLabel("Primeiro nome").fill("Teresa"); await page.getByLabel("Objetivo").fill("Voltar a dançar"); await page.getByTestId("demo-tab-inicio").click(); await expect(page.getByTestId("demo-stage").getByTestId("jr-hero")).toContainText("Olá, Teresa"); await expect(page.getByTestId("demo-stage")).toContainText("Voltar a dançar");
    const stor = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } })); expect(stor).not.toMatch(/Marina|Teresa|dançar|jornada/i);
    // “Tela cheia” e sair
    await page.getByRole("button", { name: "Tela cheia" }).click(); await expect(page.getByTestId("demo-full")).toBeVisible();
    expect(writes, "nenhuma chamada de gravação durante a demonstração:\n" + writes.join("\n")).toEqual([]);
    await page.getByTestId("demo-prepare").click(); await expect(page).toHaveURL(/\/fisio\/pacientes\?pessoa=/, { timeout: 30_000 }); await expect(page.getByTestId("journey-editor")).toBeVisible({ timeout: 30_000 });   // abre o fluxo existente, sem copiar nada
    expect(JSON.stringify(await counts(A.id)), "o banco não mudou depois de usar a demonstração").toBe(JSON.stringify(antes));
    // ao voltar e entrar de novo, a personalização anterior sumiu
    await page.getByTestId("apresentar").click(); await expect(page.getByTestId("demo-stage").getByTestId("jr-hero")).toContainText("Olá, Marina"); await expect(page.getByTestId("demo-stage")).not.toContainText("Teresa");
    await page.getByTestId("demo-exit").click(); await expect(page).toHaveURL(/\/fisio\/pacientes/, { timeout: 30_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("demonstração: tablet e celular aproveitam a tela inteira (controles recolhidos), sem rolagem lateral; teclado inicia o tour", async ({ browser }) => {
    for (const [tag, vp] of [["tablet", { width: 820, height: 1100 }], ["celular", { width: 390, height: 844 }]] as const) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); await loginAs(ctx, QA.fisio); const p = await ctx.newPage(); const errors = collectErrors(p);
      await p.goto("/fisio/apresentar"); await expect(p.getByTestId("demo-root")).toBeVisible({ timeout: 40_000 }); await expect(p.getByTestId("demo-phone")).toHaveCount(0); await expect(p.getByTestId("demo-full")).toBeVisible();
      await expect(p.getByTestId("demo-banner")).toBeVisible(); await expect(p.getByTestId("demo-stage").getByTestId("jr-hero")).toBeVisible(); expect(await noOverflow(p), `${tag}: sem rolagem horizontal`).toBe(true);
      await shot(p, `demonstracao-${tag}`); await p.getByTestId("demo-controls-toggle").locator("summary").first().click(); await expect(p.getByTestId("demo-tour-start")).toBeVisible(); expect(await noOverflow(p)).toBe(true);
      expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); await loginAs(ctx, QA.fisio); const p = await ctx.newPage();
    await p.goto("/fisio/apresentar"); await expect(p.getByTestId("demo-root")).toBeVisible({ timeout: 40_000 });
    for (let i = 0; i < 30; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(() => document.activeElement?.getAttribute("data-testid") === "demo-tour-start")) break; }
    await p.keyboard.press("Enter"); await expect(p.getByTestId("demo-tour")).toContainText("passo 1 de 8"); await ctx.close();
  });

  test("portal com dados em tablet, celular e tema escuro: sem rolagem lateral, contraste suficiente e movimento reduzido respeitado", async ({ browser }) => {
    const contrast = (p: Page) => p.evaluate(() => {
      const lum = (c: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const parse = (s: string) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a] = m[1].split(/[ ,/]+/).map(Number); return { c: [r, g, b], a: a ?? 1 }; };
      const bgOf = (el: Element) => { let n: Element | null = el; let acc = [255, 255, 255]; const stack: { c: number[]; a: number }[] = []; while (n) { const p = parse(getComputedStyle(n).backgroundColor); if (p && p.a > 0) { stack.push(p); if (p.a >= 1) break; } n = n.parentElement; } for (const l of stack.reverse()) acc = acc.map((v, i) => v * (1 - l.a) + l.c[i] * l.a); return acc; };
      const out: Record<string, number> = {};
      for (const [k, sel] of Object.entries({ saudacao: ".jr-hello", titulo: ".jr-title", apoio: ".jr-card .jr-muted", botao: ".jr-btn", etapa: ".jr-stage-name" })) {
        const el = document.querySelector(sel); if (!el) continue; const fg = parse(getComputedStyle(el).color); const bg = bgOf(el); if (!fg) continue;
        const l1 = lum(fg.c) , l2 = lum(bg); out[k] = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
      } return out;
    });
    for (const [tag, vp, mobile, dark] of [["tablet", { width: 820, height: 1100 }, true, false], ["celular", { width: 390, height: 844 }, true, false], ["escuro", { width: 1440, height: 900 }, false, true], ["celular-escuro", { width: 390, height: 844 }, true, true]] as const) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, timezoneId: "America/Sao_Paulo", locale: "pt-BR", reducedMotion: "reduce" }); if (dark) await ctx.addInitScript(() => localStorage.setItem("hp-theme", "dark"));
      const p = await ctx.newPage(); const errors = collectErrors(p); await uiLogin(p, A.email, pass); await p.goto("/paciente"); await expect(p.getByTestId("jr-pain")).toBeVisible({ timeout: 40_000 }); await p.waitForLoadState("networkidle");
      expect(await noOverflow(p), `${tag}: sem rolagem lateral`).toBe(true);
      for (const [k, v] of Object.entries(await contrast(p))) expect(v, `${tag}: contraste de ${k}`).toBeGreaterThanOrEqual(4.5);
      expect(await p.evaluate(() => getComputedStyle(document.querySelector(".jr-btn")!).transitionDuration), `${tag}: movimento reduzido`).toMatch(/^0s/);
      if (dark) expect(await p.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
      await shot(p, `inicio-com-acompanhamento-${tag}`, true); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
    }
  });

  test("rotas e permissões: só o fisioterapeuta abre a demonstração; paciente e anônimo não", async ({ browser }) => {
    const mk = async (email: string | null) => { const ctx: BrowserContext = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); if (email) await loginAs(ctx, email); return ctx; };
    const pac = await mk(QA.paciente); const p1 = await pac.newPage(); await p1.goto("/fisio/apresentar"); await expect(p1.getByTestId("demo-root")).toHaveCount(0); await expect(p1.getByText("Sem permissão")).toBeVisible({ timeout: 20_000 }); await pac.close();
    const an = await mk(null); const p2 = await an.newPage(); await p2.goto("/fisio/apresentar"); await expect(p2).toHaveURL(/\/login/, { timeout: 30_000 }); await expect(p2.getByTestId("demo-root")).toHaveCount(0); await an.close();
  });
});
