import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SUPABASE_URL, ANON, PASSWORD, signIn, useSession, type Session } from "../helpers";
import { call, get, haveHarness, mkUser, PLATFORM, sqlDev } from "./helpers-wl";
import { moveAppointment } from "../release/helpers-release";

// @novo — WHITE LABEL: a jornada COMPLETA da Clínica Delta (fictícia), criada SÓ pelo questionário e operada SÓ pelos fluxos normais do app:
// questionário → convite → acesso pelo endereço da organização (/empresa/<slug>) → configuração (serviços, pacote, conta, fisioterapeuta, disponibilidade, regra de repasse) → captação pública (quiz)
// → CRM → avaliação agendada → paciente pendente → apresentação → pagamento → paciente ativo → sessão realizada → financeiro e repasse → isolamento.
// SIMULADO (declarado): o e-mail do convite NÃO é clicado aqui (o envio real foi validado à parte, ver docs); as contas do administrador, da fisioterapeuta e do paciente nascem confirmadas por SQL no Dev
// (equivale a "já confirmaram o e-mail e definiram a senha"). NÃO exercitado: provedor de pagamento (o recebimento entra manualmente pelo Financeiro, com auditoria) e envio de e-mail ao paciente.
// A Delta fica no Dev ao final (para ser aberta e conferida); a execução seguinte remove a anterior (slug exato "delta-fisio").
const SHOTS = "docs/white-label/screenshots/delta"; mkdirSync(SHOTS, { recursive: true });
const ADMIN = "delta.admin@example.test", FISIO = "delta.fisio@example.test", PACIENTE = "delta.paciente@example.test";
const SUB = "delta-fisio";
const NOMEPAC = "Paciente Delta Jornada"; const EMAILPAC = "delta.paciente@example.test"; const FONEPAC = "(11) 98877-6655"; const NOMEFORM = "Lead Formulário Delta"; const EMAILFORM = "delta.formulario@example.test";
const shot = (page: Page, name: string, full = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const advance = async (page: Page, to: number) => { await page.getByTestId("proximo").click(); await expect(page.getByTestId(`step-${to}`)).toBeVisible(); };
const as = async (context: BrowserContext, email: string) => { const s = await signIn(email); await useSession(context, s); return s; };
const spDate = (days: number) => new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const brl = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100).replace(/\s/g, " ");

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 }, actionTimeout: 30_000, trace: "off" });   // vários contextos de navegador por teste: sem trace (os screenshots de falha continuam)
test.describe.serial("@novo White label — jornada completa da Clínica Delta", () => {
  test.afterEach(() => { try { save(); } catch { /* estado só para retomar depuração */ } });
  test.skip(!haveHarness, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  test.setTimeout(240_000);
  let plat: Session; let reqId = ""; let orgId = ""; let slug = ""; let adminS: Session; const tempos: Record<string, unknown> = {}; const S: Record<string, string> = {};

  // N40_RESUME=1 retoma de onde parou (estado da execução anterior em test-results/wl-delta-state.json): só para depurar a jornada sem recriar a Delta
  const STATE = "test-results/wl-delta-state.json";
  const save = () => writeFileSync(STATE, JSON.stringify({ reqId, orgId, slug, S, tempos }));
  test.beforeAll(async () => {
    if (process.env.N40_RESUME && existsSync(STATE)) { const st = JSON.parse(readFileSync(STATE, "utf8")); reqId = st.reqId; orgId = st.orgId; slug = st.slug; Object.assign(S, st.S); Object.assign(tempos, st.tempos); plat = await signIn(PLATFORM); adminS = await signIn(ADMIN); return; }
    for (let i = 0; i < 3; i++) {   // remove a Delta da execução anterior e CONFERE que saiu (com o banco ocupado a primeira tentativa pode não pegar)
      execFileSync("node", ["supabase/tools/wl-limpar-orgs-teste.mjs", SUB], { stdio: "pipe" });
      if (!(await sqlDev<{ n: number }[]>(`select count(*)::int n from public.organizations where slug = '${SUB}'`))[0].n) break;
    }
    expect((await sqlDev<{ n: number }[]>(`select count(*)::int n from public.organizations where slug = '${SUB}'`))[0].n, "a Delta anterior foi removida").toBe(0);
    plat = await signIn(PLATFORM);
  });

  test("1. Delta criada SÓ pelo questionário (interface), com administrador e unidade; o convite do e-mail de teste é contido pela política de destinatários", async ({ page, context }) => {
    await useSession(context, plat); await page.goto("/plataforma/criar");
    await expect(page.getByTestId("step-0")).toBeVisible();
    await page.locator("#q-name").fill("Clínica Delta"); await page.locator("#q-seg").selectOption("fisioterapia");
    await page.locator("#q-rn").fill("Delta Administradora"); await page.locator("#q-re").fill(ADMIN); await page.locator("#q-city").fill("Curitiba"); await page.locator("#q-uf").fill("PR");
    await page.getByLabel("Nome da unidade 1").fill("Sede Curitiba");
    await advance(page, 1);
    await page.locator("#q-serv").fill("Avaliação fisioterapêutica\nFisioterapia ortopédica"); await page.getByLabel("Pacotes de sessões").check(); await advance(page, 2);
    await page.locator("#q-users").fill("3"); await page.getByLabel("Quantidade: Fisioterapeuta").fill("1"); await page.getByLabel("Quantidade: Administrativo").fill("1"); await advance(page, 3);
    await page.getByLabel("Captação de contatos (páginas e formulários)").check(); await advance(page, 4); await advance(page, 5);
    await page.locator("#q-app").fill("Delta Fisioterapia"); await page.locator("#q-c1").fill("#7c3aed"); await page.locator("#q-c2").fill("#16a34a"); await page.locator("#q-sub").fill(SUB);
    await advance(page, 6); await advance(page, 7); await advance(page, 8);
    await expect(page.getByTestId("val-errors")).toHaveCount(0, { timeout: 15_000 });
    const t0 = Date.now(); await page.getByTestId("criar-aplicativo").click();
    await expect(page).toHaveURL(/\/plataforma\/solicitacoes\/[0-9a-f-]{36}/); await expect(page.getByTestId("request-state")).toContainText(/Disponível/, { timeout: 30_000 });
    tempos.provisionamento_clique_ate_disponivel_ms = Date.now() - t0; tempos.provisionamento_internal_ms_exibido = (await page.getByTestId("internal-ms").innerText()).trim();
    reqId = page.url().match(/solicitacoes\/([0-9a-f-]{36})/)![1];
    const g = await call(plat, "provisioning_get", { p_id: reqId }); orgId = g.body.org_id; slug = g.body.org_slug; expect(slug).toBe(SUB);
    await expect(page.getByTestId("endereco-acesso")).toContainText(`/empresa/${slug}`); await shot(page, "01-delta-provisionada");
    // convite: o e-mail de teste (example.test) NÃO é autorizado → nada é enviado e isso fica registrado (nível 1 = pedido; nível 2 = NÃO aceito)
    await page.getByTestId("enviar-convite").click(); await expect(page.getByRole("alert").filter({ hasText: /autorizados|EMAIL_ALLOWED/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("evidencia-acesso")).toBeVisible(); await expect(page.getByTestId("ev-1")).toContainText("sim"); await expect(page.getByTestId("ev-2")).toContainText("falhou"); await expect(page.getByTestId("ev-5")).toContainText("não");
    await shot(page, "02-delta-evidencia-convite-contido");
  });

  test("2. administrador (conta confirmada SIMULADA) entra pelo ENDEREÇO da organização: marca da Delta desde o primeiro quadro, nunca a da HP", async ({ page }) => {
    await mkUser(ADMIN);   // SIMULADO: equivale a "confirmou o e-mail do convite e definiu a senha"; o gatilho vincula o administrador à organização do convite
    const ev = await call(plat, "provisioning_access_evidence", { p_id: reqId }); expect(ev.body["4_link_used"]).toBe(true); expect(ev.body["5_access"]).toMatchObject({ membership: true, manager_role: true });
    const logos: string[] = []; page.on("framenavigated", () => undefined);
    await page.goto(`/empresa/${slug}/login`);
    for (let i = 0; i < 12; i++) { logos.push(String(await page.locator('img[alt="HP Fisioterapia"]').count())); await page.waitForTimeout(100); }
    expect(logos.every((n) => n === "0"), "nenhum quadro mostrou o logotipo da HP").toBe(true);
    await expect(page.getByRole("heading", { name: "Bem-vindo ao Delta Fisioterapia" })).toBeVisible({ timeout: 20_000 }); await expect(page.getByText("HP Group Hub")).toHaveCount(0);
    await shot(page, "03-delta-login-por-endereco");
    // organização desconhecida: uma resposta só, sem marca
    const other = await page.context().newPage(); await other.goto("/empresa/nao-existe-delta/login"); await expect(other.getByTestId("organizacao-indisponivel")).toBeVisible(); await expect(other.getByText("HP Group")).toHaveCount(0); await other.close();
    await page.getByLabel("E-mail").fill(ADMIN); await page.getByLabel("Senha").fill(PASSWORD); await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 }); expect(await page.evaluate(() => sessionStorage.getItem("hp.activeOrg"))).toBe(orgId);
    expect(await page.title()).toBe("Delta Fisioterapia"); await expect(page.getByText(/HP Group/)).toHaveCount(0); await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible(); await shot(page, "04-delta-admin-home");
    adminS = await signIn(ADMIN); tempos.org_id = orgId; tempos.slug = slug;
  });

  test("3. configuração operacional SÓ pelos fluxos normais: serviços, pacote, conta financeira, fisioterapeuta, acesso, disponibilidade e regra de repasse", async ({ page, context }) => {
    await mkUser(FISIO);   // SIMULADO: conta da fisioterapeuta já confirmada (o convite real dela segue o mesmo caminho do administrador)
    await as(context, ADMIN); const t0 = Date.now();
    // serviços e pacote (Configurações)
    await page.goto("/admin/configuracoes");
    await page.getByText("Serviços (duração/preço do atendimento)").locator("xpath=ancestor::div[.//button[normalize-space()='Gerenciar']][1]").getByRole("button", { name: "Gerenciar" }).click();
    for (const [nome, dur, preco] of [["Avaliação Delta", "50", "150,00"], ["Sessão Delta", "50", "200,00"]]) {
      await page.locator("#sv-name").fill(nome); await page.locator("#sv-dur").fill(dur); await page.locator("#sv-price").fill(preco); await page.getByRole("button", { name: "Criar serviço" }).click(); await expect(page.getByText("Serviço criado.")).toBeVisible({ timeout: 20_000 });
    }
    await page.locator("#pr-kind").selectOption("package"); await page.locator("#pr-name").fill("Pacote Delta 8 sessões"); await page.locator("#pr-price").fill("1200,00");
    await page.locator("#pr-svc").selectOption({ label: "Sessão Delta" }); await page.locator("#pr-sess").fill("8"); await page.locator("#pr-val").fill("180"); await page.getByRole("button", { name: "Criar produto" }).click(); await expect(page.getByText("Produto criado.")).toBeVisible({ timeout: 20_000 });
    await shot(page, "05-delta-servicos-e-pacote");
    // conta financeira
    await page.goto("/admin/financeiro/config"); await page.locator("#fa-name").fill("Conta Delta Principal"); await page.locator("#fa-unit").selectOption({ index: 1 }); await page.getByRole("button", { name: "Criar", exact: true }).first().click(); await expect(page.getByText("Criado.").first()).toBeVisible({ timeout: 20_000 });
    // fisioterapeuta (cadastro novo na unidade da Delta) + acesso + disponibilidade
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await page.getByRole("button", { name: "Nova pessoa" }).click(); await page.locator("#pa-name").fill("Dra. Fernanda Delta"); await page.locator("#pa-reg").fill("CREFITO-8 123456-F");
    await page.getByRole("checkbox", { name: "Sede Curitiba" }).check(); await page.getByRole("button", { name: "Cadastrar profissional" }).click();
    const row = page.getByRole("row").filter({ hasText: "Dra. Fernanda Delta" }); await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Liberar acesso" }).click(); await page.locator("#pg-email").fill(FISIO); await page.getByRole("dialog").getByRole("button", { name: "Liberar acesso" }).click();
    await expect(row.getByText("Conta ligada")).toBeVisible({ timeout: 20_000 });
    await page.locator("#rp").selectOption({ label: "Dra. Fernanda Delta" });
    for (let d = 0; d < 7; d++) { await page.locator("#rd").selectOption(String(d)); await page.locator("#rs").fill("07:00"); await page.locator("#re").fill("21:00"); await page.getByRole("button", { name: "Adicionar", exact: true }).click(); await expect(page.getByRole("region", { name: "Disponibilidade semanal" }).getByRole("row")).toHaveCount(d + 2, { timeout: 20_000 }); }   // cabeçalho + uma linha por dia salvo
    await shot(page, "06-delta-fisioterapeuta-disponibilidade");
    // regra de repasse (Financeiro ▸ Comissões ▸ Regras): produto, beneficiária e percentual vêm da regra criada na Delta
    const fis = await signIn(FISIO); S.fisUser = fis.user.id; S.pkg = (await get(adminS, "products?select=id&name=eq.Pacote%20Delta%208%20sess%C3%B5es")).body[0].id;
    await page.goto("/admin/financeiro/comissoes"); await page.getByRole("tab", { name: "Regras de comissão" }).click();
    await page.locator("#crn").fill("Repasse Delta — fisioterapeuta"); await page.locator("#crp").selectOption(S.pkg); await page.locator("#crb").selectOption(S.fisUser); await page.locator("#crv").fill("30");
    await page.getByRole("button", { name: "Criar regra" }).click(); await expect(page.getByText("Regra criada.")).toBeVisible({ timeout: 20_000 });
    await shot(page, "07-delta-regra-de-repasse");
    tempos.configuracao_operacional_ms = Date.now() - t0;
    const prof = (await get(adminS, "professionals?select=id,user_id,display_name")).body; expect(prof).toHaveLength(1); expect(prof[0].user_id).toBe(S.fisUser); S.prof = prof[0].id;
    S.unit = (await get(adminS, "units?select=id&order=name&limit=1")).body[0].id; S.svcEval = (await get(adminS, "services?select=id&name=eq.Avalia%C3%A7%C3%A3o%20Delta")).body[0].id; S.svcSess = (await get(adminS, "services?select=id&name=eq.Sess%C3%A3o%20Delta")).body[0].id;
    expect((await get(adminS, "availability_rules?select=id")).body).toHaveLength(7);
    // nada da HP veio junto: nenhum serviço, produto ou profissional que não seja da Delta
    expect((await get(adminS, "services?select=name")).body.map((x: { name: string }) => x.name).sort()).toEqual(["Avaliação Delta", "Sessão Delta"]);
    expect((await get(adminS, "products?select=name")).body.map((x: { name: string }) => x.name)).toEqual(["Pacote Delta 8 sessões"]);
  });

  test("4. captação pública da Delta: WhatsApp próprio, página/formulário criados no editor e quiz — o lead entra UMA vez no CRM da Delta, com origem e campanha, e em nenhuma outra organização", async ({ page, context, browser }) => {
    await as(context, ADMIN);
    // número de WhatsApp da Delta (Configurações ▸ Captação)
    await page.goto("/admin/configuracoes");
    await page.getByText("Número de WhatsApp por jornada").locator("xpath=ancestor::div[.//button[normalize-space()='Gerenciar']][1]").getByRole("button", { name: "Gerenciar" }).click();
    await page.locator("#wa-phone").fill("5541999990001"); await page.getByRole("button", { name: "Salvar número" }).click(); await expect(page.getByRole("cell", { name: "5541999990001" })).toBeVisible({ timeout: 20_000 });
    // página com formulário criada e publicada NO EDITOR da Delta
    S.pageSlug = "avaliacao-gratuita-delta";
    await page.goto("/admin/paginas"); await page.getByRole("button", { name: "Nova página" }).click(); await page.getByLabel("Endereço (/…)").fill(S.pageSlug);
    await expect(page.getByLabel("Funil de destino")).not.toHaveValue(""); await expect(page.getByLabel("Unidade")).not.toHaveValue("");
    await page.getByRole("button", { name: "Criar e editar" }).click(); await expect(page).toHaveURL(/\/admin\/paginas\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Publicar", exact: true }).click(); await expect(page.getByText("Página publicada.")).toBeVisible({ timeout: 20_000 });
    await shot(page, "08-delta-pagina-publicada-no-editor");
    // visitante anônimo: formulário da página no endereço da Delta (marca e cabeçalho da Delta; nada da HP)
    const v1 = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p1 = await v1.newPage();
    await p1.goto(`/empresa/${slug}/${S.pageSlug}?utm_source=instagram&utm_campaign=delta-form-e2e`);
    await expect(p1.getByTestId("cabecalho-organizacao")).toContainText("Delta Fisioterapia"); await expect(p1.getByText(/HP Fisioterapia|HP Group|Hugo/)).toHaveCount(0);
    await p1.getByRole("textbox", { name: /Nome completo/ }).fill(NOMEFORM); await p1.getByRole("textbox", { name: /WhatsApp/ }).fill("(41) 98888-1122"); await p1.getByRole("textbox", { name: "E-mail" }).fill(EMAILFORM);
    await shot(p1, "09-delta-formulario-publico");
    await p1.getByRole("button", { name: "Enviar" }).click(); await expect(p1.getByText(/Recebemos seus dados/)).toBeVisible({ timeout: 20_000 }); await v1.close();
    // visitante anônimo: quiz de avaliação no endereço da Delta, com atribuição na URL
    const v2 = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }); const p = await v2.newPage();
    await p.goto(`/empresa/${slug}/avaliacao?utm_source=google&utm_medium=cpc&utm_campaign=delta-quiz-e2e`);
    await expect(p.getByTestId("cabecalho-organizacao")).toContainText("Delta Fisioterapia"); await expect(p.getByText(/HP Group|HP Fisioterapia/)).toHaveCount(0);
    await p.getByLabel("Nome completo").fill(NOMEPAC); await p.getByLabel("E-mail", { exact: true }).fill(EMAILPAC); await p.getByLabel("WhatsApp com DDD").fill(FONEPAC);
    await expect(p.getByText(/em nome de Delta Fisioterapia/)).toBeVisible();   // o consentimento cita a organização do endereço, não a HP
    await p.getByRole("checkbox").click(); await shot(p, "10-delta-quiz-contato"); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByLabel("Cidade").fill("São Paulo"); await p.getByLabel("UF").selectOption("SP"); await p.getByLabel("Bairro").fill("Pinheiros"); await p.getByLabel("Zona de São Paulo").selectOption("oeste"); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("button", { name: "Concordo, continuar" }).click();
    for (const label of ["dor ou desconforto", "deseja melhorar", "qualidade de vida melhoraria"]) { await expect(p.getByText(new RegExp(label))).toBeVisible(); await p.getByRole("radio", { name: "5" }).click(); await p.getByRole("button", { name: "Continuar" }).click(); }
    await p.getByRole("radio", { name: "Realizar atividades diárias" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Sim" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Até R$ 250" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("button", { name: "Concluir" }).click(); await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible({ timeout: 30_000 });
    await expect(p.getByRole("button", { name: /WhatsApp/ }).first()).toBeVisible();   // o número é o da Delta
    await shot(p, "11-delta-quiz-concluido"); await v2.close();
    // reenvio do mesmo contato (outro navegador): continua UM lead
    const v3 = await browser.newContext(); const p3 = await v3.newPage(); await p3.goto(`/empresa/${slug}/avaliacao`);
    await p3.getByLabel("Nome completo").fill(NOMEPAC); await p3.getByLabel("E-mail", { exact: true }).fill(EMAILPAC); await p3.getByLabel("WhatsApp com DDD").fill(FONEPAC); await p3.getByRole("checkbox").click(); await p3.getByRole("button", { name: "Continuar" }).click();
    await expect(p3.getByText("Em qual cidade e estado")).toBeVisible(); await v3.close();
    // banco: UM lead, UMA pessoa, UMA oportunidade — só na Delta; origem, campanha e consentimento preservados
    const q = await sqlDev<{ org: string; n: number }[]>(`select p.org_id::text org, count(distinct p.id)::int n from public.people p join public.person_contacts c on c.person_id = p.id where c.value in ('${EMAILPAC}', '${EMAILFORM}') group by p.org_id`);
    expect(q).toEqual([{ org: orgId, n: 2 }]);
    const l = await sqlDev<{ org_id: string; contact_consent_version: string; utm: Record<string, string>; person_id: string; opportunity_id: string }[]>(`select org_id::text, contact_consent_version, utm, person_id::text, opportunity_id::text from public.quiz_leads where email = '${EMAILPAC}'`);
    expect(l).toHaveLength(1); expect(l[0].org_id).toBe(orgId); expect(l[0].contact_consent_version).toBe("contact-v1-org"); expect(l[0].utm).toMatchObject({ utm_source: "google", utm_campaign: "delta-quiz-e2e" }); S.person = l[0].person_id; S.opp = l[0].opportunity_id;
    const o = await sqlDev<{ source: string; campaign: string }[]>(`select source, campaign from public.opportunities where org_id = '${orgId}' order by created_at`);
    expect(o.map((x) => x.source).sort()).toEqual([`page:${S.pageSlug}`, "quiz:atendimento"].sort()); expect(o.find((x) => x.source.startsWith("page:"))!.campaign).toBe("delta-form-e2e");
    // CRM da Delta pela interface: cada lead aparece uma vez; nas outras organizações, nenhuma
    await page.goto("/admin/crm/leads"); await expect(page.getByRole("row").filter({ hasText: NOMEPAC })).toHaveCount(1, { timeout: 30_000 }); await expect(page.getByRole("row").filter({ hasText: NOMEFORM })).toHaveCount(1); await shot(page, "12-delta-crm-leads");
    for (const email of ["alfa.admin@example.test", "beta.admin@example.test", "qa.manager@hp-test.dev"]) {
      const s = await signIn(email); const r = await get(s, `person_contacts?select=person_id&normalized=in.(${EMAILPAC},${EMAILFORM})`); expect(r.body, `${email} não enxerga os leads da Delta`).toEqual([]);
    }
    const outras = await sqlDev<{ n: number }[]>(`select count(*)::int n from public.quiz_leads where email in ('${EMAILPAC}', '${EMAILFORM}') and org_id <> '${orgId}'`); expect(outras[0].n).toBe(0);
    tempos.captacao_leads = 2;
  });

  test("5. avaliação agendada pela agenda da Delta: o lead vira paciente PENDENTE (um só vínculo, mesma pessoa, sem duplicar cadastro nem oportunidade)", async ({ page, context }) => {
    await as(context, ADMIN);
    S.day = spDate(2);
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(S.day); await page.locator("#ap").selectOption(S.prof); await page.locator("#as").selectOption(S.svcEval);
    await page.locator("#apn").fill(NOMEPAC); await page.getByRole("button", { name: NOMEPAC, exact: true }).click();
    const sel = page.locator("#ash"); await expect.poll(async () => (await sel.locator("option").count())).toBeGreaterThan(1);
    const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)); await sel.selectOption(opts[0]);
    await page.locator("#aop").selectOption(S.opp);
    await page.getByRole("button", { name: "Agendar", exact: true }).click(); await expect(page.getByText("Agendamento criado.")).toBeVisible({ timeout: 20_000 });
    await shot(page, "13-delta-avaliacao-agendada");
    // o funil já reflete a avaliação agendada (agendar com a oportunidade move a etapa; a opção fica desabilitada no menu)
    const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
    await page.goto("/admin/crm/oportunidades"); await page.waitForTimeout(1500); if (!(await page.getByRole("region", { name: "Quadro do funil" }).count())) console.log("FUNIL-ERROS", JSON.stringify(errs));
    await expect(page.getByRole("region", { name: "Quadro do funil" })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Avaliação agendada/ }).getByText(NOMEPAC)).toBeVisible({ timeout: 20_000 }); await shot(page, "13b-delta-funil-avaliacao-agendada");
    const e = await sqlDev<{ status: string; n: number; care: number; pessoas: number; opps: number }[]>(`select (select status from public.patient_enrollments where person_id = '${S.person}' limit 1) status, (select count(*)::int from public.patient_enrollments where person_id = '${S.person}') n,
      (select count(*)::int from public.care_relationships where person_id = '${S.person}' and revoked_at is null) care, (select count(distinct p.id)::int from public.people p join public.person_contacts c on c.person_id = p.id where c.value = '${EMAILPAC}') pessoas,
      (select count(*)::int from public.opportunities where person_id = '${S.person}') opps`);
    expect(e[0]).toMatchObject({ status: "pending", n: 1, care: 1, pessoas: 1, opps: 1 });
    S.enr = (await sqlDev<{ id: string }[]>(`select id::text from public.patient_enrollments where person_id = '${S.person}'`))[0].id;
    S.appt = (await sqlDev<{ id: string }[]>(`select id::text from public.appointments where person_id = '${S.person}'`))[0].id;
  });

  test("6. apresentação personalizada pela fisioterapeuta da Delta: captura, prévia real do portal e publicação — sem evidências nem dados da HP", async ({ page, context }) => {
    await as(context, FISIO);
    await page.goto(`/fisio/pacientes?pessoa=${S.person}`); await expect(page.getByTestId("presentation-entry")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("presentation-entry")).toContainText("Paciente pendente"); await expect(page.getByTestId("presentation-entry")).toContainText("não ativa o paciente");
    await page.getByTestId("open-presentation").click(); await expect(page.getByTestId("presentation-workspace")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Traumato-Ortopédica" }).click();
    await page.getByLabel("Queixa principal").fill("Dor no ombro direito ao levantar o braço"); await page.getByLabel("Há quanto tempo").fill("há 3 meses"); await page.getByLabel("Atividades que quer retomar").fill("Voltar a nadar");
    await page.getByLabel("Limitações funcionais").fill("Não consigo pentear o cabelo"); await page.getByLabel("A condição é…").selectOption("hypothesis"); await page.getByLabel("Descrição").fill("Possível tendinopatia do manguito");
    await page.getByLabel("Objetivo do paciente").fill("Voltar a nadar sem dor"); await page.getByLabel("Frequência (vezes por semana)").fill("2"); await page.getByLabel("Duração prevista (semanas)").fill("8");
    await page.getByLabel("Rotina orientada").fill("Exercícios 3 vezes por semana em casa"); await page.getByTestId("pw-internal").fill("ANOTAÇÃO INTERNA DELTA: não aparece ao paciente");
    await expect(page.getByTestId("pw-save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await page.getByLabel("Valor (0 a 10)").fill("7"); await page.getByTestId("pw-measure-add").click(); await expect(page.getByTestId("pw-measures")).toContainText("ponto de partida");
    await shot(page, "14-delta-apresentacao-captura", true);
    // biblioteca de evidências: a Delta NÃO herda as fichas da HP
    await page.getByTestId("pw-tab-evidencias").click(); await expect(page.getByTestId("pw-evidence-panel")).toBeVisible(); await expect(page.getByTestId("pw-evidence-suggestion")).toHaveCount(0); await expect(page.getByTestId("pw-evidence-none")).toBeVisible();
    // apresentação guiada e prévia REAL do portal
    await page.getByTestId("pw-tab-apresentar").click(); await expect(page.getByTestId("pp-step-objetivo")).toContainText("Voltar a nadar sem dor");
    for (let i = 0; i < 4; i++) await page.getByTestId("pp-next").click();
    await expect(page.getByTestId("pp-plan")).toContainText("2x por semana");
    await page.getByTestId("pp-next").click(); await page.getByTestId("pp-next").click();
    const prev = page.getByTestId("portal-preview"); await expect(prev).toBeVisible({ timeout: 30_000 }); await expect(page.getByTestId("pv-banner")).toContainText("Prévia da área do paciente");
    await expect(prev.getByTestId("jr-enrollment-pending")).toBeVisible({ timeout: 20_000 }); await expect(prev).not.toContainText("ANOTAÇÃO INTERNA"); await shot(page, "15-delta-previa-portal", true);
    // publicar cria a versão 1; repetir não duplica
    await page.getByTestId("pw-tab-publicar").click(); await page.getByTestId("pw-publish").click(); await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByText("Versão 1 publicada")).toBeVisible({ timeout: 20_000 }); await expect(page.getByTestId("pw-publish")).toBeDisabled();
    const n = await sqlDev<{ v: number; g: number }[]>(`select (select count(*)::int from public.presentation_versions pv join public.evaluation_presentations p on p.id = pv.presentation_id where p.enrollment_id = '${S.enr}') v, (select count(*)::int from public.patient_goals where person_id = '${S.person}') g`);
    expect(n[0]).toEqual({ v: 1, g: 1 });
    // a apresentação e a prévia NÃO misturam demonstração institucional com dado real: o rótulo de prévia/real vem da própria interface
    const ev = await sqlDev<{ n: number }[]>(`select count(*)::int n from public.evidence_library where org_id = '${orgId}'`).catch(() => [{ n: 0 }]); expect(ev[0].n).toBe(0);
  });

  test("7. paciente PENDENTE recebe o acesso ao portal (convite pelo servidor; clique no link e senha SIMULADOS), entra pelo endereço da Delta e vê só o que é dele", async ({ page, browser }) => {
    const phys = await signIn(FISIO);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/patient-invite`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${phys.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ person_id: S.person }) });
    const inv = await r.json().catch(() => ({})); tempos.convite_paciente = { http: r.status, status: inv.status };
    expect(["sent", "linked"], JSON.stringify(inv)).toContain(inv.status);   // "sent" = o Auth aceitou o pedido; o e-mail de teste (example.test) é contido pela política de destinatários (nada sai)
    const evt = await sqlDev<{ purpose: string; state: string }[]>(`select purpose, state from private.email_events where org_id = '${orgId}' and purpose like 'auth:%' order by created_at desc limit 3`); expect(evt.some((x) => x.state === "suppressed")).toBe(true);
    // SIMULADO: o paciente "abriu o link e definiu a senha" (confirmação + senha por SQL); o gatilho do banco vincula a conta ao convite aberto
    await sqlDev(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), encrypted_password = crypt('${PASSWORD.replace(/'/g, "''")}', gen_salt('bf')), updated_at = now() where lower(email) = '${EMAILPAC}'`);
    const vinculo = await sqlDev<{ conf: boolean; ua: number; mem: number; roles: number; inv: string }[]>(`select u.email_confirmed_at is not null conf, (select count(*)::int from public.user_accounts a where a.user_id = u.id) ua, (select count(*)::int from public.org_memberships m where m.user_id = u.id and m.org_id = '${orgId}') mem,
      (select count(*)::int from public.role_assignments r where r.user_id = u.id and r.org_id = '${orgId}') roles, (select coalesce(string_agg(i.role::text || ':' || (i.accepted_at is not null)::text, ','), '-') from public.invitations i where lower(i.email::text) = lower(u.email) and i.org_id = '${orgId}') inv from auth.users u where lower(u.email) = '${EMAILPAC}'`);
    expect(vinculo[0], `vínculo do paciente: ${JSON.stringify(vinculo)}`).toMatchObject({ conf: true, ua: 1, mem: 1, roles: 1 });
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto(`/empresa/${slug}/login`); await expect(p.getByRole("heading", { name: "Bem-vindo ao Delta Fisioterapia" })).toBeVisible({ timeout: 20_000 });
    await p.getByLabel("E-mail").fill(EMAILPAC); await p.getByLabel("Senha").fill(PASSWORD); await p.getByRole("button", { name: "Entrar" }).click();
    await expect(p.getByTestId("tutorial-comecar")).toBeVisible({ timeout: 40_000 });   // primeiro login: tutorial (marca da Delta; sem Academy, que a Delta não contratou)
    await expect(p.getByText("Academy")).toHaveCount(0); await expect(p.locator('img[alt="HP Fisioterapia"]')).toHaveCount(0); await shot(p, "16a-delta-tutorial-paciente-celular");
    await p.getByTestId("tutorial-comecar").click(); await expect(p).toHaveURL(/\/paciente/, { timeout: 40_000 }); await expect(p.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
    await expect(p.getByTestId("jr-enrollment-pending")).toBeVisible({ timeout: 20_000 }); await expect(p.getByText("Voltar a nadar sem dor").first()).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "sem rolagem horizontal no celular").toBe(true);
    await shot(p, "16-delta-portal-paciente-pendente-celular", true);
    // o paciente enxerga só a própria pessoa (nenhum outro paciente da Delta, nenhum da HP)
    const ps = await signIn(EMAILPAC); const pe = await get(ps, "people?select=id,full_name"); expect(pe.body.map((x: { full_name: string }) => x.full_name)).toEqual([NOMEPAC]);
    expect((await get(ps, "sales?select=id")).body).toEqual([]); expect((await get(ps, "commission_entries?select=id")).status === 200 ? (await get(ps, "commission_entries?select=id")).body : []).toEqual([]);
    await ctx.close();
  });

  test("8. venda e pagamento: 'Venda feita' NÃO ativa; parcela parcial NÃO ativa; estorno gera repasse negativo; 1ª parcela quitada ATIVA; reenvio, organização errada e estorno conforme as regras", async ({ page, context }) => {
    await as(context, ADMIN); const g = adminS;
    await page.goto("/admin/crm/oportunidades"); await page.getByText(NOMEPAC, { exact: true }).first().click(); await page.getByRole("link", { name: "Converter em venda" }).click();
    await expect(page).toHaveURL(/\/admin\/financeiro\/vendas\?venda=/); await expect(page.getByText("Venda originada de uma oportunidade")).toBeVisible();
    await page.locator("#pr").selectOption(S.pkg); await page.locator("#in").fill("2"); await page.locator("#fd").fill(spDate(0));
    await page.getByRole("button", { name: "Criar venda" }).click(); await expect(page.getByText(/Venda criada como pendente/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("row").filter({ hasText: NOMEPAC }).getByRole("button", { name: "Confirmar" }).click(); await expect(page.getByText(/Venda confirmada/)).toBeVisible({ timeout: 20_000 });
    const st = async () => (await sqlDev<{ enr: string; pk: number; rec: number; pay: number; ent: number; net: number }[]>(`select (select status from public.patient_enrollments where person_id = '${S.person}') enr, (select count(*)::int from public.client_packages where org_id = '${orgId}') pk,
      (select count(*)::int from public.receivables where org_id = '${orgId}') rec, (select count(*)::int from public.payments where org_id = '${orgId}') pay, (select count(*)::int from public.commission_entries where org_id = '${orgId}') ent,
      (select coalesce(sum(amount_cents), 0)::int from public.commission_entries where org_id = '${orgId}') net`))[0];
    S.sale = (await sqlDev<{ id: string }[]>(`select id::text from public.sales where person_id = '${S.person}'`))[0].id;
    let s = await st(); expect(s).toMatchObject({ enr: "pending", pk: 0, rec: 2, pay: 0, ent: 0 });     // venda confirmada, nada recebido: continua pendente e sem pacote
    await shot(page, "17-delta-venda-confirmada-sem-pagamento");
    // pagamento PARCIAL de R$ 100,00 (duplo clique): um recebimento, um repasse de R$ 30,00; paciente segue pendente
    const row = (n: string) => page.getByRole("row").filter({ hasText: NOMEPAC }).filter({ has: page.getByRole("cell", { name: n, exact: true }) });
    const abaReceb = async () => { await page.getByRole("tab", { name: "Recebíveis e recebimentos" }).click(); };
    await abaReceb(); await row("1/2").getByRole("button", { name: "Receber" }).click(); await page.locator("#pa").fill("100,00"); await page.getByRole("button", { name: "Registrar" }).dblclick(); await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    s = await st(); expect(s).toMatchObject({ enr: "pending", pk: 0, pay: 1, ent: 1, net: 3000 });
    // reenvio do MESMO evento (mesma chave de idempotência): nada muda
    const rec1 = (await sqlDev<{ id: string; k: string }[]>(`select r.id::text, p.idempotency_key k from public.receivables r join public.payments p on p.receivable_id = r.id where r.sale_id = '${S.sale}' and r.installment_no = 1`))[0]; S.rec1 = rec1.id;
    const again = await call(g, "payment_record", { p_receivable: rec1.id, p_amount_cents: 10000, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: rec1.k }, orgId);
    expect(again.status, JSON.stringify(again.body)).toBeLessThan(300); s = await st(); expect(s).toMatchObject({ pay: 1, ent: 1, net: 3000, enr: "pending" });
    // pagamento vinculado à organização ERRADA: a gestora da Alfa não registra recebimento da Delta; o gestor da HP também não
    for (const email of ["alfa.admin@example.test", "qa.manager@hp-test.dev"]) { const o = await signIn(email); const x = await call(o, "payment_record", { p_receivable: rec1.id, p_amount_cents: 500, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `errada-${email}` }); expect(x.status, `${email}: ${JSON.stringify(x.body)}`).toBeGreaterThanOrEqual(400); }
    s = await st(); expect(s).toMatchObject({ pay: 1, ent: 1, net: 3000 });
    // ESTORNO PARCIAL de R$ 40,00 (conforme a regra atual: lançamento negativo proporcional; o paciente continua pendente). Obs.: estornar o valor INTEIRO de uma parcela a marca como "estornada" e a tela não permite receber de novo (comportamento já existente, não alterado aqui).
    await page.reload(); await abaReceb(); await page.getByRole("row").filter({ hasText: "Recebimento" }).filter({ hasText: "R$ 100,00" }).first().getByRole("button", { name: "Estornar" }).click();
    await page.locator("#ask-input").fill("40,00"); await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click(); await page.locator("#ask-input").fill("Estorno de teste Delta"); await page.getByRole("dialog").getByRole("button", { name: "Estornar" }).click();
    await expect(async () => { s = await st(); expect(s).toMatchObject({ ent: 2, net: 1800, enr: "pending", pk: 0 }); }).toPass({ timeout: 20_000 });
    // 1ª parcela QUITADA (restante de R$ 540,00): o paciente fica ATIVO e o pacote de 8 sessões é liberado; repasse líquido de R$ 180,00 (30% de R$ 600,00 recebidos)
    await page.reload(); await abaReceb(); await row("1/2").getByRole("button", { name: "Receber" }).click(); await expect(page.locator("#pa")).toHaveValue("540,00"); await page.getByRole("button", { name: "Registrar" }).click(); await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    await expect(async () => { s = await st(); expect(s).toMatchObject({ enr: "active", pk: 1, ent: 3, net: 18000 }); }).toPass({ timeout: 20_000 });
    const pk = (await sqlDev<{ total: number; saldo: number }[]>(`select total_sessions total, (select coalesce(sum(delta), 0)::int from public.session_ledger l where l.client_package_id = c.id) saldo from public.client_packages c where org_id = '${orgId}'`))[0]; expect(pk).toMatchObject({ total: 8, saldo: 8 });
    await shot(page, "18-delta-pagamento-quitou-primeira-parcela");
    tempos.ativacao_apos_pagamento = "paciente pendente → ativo somente com a 1ª parcela quitada (parcial e estornada não ativam)";
  });

  test("9. sessão agendada e realizada pelos fluxos normais: consome UMA sessão só quando a fisioterapeuta registra o comparecimento", async ({ page, context }) => {
    await as(context, ADMIN); S.day2 = spDate(3);
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(S.day2); await page.locator("#ap").selectOption(S.prof); await page.locator("#as").selectOption(S.svcSess);
    await page.locator("#apn").fill(NOMEPAC); await page.getByRole("button", { name: NOMEPAC, exact: true }).click();
    const sel = page.locator("#ash"); await expect.poll(async () => (await sel.locator("option").count())).toBeGreaterThan(1);
    const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)); await sel.selectOption(opts[0]);
    await page.locator("#apk").selectOption({ index: 1 }); await page.getByRole("button", { name: "Agendar", exact: true }).click(); await expect(page.getByText("Agendamento criado.")).toBeVisible({ timeout: 20_000 });
    S.sess = (await sqlDev<{ id: string }[]>(`select id::text from public.appointments where person_id = '${S.person}' and service_id = '${S.svcSess}'`))[0].id;
    const used = async () => (await sqlDev<{ n: number }[]>(`select count(*)::int n from public.session_ledger where org_id = '${orgId}' and reason = 'consume'`))[0].n;
    expect(await used(), "agendar não consome sessão").toBe(0);
    // antes do horário o servidor recusa o comparecimento (a presença NÃO é automática nem antecipada)
    const phys = await signIn(FISIO); const early = await call(phys, "set_appointment_status", { p_id: S.sess, p_status: "attended", p_reason: null }, orgId); expect(early.status).toBeGreaterThanOrEqual(400);
    // o tempo passa (Dev): a sessão ocorreu ontem; a fisioterapeuta registra o comparecimento pela interface
    const past = spDate(-1); await moveAppointment(S.sess, `${past}T10:00:00-03:00`);
    const pc = await page.context().browser()!.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); const pp = await pc.newPage(); await useSession(pc, phys);
    await pp.goto("/admin/agenda"); await pp.locator("#pf-unit").selectOption(S.unit); await pp.locator("#pf-day").fill(past);
    // a agenda da fisioterapeuta não mostra o nome do paciente (a pessoa só é lida por funções com vínculo assistencial; mesmo comportamento da HP): a linha é achada pelo serviço e pelo dia
    await pp.getByRole("row").filter({ hasText: "Sessão Delta" }).filter({ hasText: "Agendado" }).getByRole("button", { name: "Compareceu" }).click(); await expect(pp.getByText("Status atualizado.")).toBeVisible({ timeout: 20_000 });
    await shot(pp, "19-delta-sessao-realizada"); await pc.close();
    const r = await sqlDev<{ st: string; consumed: number; remaining: number }[]>(`select (select status from public.appointments where id = '${S.sess}') st, (select count(*)::int from public.session_ledger where org_id = '${orgId}' and reason = 'consume') consumed,
      (select coalesce(sum(delta), 0)::int from public.session_ledger where org_id = '${orgId}') remaining`);
    expect(r[0]).toMatchObject({ st: "attended", consumed: 1, remaining: 7 });
    // marcar de novo (retentativa) não consome outra sessão
    await call(phys, "set_appointment_status", { p_id: S.sess, p_status: "attended", p_reason: null }, orgId); expect((await sqlDev<{ n: number }[]>(`select count(*)::int n from public.session_ledger where org_id = '${orgId}' and reason = 'consume'`))[0].n).toBe(1);
    // portal do paciente (celular) mostra o acompanhamento ativo e o histórico
    const pcx = await page.context().browser()!.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 } }); const pa = await pcx.newPage(); await useSession(pcx, await signIn(EMAILPAC));
    await pa.goto("/paciente"); await expect(pa.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 }); await expect(pa.getByTestId("jr-enrollment-pending")).toHaveCount(0); await shot(pa, "20-delta-portal-paciente-ativo-celular", true); await pcx.close();
  });

  test("10. financeiro e repasse: receita, caixa, repasse provisionado e repasse pago são coisas diferentes; valor positivo visível ao gestor e à fisioterapeuta, vindo da regra da Delta", async ({ page, context }) => {
    await as(context, ADMIN);
    const n = async (q: string) => (await sqlDev<{ v: number }[]>(q))[0].v;
    // receita contratada (venda confirmada) × caixa (recebido líquido de estornos) × repasse provisionado/pago
    const receita = await n(`select coalesce(sum(total_cents), 0)::int v from public.sales where org_id = '${orgId}' and status = 'confirmed'`);
    const caixa = await n(`select coalesce(sum(case when kind = 'refund' then -amount_cents else amount_cents end), 0)::int v from public.payments where org_id = '${orgId}'`);
    expect({ receita, caixa }).toEqual({ receita: 120000, caixa: 60000 });                                                          // contratado R$ 1.200,00; efetivamente recebido R$ 600,00
    // gestor: lançamentos da regra (R$ 30,00, −R$ 12,00 e R$ 162,00); autoriza e paga o de R$ 162,00 pela tela (o de R$ 30,00 continua pendente e o negativo, estornado)
    await page.goto("/admin/financeiro/comissoes"); const rule = "Repasse Delta — fisioterapeuta";
    const r162 = page.getByRole("row").filter({ hasText: rule }).filter({ hasText: "R$ 162,00" }); await expect(r162).toHaveCount(1, { timeout: 30_000 });
    await expect(r162).toContainText("30,00%"); await expect(r162).toContainText("Pendente"); await expect(page.getByRole("row").filter({ hasText: rule }).filter({ hasText: "R$ 30,00" }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: rule }).filter({ hasText: "12,00" }).first()).toBeVisible();      // estorno proporcional (negativo)
    await shot(page, "21-delta-comissoes-pendentes");
    await r162.getByRole("button", { name: "Autorizar" }).click(); await expect(r162).toContainText("Autorizada", { timeout: 20_000 });
    await r162.getByRole("button", { name: "Marcar paga" }).click(); await expect(r162).toContainText("Paga", { timeout: 20_000 });
    await shot(page, "22-delta-comissao-paga");
    const sum = (await call(await signIn(FISIO), "my_professional_summary", { p_from: spDate(-30), p_to: spDate(1) }, orgId)).body.payouts;
    expect(sum, JSON.stringify(sum)).toMatchObject({ visible: true, pending_cents: 3000, reversed_cents: -1200, paid_cents: 16200, net_cents: 18000 });   // pendente R$ 30,00 (aguarda autorização); estornado −R$ 12,00; pago R$ 162,00; líquido R$ 180,00 = 30% de R$ 600,00 recebidos
    // fisioterapeuta: o próprio repasse, sem o nome do paciente
    const pc = await page.context().browser()!.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); const pp = await pc.newPage(); await useSession(pc, await signIn(FISIO));
    await pp.goto("/admin/meu-resumo?periodo=mes"); await expect(pp.getByRole("heading", { name: "Meu resumo" }).first()).toBeVisible({ timeout: 40_000 });
    const card = (label: string) => pp.getByRole("listitem").filter({ has: pp.getByText(label, { exact: true }) }).locator(".hp-kpi-value");
    await expect(card("Repasses pagos")).toContainText("162,00"); await expect(card("Líquido do período")).toContainText("180,00");
    await expect(pp.getByText(NOMEPAC)).toHaveCount(0); await shot(pp, "23-delta-meu-resumo-fisioterapeuta", true);
    // a fisioterapeuta não autoriza nem paga o próprio repasse e não abre o Financeiro
    const ids = await sqlDev<{ id: string }[]>(`select id::text from public.commission_entries where org_id = '${orgId}'`); const f = await signIn(FISIO);
    for (const { id } of ids) expect((await call(f, "commission_set_status", { p_entry: id, p_status: "paid" }, orgId)).status).toBeGreaterThanOrEqual(400);
    await pp.goto("/admin/financeiro/comissoes"); await expect(pp.getByRole("heading", { name: "Comissões e repasses" })).toHaveCount(0); await pc.close();
    tempos.financeiro = { receita_contratada: brl(receita), caixa_liquido: brl(caixa), repasse_pendente: brl(sum.pending_cents), repasse_estornado: brl(sum.reversed_cents), repasse_pago: brl(sum.paid_cents), repasse_liquido: brl(sum.net_cents) };
  });

  test("11. isolamento em toda a jornada: leitura e escrita cruzadas (interface, API direta, x-org forjado, anônimo) — nada da Delta vaza e nada entra nela", async () => {
    const outros = ["alfa.admin@example.test", "beta.admin@example.test", "qa.manager@hp-test.dev"]; const tabelas = ["people", "person_contacts", "opportunities", "appointments", "sales", "receivables", "payments", "commission_entries", "client_packages", "patient_enrollments", "evaluation_presentations", "services", "products", "professionals", "pages", "forms", "form_submissions", "financial_accounts", "availability_rules"];
    for (const email of outros) {
      const s = await signIn(email);
      for (const t of tabelas) {   // sem x-org: só a organização do usuário; nenhuma linha da Delta
        const r = await get(s, `${t}?select=org_id&org_id=eq.${orgId}&limit=1`); expect(r.status === 200 ? r.body : [], `${email} lê ${t} da Delta`).toEqual([]);
        const f = await get(s, `${t}?select=org_id&limit=1`, orgId); expect([401, 403, 404].includes(f.status) || (f.status === 200 && f.body.length === 0), `${email} com x-org forjado lê ${t}: HTTP ${f.status}`).toBe(true);   // x-org da Delta sem vínculo: recusado
      }
      // escritas cruzadas
      const w1 = await fetch(`${SUPABASE_URL}/rest/v1/services`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${s.access_token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify({ org_id: orgId, name: `Intruso ${email}`, duration_min: 30, price_cents: 100 }) }); expect(w1.status, `${email} cria serviço na Delta`).toBeGreaterThanOrEqual(400);
      const w2 = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${S.pkg}`, { method: "PATCH", headers: { apikey: ANON, authorization: `Bearer ${s.access_token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify({ price_cents: 1 }) }); const b2 = await w2.json().catch(() => []); expect(w2.status >= 400 || (Array.isArray(b2) && b2.length === 0), `${email} altera produto da Delta`).toBe(true);
      const c1 = await call(s, "sale_confirm", { p_sale: S.sale }); expect(c1.status, `${email} confirma venda da Delta`).toBeGreaterThanOrEqual(400);
      const c2 = await call(s, "set_appointment_status", { p_id: S.sess, p_status: "cancelled_by_clinic", p_reason: null }); expect(c2.status, `${email} muda atendimento da Delta`).toBeGreaterThanOrEqual(400);
      const c3 = await call(s, "portal_access_state", { p_person: S.person }); expect(c3.status, `${email} lê acesso do paciente da Delta (achado do N40: corrigido na migration 147)`).toBeGreaterThanOrEqual(400);
      const c4 = await call(s, "person_portal_access", { p_person: S.person, p_email: EMAILPAC }); expect(c4.status, `${email} convida paciente da Delta`).toBeGreaterThanOrEqual(400);
    }
    // a Delta não enxerga nada de fora
    const d = await signIn(ADMIN); const ppl = await get(d, "people?select=full_name"); expect(ppl.body.every((x: { full_name: string }) => [NOMEPAC, NOMEFORM, "Dra. Fernanda Delta"].includes(x.full_name)), "pessoas da Delta são só as da Delta").toBe(true);
    for (const t of ["opportunities", "appointments", "sales", "payments", "commission_entries"]) { const r = await sqlDev<{ n: number }[]>(`select count(*)::int n from public.${t} where org_id <> '${orgId}' and org_id in (select id from public.organizations where slug = 'hp-group')`); void r; }
    expect((await get(d, "mkt_campaigns?select=id&limit=1")).status, "módulo Marketing não contratado: bloqueado no servidor").toBe(403);
    const hp = (await get(d, "organizations?select=slug")).body.map((x: { slug: string }) => x.slug); expect(hp).toEqual([SUB]);
    // anônimo: nada listável; formulário da Delta não serve para a HP (sem slug) nem para outra organização
    expect((await get(null, "people?select=id&limit=1")).status).toBeGreaterThanOrEqual(400); expect((await get(null, "quiz_leads?select=id&limit=1")).status).toBeGreaterThanOrEqual(400);
    const form = (await sqlDev<{ id: string }[]>(`select id::text from public.forms where org_id = '${orgId}' limit 1`))[0].id;
    const semSlug = await call(null, "submit_public_form", { p_form_id: form, p_answers: { name: "Intruso Teste", email: "intruso.delta@example.test" }, p_utm: {}, p_honeypot: null, p_referrer: null }); expect(semSlug.status).toBeGreaterThanOrEqual(400);
    const outraOrg = await call(null, "submit_public_form", { p_form_id: form, p_answers: { name: "Intruso Teste", email: "intruso.delta@example.test" }, p_utm: {}, p_honeypot: null, p_referrer: null, p_org_slug: "clinica-alfa" }); expect(outraOrg.status).toBeGreaterThanOrEqual(400);
    expect((await sqlDev<{ n: number }[]>(`select count(*)::int n from public.form_submissions where answers ->> 'email' = 'intruso.delta@example.test'`))[0].n).toBe(0);
    // anon e pré-request explicitamente (migration 142 + 143)
    const pre = await sqlDev<{ a: boolean; b: boolean; c: boolean; d: boolean }[]>(`select has_function_privilege('anon', 'public.hp_pre_request()', 'execute') a, has_function_privilege('authenticated', 'public.hp_pre_request()', 'execute') b, has_function_privilege('anon', 'public.org_public_by_slug(text)', 'execute') c, not has_function_privilege('anon', 'private.public_org(text)', 'execute') d`);
    expect(pre[0]).toEqual({ a: true, b: true, c: true, d: true });
    writeFileSync("test-results/wl-delta-tempos.json", JSON.stringify(tempos, null, 2)); console.log("DELTA", JSON.stringify(tempos));
  });
});

test.afterAll(() => { /* a Delta permanece no Dev para conferência */ });
void SUPABASE_URL; void ANON; void get; void sqlDev; void writeFileSync; void brl;
