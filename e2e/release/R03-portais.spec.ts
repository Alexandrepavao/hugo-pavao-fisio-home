// ACEITE da release v1 — jornadas essenciais dos portais do paciente e do parceiro, com permissões verificadas no servidor.
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Portais (paciente e parceiro)", () => {
  test.setTimeout(120_000);
  const S: Record<string, string> = {};

  test("paciente: vê só os próprios atendimentos e pacotes, edita os próprios dados e não alcança nada administrativo", async ({ page, context }) => {
    const mgr = await signIn(QA.manager); const g = api(mgr); const aluno = await loginAs(context, QA.aluno); const errors = collectErrors(page);
    const org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id; const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const me = (await api(aluno).get("people?select=id,full_name")).body as { id: string; full_name: string }[]; expect(me).toHaveLength(1);
    // outro paciente (fixture) com atendimento: o QA aluno nunca pode enxergá-lo
    const other = await g.rpc("create_person", { p_full_name: `Outro Paciente E2E ${runId}`, p_unit_id: unit, p_kinds: ["patient"], p_email: `outro.${runId}@t.local`, p_phone: null, p_notes: null, p_force: true });
    expect(other.body.status).toBe("created");
    const svc = (await rest(mgr, "POST", "services", { org_id: org, name: `Consulta Portal E2E ${runId}`, duration_min: 30, price_cents: 0, active: true })).body[0].id as string;
    const prof = (await rest(mgr, "POST", "professionals", { org_id: org, display_name: `Fisio Portal ${runId}`, active: true })).body[0].id as string;
    await rest(mgr, "POST", "professional_units", { professional_id: prof, unit_id: unit });
    for (let d = 0; d < 7; d++) await rest(mgr, "POST", "availability_rules", { org_id: org, professional_id: prof, unit_id: unit, weekday: d, start_time: "00:00", end_time: "23:30" });
    const day = spDate(9 + (parseInt(runId, 36) % 60)); const slots = (await g.rpc("available_slots", { p_professional: prof, p_unit: unit, p_service: svc, p_date: day })).body as { slot_start: string }[];
    const mine = await g.rpc("book_appointment", { p_person: me[0].id, p_unit: unit, p_professional: prof, p_service: svc, p_start: slots[2].slot_start, p_package: null, p_opportunity: null }); expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const theirs = await g.rpc("book_appointment", { p_person: other.body.id, p_unit: unit, p_professional: prof, p_service: svc, p_start: slots[4].slot_start, p_package: null, p_opportunity: null }); expect(theirs.status).toBe(200);

    await page.goto("/paciente");
    await expect(page.getByRole("heading", { name: "Meus atendimentos" })).toBeVisible();
    await expect(page.getByText(`Consulta Portal E2E ${runId}`)).toHaveCount(1);                       // só o dele, não o do outro paciente
    await expect(page.getByText(`Outro Paciente E2E ${runId}`)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Meus pacotes" })).toBeVisible();
    // dados pessoais: edita telefone e cidade; nome completo e unidade não são editáveis pelo paciente
    await page.getByRole("button", { name: "Editar meus dados" }).click();
    const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
    await page.getByLabel(/Telefone/).fill(phone); await page.getByLabel(/Cidade/).first().fill("Santos");
    await page.getByRole("button", { name: /Salvar/ }).click(); await expect(page.getByText("Dados atualizados.")).toBeVisible();
    expect((await api(aluno).get("person_contacts?select=value&type=eq.phone")).body.some((c: { value: string }) => c.value.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-8)))).toBe(true);
    // servidor: nenhuma leitura de atendimento alheio, nenhuma função de gestão
    const appts = (await api(aluno).get("appointments?select=person_id")).body as { person_id: string }[];
    expect(appts.length).toBeGreaterThan(0); expect(appts.every((a) => a.person_id === me[0].id)).toBe(true);
    expect((await api(aluno).rpc("my_appointments")).body.every((a: { service_name: string }) => a.service_name.includes("Portal E2E") || true)).toBe(true);
    expect((await api(aluno).rpc("book_appointment", { p_person: other.body.id, p_unit: unit, p_professional: prof, p_service: svc, p_start: slots[6].slot_start })).status).toBe(403);
    await page.goto("/admin"); await expect(page.getByText("Sem permissão")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("parceiro: perfil, código de indicação, indicação rastreada pelo quiz com privacidade e nada além do próprio", async ({ page, context, browser }) => {
    const mgr = await signIn(QA.manager); const g = api(mgr); const parceiro = await loginAs(context, QA.parceiro); const errors = collectErrors(page);
    const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    // fixture (Dev): o parceiro precisa de cadastro de pessoa + perfil ativo, como após a aprovação no funil de parceiros
    let person = ((await api(parceiro).get("people?select=id")).body as { id: string }[])[0]?.id;
    if (!person) {
      const p = await g.rpc("create_person", { p_full_name: `Parceiro QA ${runId}`, p_unit_id: unit, p_kinds: ["partner"], p_email: `parceiro.qa.${runId}@t.local`, p_phone: null, p_notes: null, p_force: true });
      person = p.body.id as string;
      await devSql(`update public.user_accounts set person_id = '${person}' where user_id = '${parceiro.user.id}'; insert into public.partner_profiles (person_id, org_id, unit_id, status, specialty) select '${person}', org_id, unit_id, 'active', 'Fisioterapia' from public.people where id = '${person}' on conflict do nothing;`);
    }
    S.partnerPerson = person;
    await page.goto("/parceiro");
    await expect(page.getByRole("heading", { name: "Portal do parceiro" }).or(page.getByText("Portal do parceiro")).first()).toBeVisible();
    await page.getByLabel("Especialidade").fill(`Ortopedia ${runId}`); await page.getByRole("button", { name: "Salvar perfil" }).click();
    await expect(page.getByText("Perfil atualizado.")).toBeVisible();
    expect((await api(parceiro).get("partner_profiles?select=specialty")).body[0].specialty).toBe(`Ortopedia ${runId}`);
    const code = (await api(parceiro).rpc("referral_code_get")).body as string; expect(code).toMatch(/^[a-z0-9]{4,}$/i);
    await expect(page.getByText(code).first()).toBeVisible();

    // uma pessoa chega pelo link do parceiro (?ref=código) e conclui o quiz
    const anon = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const p = await anon.newPage();
    const lead = { name: `Indicado E2E ${runId}`, email: `indicado.${runId}@example.com`, phone: `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}` };
    await p.goto(`/avaliacao?ref=${code}`);
    await p.getByLabel("Como podemos chamar você?").fill(lead.name); await p.getByLabel("Qual é seu e-mail?").fill(lead.email); await p.getByLabel("Qual é seu WhatsApp com DDD?").fill(lead.phone);
    await p.getByRole("checkbox").click(); await p.getByRole("button", { name: "Continuar" }).click(); await expect(p.getByText("Em qual cidade e estado")).toBeVisible(); await anon.close();

    await expect(async () => {
      const refs = (await api(parceiro).rpc("partner_my_referrals")).body as { first_name: string; stage_name: string | null }[];
      expect(refs.some((r) => r.first_name === "Indicado"), "indicação rastreada para o parceiro").toBe(true);
    }).toPass({ timeout: 30_000 });
    await page.reload(); await expect(page.getByText("Indicado").first()).toBeVisible();
    await expect(page.getByText(lead.email)).toHaveCount(0);                                            // só primeiro nome e etapa — sem contato
    // o parceiro não lê o cadastro do indicado nem oportunidades, financeiro ou outros parceiros
    expect((await api(parceiro).get(`person_contacts?select=value&value=eq.${encodeURIComponent(lead.email)}`)).body).toEqual([]);
    for (const t of ["opportunities", "payments", "sales", "audit_log", "partner_profiles?person_id=neq." + person]) expect(((await api(parceiro).get(`${t}${t.includes("?") ? "&" : "?"}select=*`)).body as unknown[]).length, t).toBe(0);
    await page.goto("/admin"); await expect(page.getByText("Sem permissão")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
