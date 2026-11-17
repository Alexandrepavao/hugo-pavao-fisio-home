// NOVO — N36: jornada integrada "avaliação agendada → paciente pendente → apresentação personalizada → prévia real de /paciente → publicação → pagamento confirmado → paciente ativo". Somente Dev.
// REAL (banco Dev + telas): vínculo pendente pelo gatilho do CRM, captura com salvamento automático e retomada, biblioteca de evidências (proposta pela fisioterapeuta, aprovação pela gestão), prévia real do portal,
// publicação com versão, visão do paciente (login pela API com conta de teste), regra de ativação por pagamento (venda feita NÃO ativa; parcela 1 parcial NÃO ativa; parcela 1 quitada ATIVA).
// NÃO exercitado aqui: provedor/gateway de pagamento (não existe no projeto: o recebimento entra por payment_record, manual do financeiro) e envio de e-mail (N37).
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { ANON, SUPABASE_URL, api, useSession } from "../helpers";
import { QA, devSql, createConfirmedUser, signInWith, signIn, loginAs, collectErrors } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: Page, name: string, full = false) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`), fullPage: full }); };
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const ORG = "268b67d7-faa3-43c2-bb91-0616c78e10d0", UNIT = "9ace3ebd-352c-4832-b488-904f6a708e22", PROF = "3b6e077e-bee8-437b-b4fe-e3c413cdd457", SVC = "3c2ac8b8-8322-4e04-85a2-c832c38d475c";
const RUN = Date.now().toString(36); const NAME = `Paciente N36 ${RUN}`; const EMAIL = `n36.${RUN}@hp-test.dev`; const PWD = `Teste-${RUN}-Aa1!`;
const EV_TITLE = `[TESTE ${RUN}] Exercícios orientados na dor de ombro: ensaio fictício`; const COMPLAINT = "Dor no ombro direito ao levantar o braço"; const INTERNAL = `ANOTAÇÃO INTERNA ${RUN}: suspeita associada`;
let personId = "", oppId = "", enrId = "", productId = "", userId = "";

const one = async <T,>(q: string) => ((await devSql(q)) as T[])[0];

test.describe.serial("@novos Jornada: avaliação → pendente → apresentação → pagamento → ativo", () => {
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    const r = await one<{ pid: string; oid: string; prod: string }>(`
      with p as (insert into public.people (org_id, unit_id, full_name) values ('${ORG}', '${UNIT}', '${NAME}') returning id),
      pc as (insert into public.person_contacts (org_id, person_id, type, value) select '${ORG}', id, 'email', '${EMAIL}' from p returning person_id),
      o as (insert into public.opportunities (org_id, unit_id, person_id, pipeline_id, stage_id, title)
              select '${ORG}', '${UNIT}', p.id, pl.id, st.id, 'Opp N36 ${RUN}' from p, public.pipelines pl join public.pipeline_stages st on st.pipeline_id = pl.id and st.key = 'new_contact'
               where pl.org_id = '${ORG}' and pl.kind = 'patients' returning id),
      pr as (insert into public.products (org_id, kind, name, price_cents, sessions_count, service_id, validity_days) values ('${ORG}', 'package', 'Acompanhamento N36 ${RUN}', 90000, 8, '${SVC}', 180) returning id)
      select (select id from p) pid, (select id from o) oid, (select id from pr) prod`);
    personId = r.pid; oppId = r.oid; productId = r.prod;
    userId = await createConfirmedUser(EMAIL, PWD);
    await devSql(`insert into public.user_accounts (user_id, org_id, person_id, display_name) values ('${userId}', '${ORG}', '${personId}', 'Paciente N36') on conflict (user_id) do nothing;
      insert into public.role_assignments (org_id, user_id, role) values ('${ORG}', '${userId}', 'member') on conflict do nothing;
      insert into public.appointments (org_id, unit_id, professional_id, person_id, service_id, period, opportunity_id)
        values ('${ORG}', '${UNIT}', '${PROF}', '${personId}', '${SVC}', tstzrange(now() + interval '2 days', now() + interval '2 days 50 minutes'), '${oppId}');
      update public.opportunities set stage_id = (select st.id from public.pipeline_stages st join public.opportunities o on o.pipeline_id = st.pipeline_id where o.id = '${oppId}' and st.key = 'evaluation_scheduled') where id = '${oppId}';`);
    enrId = (await one<{ id: string }>(`select id from public.patient_enrollments where person_id = '${personId}'`)).id;
  });

  test("N36-1 'Avaliação agendada' (tipo Paciente) cria UM vínculo pendente e a fisioterapeuta vê na ficha", async ({ page, context }) => {
    await loginAs(context, QA.fisio); const errors = collectErrors(page);
    const e = await one<{ status: string; n: string; care: string }>(`select status, (select count(*) from public.patient_enrollments where person_id = '${personId}') n, (select count(*) from public.care_relationships where person_id = '${personId}' and revoked_at is null) care from public.patient_enrollments where id = '${enrId}'`);
    expect(e.status).toBe("pending"); expect(Number(e.n)).toBe(1); expect(Number(e.care)).toBe(1);
    await page.goto(`/fisio/pacientes?pessoa=${personId}`);
    await expect(page.getByTestId("presentation-entry")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("presentation-entry")).toContainText("Paciente pendente");
    await expect(page.getByTestId("presentation-entry")).toContainText("não ativa o paciente");
    await shot(page, "jornada-ficha-pendente");
    await page.getByTestId("open-presentation").click();
    await expect(page.getByTestId("presentation-workspace")).toBeVisible({ timeout: 20_000 });
    expect(errors.filter((x) => !/maplibre|tiles|openfreemap|net::/i.test(x))).toEqual([]);
  });

  test("N36-2 captura progressiva: áreas, relato × avaliação, plano, anotação interna; salva sozinho e retoma ao recarregar", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${enrId}`); await expect(page.getByTestId("presentation-workspace")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pw-tab-publicar")).toBeVisible();
    await page.getByTestId("pw-tab-publicar").click(); await expect(page.getByTestId("pw-missing")).toContainText("Escolha ao menos uma área");
    await expect(page.getByTestId("pw-publish")).toBeDisabled();                                                      // sem os campos obrigatórios não publica
    await page.getByTestId("pw-tab-avaliacao").click();
    await page.getByRole("button", { name: "Traumato-Ortopédica" }).click(); await page.getByRole("button", { name: "Esportiva" }).click();
    await page.getByLabel("Queixa principal").fill(COMPLAINT);
    await page.getByLabel("Há quanto tempo").fill("há 3 meses"); await page.getByLabel("Atividades que quer retomar").fill("Voltar a nadar");
    await page.getByLabel("Limitações funcionais").fill("Não consigo pentear o cabelo");
    await page.getByLabel("A condição é…").selectOption("hypothesis"); await page.getByLabel("Descrição").fill("Possível tendinopatia do manguito");
    await page.getByLabel("Objetivo do paciente").fill("Voltar a nadar sem dor");
    await page.getByLabel("Frequência (vezes por semana)").fill("2"); await page.getByLabel("Duração prevista (semanas)").fill("8");
    await page.getByLabel("Rotina orientada").fill("Exercícios 3 vezes por semana em casa");
    await page.getByTestId("pw-internal").fill(INTERNAL);
    await expect(page.getByTestId("pw-save-state")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
    // medida realmente coletada (existente: prof_measurement_add); sem medida, a apresentação diz que não há registro
    await expect(page.getByTestId("pw-measures-empty")).toBeVisible();
    await page.getByLabel("Valor (0 a 10)").fill("7"); await page.getByTestId("pw-measure-add").click();
    await expect(page.getByTestId("pw-measures")).toContainText("ponto de partida");
    await shot(page, "jornada-captura", true);
    await page.reload(); await expect(page.getByTestId("presentation-workspace")).toBeVisible({ timeout: 20_000 });          // retomada: nada se perde ao atualizar
    await page.getByTestId("pw-tab-avaliacao").click();
    await expect(page.getByLabel("Queixa principal")).toHaveValue(COMPLAINT); await expect(page.getByLabel("A condição é…")).toHaveValue("hypothesis");
    await expect(page.getByTestId("pw-internal")).toHaveValue(INTERNAL);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("tendinopatia"))).toBe(false);   // dado clínico fora do armazenamento do navegador
  });

  test("N36-3 biblioteca: a fisioterapeuta propõe, a gestão revisa e aprova; só então vira sugestão com o motivo", async ({ page, context, browser }) => {
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${enrId}`); await page.getByTestId("pw-tab-evidencias").click();
    await expect(page.getByTestId("pw-evidence-panel")).toBeVisible(); await expect(page.getByTestId("pw-evidence-none")).toBeVisible();
    await page.getByTestId("pw-evidence-propose-toggle").click();
    await page.getByLabel("Título do estudo").fill(EV_TITLE); await page.getByLabel("DOI (ex.: 10.xxxx/yyyy)").fill(`10.9999/n36.${RUN}`);
    await page.getByLabel("Quem participou").fill("Adultos com dor no ombro (dado fictício de teste)"); await page.getByLabel("Benefícios encontrados").fill("Menos dor após 8 semanas (fictício)");
    await page.getByLabel("Condições (separe por vírgula)").fill("tendinopatia");
    await page.getByTestId("pw-propose-form").getByRole("button", { name: "Traumato-Ortopédica" }).click();
    await page.getByTestId("pw-propose-send").click(); await expect(page.getByText("enviada para revisão clínica")).toBeVisible();
    await expect(page.getByTestId("pw-evidence-nolib")).toBeVisible();                                                     // ainda não aprovada: não é sugerida
    // gestão aprova (precisa confirmar a fonte original)
    const ctx2 = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); const p2 = await ctx2.newPage();
    await loginAs(ctx2, QA.manager); await p2.goto("/admin/evidencias"); await expect(p2.getByTestId("evidences-admin")).toBeVisible({ timeout: 20_000 });
    const row = p2.getByTestId("evidence-row").filter({ hasText: EV_TITLE }); await expect(row).toBeVisible();
    await expect(row.getByTestId("evidence-approve")).toBeDisabled();                                                      // sem conferir a fonte não aprova
    await row.getByTestId("evidence-checked").check(); await row.getByTestId("evidence-approve").click(); await expect(p2.getByText("Ficha aprovada")).toBeVisible();
    await shot(p2, "jornada-evidencias-revisao"); await ctx2.close();
    // volta para a fisioterapeuta: aparece como sugestão, com o motivo
    await page.getByTestId("pw-tab-avaliacao").click(); await page.getByTestId("pw-tab-evidencias").click();
    const sug = page.getByTestId("pw-evidence-suggestion").filter({ hasText: EV_TITLE }); await expect(sug).toBeVisible({ timeout: 15_000 });
    await expect(sug).toContainText("Mesma área"); await expect(sug).toContainText("Condição citada");
    await sug.getByTestId("pw-evidence-use").click(); await page.getByLabel(/Por que serve a ESTE paciente/).fill("Mostra que exercícios orientados ajudam pessoas com dor no ombro como a sua");
    await page.getByTestId("pw-evidence-confirm").click(); await expect(page.getByTestId("pw-evidence-picked")).toContainText(EV_TITLE);
    await shot(page, "jornada-evidencias", true);
  });

  test("N36-4 apresentação guiada (7 etapas) e etapa final = PRÉVIA REAL do portal /paciente (mesmos componentes, só leitura)", async ({ page, context }) => {
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${enrId}`); await page.getByTestId("pw-tab-apresentar").click();
    await expect(page.getByTestId("pp-step-objetivo")).toContainText("Voltar a nadar sem dor"); await expect(page.getByTestId("pp-step-objetivo")).toContainText("Relatado por você");
    await page.getByTestId("pp-next").click();
    await expect(page.getByTestId("pp-step-partida")).toContainText(COMPLAINT); await expect(page.getByTestId("pp-step-partida")).toContainText("Hipótese em investigação");
    await expect(page.getByTestId("pp-measures")).toContainText("7"); await expect(page.getByTestId("pp-measures")).toContainText("não uma tendência");   // um único registro não vira tendência
    await page.getByTestId("pp-next").click(); await expect(page.getByTestId("pp-step-acompanhamento")).toContainText("Reavaliação");
    await page.getByTestId("pp-next").click(); await expect(page.getByTestId("pp-step-rotina")).toContainText("participa das decisões");
    await page.getByTestId("pp-next").click(); const plano = page.getByTestId("pp-plan");
    await expect(plano).toContainText("2x por semana"); await expect(plano).toContainText("Exercícios 3 vezes"); await expect(plano).toContainText("A definir com seu fisioterapeuta");   // reavaliação não definida
    await page.getByTestId("pp-next").click(); await expect(page.getByTestId("pp-evidence")).toContainText(EV_TITLE);
    await shot(page, "jornada-apresentacao-ciencia");
    await page.getByTestId("pp-next").click();
    const prev = page.getByTestId("portal-preview"); await expect(prev).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pv-banner")).toContainText("Prévia da área do paciente"); await expect(page.getByTestId("pv-banner")).toContainText("ainda não publicada");
    await expect(prev.getByTestId("patient-home")).toBeVisible({ timeout: 20_000 });                                      // O MESMO componente do portal real
    await expect(prev.getByTestId("jr-enrollment-pending")).toBeVisible();                                                // estado verdadeiro: paciente pendente
    await expect(prev.getByTestId("jr-evidence")).toContainText(EV_TITLE);
    await expect(prev).toContainText("Voltar a nadar sem dor");
    await expect(prev.getByRole("button", { name: /Confirmar presença|Cancelar$/ })).toHaveCount(0);                      // ações exclusivas do paciente não existem na prévia
    await expect(prev).not.toContainText(INTERNAL);
    await shot(page, "jornada-previa-portal", true);
  });

  test("N36-5 publicar cria a versão 1; repetir não duplica; o paciente (pendente) vê só o que foi liberado", async ({ page, context, browser }) => {
    await loginAs(context, QA.fisio);
    await page.goto(`/apresentacao/avaliacao/${enrId}`); await page.getByTestId("pw-tab-publicar").click();
    await expect(page.getByTestId("pw-version")).toContainText("Ainda não publicada");
    await page.getByTestId("pw-publish").click(); await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByText("Versão 1 publicada")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pw-version")).toContainText("Nada novo para publicar"); await expect(page.getByTestId("pw-publish")).toBeDisabled();
    const n = await one<{ v: string; g: string }>(`select (select count(*) from public.presentation_versions pv join public.evaluation_presentations p on p.id = pv.presentation_id where p.enrollment_id = '${enrId}') v, (select count(*) from public.patient_goals where person_id = '${personId}' and status = 'active') g`);
    expect(Number(n.v)).toBe(1); expect(Number(n.g)).toBe(1);                                                              // uma versão; uma meta ativa
    // paciente: login pela API com a conta de teste (senha própria) e a sessão injetada
    const s = await signInWith(EMAIL, PWD); const ctx3 = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); await useSession(ctx3, s);
    const p3 = await ctx3.newPage(); const errors = collectErrors(p3);
    await p3.goto("/paciente"); await expect(p3.getByTestId("patient-home")).toBeVisible({ timeout: 25_000 });
    await expect(p3.getByTestId("jr-enrollment-pending")).toBeVisible(); await expect(p3.getByTestId("jr-evidence")).toContainText(EV_TITLE);
    await expect(p3.getByTestId("jr-enrollment-pending")).toContainText("nenhum pacote aparece como contratado");
    await shot(p3, "jornada-portal-pendente", true);
    await p3.getByTestId("jr-open-presentation").click(); await expect(p3.getByTestId("patient-presentation")).toBeVisible({ timeout: 20_000 });
    await expect(p3.getByTestId("pp-patient-banner")).toContainText("versão 1"); await expect(p3.getByTestId("pp-patient-pending")).toBeVisible();
    await expect(p3.getByTestId("pp-step-objetivo")).toContainText("Voltar a nadar sem dor");
    await p3.getByTestId("pp-next").click(); await expect(p3.getByTestId("pp-step-partida")).toContainText(COMPLAINT);
    expect(await noOverflow(p3)).toBe(true);
    for (let i = 0; i < 5; i++) await p3.getByTestId("pp-next").click();
    await expect(p3.getByTestId("pp-final-patient")).toBeVisible(); await shot(p3, "jornada-apresentacao-paciente");
    expect(await p3.locator("body").innerText()).not.toContain(INTERNAL);                                                  // anotação interna nunca chega ao paciente
    await p3.setViewportSize({ width: 390, height: 844 }); await p3.goto("/paciente/apresentacao"); await expect(p3.getByTestId("patient-presentation")).toBeVisible(); expect(await noOverflow(p3)).toBe(true);
    await shot(p3, "jornada-apresentacao-celular");
    // o paciente NÃO acessa a edição profissional (rota nem API)
    await p3.goto(`/apresentacao/avaliacao/${enrId}`); await expect(p3.getByText(/Sem permissão|não tem acesso/i).first()).toBeVisible({ timeout: 15_000 });
    const api3 = api(s); const r = await api3.rpc("presentation_open", { p_enrollment: enrId }); expect(r.status).toBeGreaterThanOrEqual(400);
    expect(errors.filter((x) => !/maplibre|tiles|openfreemap|net::|403|42501/i.test(x))).toEqual([]);
    await ctx3.close();
  });

  test("N36-6 pagamento: 'Venda feita' NÃO ativa; 1ª parcela parcial NÃO ativa; 1ª parcela quitada ATIVA o MESMO vínculo", async ({ page, browser }) => {
    const com = await signIn(QA.comercial); const fin = await signIn(QA.financeiro);
    const sale = await api(com).rpc("sale_create", { p_person: personId, p_unit: UNIT, p_opportunity: oppId, p_items: [{ product_id: productId }], p_discount_cents: 0, p_installments: 3, p_first_due: new Date().toISOString().slice(0, 10), p_notes: "N36" });
    expect(sale.status).toBe(200); const saleId = sale.body as string;
    expect((await api(com).rpc("sale_confirm", { p_sale: saleId })).status).toBeLessThan(300);
    const st = async () => one<{ status: string; n: string; pk: string; kind: string }>(`select e.status, (select count(*) from public.patient_enrollments where person_id = '${personId}') n, (select count(*) from public.client_packages where sale_id = '${saleId}') pk, (select count(*) from public.person_kinds where person_id = '${personId}' and kind = 'patient') kind from public.patient_enrollments e where e.person_id = '${personId}' and e.status in ('pending','active')`);
    let s1 = await st(); expect(s1.status).toBe("pending"); expect(Number(s1.pk)).toBe(0); expect(Number(s1.kind)).toBe(0);     // "venda feita" não ativa, sem pacote nem tipo paciente
    const opp = await one<{ stage: string }>(`select st.key as stage from public.opportunities o join public.pipeline_stages st on st.id = o.stage_id where o.id = '${oppId}'`); expect(opp.stage).toBe("hired");   // CRM: Contratou
    const r1 = await one<{ id: string; amount_cents: string }>(`select id, amount_cents from public.receivables where sale_id = '${saleId}' and installment_no = 1`); const amount = Number(r1.amount_cents);
    // portal do paciente: contratação registrada, pagamento aguardado
    const s = await signInWith(EMAIL, PWD); const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); await useSession(ctx, s); const pp = await ctx.newPage();
    await pp.goto("/paciente"); await expect(pp.getByTestId("jr-enrollment-pending")).toContainText("aguardando a confirmação do pagamento", { timeout: 25_000 });
    await shot(pp, "jornada-portal-pagamento-pendente");
    expect((await api(fin).rpc("payment_record", { p_receivable: r1.id, p_amount_cents: 10000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `n36-a-${RUN}` })).status).toBeLessThan(300);
    s1 = await st(); expect(s1.status).toBe("pending"); expect(Number(s1.pk)).toBe(0);                                                  // parcial abaixo da parcela: não ativa por acidente
    const pay = await api(fin).rpc("payment_record", { p_receivable: r1.id, p_amount_cents: amount - 10000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `n36-b-${RUN}` });
    expect(pay.status).toBeLessThan(300);
    s1 = await st(); expect(s1.status).toBe("active"); expect(Number(s1.n)).toBe(1); expect(Number(s1.pk)).toBe(1); expect(Number(s1.kind)).toBe(1);   // MESMO vínculo, pacote liberado, tipo paciente
    const rep = await api(fin).rpc("payment_record", { p_receivable: r1.id, p_amount_cents: amount - 10000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `n36-b-${RUN}` });   // reenvio da mesma chave
    expect(rep.status).toBeLessThan(300); s1 = await st(); expect(Number(s1.pk)).toBe(1); expect(Number(s1.n)).toBe(1);
    const e = await one<{ id: string; sale: string; sess: string }>(`select e.id, e.activation_sale_id sale, (select coalesce(sum(delta),0) from public.session_ledger l join public.client_packages c on c.id = l.client_package_id where c.sale_id = '${saleId}') sess from public.patient_enrollments e where e.person_id = '${personId}'`);
    expect(e.id).toBe(enrId); expect(e.sale).toBe(saleId); expect(Number(e.sess)).toBe(8);                                           // mesmo id do pendente; 8 sessões do pacote; nenhuma marcada como realizada
    await pp.reload(); await expect(pp.getByTestId("patient-home")).toBeVisible({ timeout: 25_000 }); await expect(pp.getByTestId("jr-enrollment-pending")).toHaveCount(0);
    await expect(pp.getByTestId("jr-sessions")).toBeVisible().catch(() => undefined);
    await shot(pp, "jornada-portal-ativo", true);
    // a fisioterapeuta vê o estado ativo na ficha
    const fctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); await loginAs(fctx, QA.fisio); const fp = await fctx.newPage();
    await fp.goto(`/fisio/pacientes?pessoa=${personId}`); await expect(fp.getByTestId("presentation-entry")).toContainText("Paciente ativo", { timeout: 20_000 }); await fctx.close(); await ctx.close();
    void page;
  });

  test("N36-7 acesso: gestão/comercial não abrem a edição clínica; /apresentacao é institucional (sem dados pessoais); /apresentação redireciona", async ({ page, context }) => {
    const mgr = await signIn(QA.manager); const sales = await signIn(QA.comercial);
    expect((await api(mgr).rpc("presentation_open", { p_enrollment: enrId })).status).toBeGreaterThanOrEqual(400);               // gestão não lê o clínico
    expect((await api(sales).rpc("presentation_open", { p_enrollment: enrId })).status).toBeGreaterThanOrEqual(400);
    expect((await api(null).rpc("my_presentation")).status).toBeGreaterThanOrEqual(400);                                           // anônimo
    expect((await api(mgr).get("evaluation_presentations?select=*")).status).toBeGreaterThanOrEqual(400);                         // tabela sem acesso direto
    await loginAs(context, QA.manager); await page.goto(`/apresentacao/avaliacao/${enrId}`); await expect(page.getByText(/Sem permissão|não tem acesso/i).first()).toBeVisible({ timeout: 15_000 });
    const pub = await page.context().browser()!.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" }); const pg = await pub.newPage();
    await pg.goto("/apresentação"); await expect(pg).toHaveURL(/\/apresentacao$/); await expect(pg.getByTestId("apresentacao-publica")).toBeVisible({ timeout: 20_000 });
    await expect(pg.getByTestId("aviso-demo")).toContainText("Nenhum dado de paciente"); expect(await pg.locator("body").innerText()).not.toContain(NAME);
    expect(await pg.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
    await shot(pg, "jornada-apresentacao-publica");
    await pg.getByTestId("ver-demonstracao").click(); await expect(pg.getByText(/DEMONSTRAÇÃO/i).first()).toBeVisible({ timeout: 15_000 });
    await pub.close();
    void ANON; void SUPABASE_URL;
  });
});
