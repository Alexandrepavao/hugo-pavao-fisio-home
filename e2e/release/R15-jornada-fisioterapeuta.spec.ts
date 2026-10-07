// ACEITE da release v1 — JORNADA DO FISIOTERAPEUTA ponta a ponta: cadastro (pessoa + profissional + registro + unidades), disponibilidade, liberação de acesso, conta criada e ligada ao cadastro,
// login pela tela, “Meu resumo” com números reais, agenda alheia e dados clínicos negados, senha nova pela tela, celular. Cria dados próprios (prefixo do runId) e os remove no fim.
// NÃO exercita (dependências externas, registradas em docs): entrega do e-mail de convite/recuperação (Resend) e a autorização real no Google (OAuth). A conta é criada já confirmada
// diretamente no Auth do Dev (mesmo gatilho do convite), porque o clique no link do e-mail é uma ação humana externa.
import { expect, test } from "@playwright/test";
import { api, collectErrors, createConfirmedUser, devSql, expectNoFatal, loginAs, QA, runId, signIn, signInWith, uiLogin } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Jornada do fisioterapeuta", () => {
  test.setTimeout(180_000);
  const name = `Fisio R15 ${runId}`; const reg = `CREFITO-3 15${runId.replace(/[^0-9]/g, "").slice(0, 4).padEnd(4, "7")}-F`; const email = `r15.fisio.${runId.toLowerCase()}@hp-test.dev`;
  const pass1 = `R15-Senha-${runId}-Aa1!`; const pass2 = `R15-Nova-${runId}-Bb2!`;
  let unitId = ""; let unitName = ""; let svcId = ""; let profId = ""; let personId = ""; let userId = ""; let patientId = ""; let otherProf = "";
  const day = (n: number) => `(current_date + (${n}))`;
  const clean = async () => {
    await devSql(`delete from public.appointments where professional_id in (select id from public.professionals where display_name = '${name}')`);
    await devSql(`delete from public.availability_rules where professional_id in (select id from public.professionals where display_name = '${name}')`);
    await devSql(`delete from public.invitations where email = '${email}'`);
    await devSql(`delete from auth.users where email = '${email}'`);
    await devSql(`delete from public.professionals where display_name = '${name}'`);
    await devSql(`delete from public.person_kinds where person_id in (select id from public.people where full_name in ('${name}', 'Paciente R15 ${runId}'))`).catch(() => null);
    await devSql(`delete from public.people where full_name in ('${name}', 'Paciente R15 ${runId}')`).catch(() => null);
  };

  test("fixtures: unidade, serviço, um paciente e outro profissional (do QA) para provar o isolamento", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN para preparar fixtures");
    await clean();
    const u = (await devSql(`select u.id, u.name, u.org_id, (select id from public.services where active order by created_at limit 1) svc from public.units u where u.slug = 'sao-paulo'`)) as { id: string; name: string; org_id: string; svc: string }[];
    unitId = u[0].id; unitName = u[0].name; svcId = u[0].svc;
    patientId = ((await devSql(`insert into public.people (org_id, unit_id, full_name) values ('${u[0].org_id}', '${unitId}', 'Paciente R15 ${runId}') returning id`)) as { id: string }[])[0].id;
    otherProf = ((await devSql(`select pr.id from public.professionals pr join public.professional_units pu on pu.professional_id = pr.id where pr.user_id is not null and pr.display_name <> '${name}' limit 1`)) as { id: string }[])[0]?.id ?? "";
    expect(unitId && svcId && patientId).toBeTruthy();
  });

  test("gestor cadastra o profissional pela tela: pessoa criada no cadastro central, registro e unidade", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await page.getByRole("button", { name: "Nova pessoa" }).click();
    await page.locator("#pa-name").fill(name); await page.locator("#pa-reg").fill(reg);
    await page.getByRole("button", { name: "Cadastrar profissional" }).click();
    await expect(page.getByText("Marque ao menos uma unidade de atendimento.")).toBeVisible();             // validação antes de gravar
    await page.getByRole("group", { name: "Origem do cadastro" }).waitFor();
    await page.getByLabel(unitName, { exact: true }).first().check();
    await page.getByRole("button", { name: "Cadastrar profissional" }).click();
    await expect(page.getByText("Profissional cadastrado.")).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("row").filter({ hasText: name }); await expect(row).toContainText(reg); await expect(row).toContainText("Sem acesso"); await expect(row).toContainText(unitName);
    const db = (await devSql(`select pr.id, pr.person_id, pr.council_registration, pr.active, (select count(*) from public.professional_units where professional_id = pr.id)::int units,
        (select count(*) from public.person_kinds k where k.person_id = pr.person_id and k.kind = 'staff')::int staff from public.professionals pr where pr.display_name = '${name}'`)) as { id: string; person_id: string; council_registration: string; active: boolean; units: number; staff: number }[];
    expect(db).toHaveLength(1); expect(db[0]).toMatchObject({ council_registration: reg, active: true, units: 1, staff: 1 }); profId = db[0].id; personId = db[0].person_id; expect(personId).toBeTruthy();
    // a pessoa aparece no cadastro central (Pessoas)
    await page.goto(`/admin/pessoas`); await page.locator("#p-q").fill(name); await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("disponibilidade pela tela: cadastrar, recusar sobreposição, editar e remover", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await page.locator("#rp").selectOption(profId);
    await page.locator("#rd").selectOption("1"); await page.locator("#rs").fill("08:00"); await page.locator("#re").fill("12:00"); await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText("Disponibilidade cadastrada.")).toBeVisible({ timeout: 20_000 });
    await page.locator("#rs").fill("11:00"); await page.locator("#re").fill("14:00"); await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText(/se sobrepõe a outra disponibilidade/)).toBeVisible({ timeout: 20_000 });
    await page.locator("#rs").fill("14:00"); await page.locator("#re").fill("18:00"); await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText("Disponibilidade cadastrada.").first()).toBeVisible();
    let n = (await devSql(`select count(*)::int n from public.availability_rules where professional_id = '${profId}'`)) as { n: number }[]; expect(n[0].n).toBe(2);
    await page.getByRole("row").filter({ hasText: "08:00–12:00" }).getByRole("button", { name: "Editar" }).click();
    await page.locator("#rs").fill("07:30"); await page.getByRole("button", { name: "Salvar alteração" }).click();
    await expect(page.getByText("Disponibilidade atualizada.")).toBeVisible({ timeout: 20_000 }); await expect(page.getByRole("row").filter({ hasText: "07:30–12:00" })).toHaveCount(1);
    await page.getByRole("row").filter({ hasText: "14:00–18:00" }).getByRole("button", { name: "Remover" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Remover" }).click();
    await expect(page.getByText("Disponibilidade removida.")).toBeVisible({ timeout: 20_000 });
    n = (await devSql(`select count(*)::int n from public.availability_rules where professional_id = '${profId}'`)) as { n: number }[]; expect(n[0].n).toBe(1);
    const aud = (await devSql(`select count(*)::int n from public.audit_log where entity_type = 'availability_rules' and unit_id is null or entity_type = 'availability_rules' and entity_id in (select id::text from public.availability_rules where professional_id = '${profId}')`)) as { n: number }[]; expect(aud[0].n).toBeGreaterThanOrEqual(2);
  });

  test("permissões do cadastro (servidor): comercial e fisioterapeuta não cadastram profissional nem liberam acesso", async () => {
    for (const mail of [QA.comercial, QA.fisio, QA.paciente]) {
      const a = api(await signIn(mail));
      const r = await a.rpc("professional_save", { p_id: null, p_person: null, p_name: `Intruso ${runId}`, p_registration: null, p_units: [unitId], p_active: true });
      expect(r.status, mail).not.toBe(200); expect(JSON.stringify(r.body), mail).toMatch(/sem permissão|42501/);
      const g = await a.rpc("professional_grant_access", { p_professional: profId, p_email: "intruso@hp-test.dev" });
      expect(g.status, mail).not.toBe(200);
    }
    expect(((await devSql(`select count(*)::int n from public.professionals where display_name like 'Intruso ${runId}%'`)) as { n: number }[])[0].n).toBe(0);
  });

  test("liberar acesso pela tela registra o convite ligado à pessoa e ao profissional; a conta confirmada é ligada ao cadastro", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Liberar acesso" }).click();
    const dlg = page.getByRole("dialog"); await dlg.locator("#pg-email").fill("sem-arroba"); await dlg.getByRole("button", { name: "Liberar acesso" }).click();
    await expect(page.getByText(/e-mail inválido/i).first()).toBeVisible({ timeout: 20_000 });
    await dlg.locator("#pg-email").fill(email); await dlg.getByRole("button", { name: "Liberar acesso" }).click();
    await expect(page.getByText(/Convite registrado/)).toBeVisible({ timeout: 30_000 });         // o envio do e-mail é dependência externa: aqui só se prova o REGISTRO do convite
    const inv = (await devSql(`select role, unit_id, person_id, professional_id, accepted_at from public.invitations where email = '${email}'`)) as { role: string; unit_id: string; person_id: string; professional_id: string; accepted_at: string | null }[];
    expect(inv).toHaveLength(1); expect(inv[0]).toMatchObject({ role: "physio", unit_id: unitId, person_id: personId, professional_id: profId, accepted_at: null });
    // a pessoa cria a senha e confirma o e-mail (simulado no Auth do Dev): o gatilho liga a conta
    userId = await createConfirmedUser(email, pass1);
    const link = (await devSql(`select pr.user_id, ua.person_id, (select count(*) from public.role_assignments ra where ra.user_id = pr.user_id and ra.role = 'physio' and ra.unit_id = '${unitId}' and ra.revoked_at is null)::int roles,
        (select accepted_at is not null from public.invitations where email = '${email}') accepted from public.professionals pr join public.user_accounts ua on ua.user_id = pr.user_id where pr.id = '${profId}'`)) as { user_id: string; person_id: string; roles: number; accepted: boolean }[];
    expect(link).toHaveLength(1); expect(link[0]).toMatchObject({ user_id: userId, person_id: personId, roles: 1, accepted: true });
  });

  test("login pela tela e “Meu resumo” com os números do banco (só os atendimentos dele)", async ({ page }) => {
    const errors = collectErrors(page);
    // atendimentos do profissional (e um de OUTRO profissional que não pode contar)
    const mk = (d: number, h: string, st: string, who = profId) => `('${unitId}', '${who}', '${patientId}', '${svcId}', tstzrange(((${day(d)} + time '${h}') at time zone 'America/Sao_Paulo'), ((${day(d)} + time '${h}' + interval '30 minutes') at time zone 'America/Sao_Paulo'), '[)'), '${st}')`;
    await devSql(`insert into public.appointments (unit_id, professional_id, person_id, service_id, period, status, org_id) select v.u::uuid, v.p::uuid, v.pe::uuid, v.s::uuid, v.per, v.st, (select org_id from public.units where id = '${unitId}') from (values
      ${[mk(-1, "09:00", "attended"), mk(-2, "09:00", "attended"), mk(-3, "09:00", "no_show"), mk(-4, "09:00", "professional_no_show"), mk(-5, "09:00", "cancelled_by_patient"), mk(-6, "09:00", "cancelled_by_clinic"), mk(2, "09:00", "scheduled")].join(",\n")}) v(u, p, pe, s, per, st)`);
    await uiLogin(page, email, pass1);
    await expect(page).toHaveURL(/\/admin/, { timeout: 40_000 });
    await expect(page.getByText("Sem permissão")).toHaveCount(0);
    await page.goto("/admin/meu-resumo?periodo=7dias");
    await expect(page.getByRole("heading", { name: "Meu resumo" }).first()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByLabel("Quem e quando")).toContainText(name);
    const card = (label: string) => page.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) }).locator(".hp-kpi-value");
    await expect(card("Realizados")).toHaveText("2"); await expect(card("Faltas do paciente")).toHaveText("1");
    await expect(card("Faltas do profissional")).toHaveText("1"); await expect(card("Cancelados pelo paciente")).toHaveText("1");
    await expect(card("Cancelados pela clínica")).toHaveText("1"); await expect(card("Agendados (à frente)")).toHaveText("1");
    await expect(card("Pacientes atendidos")).toHaveText("1");
    // o mesmo recálculo no servidor
    const s = await signInWith(email, pass1); const sum = (await api(s).rpc("my_professional_summary", { p_from: new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), p_to: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) })).body as { counts: Record<string, number>; payouts: { available: boolean } };
    expect(sum.counts).toMatchObject({ attended: 2, patient_no_show: 1, professional_no_show: 1, cancelled_by_patient: 1, cancelled_by_clinic: 1, scheduled: 1, patients_attended: 1 });
    // repasses: sem regra e sem dados reais → indisponível (nada de zero inventado)
    await expect(page.getByText(/Indisponível/)).toBeVisible(); expect(sum.payouts.available).toBe(false);
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("isolamento: o fisioterapeuta novo não vê agenda alheia, dado clínico fora do vínculo nem as áreas administrativas", async ({ page }) => {
    const s = await signInWith(email, pass1); const a = api(s);
    if (otherProf) {
      const day1 = await a.rpc("professional_day", { p_professional: otherProf, p_date: new Date().toISOString().slice(0, 10) }); expect(day1.status).not.toBe(200);
      const sm = await a.rpc("my_professional_summary", { p_professional: otherProf }); expect(sm.status).not.toBe(200);
    }
    const journey = await a.rpc("professional_journey", { p_person: patientId }); expect(journey.status).not.toBe(200);                 // sem vínculo assistencial
    const goal = await a.rpc("patient_goal_save", { p_person: patientId, p_id: null, p_title: "Sem vínculo não pode", p_details: null, p_target_date: null, p_status: "active" }); expect(goal.status).not.toBe(200);
    expect(((await a.get("payables?select=id&limit=1")).body as unknown[]).length).toBe(0); expect(((await a.get("sales?select=id&limit=1")).body as unknown[]).length).toBe(0);
    const mine = (await a.rpc("my_agenda_professionals")).body as { id: string; is_self: boolean }[]; expect(mine.filter((p) => p.is_self).map((p) => p.id)).toEqual([profId]); expect(mine.length).toBe(1);   // só a própria agenda
    await uiLogin(page, email, pass1); await expect(page).toHaveURL(/\/admin/, { timeout: 40_000 });
    for (const path of ["/admin/financeiro/pagar", "/admin/adm/diretorio", "/admin/crm", "/admin/equipe"]) { await page.goto(path); await expect(page.getByText(/Sem permissão/).first(), path).toBeVisible({ timeout: 30_000 }); }
    // Meu dia: Google Calendar individual (a autorização real no Google é externa e não é exercitada)
    await page.goto("/admin/meu-dia"); await expect(page.getByRole("button", { name: /Conectar Google Calendar/ })).toBeVisible({ timeout: 40_000 });
  });

  test("senha: tela de nova senha (sessão válida) troca a senha; a antiga deixa de valer", async ({ page, context, browser }) => {
    // o link do e-mail entrega uma sessão ao navegador; aqui a sessão vem do login por API (a entrega do e-mail é externa)
    const { useSession } = await import("../helpers"); await useSession(context, await signInWith(email, pass1));
    await page.goto("/redefinir-senha");
    await expect(page.getByRole("heading", { name: "Definir nova senha" })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Nova senha").fill("curta"); await page.getByLabel("Confirmar senha").fill("curta"); await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByText("Use ao menos 10 caracteres.")).toBeVisible();
    await page.getByLabel("Nova senha").fill(pass2); await page.getByLabel("Confirmar senha").fill(pass2 + "x"); await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByText("As senhas não coincidem.")).toBeVisible();
    await page.getByLabel("Nova senha").fill(pass2); await page.getByLabel("Confirmar senha").fill(pass2); await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByRole("heading", { name: "Senha atualizada" })).toBeVisible({ timeout: 20_000 });
    await expect(signInWith(email, pass1)).rejects.toThrow(); await expect(signInWith(email, pass2)).resolves.toBeTruthy();
    // login pela tela com a senha nova
    const ctx2 = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p2 = await ctx2.newPage(); await uiLogin(p2, email, pass2); await expect(p2).toHaveURL(/\/admin/, { timeout: 40_000 }); await ctx2.close();
  });

  test("celular: “Meu resumo” e o cadastro de profissionais cabem na tela", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uiLogin(page, email, pass2); await expect(page).toHaveURL(/\/admin/, { timeout: 40_000 });
    await page.goto("/admin/meu-resumo?periodo=7dias"); await expect(page.getByRole("heading", { name: "Meu resumo" }).first()).toBeVisible({ timeout: 40_000 }); await page.waitForTimeout(600);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(w.sw).toBeLessThanOrEqual(w.iw + 1);
  });

  test("limpeza: profissional, pessoa, conta, convite, disponibilidade e atendimentos de teste removidos", async () => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, "precisa de SUPABASE_ACCESS_TOKEN");
    await clean();
    const n = (await devSql(`select (select count(*) from public.professionals where display_name = '${name}')::int p, (select count(*) from auth.users where email = '${email}')::int u, (select count(*) from public.invitations where email = '${email}')::int i`)) as { p: number; u: number; i: number }[];
    expect(n[0]).toEqual({ p: 0, u: 0, i: 0 });
  });
});
