// ACEITE da release v1 — confirmação antecipada independente (paciente e fisioterapeuta, nos respectivos portais), presença efetiva e consumo de sessão.
// Três coisas separadas: confirmar (antes) ≠ comparecer/faltar (depois do horário) ≠ consumir sessão (política do pacote).
// Exige SUPABASE_ACCESS_TOKEN (Dev): cria o pacote de teste e desloca horários ao passado (o sistema não deixa marcar falta antes do horário).
import { expect, test } from "@playwright/test";
import { api, collectErrors, devSql, loginAs, moveAppointment, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

test.describe.serial("@release Confirmação, presença e consumo de sessão", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {};
  const svcName = (k: string) => `R04 ${k} ${runId}`;
  const bal = async () => Number(((await devSql(`select coalesce(sum(delta),0)::int as b from public.session_ledger where client_package_id = '${S.pkg}'`)) as { b: number }[])[0].b);
  const appt = async (id: string) => ((await api(await signIn(QA.manager)).get(`appointments?select=status,patient_confirmed_at,patient_confirmed_via,professional_confirmed_at&id=eq.${id}`)).body as Record<string, string | null>[])[0];

  test("preparo + paciente confirma a própria presença no portal (sem mudar status nem consumir sessão)", async ({ page, context }) => {
    const mgr = await signIn(QA.manager); const g = api(mgr); const pac = await loginAs(context, QA.paciente); const fis = await signIn(QA.fisio); const errors = collectErrors(page);
    const org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id as string; const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    const me = (await api(pac).get("people?select=id,full_name")).body as { id: string; full_name: string }[]; expect(me).toHaveLength(1); S.person = me[0].id;
    // higiene: o paciente QA é compartilhado e o portal mostra só os 100 atendimentos mais recentes (my_appointments, limit 100); atendimentos de execuções ANTERIORES dos testes R0x
    // (serviço “R0x …”, de outro runId) são removidos para que o de hoje não seja empurrado para fora da lista. Só dados de teste do Dev; o livro de sessões (append-only) não é tocado.
    if (process.env.SUPABASE_ACCESS_TOKEN) await devSql(`delete from public.appointments a using public.services s where s.id = a.service_id and a.person_id = '${S.person}' and s.name ~ '^R0[0-9] ' and s.name not like '% ${runId}'`);

    // profissional = o cadastro profissional da conta QA de fisioterapeuta (cria e vincula se ainda não existir)
    let prof = ((await g.get(`professionals?select=id&user_id=eq.${fis.user.id}`)).body as { id: string }[])[0]?.id;
    if (!prof) {
      prof = (await rest(mgr, "POST", "professionals", { org_id: org, display_name: `Fisio QA R04`, active: true, user_id: fis.user.id })).body[0].id as string;
      await rest(mgr, "POST", "professional_units", { professional_id: prof, unit_id: unit });
    }
    S.prof = prof;
    if (((await g.get(`availability_rules?select=id&professional_id=eq.${prof}&unit_id=eq.${unit}&limit=1`)).body as unknown[]).length === 0)
      for (let d = 0; d < 7; d++) await rest(mgr, "POST", "availability_rules", { org_id: org, professional_id: prof, unit_id: unit, weekday: d, start_time: "00:00", end_time: "23:30" });
    const svc: Record<string, string> = {};
    for (const k of ["A", "B", "C"]) svc[k] = (await rest(mgr, "POST", "services", { org_id: org, name: svcName(k), duration_min: 30, price_cents: 0, active: true })).body[0].id as string;
    const product = (await rest(mgr, "POST", "products", { org_id: org, kind: "package", name: `Pacote R04 ${runId}`, price_cents: 0, sessions_count: 4, validity_days: 90, consume_on_no_show: true, late_cancel_hours: 24, service_id: svc.B, active: true, access_rule: "on_first_payment" })).body[0].id as string;
    S.pkg = ((await devSql(`insert into public.client_packages (org_id, unit_id, person_id, product_id, total_sessions) values ('${org}','${unit}','${S.person}','${product}',4) returning id`)) as { id: string }[])[0].id;
    await devSql(`insert into public.session_ledger (org_id, client_package_id, delta, reason) values ('${org}','${S.pkg}',4,'grant')`);

    const day = spDate(9 + (parseInt(runId, 36) % 60)); S.day = day; S.unit = unit;
    const slots = (await g.rpc("available_slots", { p_professional: prof, p_unit: unit, p_service: svc.A, p_date: day })).body as { slot_start: string }[];
    const book = async (k: string, i: number, pkg: string | null) => { const r = await g.rpc("book_appointment", { p_person: S.person, p_unit: unit, p_professional: prof, p_service: svc[k], p_start: slots[i].slot_start, p_package: pkg, p_opportunity: null }); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body as string; };
    S.A = await book("A", 4, null); S.B = await book("B", 8, S.pkg); S.C = await book("C", 12, S.pkg); S.slotA = slots[4].slot_start;
    expect(await bal()).toBe(4);

    // portal do paciente: confirma pela interface
    await page.goto("/paciente");
    const rowA = page.getByRole("listitem").filter({ hasText: svcName("A") });
    await expect(rowA).toHaveCount(1); await expect(rowA.getByText("Aguardando confirmação do profissional.")).toBeVisible();
    await rowA.getByRole("button", { name: "Confirmar minha presença" }).click();
    await expect(page.getByText("Presença confirmada. Obrigado!")).toBeVisible();
    await expect(rowA.getByText(/Você confirmou presença em/)).toBeVisible(); await expect(rowA.getByRole("button", { name: "Confirmar minha presença" })).toHaveCount(0);
    // servidor: só a confirmação do paciente, status intacto, nenhuma sessão consumida
    const a = await appt(S.A); expect(a).toMatchObject({ status: "scheduled", patient_confirmed_via: "portal", professional_confirmed_at: null }); expect(a.patient_confirmed_at).toBeTruthy();
    expect(await bal(), "confirmar não consome sessão").toBe(4);
    // permissões no servidor (chamada direta à API)
    expect((await api(pac).rpc("professional_appointment_confirm", { p_id: S.A })).status, "paciente não confirma pelo profissional").toBe(403);
    expect((await api(pac).rpc("appointment_confirm_for_patient", { p_id: S.B })).status, "paciente não usa a via da recepção").toBe(403);
    expect((await api(fis).rpc("my_appointment_confirm", { p_id: S.B })).status, "fisioterapeuta não confirma como paciente").toBe(403);
    expect((await api(fis).rpc("appointment_confirm_for_patient", { p_id: S.B })).status, "fisioterapeuta não registra confirmação do paciente").toBe(403);
    expect((await api(mgr).rpc("professional_appointment_confirm", { p_id: S.A })).status, "gestor não confirma em nome do profissional").toBe(403);
    expect((await api(pac).rpc("set_appointment_status", { p_id: S.A, p_status: "professional_no_show", p_reason: null })).status, "paciente não muda presença").toBe(403);
    expect(errors).toEqual([]);
  });

  test("fisioterapeuta confirma o próprio atendimento em 'Meu dia'; a confirmação do paciente é independente", async ({ page, context }) => {
    const fis = await loginAs(context, QA.fisio); const errors = collectErrors(page);
    await page.goto("/admin/meu-dia"); await page.locator("#pd-date").fill(S.day);
    const row = page.getByRole("listitem").filter({ hasText: svcName("A") });
    await expect(row).toHaveCount(1); await expect(row.getByText("Paciente: confirmou")).toBeVisible();
    await row.getByRole("button", { name: "Confirmo o atendimento" }).click();
    await expect(page.getByText("Atendimento confirmado.")).toBeVisible(); await expect(row.getByText("Você confirmou")).toBeVisible();
    const a = await appt(S.A); expect(a.professional_confirmed_at).toBeTruthy(); expect(a.patient_confirmed_at).toBeTruthy(); expect(a.status).toBe("scheduled");
    // B: só o profissional confirma; o paciente continua pendente (independência), sem consumo
    const rowB = page.getByRole("listitem").filter({ hasText: svcName("B") });
    await rowB.getByRole("button", { name: "Confirmo o atendimento" }).click(); await expect(page.getByText("Atendimento confirmado.")).toBeVisible();
    const b = await appt(S.B); expect(b.professional_confirmed_at).toBeTruthy(); expect(b.patient_confirmed_at).toBeNull();
    expect(await bal()).toBe(4);
    // auditoria: quem confirmou
    const audit = await devSql(`select count(*)::int as n from public.audit_log where entity_type='appointments' and entity_id::text='${S.A}' and actor_user_id='${fis.user.id}' and new_values->>'professional_confirmed_at' is not null`) as { n: number }[];
    expect(audit[0].n).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("paciente vê a confirmação do profissional; gestor vê as duas confirmações e registra a do paciente por telefone (via equipe)", async ({ page, context, browser }) => {
    // paciente (contexto próprio)
    const ctxP = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const pageP = await ctxP.newPage(); await loginAs(ctxP, QA.paciente);
    await pageP.goto("/paciente");
    const rowA = pageP.getByRole("listitem").filter({ hasText: svcName("A") });
    await expect(rowA.getByText("O profissional confirmou o atendimento.")).toBeVisible();
    const rowB = pageP.getByRole("listitem").filter({ hasText: svcName("B") }); await expect(rowB.getByRole("button", { name: "Confirmar minha presença" })).toBeVisible();
    await ctxP.close();
    // gestor: Agenda do dia
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(S.day);
    const agA = page.getByRole("row").filter({ hasText: svcName("A") });
    await expect(agA.getByText("Paciente: ✓")).toBeVisible(); await expect(agA.getByText("Profissional: ✓")).toBeVisible();
    await expect(agA.getByRole("button", { name: "Registrar confirmação do paciente" })).toHaveCount(0);
    await expect(agA.getByRole("button", { name: "Confirmo o atendimento" }), "gestor nunca confirma pelo profissional").toHaveCount(0);
    const agB = page.getByRole("row").filter({ hasText: svcName("B") });
    await expect(agB.getByText("Paciente: pendente")).toBeVisible(); await expect(agB.getByText("Profissional: ✓")).toBeVisible();
    await agB.getByRole("button", { name: "Registrar confirmação do paciente" }).click();
    await expect(page.getByText("Confirmação do paciente registrada.")).toBeVisible(); await expect(agB.getByText("Paciente: ✓ (equipe)")).toBeVisible();
    const b = await appt(S.B); expect(b).toMatchObject({ patient_confirmed_via: "staff" }); expect(await bal()).toBe(4);
    expect(errors).toEqual([]);
  });

  test("presença ≠ confirmação ≠ consumo: paciente confirmado que falta sem cancelar = no_show consumindo; falta do profissional nunca consome", async ({ page, context, browser }) => {
    const mgr = await signIn(QA.manager); const g = api(mgr);
    // antes do horário o servidor recusa as duas faltas
    expect((await g.rpc("set_appointment_status", { p_id: S.B, p_status: "no_show", p_reason: null })).status).not.toBe(204);
    expect((await g.rpc("set_appointment_status", { p_id: S.C, p_status: "professional_no_show", p_reason: null })).status).not.toBe(204);
    // o tempo passa (Dev): B (paciente confirmou e não veio) e C (o profissional não veio) ocorreram ontem
    // horários únicos por execução: o profissional é compartilhado e a regra de não sobreposição vale também para o passado
    const past = spDate(-1); const hh = 1 + (parseInt(runId, 36) % 20); const at = (h: number) => `${past}T${String(h).padStart(2, "0")}:00:00-03:00`;
    await moveAppointment(S.B, at(hh)); await moveAppointment(S.C, at(hh + 2));
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(past);
    const rowB = page.getByRole("row").filter({ hasText: svcName("B") });
    await rowB.getByRole("button", { name: "Faltou" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();
    await expect(rowB.getByText("Faltou", { exact: true })).toBeVisible(); await expect(rowB.getByText("Consumida", { exact: true })).toBeVisible();
    expect((await appt(S.B)).status, "falta do paciente nunca é atendimento realizado").toBe("no_show"); expect(await bal()).toBe(3);
    const rowC = page.getByRole("row").filter({ hasText: svcName("C") });
    await rowC.getByRole("button", { name: "Profissional ausente" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();
    await expect(rowC.getByText("Profissional ausente", { exact: true })).toBeVisible(); await expect(rowC.getByText("Não consumida", { exact: true })).toBeVisible();
    await expect.poll(async () => (await appt(S.C)).status, { message: "a falta do profissional precisa chegar ao banco", timeout: 20_000 }).toBe("professional_no_show"); expect(await bal(), "falta do profissional não penaliza o paciente").toBe(3);
    // nem um nem outro viram atendimento realizado depois de encerrados
    expect((await g.rpc("set_appointment_status", { p_id: S.C, p_status: "attended", p_reason: null })).status).not.toBe(204);
    const att = await devSql(`select count(*)::int as n from public.session_ledger where appointment_id in ('${S.B}','${S.C}') and note ilike 'Atendimento realizado%'`) as { n: number }[]; expect(att[0].n).toBe(0);
    // o paciente vê a verdade no portal
    const ctxP = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const pageP = await ctxP.newPage(); await loginAs(ctxP, QA.paciente);
    await pageP.goto("/paciente");
    const pB = pageP.getByRole("listitem").filter({ hasText: svcName("B") }); await expect(pB.getByText("Você faltou")).toBeVisible(); await expect(pB.getByText(/foi descontada do seu pacote/)).toBeVisible();
    const pC = pageP.getByRole("listitem").filter({ hasText: svcName("C") }); await expect(pC.getByText("O profissional não compareceu")).toBeVisible(); await expect(pC.getByText(/Sua sessão não foi descontada/)).toBeVisible();
    await ctxP.close();
    expect(errors).toEqual([]);
  });
});
