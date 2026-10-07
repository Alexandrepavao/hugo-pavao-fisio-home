// ACEITE da release v1 — JORNADA DO PACIENTE ponta a ponta: acesso ligado ao paciente CERTO (convite ou conta já existente), portal (próximos atendimentos, confirmação e cancelamento pela política),
// sessões contratadas/realizadas/consumidas/devolvidas e saldo SEPARADAS, plano definido pelo profissional (nunca “10 para todos”), renovação só com orientação do fisioterapeuta, vídeo privado,
// isolamento entre pacientes e celular. Dados próprios (runId), removidos no fim.
// NÃO exercita (dependências externas): entrega do e-mail de convite/recuperação (Resend), clique no link do e-mail e reprodução real do vídeo no Bunny (segredo não cadastrado no Dev).
import { expect, test } from "@playwright/test";
import { api, collectErrors, createConfirmedUser, devSql, expectNoFatal, loginAs, QA, runId, signIn, signInWith, uiLogin } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Jornada do paciente", () => {
  test.setTimeout(180_000);
  const nameA = `Paciente R16 A ${runId}`; const nameB = `Paciente R16 B ${runId}`; const svcName = `Serviço R16 ${runId}`; const prodName = `Pacote R16 ${runId}`;
  const emailA = `r16.a.${runId.toLowerCase()}@hp-test.dev`; const emailB = `r16.b.${runId.toLowerCase()}@hp-test.dev`; const pass = `R16-Senha-${runId}-Aa1!`;
  let unitId = ""; let orgId = ""; let svcId = ""; let prodId = ""; let pkgId = ""; let pA = ""; let pB = ""; let profId = ""; let fisioUser = ""; let mgrUser = ""; let uA = ""; let uB = ""; let apptFuture1 = ""; let apptFuture2 = "";
  const off = 40 + (parseInt(runId, 36) % 200);                        // dias à frente, únicos por execução (o profissional QA é compartilhado)
  const myAppts = (page: import("@playwright/test").Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Meus atendimentos" }) });
  const hh = 1 + (parseInt(runId, 36) % 17); const hr = (k: number) => `${String(hh + k).padStart(2, "0")}:00`;   // horário do dia único por execução (o profissional QA é compartilhado)
  const ts = (d: number, h: string) => `((current_date + (${d})) + time '${h}') at time zone 'America/Sao_Paulo'`;
  const clean = async () => {
    const people = `select id from public.people where full_name in ('${nameA}', '${nameB}')`;
    await devSql(`delete from public.crm_tasks where person_id in (${people})`).catch(() => null);
    await devSql(`delete from public.renewal_requests where person_id in (${people})`).catch(() => null);
    await devSql(`delete from public.appointments where person_id in (${people})`);
    await devSql(`delete from public.client_packages where person_id in (${people})`);
    await devSql(`delete from public.care_relationships where person_id in (${people})`);
    await devSql(`delete from public.invitations where email in ('${emailA}', '${emailB}')`);
    await devSql(`delete from auth.users where email in ('${emailA}', '${emailB}')`);
    await devSql(`delete from public.products where name = '${prodName}'`);
    await devSql(`delete from public.services where name = '${svcName}'`);
    await devSql(`delete from public.person_kinds where person_id in (${people})`).catch(() => null);
    await devSql(`delete from public.people where full_name in ('${nameA}', '${nameB}')`).catch(() => null);
  };

  test("fixtures: dois pacientes (cada um com e-mail), pacote de 8 sessões com histórico, vínculo clínico do fisioterapeuta QA", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    await clean();
    const mgr = await signIn(QA.manager); const fis = await signIn(QA.fisio); mgrUser = mgr.user.id; fisioUser = fis.user.id;
    const u = (await devSql(`select id, org_id from public.units where slug = 'sao-paulo'`)) as { id: string; org_id: string }[]; unitId = u[0].id; orgId = u[0].org_id;
    profId = ((await devSql(`select id from public.professionals where user_id = '${fisioUser}'`)) as { id: string }[])[0]?.id ?? "";
    expect(profId, "o fisioterapeuta QA precisa ter cadastro profissional (criado pelo R04)").toBeTruthy();
    svcId = ((await devSql(`insert into public.services (org_id, name, duration_min) values ('${orgId}', '${svcName}', 30) returning id`)) as { id: string }[])[0].id;
    prodId = ((await devSql(`insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id) values ('${orgId}', 'package', '${prodName}', 0, 8, '${svcId}') returning id`)) as { id: string }[])[0].id;
    const mk = async (n: string, mail: string) => { const id = ((await devSql(`insert into public.people (org_id, unit_id, full_name) values ('${orgId}', '${unitId}', '${n}') returning id`)) as { id: string }[])[0].id;
      await devSql(`insert into public.person_kinds (person_id, kind) values ('${id}', 'patient')`); await devSql(`insert into public.person_contacts (org_id, person_id, type, value, is_primary) values ('${orgId}', '${id}', 'email', '${mail}', true)`); return id; };
    pA = await mk(nameA, emailA); pB = await mk(nameB, emailB);
    pkgId = ((await devSql(`insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values ('${orgId}', '${unitId}', '${pA}', '${prodId}', 8) returning id`)) as { id: string }[])[0].id;
    await devSql(`insert into public.session_ledger (org_id, client_package_id, delta, reason, note) values ('${orgId}', '${pkgId}', 8, 'grant', 'compra R16')`);
    const ins = async (d: number, h: string, st: string, pkg = true) => ((await devSql(`insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, client_package_id, period, status)
        values ('${orgId}', '${unitId}', '${profId}', '${pA}', '${svcId}', ${pkg ? `'${pkgId}'` : "null"}, tstzrange(${ts(d, h)}, ${ts(d, h)} + interval '30 minutes', '[)'), '${st}') returning id`)) as { id: string }[])[0].id;
    for (const [d, h, st] of [[-3, hr(0), "attended"], [-4, hr(0), "no_show"], [-5, hr(0), "cancelled_by_patient"]] as const) {
      const id = await ins(d, h, st); await devSql(`insert into public.session_ledger (org_id, client_package_id, appointment_id, delta, reason) values ('${orgId}', '${pkgId}', '${id}', -1, 'consume')`);
    }
    apptFuture1 = await ins(off, hr(0), "scheduled"); apptFuture2 = await ins(off + 1, hr(0), "scheduled");
    await devSql(`insert into public.care_relationships (org_id, unit_id, professional_user_id, person_id, granted_by) values ('${orgId}', '${unitId}', '${fisioUser}', '${pA}', '${mgrUser}')`);
  });

  test("gestor libera o portal pela tela: sem conta → convite ligado ao paciente; com conta já existente → vínculo imediato; o paciente certo recebe a conta certa", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    const invite = async (n: string) => { await page.goto("/admin/pessoas"); await page.locator("#p-q").fill(n); const row = page.getByRole("row").filter({ hasText: n }); await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole("button", { name: `Ações de ${n}` }).click(); await page.getByRole("menuitem", { name: "Convidar ao portal" }).click(); };
    await invite(nameA);
    await expect(page.getByText(new RegExp(`Convite ao portal registrado para ${emailA.replace(/[.+]/g, "\\$&")}`))).toBeVisible({ timeout: 20_000 });
    const inv = (await devSql(`select role, person_id, accepted_at from public.invitations where email = '${emailA}'`)) as { role: string; person_id: string; accepted_at: string | null }[];
    expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ role: "member", person_id: pA, accepted_at: null });
    uA = await createConfirmedUser(emailA, pass);                                                    // “Primeiro acesso” + e-mail confirmado (o clique no link é externo)
    const la = (await devSql(`select ua.person_id, (select count(*) from public.role_assignments r where r.user_id = ua.user_id and r.role = 'member' and r.revoked_at is null)::int roles from public.user_accounts ua where ua.user_id = '${uA}'`)) as { person_id: string; roles: number }[];
    expect(la[0]).toMatchObject({ person_id: pA, roles: 1 });
    // B: a conta JÁ existe (confirmada, sem papel nem vínculo) antes de qualquer convite
    uB = await createConfirmedUser(emailB, pass);
    expect(((await devSql(`select count(*)::int n from public.user_accounts where user_id = '${uB}'`)) as { n: number }[])[0].n).toBe(0);
    await invite(nameB);
    await expect(page.getByText(/já tinha conta: o portal foi ligado a este cadastro agora/)).toBeVisible({ timeout: 20_000 });
    const lb = (await devSql(`select ua.person_id from public.user_accounts ua where ua.user_id = '${uB}'`)) as { person_id: string }[]; expect(lb[0].person_id).toBe(pB);
    expect(((await devSql(`select count(*)::int n from public.invitations where email = '${emailB}'`)) as { n: number }[])[0].n).toBe(0);      // nenhum convite “fantasma”
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("login pela tela cai no portal; próximos atendimentos, histórico e sessões SEPARADAS (contratadas, realizadas, falta, cancelamento tardio, devolvidas, saldo)", async ({ page }) => {
    const errors = collectErrors(page);
    await uiLogin(page, emailA, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 }); await expect(page.getByText("Sem permissão")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Meus atendimentos" })).toBeVisible({ timeout: 30_000 });
    await expect(myAppts(page).getByRole("listitem").filter({ hasText: svcName })).toHaveCount(5);                      // 3 passados + 2 futuros: só os dele
    const pk = page.getByRole("listitem", { name: `Pacote ${prodName}` });
    for (const [label, v] of [["Contratadas", 8], ["Realizadas", 1], ["Consumidas por falta", 1], ["Consumidas por cancelamento tardio", 1], ["Devolvidas", 0], ["Saldo", 5]] as const) await expect(pk.getByLabel(`${label}: ${v}`)).toBeVisible();
    await expect(pk).toContainText("5 de 8 sessões");
    // o servidor diz o mesmo
    const b = (await api(await signInWith(emailA, pass)).rpc("my_package_breakdown")).body as { contracted: number; attended: number; no_show: number; late_cancel: number; refunded: number; balance: number }[];
    expect(b[0]).toMatchObject({ contracted: 8, attended: 1, no_show: 1, late_cancel: 1, refunded: 0, balance: 5 });
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("confirmação e cancelamento pela política: confirma a própria presença; cancelar com antecedência não desconta sessão", async ({ page }) => {
    await uiLogin(page, emailA, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    const rows = myAppts(page).getByRole("listitem").filter({ hasText: svcName }).filter({ has: page.getByRole("button", { name: "Cancelar atendimento" }) });
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    await rows.last().getByRole("button", { name: "Confirmar minha presença" }).click();     // a lista é do mais recente para o mais antigo: o último é o atendimento mais próximo await expect(page.getByText("Presença confirmada. Obrigado!")).toBeVisible({ timeout: 20_000 });
    expect(((await devSql(`select patient_confirmed_at is not null as c, status from public.appointments where id = '${apptFuture1}'`)) as { c: boolean; status: string }[])[0]).toMatchObject({ c: true, status: "scheduled" });   // confirmar ≠ presença ≠ consumo
    const second = myAppts(page).getByRole("listitem").filter({ hasText: svcName }).filter({ has: page.getByRole("button", { name: "Cancelar atendimento" }) }).first();
    await second.getByRole("button", { name: "Cancelar atendimento" }).click();
    await expect(page.getByRole("dialog")).toContainText(/nenhuma sessão será descontada/i); await page.getByRole("dialog").getByRole("button", { name: "Cancelar atendimento" }).click();
    await expect(page.getByText(/Atendimento cancelado\. Nenhuma sessão foi descontada\./)).toBeVisible({ timeout: 20_000 });
    expect(((await devSql(`select status from public.appointments where id = '${apptFuture2}'`)) as { status: string }[])[0].status).toBe("cancelled_by_patient");
    const bal = (await devSql(`select sum(delta)::int s from public.session_ledger where client_package_id = '${pkgId}'`)) as { s: number }[]; expect(bal[0].s).toBe(5);       // saldo intacto
    await expect(page.getByRole("listitem", { name: `Pacote ${prodName}` }).getByLabel("Saldo: 5")).toBeVisible();
  });

  test("plano de sessões: só o profissional vinculado define; sem número padrão; o paciente vê o que o profissional registrou", async ({ page }) => {
    const f = api(await signIn(QA.fisio)); const aClient = api(await signInWith(emailA, pass));
    await uiLogin(page, emailA, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    await expect(page.getByText(/ainda não definiu o plano de sessões/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/não existe um número padrão/)).toBeVisible();
    const noQty = await f.rpc("patient_plan_save", { p_person: pA, p_planned_sessions: null, p_client_package: null, p_notes: null }); expect(noQty.status).not.toBe(200); expect(JSON.stringify(noQty.body)).toMatch(/não há quantidade padrão/);
    const byPatient = await aClient.rpc("patient_plan_save", { p_person: pA, p_planned_sessions: 99, p_client_package: null, p_notes: null }); expect(byPatient.status).not.toBe(200);       // paciente não define o próprio plano
    const other = await api(await signIn(QA.comercial)).rpc("patient_plan_save", { p_person: pA, p_planned_sessions: 5, p_client_package: null, p_notes: null }); expect(other.status).not.toBe(200);   // nem quem não tem vínculo clínico
    const ok = await f.rpc("patient_plan_save", { p_person: pA, p_planned_sessions: 6, p_client_package: null, p_notes: `plano R16 ${runId}` }); expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await page.reload(); await expect(page.getByText(/Plano de 6 sessão\(ões\)/)).toBeVisible({ timeout: 30_000 }); await expect(page.getByText(/Plano de 10/)).toHaveCount(0);
    const plan = page.getByRole("region", { name: "Minha jornada" }).getByRole("progressbar", { name: "Sessões realizadas do plano" }); await expect(plan).toHaveAttribute("aria-valuemax", "6");
  });

  test("renovação só com a orientação do fisioterapeuta; o pedido avisa a equipe sem cobrar nem descontar sessão", async ({ page }) => {
    const f = api(await signIn(QA.fisio)); const aClient = api(await signInWith(emailA, pass));
    await uiLogin(page, emailA, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    await expect(page.getByRole("button", { name: "Quero renovar meu acompanhamento" })).toHaveCount(0); await expect(page.getByRole("button", { name: "Quero falar com a equipe" })).toBeVisible({ timeout: 30_000 });
    const early = await aClient.rpc("my_renewal_request", { p_kind: "renovacao", p_message: null }); expect(early.status).not.toBe(200); expect(JSON.stringify(early.body)).toMatch(/orientação do seu fisioterapeuta/);
    const re = await f.rpc("patient_reassess", { p_person: pA, p_decision: "continuidade", p_extra_sessions: 4, p_patient_message: "Vamos continuar com foco em força", p_clinical_note: "nota clínica restrita R16" }); expect(re.status, JSON.stringify(re.body)).toBe(200);
    await page.reload(); await expect(page.getByText(/Seu fisioterapeuta indicou a continuidade do acompanhamento/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/nota clínica restrita R16/)).toHaveCount(0);                              // nota clínica nunca chega ao paciente
    await page.getByRole("button", { name: "Quero renovar meu acompanhamento" }).click(); await expect(page.getByText(/Pedido enviado/)).toBeVisible({ timeout: 20_000 });
    const rq = (await devSql(`select kind, status from public.renewal_requests where person_id = '${pA}'`)) as { kind: string; status: string }[]; expect(rq).toEqual([{ kind: "renovacao", status: "open" }]);
    expect(((await devSql(`select count(*)::int n from public.crm_tasks where person_id = '${pA}'`)) as { n: number }[])[0].n).toBe(1);                     // tarefa para a equipe
    expect(((await devSql(`select (select count(*) from public.sales where person_id = '${pA}')::int s, (select sum(delta)::int from public.session_ledger where client_package_id = '${pkgId}') l`)) as { s: number; l: number }[])[0]).toEqual({ s: 0, l: 5 });   // sem cobrança, sem consumo
  });

  test("vídeo privado: só aparece para o paciente atribuído; reprodução depende do backend (Bunny não configurado → mensagem honesta)", async ({ page }) => {
    const f = api(await signIn(QA.fisio));
    const as = await f.rpc("patient_video_assign", { p_person: pA, p_title: `Vídeo R16 ${runId}`, p_description: "exercício", p_library_id: "123456", p_video_id: "0a1b2c3d-1111-2222-3333-444455556666", p_expires_at: null }); expect(as.status, JSON.stringify(as.body)).toBe(200);
    await uiLogin(page, emailA, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    const v = page.getByRole("listitem").filter({ hasText: `Vídeo R16 ${runId}` }); await expect(v).toBeVisible({ timeout: 30_000 });
    expect(await page.content()).not.toContain("0a1b2c3d-1111-2222-3333-444455556666");                      // o identificador do Bunny não vai para o navegador
    await v.getByRole("button", { name: "Assistir" }).click();
    await expect(v.getByText(/Reprodução indisponível por configuração/).or(v.locator("iframe"))).toBeVisible({ timeout: 30_000 });
    const b = api(await signInWith(emailB, pass)); const j = (await b.rpc("my_journey")).body as { videos: unknown[] }; expect(j.videos).toHaveLength(0);
  });

  test("isolamento: o outro paciente não vê atendimentos, pacote, jornada, mensagens nem vídeos do primeiro, e não age sobre eles", async ({ page }) => {
    const b = api(await signInWith(emailB, pass));
    expect(((await b.rpc("my_appointments")).body as unknown[]).length).toBe(0); expect((await b.rpc("my_package_breakdown")).body).toEqual([]);
    expect(((await b.get("client_packages?select=id")).body as unknown[]).length).toBe(0); expect(((await b.get("appointments?select=id")).body as unknown[]).length).toBe(0);
    expect(((await b.get("session_ledger?select=id")).body as unknown[]).length).toBe(0); expect(((await b.get("people?select=id,full_name")).body as { full_name: string }[]).map((p) => p.full_name)).toEqual([nameB]);
    for (const t of ["patient_plans", "patient_goals", "patient_assessments", "patient_reassessments", "renewal_requests", "care_messages", "patient_videos"]) expect(((await b.get(`${t}?select=id`)).body as unknown[]).length, t).toBe(0);
    expect((await b.rpc("my_appointment_cancel", { p_id: apptFuture1, p_reason: null })).status).not.toBe(200); expect((await b.rpc("my_appointment_confirm", { p_id: apptFuture1 })).status).not.toBe(200);
    expect((await b.rpc("professional_journey", { p_person: pA })).status).not.toBe(200); expect((await b.rpc("patient_goal_save", { p_person: pA, p_id: null, p_title: "Intruso", p_details: null, p_target_date: null, p_status: "active" })).status).not.toBe(200);
    expect((await b.rpc("video_playback_authorize", { p_video: "00000000-0000-0000-0000-000000000000" })).status).not.toBe(200);
    await uiLogin(page, emailB, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    await expect(page.getByText("Nenhum pacote.")).toBeVisible({ timeout: 30_000 }); await expect(page.getByText(nameA)).toHaveCount(0); await expect(page.getByText(svcName)).toHaveCount(0);
    for (const path of ["/admin", "/admin/financeiro", "/admin/agenda"]) { await page.goto(path); await expect(page.getByText(/Sem permissão/).first(), path).toBeVisible({ timeout: 30_000 }); }
  });

  test("celular: o portal do paciente cabe na tela (sessões, plano, vídeo)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, emailA, pass); await expect(page).toHaveURL(/\/paciente$/, { timeout: 40_000 });
    await expect(page.getByRole("listitem", { name: `Pacote ${prodName}` })).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(600);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw, `rolagem lateral (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
  });

  test("limpeza: pacientes, pacote, atendimentos, contas, convites e vínculos de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    const n = (await devSql(`select (select count(*) from public.people where full_name in ('${nameA}', '${nameB}'))::int p, (select count(*) from auth.users where email in ('${emailA}', '${emailB}'))::int u, (select count(*) from public.client_packages where id = '${pkgId}')::int k`)) as { p: number; u: number; k: number }[];
    expect(n[0]).toEqual({ p: 0, u: 0, k: 0 });
  });
});
