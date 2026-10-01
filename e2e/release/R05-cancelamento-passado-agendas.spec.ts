// ACEITE da release v1 — cancelamento pelo paciente no portal (prazo e consumo de sessão), bloqueio de remarcar para o passado
// (interface e servidor) e agendas de outros profissionais em "Meu dia" somente por permissão. Não depende de token de gestão do Dev.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, loginAs, QA, rest, runId, signIn, spDate } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

// No portal do paciente o mesmo atendimento aparece em "Meus atendimentos" e, como consulta futura, em "Minha jornada": a ação de cancelar/remarcar é a da primeira lista.
const mine = (p: Page) => p.locator("section").filter({ has: p.getByRole("heading", { name: "Meus atendimentos" }) }).getByRole("listitem");

test.describe.serial("@release Cancelamento pelo paciente, horário passado e agendas por permissão", () => {
  test.setTimeout(150_000);
  const S: Record<string, string> = {};
  const svcName = (k: string) => `R05 ${k} ${runId}`;
  const bal = async () => { const mgr = await signIn(QA.manager); return ((await api(mgr).get(`session_ledger?select=delta&client_package_id=eq.${S.pkg}`)).body as { delta: number }[]).reduce((a, x) => a + x.delta, 0); };
  const status = async (id: string) => { const mgr = await signIn(QA.manager); return (await api(mgr).get(`appointments?select=status&id=eq.${id}`)).body[0].status as string; };

  test("preparo: pacote do paciente (venda real), profissional e atendimentos", async () => {
    const mgr = await signIn(QA.manager); const g = api(mgr); const pac = await signIn(QA.paciente); const fis = await signIn(QA.fisio);
    const org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id as string; const unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id as string;
    const person = ((await api(pac).get("people?select=id")).body as { id: string }[])[0].id; S.unit = unit;
    let prof = ((await g.get(`professionals?select=id,display_name&user_id=eq.${fis.user.id}`)).body as { id: string; display_name: string }[])[0];
    if (!prof) { const r = await rest(mgr, "POST", "professionals", { org_id: org, display_name: "Fisio QA (aceite)", active: true, user_id: fis.user.id }); prof = r.body[0]; await rest(mgr, "POST", "professional_units", { professional_id: prof.id, unit_id: unit }); }
    S.prof = prof.id; S.profName = prof.display_name;
    if (((await g.get(`availability_rules?select=id&professional_id=eq.${prof.id}&unit_id=eq.${unit}&limit=1`)).body as unknown[]).length === 0)
      for (let d = 0; d < 7; d++) await rest(mgr, "POST", "availability_rules", { org_id: org, professional_id: prof.id, unit_id: unit, weekday: d, start_time: "00:00", end_time: "23:30" });
    const svc: Record<string, string> = {};
    for (const k of ["E", "L", "F"]) svc[k] = (await rest(mgr, "POST", "services", { org_id: org, name: svcName(k), duration_min: 30, price_cents: 0, active: true })).body[0].id as string;
    const product = (await rest(mgr, "POST", "products", { org_id: org, kind: "package", name: `Pacote R05 ${runId}`, price_cents: 10000, sessions_count: 4, validity_days: 90, consume_on_no_show: true, late_cancel_hours: 24, service_id: svc.E, active: true, access_rule: "on_first_payment" })).body[0].id as string;
    const sale = await g.rpc("sale_create", { p_person: person, p_unit: unit, p_opportunity: null, p_items: [{ product_id: product, qty: 1 }], p_discount_cents: 0, p_installments: 1, p_first_due: spDate(0) });
    expect(sale.status, JSON.stringify(sale.body)).toBe(200); expect((await g.rpc("sale_confirm", { p_sale: sale.body })).status).toBeLessThan(300);
    S.pkg = (await g.get(`client_packages?select=id&sale_id=eq.${sale.body}`)).body[0].id; expect(await bal()).toBe(4);
    const slotsOf = async (day: string, k: string) => ((await g.rpc("available_slots", { p_professional: prof.id, p_unit: unit, p_service: svc[k], p_date: day })).body as { slot_start: string }[]).map((s) => s.slot_start);
    const book = async (k: string, start: string, pkg: string | null) => { const r = await g.rpc("book_appointment", { p_person: person, p_unit: unit, p_professional: prof.id, p_service: svc[k], p_start: start, p_package: pkg, p_opportunity: null }); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body as string; };
    const far = spDate(9 + (parseInt(runId, 36) % 60)); S.day = far; const farSlots = await slotsOf(far, "E");
    S.E = await book("E", farSlots[6], S.pkg);                                  // bem adiante: cancelamento dentro do prazo (sem custo)
    S.F = await book("F", farSlots[10], null);                                  // sem pacote, para a remarcação
    const soon = [...(await slotsOf(spDate(0), "L")), ...(await slotsOf(spDate(1), "L"))].find((s) => { const h = (new Date(s).getTime() - Date.now()) / 36e5; return h > 2 && h < 20; });
    expect(soon, "há horário nas próximas 20 h").toBeTruthy(); S.L = await book("L", soon!, S.pkg);    // dentro das 24 h: cancelar consome
    // outro profissional (a fisioterapeuta QA não pode ver a agenda dele)
    const other = (await rest(mgr, "POST", "professionals", { org_id: org, display_name: `Fisio Outro R05 ${runId}`, active: true })).body[0].id as string; await rest(mgr, "POST", "professional_units", { professional_id: other, unit_id: unit }); S.other = other;
  });

  test("paciente cancela pelo portal: avisado antes; dentro do prazo não consome, dentro das 24 h consome", async ({ page, context }) => {
    const pac = await loginAs(context, QA.paciente); const errors = collectErrors(page); void pac;
    await page.goto("/paciente");
    const rowE = mine(page).filter({ hasText: svcName("E") }); await expect(rowE).toHaveCount(1);
    await expect(rowE.getByText(/Sem custo até 24 h antes/)).toBeVisible();
    await rowE.getByRole("button", { name: "Cancelar atendimento" }).click();
    const dlg = page.getByRole("dialog"); await expect(dlg.getByText(/nenhuma sessão será descontada/)).toBeVisible();
    await dlg.getByRole("button", { name: "Cancelar atendimento" }).click();
    await expect(page.getByText("Atendimento cancelado. Nenhuma sessão foi descontada.")).toBeVisible();
    await expect(rowE.getByText(/Cancelado dentro do prazo/)).toBeVisible();
    expect(await status(S.E)).toBe("cancelled_by_patient"); expect(await bal(), "cancelamento dentro do prazo não consome").toBe(4);

    const rowL = mine(page).filter({ hasText: svcName("L") }); await expect(rowL).toHaveCount(1);
    await expect(rowL.getByText(/Cancelar agora desconta 1 sessão/)).toBeVisible();
    await rowL.getByRole("button", { name: "Cancelar atendimento" }).click();
    await expect(page.getByRole("dialog").getByText(/SERÁ DESCONTADA/)).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar atendimento" }).click();
    await expect(page.getByText("Atendimento cancelado. A sessão foi descontada do seu pacote, conforme a regra de cancelamento tardio.")).toBeVisible();
    await expect(rowL.getByText(/a sessão foi descontada/)).toBeVisible();
    expect(await status(S.L)).toBe("cancelled_by_patient"); expect(await bal(), "cancelamento tardio consome 1 sessão").toBe(3);
    // repetir pela API não consome de novo; equipe e outros pacientes não usam essa via
    const pacS = await signIn(QA.paciente); expect((await api(pacS).rpc("my_appointment_cancel", { p_id: S.L, p_reason: null })).status).toBe(200); expect(await bal()).toBe(3);
    expect((await api(await signIn(QA.manager)).rpc("my_appointment_cancel", { p_id: S.F, p_reason: null })).status, "gestor não cancela como paciente").toBe(403);
    expect((await api(await signIn(QA.fisio)).rpc("my_appointment_cancel", { p_id: S.F, p_reason: null })).status, "fisioterapeuta não cancela como paciente").toBe(403);
    expect(errors).toEqual([]);
  });

  test("remarcar para horário passado é recusado na interface e no servidor; futuro continua funcionando", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(await signIn(QA.manager));
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(S.day);
    const row = page.getByRole("row").filter({ hasText: svcName("F") }); await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Remarcar" }).click(); await page.locator("#ask-input").fill(`${spDate(-1)} 10:00`); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Não é possível remarcar para um horário passado/)).toBeVisible();
    expect(await status(S.F)).toBe("scheduled");
    // servidor (chamada direta, sem a interface): recusado e nada muda
    const past = new Date(Date.now() - 3 * 36e5).toISOString();
    expect((await g.rpc("reschedule_appointment", { p_id: S.F, p_new_start: past })).status).not.toBe(200); expect(await status(S.F)).toBe("scheduled");
    // agendar no passado (mesmo informando p_rescheduled_from, a antiga brecha) também é recusado
    const person = ((await g.get(`appointments?select=person_id,service_id&id=eq.${S.F}`)).body as { person_id: string; service_id: string }[])[0];
    const direct = await g.rpc("book_appointment", { p_person: person.person_id, p_unit: S.unit, p_professional: S.prof, p_service: person.service_id, p_start: past, p_package: null, p_opportunity: null, p_notes: null, p_rescheduled_from: S.F });
    expect(direct.status).not.toBe(200); expect(JSON.stringify(direct.body)).toMatch(/passado/);
    // futuro: funciona — num horário livre do paciente e da profissional (execuções anteriores deixam atendimentos remarcados e a data é sorteada)
    const busy = ((await g.get(`appointments?select=period&status=in.(scheduled,confirmed,attended)&or=(person_id.eq.${person.person_id},professional_id.eq.${S.prof})&limit=2000`)).body as { period: string }[])
      .map((a) => [...a.period.matchAll(/(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(?:\.\d+)?([+-]\d\d)/g)].map((m) => Date.parse(m[1].replace(" ", "T") + m[2] + ":00")));
    const free = Array.from({ length: 21 }, (_, i) => `${String(12 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`).find((h) => { const a = Date.parse(`${S.day}T${h}:00-03:00`), b = a + 30 * 60_000; return !busy.some(([x, y]) => a < y && b > x); });
    expect(free, "há horário livre na data sorteada").toBeTruthy();
    await row.getByRole("button", { name: "Remarcar" }).click(); await page.locator("#ask-input").fill(`${S.day} ${free}`); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Remarcado.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Meu dia: a própria agenda de cada um; agenda de outros fisioterapeutas só para quem tem permissão", async ({ page, context, browser }) => {
    // gestor: vê o seletor e abre a agenda da fisioterapeuta, sem ação de confirmar por ela
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/meu-dia"); await page.locator("#pd-date").fill(S.day);
    await expect(page.locator("#pd-prof")).toBeVisible(); await page.locator("#pd-prof").selectOption({ label: S.profName });
    const row = page.getByRole("listitem").filter({ hasText: svcName("F") }); await expect(row).toHaveCount(1);
    await expect(row.getByRole("button", { name: "Confirmo o atendimento" }), "gestor nunca confirma pelo profissional").toHaveCount(0);
    // fisioterapeuta: sem seletor; vê a própria agenda e pode confirmar o próprio atendimento
    const ctxF = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const pf = await ctxF.newPage(); await loginAs(ctxF, QA.fisio);
    await pf.goto("/admin/meu-dia"); await pf.locator("#pd-date").fill(S.day);
    await expect(pf.getByRole("listitem").filter({ hasText: svcName("F") })).toHaveCount(1); await expect(pf.locator("#pd-prof")).toHaveCount(0);
    await ctxF.close();
    // servidor: a fisioterapeuta não abre a agenda de outro fisioterapeuta; o gestor abre; comercial e paciente não
    const fis = await signIn(QA.fisio); const mgr = await signIn(QA.manager);
    expect((await api(fis).rpc("professional_day", { p_professional: S.other, p_date: S.day })).status, "fisio não vê agenda alheia").toBe(403);
    expect((await api(fis).rpc("professional_day", { p_professional: S.prof, p_date: S.day })).status, "fisio vê a própria").toBe(200);
    expect((await api(mgr).rpc("professional_day", { p_professional: S.other, p_date: S.day })).status, "gestor vê").toBe(200);
    expect((await api(await signIn(QA.comercial)).rpc("professional_day", { p_professional: S.prof, p_date: S.day })).status, "comercial não vê").toBe(403);
    expect((await api(await signIn(QA.paciente)).rpc("professional_day", { p_professional: S.prof, p_date: S.day })).status, "paciente não vê").toBe(403);
    const list = (await api(fis).rpc("my_agenda_professionals")).body as { id: string; is_self: boolean }[]; expect(list.every((p) => p.is_self)).toBe(true);
    expect(errors).toEqual([]);
  });
});
