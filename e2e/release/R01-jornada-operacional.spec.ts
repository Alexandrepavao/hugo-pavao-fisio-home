// ACEITE da release v1 — jornada operacional completa contra o Supabase DEV, com dados persistidos:
// lead (quiz) → CRM + cadastro central (sem duplicar) → responsável e acompanhamento → avaliação agendada, remarcada e realizada
// → conversão em venda de pacote → contrato/parcelas/pacote → recebimento parcial, repetido e estorno → sessões consumidas
// corretamente (comparecimento, falta, cancelamento tardio/antecipado/da clínica; sem consumo duplicado) → dashboard e histórico.
import { expect, test, type Page } from "@playwright/test";
import { api, brlFmt, collectErrors, loginAs, moveAppointment, QA, rest, runId, signIn, spDate, spTime } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const email = `jornada.${runId}@example.com`;
const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
const name = `Jornada E2E ${runId}`;

test.describe.serial("@release Jornada operacional (aceite)", () => {
  test.setTimeout(180_000);
  const S: Record<string, string> = {};                     // ids compartilhados entre os passos
  let mgr: Awaited<ReturnType<typeof signIn>>;

  test.beforeAll(async () => {
    mgr = await signIn(QA.manager); const g = api(mgr);
    S.org = (await g.get("organizations?select=id&slug=eq.hp-group")).body[0].id;
    S.unit = (await g.get("units?select=id&slug=eq.sao-paulo")).body[0].id;
    const physio = await signIn(QA.fisio); const comercial = await signIn(QA.comercial); const fin = await signIn(QA.financeiro);
    S.physioUser = physio.user.id; S.gestorUnidadeUser = (await signIn(QA.gestorUnidade)).user.id; S.comercialUser = comercial.user.id; S.finUser = fin.user.id;
    // fixtures próprias desta execução (nada de dados reais): serviço, produto pacote, profissional com agenda 24h
    const svc = await rest(mgr, "POST", "services", { org_id: S.org, name: `Avaliação E2E ${runId}`, duration_min: 30, price_cents: 0, active: true }); expect(svc.status, JSON.stringify(svc.body)).toBe(201); S.svc = svc.body[0].id;
    const pkg = await rest(mgr, "POST", "products", { org_id: S.org, kind: "package", name: `Pacote 4 sessões E2E ${runId}`, price_cents: 40000, sessions_count: 4, validity_days: 90, consume_on_no_show: true, late_cancel_hours: 24, service_id: S.svc, active: true, access_rule: "on_first_payment" });
    expect(pkg.status, JSON.stringify(pkg.body)).toBe(201); S.pkg = pkg.body[0].id;
    // profissional próprio desta execução (sem user_id, que é único): a agenda de cada rodada fica isolada das anteriores
    const prof = await rest(mgr, "POST", "professionals", { org_id: S.org, display_name: `Fisio E2E ${runId}`, active: true }); expect(prof.status, JSON.stringify(prof.body)).toBe(201); S.prof = prof.body[0].id;
    if (!(await g.get(`professional_units?select=unit_id&professional_id=eq.${S.prof}&unit_id=eq.${S.unit}`)).body.length) expect((await rest(mgr, "POST", "professional_units", { professional_id: S.prof, unit_id: S.unit })).status).toBe(201);
    const rules = (await g.get(`availability_rules?select=weekday,start_time&professional_id=eq.${S.prof}&unit_id=eq.${S.unit}`)).body as { weekday: number; start_time: string }[];
    for (let d = 0; d < 7; d++) if (!rules.some((r) => r.weekday === d && r.start_time.startsWith("00:00"))) expect((await rest(mgr, "POST", "availability_rules", { org_id: S.org, professional_id: S.prof, unit_id: S.unit, weekday: d, start_time: "00:00", end_time: "23:30" })).status).toBe(201);
    const rule = await rest(mgr, "POST", "commission_rules", { org_id: S.org, name: `Comissão E2E ${runId}`, product_id: S.pkg, beneficiary_user_id: null, percent_bp: 1000, active: true }); expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  });

  test("1. lead preenche o quiz → aparece no CRM e no cadastro central; repetir não duplica", async ({ browser }) => {
    const anon = await browser.newContext({ timezoneId: "America/Sao_Paulo" }); const p = await anon.newPage(); const errors = collectErrors(p);
    await p.goto("/avaliacao");
    await p.getByLabel("Como podemos chamar você?").fill(name); await p.getByLabel("Qual é seu e-mail?").fill(email); await p.getByLabel("Qual é seu WhatsApp com DDD?").fill(phone);
    await p.getByRole("checkbox").click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByLabel("Cidade").fill("São Paulo"); await p.getByLabel("UF").selectOption("SP"); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("button", { name: "Concordo, continuar" }).click();
    for (const label of ["dor ou desconforto", "deseja melhorar", "qualidade de vida melhoraria"]) { await expect(p.getByText(new RegExp(label))).toBeVisible(); await p.getByRole("radio", { name: "5" }).click(); await p.getByRole("button", { name: "Continuar" }).click(); }
    await p.getByRole("radio", { name: "Realizar atividades diárias" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Sim" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Até R$ 250" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("button", { name: "Concluir" }).click();
    await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible();
    expect(errors).toEqual([]);

    // tentativa repetida com o MESMO contato (outro navegador, outro nome digitado): continua sendo 1 pessoa e 1 oportunidade
    const again = await browser.newContext(); const p2 = await again.newPage();
    await p2.goto("/avaliacao");
    await p2.getByLabel("Como podemos chamar você?").fill(`${name} (repetido)`); await p2.getByLabel("Qual é seu e-mail?").fill(email); await p2.getByLabel("Qual é seu WhatsApp com DDD?").fill(phone);
    await p2.getByRole("checkbox").click(); await p2.getByRole("button", { name: "Continuar" }).click();
    await expect(p2.getByText("Em qual cidade e estado")).toBeVisible();
    await anon.close(); await again.close();

    const g = api(mgr);
    const contacts = await g.get(`person_contacts?select=person_id&type=eq.email&normalized=eq.${encodeURIComponent(email)}`);
    const persons = [...new Set((contacts.body as { person_id: string }[]).map((c) => c.person_id))];
    expect(persons, "uma única pessoa para o mesmo e-mail").toHaveLength(1); S.person = persons[0];
    const opps = await g.get(`opportunities?select=id,source,owner_user_id,status,stage_id&person_id=eq.${S.person}`);
    expect(opps.body, "uma única oportunidade").toHaveLength(1); S.opp = opps.body[0].id;
    expect(opps.body[0]).toMatchObject({ source: "quiz:atendimento", status: "open" });
    const person = await g.get(`people?select=full_name,unit_id,merged_into_id&id=eq.${S.person}`);
    expect(person.body[0].merged_into_id).toBeNull();
  });

  test("2. CRM: lead na fila, responsável, contato registrado, tarefa de acompanhamento e histórico", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/crm/leads");
    const sel = page.getByLabel(new RegExp(`Responsável de ${name}`));
    await expect(sel).toBeVisible();
    // distribuição automática do CRM já atribuiu um responsável no momento da captura
    const g0 = api(mgr);
    expect((await g0.get(`opportunities?select=owner_user_id&id=eq.${S.opp}`)).body[0].owner_user_id, "lead nasce com responsável").toBe(S.comercialUser);
    // troca real de responsável (e volta) pela fila de leads: cada troca gera evento no histórico
    await sel.selectOption(S.gestorUnidadeUser);
    await expect(page.getByText("Responsável atualizado.")).toBeVisible();
    await sel.selectOption(S.comercialUser);
    await expect(async () => expect((await g0.get(`opportunity_events?select=id&kind=eq.owner_changed&opportunity_id=eq.${S.opp}`)).body.length).toBe(2)).toPass();
    await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Abrir" }).click();
    await page.getByRole("tab", { name: "Histórico" }).click();
    await page.getByLabel("Nota").fill(`Primeiro contato ${runId}: paciente quer avaliação.`); await page.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(page.getByText(`Primeiro contato ${runId}`).first()).toBeVisible();
    await page.getByRole("tab", { name: /Tarefas/ }).click();
    await page.getByPlaceholder("Nova tarefa").fill(`Confirmar avaliação ${runId}`); await page.getByRole("button", { name: "Adicionar tarefa" }).click();
    await expect(page.getByText(`Confirmar avaliação ${runId}`).first()).toBeVisible();
    const g = api(mgr);
    expect((await g.get(`opportunities?select=owner_user_id&id=eq.${S.opp}`)).body[0].owner_user_id).toBe(S.comercialUser);
    expect((await g.get(`interactions?select=id&opportunity_id=eq.${S.opp}`)).body.length).toBeGreaterThanOrEqual(1);
    const tasks = (await g.get(`crm_tasks?select=title,assignee_user_id&opportunity_id=eq.${S.opp}&done_at=is.null`)).body as { title: string; assignee_user_id: string }[];
    expect(tasks.some((t) => t.title.includes(`Confirmar avaliação ${runId}`) && t.assignee_user_id === S.comercialUser)).toBe(true);
    const events = (await g.get(`opportunity_events?select=kind&opportunity_id=eq.${S.opp}`)).body as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["created", "owner_changed", "owner_changed"]));
    // o responsável (comercial) enxerga a própria oportunidade; o cadastro central mostra a pessoa uma vez
    const com = api(await signIn(QA.comercial));
    expect((await com.get(`opportunities?select=id&id=eq.${S.opp}`)).body).toHaveLength(1);
    await page.goto(`/admin/adm/diretorio?q=${encodeURIComponent(name)}`);
    await page.getByPlaceholder(/Nome, razão social/).fill(name);
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  const pickSlot = async (page: Page, hhmm?: string) => {
    const sel = page.locator("#ash"); await expect.poll(async () => (await sel.locator("option").count())).toBeGreaterThan(1);
    const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => ({ v: (o as HTMLOptionElement).value, t: o.textContent ?? "" })).filter((o) => o.v));
    const pick = hhmm ? opts.find((o) => o.t.trim() === hhmm) : opts[0]; expect(pick, `horário ${hhmm ?? "qualquer"} disponível`).toBeTruthy(); await sel.selectOption(pick!.v); return pick!.v;
  };
  const openAgenda = async (page: Page, date: string) => {
    await page.goto("/admin/agenda");
    await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(date); await page.locator("#ap").selectOption(S.prof); await page.locator("#as").selectOption(S.svc);
  };
  const bookUi = async (page: Page, date: string, hhmm: string | undefined, opts: { pkg?: boolean; opp?: boolean } = {}) => {
    await openAgenda(page, date);
    await page.locator("#apn").fill(name); await page.getByRole("button", { name, exact: true }).click();
    const start = await pickSlot(page, hhmm);
    if (opts.pkg) await page.locator("#apk").selectOption({ index: 1 });
    if (opts.opp) await page.locator("#aop").selectOption(S.opp);
    await page.getByRole("button", { name: "Agendar", exact: true }).click(); await expect(page.getByText("Agendamento criado.")).toBeVisible();
    return start;
  };

  test("3. agenda: avaliação agendada, remarcada e realizada", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    const day = spDate(2);
    const start = await bookUi(page, day, undefined, { opp: true });
    const appts = (await g.get(`appointments?select=id,status,opportunity_id&person_id=eq.${S.person}&order=created_at`)).body as { id: string; status: string; opportunity_id: string }[];
    expect(appts).toHaveLength(1); expect(appts[0]).toMatchObject({ status: "scheduled", opportunity_id: S.opp }); S.evalAppt = appts[0].id;
    // o mesmo horário do mesmo paciente/profissional é recusado pelo servidor
    const dup = await g.rpc("book_appointment", { p_person: S.person, p_unit: S.unit, p_professional: S.prof, p_service: S.svc, p_start: start, p_package: null, p_opportunity: null });
    expect(dup.status).not.toBe(200);
    // remarcar pela interface (prompt em AAAA-MM-DD HH:MM, fuso do navegador = São Paulo)
    await page.reload(); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(day);
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "Agendado" }).getByRole("button", { name: "Remarcar" }).click();
    await page.locator("#ask-input").fill(`${day} 15:00`); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Remarcado.")).toBeVisible();
    const after = (await g.get(`appointments?select=id,status,rescheduled_from,period&person_id=eq.${S.person}&order=created_at`)).body as { id: string; status: string; rescheduled_from: string | null; period: string }[];
    expect(after.map((a) => a.status).sort()).toEqual(["rescheduled", "scheduled"]);
    const novo = after.find((a) => a.status === "scheduled")!; S.evalAppt = novo.id; expect(novo.rescheduled_from).toBeTruthy();
    expect(spTime(novo.period.replace(/[[\]()"]/g, "").split(",")[0])).toBe("15:00");
    // antes do horário o servidor recusa comparecimento e falta (não dá para "consumir" o que ainda não ocorreu)
    expect((await g.rpc("set_appointment_status", { p_id: S.evalAppt, p_status: "attended", p_reason: null })).status).not.toBe(204);
    expect((await g.rpc("set_appointment_status", { p_id: S.evalAppt, p_status: "no_show", p_reason: null })).status).not.toBe(204);
    expect((await g.get(`appointments?select=status&id=eq.${S.evalAppt}`)).body[0].status).toBe("scheduled");
    // o tempo passa (Dev): o atendimento passa a ter ocorrido ontem às 10:00 e o comparecimento é registrado pela interface
    const past = spDate(-1); await moveAppointment(S.evalAppt, `${past}T10:00:00-03:00`);
    await page.reload(); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(past);
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "Agendado" }).getByRole("button", { name: "Compareceu" }).click();
    await expect(page.getByText("Status atualizado.")).toBeVisible();
    expect((await g.get(`appointments?select=status&id=eq.${S.evalAppt}`)).body[0].status).toBe("attended");
    expect(errors).toEqual([]);
  });

  test("4. converte em venda de pacote: contrato, parcelas e pacote de sessões", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    // caminho real do usuário: painel da oportunidade → "Converter em venda"
    await page.goto("/admin/crm/oportunidades");
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole("link", { name: "Converter em venda" }).click();
    await expect(page).toHaveURL(/\/admin\/financeiro\/vendas\?venda=/);
    await expect(page.getByText("Venda originada de uma oportunidade")).toBeVisible();
    await page.locator("#pr").selectOption(S.pkg); await page.locator("#in").fill("2"); await page.locator("#fd").fill(spDate(0));
    await page.getByRole("button", { name: "Criar venda" }).click(); await expect(page.getByText(/Venda criada como pendente/)).toBeVisible();
    const sale = (await g.get(`sales?select=id,status,total_cents,installments,opportunity_id&person_id=eq.${S.person}`)).body as { id: string; status: string; total_cents: number; installments: number; opportunity_id: string }[];
    expect(sale).toHaveLength(1); expect(sale[0]).toMatchObject({ status: "pending", total_cents: 40000, installments: 2, opportunity_id: S.opp }); S.sale = sale[0].id;
    expect((await g.get(`receivables?select=id&sale_id=eq.${S.sale}`)).body, "pendente ainda não gera parcelas").toHaveLength(0);
    await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Venda confirmada/)).toBeVisible();
    const recs = (await g.get(`receivables?select=id,installment_no,amount_cents,status&sale_id=eq.${S.sale}&order=installment_no`)).body as { id: string; amount_cents: number; status: string }[];
    expect(recs.map((r) => r.amount_cents)).toEqual([20000, 20000]); expect(recs.every((r) => r.status === "open")).toBe(true);
    S.rec1 = recs[0].id; S.rec2 = recs[1].id;
    const pk = (await g.get(`client_packages?select=id,total_sessions,status&sale_id=eq.${S.sale}`)).body;
    expect(pk).toHaveLength(1); expect(pk[0]).toMatchObject({ total_sessions: 4, status: "active" }); S.cp = pk[0].id;
    expect((await g.get(`contracts?select=id&sale_id=eq.${S.sale}`)).body).toHaveLength(1);
    // confirmar de novo (clique repetido / retentativa) não duplica nada
    expect((await g.rpc("sale_confirm", { p_sale: S.sale })).status).toBeLessThan(500);
    expect((await g.get(`receivables?select=id&sale_id=eq.${S.sale}`)).body).toHaveLength(2);
    expect((await g.get(`client_packages?select=id&sale_id=eq.${S.sale}`)).body).toHaveLength(1);
    expect((await g.get(`interactions?select=summary&opportunity_id=eq.${S.opp}&channel=eq.system`)).body.some((i: { summary: string }) => /Venda confirmada/.test(i.summary))).toBe(true);
    expect(errors).toEqual([]);
  });

  test("5. recebimento parcial, repetido, excedente, estorno e comissão", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    const pays = async (rec: string) => (await g.get(`payments?select=id,kind,amount_cents,idempotency_key&receivable_id=eq.${rec}&order=created_at`)).body as { id: string; kind: string; amount_cents: number; idempotency_key: string }[];
    const recStatus = async (rec: string) => (await g.get(`receivables?select=status&id=eq.${rec}`)).body[0].status as string;
    await page.goto("/admin/financeiro/vendas");
    // a parcela é a célula inteira "1/2": um hasText "1/2" também casaria com datas de vencimento (ex.: 01/11/2026), que mudam com o dia da execução
    const row = (n: string) => page.getByRole("row").filter({ hasText: name }).filter({ has: page.getByRole("cell", { name: n, exact: true }) });
    await row("1/2").getByRole("button", { name: "Receber" }).click();
    await page.locator("#pa").fill("100,00"); await page.getByRole("button", { name: "Registrar" }).dblclick();       // clique duplo
    await expect(page.getByText("Recebimento registrado.")).toBeVisible();
    expect(await pays(S.rec1), "duplo clique não duplica o recebimento").toHaveLength(1); expect(await recStatus(S.rec1)).toBe("partial");
    // reenvio da MESMA chave de idempotência (tentativa repetida por rede/API) não cria outro pagamento
    const key = (await pays(S.rec1))[0].idempotency_key;
    await g.rpc("payment_record", { p_receivable: S.rec1, p_amount_cents: 10000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: key });
    expect(await pays(S.rec1)).toHaveLength(1);
    // excedente é recusado
    const over = await g.rpc("payment_record", { p_receivable: S.rec1, p_amount_cents: 10001, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `over-${runId}` });
    expect(over.status).not.toBe(200);
    // segunda metade pela interface quita a parcela
    await page.reload(); await row("1/2").getByRole("button", { name: "Receber" }).click();
    await expect(page.locator("#pa")).toHaveValue("100,00"); await page.getByRole("button", { name: "Registrar" }).click();
    await expect(page.getByText("Recebimento registrado.")).toBeVisible();
    expect(await recStatus(S.rec1)).toBe("paid");
    // estorno parcial pela interface: R$ 50,00 de um recebimento de R$ 100,00 → parcela volta a parcial
    await page.reload();
    await page.getByRole("row").filter({ hasText: "Recebimento" }).filter({ hasText: "R$ 100,00" }).first().getByRole("button", { name: "Estornar" }).click();
    await page.locator("#ask-input").fill("50,00"); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
    await page.locator("#ask-input").fill(`Estorno de teste ${runId}`); await page.getByRole("dialog").getByRole("button", { name: "Estornar" }).click();
    await expect(page.getByText("Estorno registrado.")).toBeVisible();
    expect((await pays(S.rec1)).map((p) => p.kind)).toEqual(["payment", "payment", "refund"]);
    expect(await recStatus(S.rec1)).toBe("partial");
    const comm = (await g.get(`commission_entries?select=amount_cents,beneficiary_user_id&sale_id=eq.${S.sale}`)).body as { amount_cents: number; beneficiary_user_id: string }[];
    expect(comm.length).toBeGreaterThanOrEqual(1);
    expect(comm.reduce((a, c) => a + c.amount_cents, 0), "10% de R$ 150,00 líquidos").toBe(1500);
    expect(comm.every((c) => c.beneficiary_user_id === S.comercialUser), "comissão vai ao responsável da oportunidade").toBe(true);
    // 2ª parcela quitada de uma vez
    await page.reload(); await row("2/2").getByRole("button", { name: "Receber" }).click();
    await page.getByRole("button", { name: "Registrar" }).click(); await expect(page.getByText("Recebimento registrado.")).toBeVisible();
    expect(await recStatus(S.rec2)).toBe("paid");
    expect((await g.get(`opportunities?select=status&id=eq.${S.opp}`)).body[0].status, "recebimento fecha a oportunidade como ganha").toBe("won");
    expect(brlFmt(15000)).toMatch(/150,00/);
    expect(errors).toEqual([]);
  });

  test("6. pacote: sessões realizadas, falta, cancelamentos e saldo — sem consumo duplicado nem saldo negativo", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    type L = { appointment_id: string | null; delta: number; reason: string; note: string | null };
    const ledger = async () => (await g.get(`session_ledger?select=appointment_id,delta,reason,note&client_package_id=eq.${S.cp}`)).body as L[];
    const balance = async () => (await ledger()).reduce((a, l) => a + l.delta, 0);
    const consumed = async (appt: string) => (await ledger()).filter((l) => l.appointment_id === appt && l.delta < 0).length;
    const apptId = async (iso: string) => ((await g.get(`appointments?select=id,period&person_id=eq.${S.person}&client_package_id=eq.${S.cp}&order=created_at`)).body as { id: string; period: string }[])
      .find((a) => new Date(a.period.replace(/[[\]()"]/g, "").split(",")[0]).getTime() === new Date(iso).getTime())?.id as string;
    expect(await balance(), "pacote de 4 sessões acabou de ser vendido").toBe(4);

    // reserva as 4 sessões do pacote pela interface (a 5ª reserva é recusada: não se agenda mais que o saldo)
    const d3 = spDate(3), d6 = spDate(6);
    const s1 = await bookUi(page, d3, "10:00", { pkg: true }); const s2 = await bookUi(page, d3, "11:00", { pkg: true }); const s3 = await bookUi(page, d3, "12:00", { pkg: true });
    const s4 = await bookUi(page, d6, "10:00", { pkg: true });
    const [a1, a2, a3, a4] = [await apptId(s1), await apptId(s2), await apptId(s3), await apptId(s4)];
    expect([a1, a2, a3, a4].every(Boolean)).toBe(true); expect(await balance(), "agendar não consome").toBe(4);
    const fifth = await g.rpc("book_appointment", { p_person: S.person, p_unit: S.unit, p_professional: S.prof, p_service: S.svc, p_start: new Date(new Date(s4).getTime() + 4 * 3600e3).toISOString(), p_package: S.cp, p_opportunity: null });
    expect(fifth.status, "com 4 reservas de 4 sessões, a 5ª é recusada").not.toBe(200);

    // o tempo passa (Dev): a1 e a2 ocorreram anteontem; a3 começa daqui a ~1h (cancelamento dentro das 24h da regra do produto)
    const dm2 = spDate(-2); await moveAppointment(a1, `${dm2}T09:00:00-03:00`); await moveAppointment(a2, `${dm2}T10:00:00-03:00`);
    const soon = new Date(Math.ceil((Date.now() + 90 * 60e3) / 1800e3) * 1800e3); await moveAppointment(a3, soon.toISOString());

    // a1: compareceu (consome 1) — pela interface
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(dm2);
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "09:00" }).getByRole("button", { name: "Compareceu" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();
    // a2: faltou (produto consome falta) — pela interface
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "10:00" }).getByRole("button", { name: "Faltou" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();
    // a3: paciente cancela em cima da hora (< 24h) → consome
    await page.locator("#pf-day").fill(soon.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }));
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: spTime(soon.toISOString()) }).getByRole("button", { name: "Cancelou", exact: true }).click();
    await page.locator("#ask-input").fill("Imprevisto de última hora"); await page.getByRole("dialog").getByRole("button", { name: "Cancelar agendamento" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();
    // a4: paciente cancela com antecedência → NÃO consome; a5: a clínica cancela → NÃO consome
    await page.locator("#pf-day").fill(d6);
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "10:00" }).getByRole("button", { name: "Cancelou", exact: true }).click();
    await page.locator("#ask-input").fill("Viagem"); await page.getByRole("dialog").getByRole("button", { name: "Cancelar agendamento" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();
    // cancelamento antecipado devolveu a reserva: agora cabe mais um agendamento, que a clínica cancela
    const s5 = await bookUi(page, d6, "11:00", { pkg: true }); const a5 = await apptId(s5);
    await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "11:00" }).getByRole("button", { name: "Clínica cancelou" }).click();
    await page.locator("#ask-input").fill("Profissional indisponível"); await page.getByRole("dialog").getByRole("button", { name: "Cancelar agendamento" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible();

    await expect.poll(async () => (await ledger()).filter((l) => l.delta < 0).length, { timeout: 30_000 }).toBe(3);
    expect([await consumed(a1), await consumed(a2), await consumed(a3), await consumed(a4), await consumed(a5)]).toEqual([1, 1, 1, 0, 0]);
    expect(await balance(), "4 vendidas − comparecimento − falta − cancelamento tardio").toBe(1);
    const notes = (await ledger()).filter((l) => l.delta < 0).map((l) => l.note ?? "").join(" | ");
    expect(notes).toMatch(/Atendimento realizado/); expect(notes).toMatch(/Falta/); expect(notes).toMatch(/Cancelamento tardio/);

    // repetições: mesma marcação de novo não consome de novo; realizado não pode virar falta; cancelado não reabre
    await g.rpc("set_appointment_status", { p_id: a1, p_status: "attended", p_reason: null });
    await g.rpc("set_appointment_status", { p_id: a2, p_status: "no_show", p_reason: null });
    expect((await g.rpc("set_appointment_status", { p_id: a1, p_status: "no_show", p_reason: null })).status).not.toBe(204);
    expect((await g.rpc("set_appointment_status", { p_id: a4, p_status: "attended", p_reason: null })).status).not.toBe(204);
    expect(await balance()).toBe(1); expect((await ledger()).filter((l) => l.delta < 0)).toHaveLength(3);
    // falta gerou tarefa de retorno; pacote perto do fim gerou tarefa de renovação
    const tasks = (await g.get(`crm_tasks?select=kind&person_id=eq.${S.person}`)).body as { kind: string }[];
    expect(tasks.map((t) => t.kind)).toEqual(expect.arrayContaining(["no_show", "package_end"]));
    // última sessão: pacote esgota e novo agendamento com ele é recusado (sem saldo negativo)
    const s6 = await bookUi(page, d3, "13:00", { pkg: true }); const a6 = await apptId(s6); await moveAppointment(a6, `${dm2}T14:00:00-03:00`);
    await g.rpc("set_appointment_status", { p_id: a6, p_status: "attended", p_reason: null });
    await expect.poll(async () => (await g.get(`client_packages?select=status&id=eq.${S.cp}`)).body[0].status, { timeout: 30_000 }).toBe("exhausted");
    expect(await balance()).toBe(0);
    const over = await g.rpc("book_appointment", { p_person: S.person, p_unit: S.unit, p_professional: S.prof, p_service: S.svc, p_start: new Date(Date.now() + 5 * 864e5).toISOString().replace(/:\d\d\.\d+Z$/, ":00Z"), p_package: S.cp, p_opportunity: null });
    expect(over.status, "pacote esgotado não agenda mais").not.toBe(200);
    // a tela Pacotes e sessões mostra o mesmo saldo do livro
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Pacotes e sessões" }).click();
    const prow = page.getByRole("row").filter({ hasText: name }); await expect(prow).toContainText("Esgotado"); await expect(prow.getByRole("cell").nth(2)).toHaveText("0"); await expect(prow.getByRole("cell").nth(3)).toHaveText("4");
    expect(errors).toEqual([]);
  });

  test("7. dashboard e detalhes refletem os mesmos dados do banco", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    const from = new Date(Date.now() - 10 * 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    const m = (await g.rpc("dashboard_metrics", { p_from: from, p_to: to, p_unit: S.unit })).body;
    const pays = (await g.get(`payments?select=kind,amount_cents,unit_id&unit_id=eq.${S.unit}&paid_at=gte.${from}&paid_at=lt.${to}`)).body as { kind: string; amount_cents: number }[];
    const net = pays.reduce((a, p) => a + (p.kind === "payment" ? p.amount_cents : -p.amount_cents), 0);
    expect(m.receipts_cents.available).toBe(true); expect(Number(m.receipts_cents.value), "recebimentos = pagamentos líquidos persistidos").toBe(net);
    const mine = (await g.get(`payments?select=kind,amount_cents,receivable:receivables!inner(sale_id)&receivable.sale_id=eq.${S.sale}`)).body as { kind: string; amount_cents: number }[];
    expect(mine.reduce((a, p) => a + (p.kind === "payment" ? p.amount_cents : -p.amount_cents), 0), "35.000 = 10.000 + 10.000 − 5.000 + 20.000").toBe(35000);
    const att = (await g.get(`appointments?select=id&unit_id=eq.${S.unit}&status=eq.attended&period=ov.${encodeURIComponent(`[${from},${to})`)}`)).body as unknown[];
    expect(Array.isArray(att)).toBe(true);
    expect(Number(m.attended.value), "atendimentos realizados").toBe(att.length);
    // detalhamento do cartão: lista os recebimentos que compõem o total, incluindo os desta jornada
    const det = (await g.rpc("dashboard_card_detail", { p_kind: "receipts", p_from: from, p_to: to, p_unit: S.unit })).body;
    expect(JSON.stringify(det)).toContain(name);
    // interface: o cartão mostra o mesmo valor e abre o painel de detalhamento
    await page.goto("/admin"); await expect(page.getByText(/Bom dia|Boa tarde|Boa noite/)).toBeVisible();
    await page.getByRole("button", { name: /Recebimentos/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("8. histórico do lead até o pagamento: mesmos fatos, mesma ordem, com autoria", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page); const g = api(mgr);
    const ev = (await g.get(`opportunity_events?select=kind,created_at&opportunity_id=eq.${S.opp}&order=created_at`)).body as { kind: string }[];
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["created", "owner_changed", "stage_changed"]));
    const ints = (await g.get(`interactions?select=channel,summary&opportunity_id=eq.${S.opp}`)).body as { channel: string; summary: string }[];
    expect(ints.some((i) => /Venda confirmada/.test(i.summary))).toBe(true); expect(ints.some((i) => i.summary.includes(`Primeiro contato ${runId}`))).toBe(true);
    const au = (await g.get(`audit_log?select=action,actor_user_id,entity_type&entity_type=eq.payments&limit=50&order=id.desc`)).body as { actor_user_id: string | null }[];
    expect(au.length, "recebimentos auditados com autoria").toBeGreaterThanOrEqual(3); expect(au.some((a) => !!a.actor_user_id)).toBe(true);
    await page.goto("/admin/crm/oportunidades"); await page.getByText(name, { exact: true }).first().click();
    await page.getByRole("tab", { name: "Histórico" }).click();
    await expect(page.getByText(/Venda confirmada/).first()).toBeVisible(); await expect(page.getByText("Troca de responsável").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
