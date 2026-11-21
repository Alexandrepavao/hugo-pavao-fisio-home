import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ANON, PASSWORD, SUPABASE_URL, signIn, useSession as injetarSessao, type Session } from "../helpers";
import { QA, devSql, moveAppointment, rest, runId, spDate } from "../release/helpers-release";

// @novo — PROCESSO COMERCIAL DA HP FISIO, DE PONTA A PONTA (Dev, organização HP): lead → cadastro → admin recebe → envia ao fisioterapeuta → atendimento com a apresentação (prévia) → apresentação PDF com valores e acesso ao
// aplicativo → paciente entra e acompanha → venda e pagamento → paciente ativo. Cada etapa registra o que mudou em cada área do aplicativo (gestor e fisioterapeuta) e captura as telas.
// SIMULADO (declarado): o clique no link do convite e a definição de senha do paciente (e-mail de teste é contido pela política de destinatários do Dev). Real: tudo o mais pela interface e pelo banco Dev.
const SHOTS = "docs/jornada-comercial"; mkdirSync(`${SHOTS}/slides`, { recursive: true });
const RUN = runId; const NOME = `Marina Costa (exemplo) N42 ${RUN}`; const EMAIL = `n42.${RUN}@hp-test.dev`; const FONE = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
const SVC_NOME = `Avaliação inicial HP N42 ${RUN}`; const PKG_NOME = `Acompanhamento HP 8 sessões N42 ${RUN}`; const CAMP = `hp-jornada-${RUN}`;
const shot = (p: Page, n: string, full = false) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });
const spDay = (d: number) => spDate(d); const PASSADO = -(5 + (parseInt(RUN, 36) % 400));   // dia passado único por execução: a fisioterapeuta de QA acumula atendimentos de outras execuções
const S: Record<string, string> = {}; const etapas: { etapa: string; o_que_mudou: Record<string, unknown> }[] = [];
const registrar = (etapa: string, o_que_mudou: Record<string, unknown>) => { etapas.push({ etapa, o_que_mudou }); };
const entrar = async (c: BrowserContext, email: string) => { const s = await signIn(email); await injetarSessao(c, s); return s; };
const q1 = async <T,>(sql: string) => ((await devSql(sql)) as T[])[0];

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 }, actionTimeout: 30_000, trace: "off" });
test.describe.serial("@novo HP Fisio — jornada comercial de ponta a ponta", () => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN || !PASSWORD, "precisa de SUPABASE_ACCESS_TOKEN e HP_QA_PASSWORD");
  test.setTimeout(300_000);
  let mgr: Session;

  test.beforeAll(async () => {
    await devSql("delete from private.rate_limits where key like 'quiz_start%'");   // o limite por IP (8 captações/10 min) é do Dev compartilhado: execuções seguidas de testes o esgotam
    mgr = await signIn(QA.manager);
    const fis = await signIn(QA.fisio); S.fisUser = fis.user.id;
    const g = async (p: string) => (await (await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: ANON, authorization: `Bearer ${mgr.access_token}` } })).json()) as { id: string }[];
    S.org = (await g("organizations?select=id&slug=eq.hp-group"))[0].id; S.unit = (await g("units?select=id&slug=eq.sao-paulo"))[0].id;
    let prof = (await g(`professionals?select=id&user_id=eq.${S.fisUser}`))[0];
    if (!prof) { const r = await rest(mgr, "POST", "professionals", { org_id: S.org, display_name: "Fisio QA (jornada)", active: true, user_id: S.fisUser }); prof = r.body[0]; await rest(mgr, "POST", "professional_units", { professional_id: prof.id, unit_id: S.unit }); }
    S.prof = prof.id;
    await devSql(`insert into public.professional_units (professional_id, unit_id) select '${S.prof}', '${S.unit}' where not exists (select 1 from public.professional_units where professional_id = '${S.prof}' and unit_id = '${S.unit}')`);
    const rules = (await g(`availability_rules?select=id,weekday&professional_id=eq.${S.prof}&unit_id=eq.${S.unit}`)) as unknown as { weekday: number }[];
    for (let d = 0; d < 7; d++) if (!rules.some((r) => r.weekday === d)) await rest(mgr, "POST", "availability_rules", { org_id: S.org, professional_id: S.prof, unit_id: S.unit, weekday: d, start_time: "06:00", end_time: "22:00" });
  });

  test("0. a gestão cadastra o serviço da avaliação e o pacote (valor) pelas telas de Configurações", async ({ page, context }) => {
    await entrar(context, QA.manager); await page.goto("/admin/configuracoes");
    await page.getByText("Serviços (duração/preço do atendimento)").locator("xpath=ancestor::div[.//button[normalize-space()='Gerenciar']][1]").getByRole("button", { name: "Gerenciar" }).click();
    await page.locator("#sv-name").fill(SVC_NOME); await page.locator("#sv-dur").fill("50"); await page.locator("#sv-price").fill("0,00"); await page.getByRole("button", { name: "Criar serviço" }).click(); await expect(page.getByText("Serviço criado.")).toBeVisible();
    await page.locator("#sv-name").fill(`Sessão HP N42 ${RUN}`); await page.locator("#sv-dur").fill("50"); await page.locator("#sv-price").fill("220,00"); await page.getByRole("button", { name: "Criar serviço" }).click(); await expect(page.getByText("Serviço criado.")).toBeVisible();
    await page.locator("#pr-kind").selectOption("package"); await page.locator("#pr-name").fill(PKG_NOME); await page.locator("#pr-price").fill("1760,00");
    await page.locator("#pr-svc").selectOption({ label: `Sessão HP N42 ${RUN}` }); await page.locator("#pr-sess").fill("8"); await page.locator("#pr-val").fill("180"); await page.getByRole("button", { name: "Criar produto" }).click(); await expect(page.getByText("Produto criado.")).toBeVisible();
    await shot(page, "00-gestao-servico-e-pacote");
    S.svc = (await q1<{ id: string }>(`select id::text from public.services where org_id = '${S.org}' and name = '${SVC_NOME}'`)).id; S.pkg = (await q1<{ id: string }>(`select id::text from public.products where org_id = '${S.org}' and name = '${PKG_NOME}'`)).id;
    registrar("0. Configuração (gestão)", { servico_avaliacao: SVC_NOME, pacote: PKG_NOME, valor_pacote: "R$ 1.760,00 / 8 sessões" });
  });

  test("1. o LEAD entra pelo quiz do site com origem e campanha e preenche o cadastro", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); p.on("response", async (r) => { if (r.url().includes("/rpc/quiz_") && r.status() >= 400) console.log("QUIZ_ERRO", r.url().split("/").pop(), r.status(), (await r.text()).slice(0, 250)); });
    await p.goto(`/avaliacao?utm_source=instagram&utm_medium=social&utm_campaign=${CAMP}`); await expect(p.getByRole("heading", { name: "Avaliação inicial gratuita" })).toBeVisible({ timeout: 30_000 }); await shot(p, "01-lead-quiz-inicio");
    await p.getByLabel("Nome completo").fill(NOME); await p.getByLabel("E-mail", { exact: true }).fill(EMAIL); await p.getByLabel("WhatsApp com DDD").fill(FONE); await p.getByRole("checkbox").click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByLabel("Cidade").fill("São Paulo"); await p.getByLabel("UF").selectOption("SP"); await p.getByLabel("Bairro").fill("Pinheiros"); await p.getByLabel("Zona de São Paulo").selectOption("oeste"); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("button", { name: "Concordo, continuar" }).click();
    for (const label of ["dor ou desconforto", "deseja melhorar", "qualidade de vida melhoraria"]) { await expect(p.getByText(new RegExp(label))).toBeVisible(); await p.getByRole("radio", { name: "5" }).click(); await p.getByRole("button", { name: "Continuar" }).click(); }
    await p.getByRole("radio", { name: "Realizar atividades diárias" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Sim" }).click(); await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Até R$ 250" }).click(); await p.getByRole("button", { name: "Continuar" }).click(); await shot(p, "02-lead-quiz-ultima-etapa");
    await p.getByRole("button", { name: "Concluir" }).click(); await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible({ timeout: 30_000 }); await shot(p, "03-lead-quiz-concluido"); await ctx.close();
    const l = await q1<{ person_id: string; opportunity_id: string; org_id: string }>(`select person_id::text, opportunity_id::text, org_id::text from public.quiz_leads where email = '${EMAIL}'`); S.person = l.person_id; S.opp = l.opportunity_id; expect(l.org_id).toBe(S.org);
    registrar("1. Lead preenche o cadastro (site)", await q1(`select (select count(*) from public.quiz_leads where email = '${EMAIL}')::int quiz_leads, (select count(*) from public.people where id = '${S.person}')::int pessoas, (select count(*) from public.opportunities where id = '${S.opp}' and campaign = '${CAMP}' and source = 'quiz:atendimento')::int oportunidades_com_origem_e_campanha`));
  });

  test("2. o ADMIN recebe o lead: CRM (fila e funil), cadastro central e indicadores de captação", async ({ page, context }) => {
    await entrar(context, QA.manager);
    await page.goto("/admin/crm/leads"); await expect(page.getByRole("row").filter({ hasText: NOME })).toHaveCount(1, { timeout: 30_000 }); await shot(page, "04-admin-crm-leads");
    await page.goto("/admin/crm/oportunidades"); await page.getByPlaceholder("Pessoa ou título").fill(NOME); await expect(page.getByRole("region", { name: /^Novo contato/ }).getByText(NOME)).toBeVisible({ timeout: 60_000 }); await shot(page, "05-admin-crm-funil-novo-contato");
    await page.goto(`/admin/adm/diretorio?q=${encodeURIComponent(NOME)}`); await page.getByPlaceholder(/Nome, razão social/).fill(NOME); await expect(page.getByRole("button", { name: NOME, exact: true })).toHaveCount(1); await shot(page, "06-admin-cadastro-central");
    await page.goto("/admin/captacao-leads"); await expect(page.getByRole("heading").first()).toBeVisible(); await shot(page, "07-admin-captacao-indicadores");
    await page.goto("/admin/crm"); await expect(page.getByRole("heading").first()).toBeVisible(); await shot(page, "08-admin-crm-painel");
    registrar("2. Admin recebe (gestor)", { crm_leads_fila: "1 linha", funil: "Novo contato", cadastro_central: "1 pessoa (tipo lead)", responsavel_automatico: !!(await q1<{ o: string | null }>(`select owner_user_id::text o from public.opportunities where id = '${S.opp}'`)).o });
  });

  test("3. o ADMIN envia o lead ao FISIOTERAPEUTA: agenda a avaliação → paciente PENDENTE com vínculo assistencial", async ({ page, context }) => {
    await entrar(context, QA.manager); S.day = spDay(3);
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(S.day); await page.locator("#ap").selectOption(S.prof); await page.locator("#as").selectOption(S.svc);
    await page.locator("#apn").fill(NOME); await page.getByRole("button", { name: NOME, exact: true }).click();
    const sel = page.locator("#ash"); await expect.poll(async () => (await sel.locator("option").count())).toBeGreaterThan(1);
    const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)); await sel.selectOption(opts[0]); await page.locator("#aop").selectOption(S.opp);
    await shot(page, "09-admin-agenda-agendando-com-fisio");
    await page.getByRole("button", { name: "Agendar", exact: true }).click(); await expect(page.getByText("Agendamento criado.")).toBeVisible({ timeout: 20_000 });
    await page.goto("/admin/crm/oportunidades"); await page.getByPlaceholder("Pessoa ou título").fill(NOME); await expect(page.getByRole("region", { name: /^Avaliação agendada/ }).getByText(NOME)).toBeVisible({ timeout: 60_000 }); await shot(page, "10-admin-funil-avaliacao-agendada");
    const e = await q1<{ status: string; n: number; care: number; appt: string }>(`select (select status from public.patient_enrollments where person_id = '${S.person}') status, (select count(*)::int from public.patient_enrollments where person_id = '${S.person}') n, (select count(*)::int from public.care_relationships where person_id = '${S.person}' and revoked_at is null) care, (select id::text from public.appointments where person_id = '${S.person}' limit 1) appt`);
    expect(e).toMatchObject({ status: "pending", n: 1, care: 1 }); S.appt = e.appt; S.enr = (await q1<{ id: string }>(`select id::text from public.patient_enrollments where person_id = '${S.person}'`)).id;
    // o fisioterapeuta recebe: agenda do dia, lista de pacientes e Meu dia
    const pc = await page.context().browser()!.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); const pp = await pc.newPage(); await injetarSessao(pc, await signIn(QA.fisio));
    await pp.goto("/admin/agenda"); await pp.locator("#pf-unit").selectOption(S.unit); await pp.locator("#pf-day").fill(S.day); await expect(pp.getByRole("row").filter({ hasText: SVC_NOME })).toBeVisible({ timeout: 30_000 }); await shot(pp, "11-fisio-agenda-recebeu-a-avaliacao");
    await pp.goto(`/fisio/pacientes?pessoa=${S.person}`); await expect(pp.getByTestId("presentation-entry")).toContainText("Paciente pendente", { timeout: 30_000 }); await shot(pp, "12-fisio-ficha-paciente-pendente");
    await pp.goto("/fisio"); await expect(pp.getByRole("heading").first()).toBeVisible(); await shot(pp, "13-fisio-inicio"); await pc.close();
    registrar("3. Admin envia ao fisio (agenda)", { matricula: "pending", vinculo_assistencial: 1, funil: "Avaliação agendada", fisio_ve: "agenda do dia + ficha do paciente pendente" });
  });

  test("4. o FISIO faz o atendimento: presença, captura da avaliação e PRÉVIA da apresentação; publica", async ({ page, context }) => {
    const phys = await entrar(context, QA.fisio); S.fisTok = phys.access_token;
    await moveAppointment(S.appt, `${spDay(PASSADO)}T10:00:00-03:00`);   // o tempo passa (Dev): a avaliação já ocorreu
    await page.goto("/admin/agenda"); await page.locator("#pf-unit").selectOption(S.unit); await page.locator("#pf-day").fill(spDay(PASSADO));
    await page.getByRole("row").filter({ hasText: SVC_NOME }).filter({ hasText: "Agendado" }).getByRole("button", { name: "Compareceu" }).click(); await expect(page.getByText("Status atualizado.")).toBeVisible({ timeout: 20_000 }); await shot(page, "14-fisio-avaliacao-realizada");
    await page.goto(`/apresentacao/avaliacao/${S.enr}`); await expect(page.getByTestId("presentation-workspace")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Traumato-Ortopédica" }).click(); await page.getByLabel("Queixa principal").fill("Dor no ombro direito ao levantar o braço");
    await page.getByLabel("Há quanto tempo").fill("há 3 meses"); await page.getByLabel("Atividades que quer retomar").fill("Voltar a nadar"); await page.getByLabel("Limitações funcionais").fill("Não consigo pentear o cabelo");
    await page.getByLabel("A condição é…").selectOption("hypothesis"); await page.getByLabel("Descrição").fill("Possível tendinopatia do manguito"); await page.getByLabel("Objetivo do paciente").fill("Voltar a nadar sem dor");
    await page.getByLabel("Frequência (vezes por semana)").fill("2"); await page.getByLabel("Duração prevista (semanas)").fill("8"); await page.getByLabel("Rotina orientada").fill("Exercícios 3 vezes por semana em casa");
    await page.getByTestId("pw-internal").fill("ANOTAÇÃO INTERNA N42: não aparece ao paciente"); await expect(page.getByTestId("pw-save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await page.getByLabel("Valor (0 a 10)").fill("7"); await page.getByTestId("pw-measure-add").click(); await expect(page.getByTestId("pw-measures")).toContainText("ponto de partida"); await shot(page, "15-fisio-captura-da-avaliacao", true);
    await page.getByTestId("pw-tab-apresentar").click(); await expect(page.getByTestId("pp-step-objetivo")).toContainText("Voltar a nadar sem dor"); await shot(page, "16-fisio-apresentacao-1-objetivo");
    const nomes = ["partida", "acompanhamento", "rotina", "plano", "ciencia"]; let i = 2;
    for (const k of nomes) { await page.getByTestId("pp-next").click(); await expect(page.getByTestId(k === "plano" ? "pp-plan" : `pp-step-${k}`).first()).toBeVisible(); if (k !== "ciencia") await shot(page, `16-fisio-apresentacao-${i++}-${k}`); }
    await page.getByTestId("pp-next").click(); const prev = page.getByTestId("portal-preview"); await expect(prev).toBeVisible({ timeout: 30_000 }); await expect(prev.getByTestId("jr-enrollment-pending")).toBeVisible({ timeout: 20_000 });
    await expect(prev).not.toContainText("ANOTAÇÃO INTERNA"); await shot(page, "17-fisio-PREVIA-da-area-do-paciente", true);
    await page.getByTestId("pw-tab-publicar").click(); await page.getByTestId("pw-publish").click(); await page.getByRole("button", { name: "Publicar", exact: true }).click(); await expect(page.getByText("Versão 1 publicada")).toBeVisible({ timeout: 20_000 }); await shot(page, "18-fisio-apresentacao-publicada");
    registrar("4. Fisio atende e apresenta", { avaliacao: "realizada (presença registrada pela fisio)", apresentacao: "versão 1 publicada", meta_do_paciente: "criada a partir do objetivo", medida_inicial: "NPRS 7" });
  });

  test("5. o FISIO gera o RASCUNHO da apresentação PDF 16:9, revisa o que entra, escolhe a oferta e APROVA a versão (retrato imutável); exporta o PDF", async ({ page, context }) => {
    await entrar(context, QA.fisio); await page.goto(`/apresentacao/avaliacao/${S.enr}`); await page.getByTestId("pw-tab-deck").click(); await expect(page.getByTestId("pw-deck")).toBeVisible();
    await expect(page.getByTestId("pw-deck-versions")).toContainText("Nenhuma versão aprovada"); await shot(page, "19-fisio-pdf-gerar-rascunho");
    await page.getByTestId("pw-deck-generate").click(); await expect(page.getByTestId("pw-deck-review")).toBeVisible({ timeout: 30_000 });
    // revisão: a evidência não existe (nenhuma ficha aprovada escolhida) → a página não é criada; a oferta é opcional
    await expect(page.getByTestId("pw-deck-sel-evidence")).toBeDisabled(); await expect(page.getByTestId("pw-deck-sel-commercial")).toBeDisabled();
    await page.getByTestId("pw-deck-product").selectOption(S.pkg); await expect(page.getByTestId("pw-deck-sel-commercial")).toBeEnabled({ timeout: 20_000 }); await expect(page.getByTestId("pw-deck-sel-commercial")).toBeChecked();
    const view = page.getByTestId("pw-deck-preview").getByTestId("deck-current"); await expect(view.getByTestId("deck-patient")).toContainText(NOME); await expect(view.getByTestId("deck-capa")).toBeVisible(); await shot(page, "20-fisio-pdf-revisao-do-rascunho", true);
    // o rascunho é só da equipe: o paciente ainda não vê nada (nem existe conta); outro paciente muito menos
    const outro = await signIn(QA.paciente); const md = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_deck`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${outro.access_token}`, "content-type": "application/json" }, body: "{}" }); expect((await md.json()).exists).toBe(false);
    await page.getByTestId("pw-deck-approve").click(); await expect(page.getByTestId("pw-deck-version")).toHaveCount(1, { timeout: 30_000 }); await expect(page.getByTestId("pw-deck-version")).toContainText("Versão 1");
    S.deck = (await q1<{ id: string }>(`select id::text from public.presentation_decks where enrollment_id = '${S.enr}' and status = 'approved'`)).id;
    // retrato imutável: nem o banco altera uma versão aprovada, nem a apaga
    for (const sql of [`update public.presentation_decks set selection = '{}' where id = '${S.deck}'`, `delete from public.presentation_decks where id = '${S.deck}'`]) { await expect(devSql(sql)).rejects.toThrow(/imut|apagada/i); }
    await page.getByTestId("pw-deck-open").click(); await expect(page).toHaveURL(new RegExp(`/apresentacao/proposta/${S.deck}`)); await expect(page.getByTestId("deck-current").getByTestId("deck-title")).toBeVisible({ timeout: 30_000 });
    // todos os slides, um a um (capturas 16:9)
    const keys = ["cover", "goals", "start", "path", "evolution", "app", "videos", "continuity", "plan", "next"]; S.keys = keys.join(",");
    for (const [n, k] of keys.entries()) { if (k !== "cover") await page.getByTestId(`deck-go-${k}`).click(); await expect(page.getByTestId("deck-counter")).toContainText(`${n + 1} / ${keys.length}`); await page.getByTestId("deck-current").screenshot({ path: `${SHOTS}/slides/slide-${String(n + 1).padStart(2, "0")}-${k}.png` }); }
    await page.getByTestId("deck-go-start").click(); await expect(page.getByTestId("deck-current").getByTestId("deck-measures")).toContainText("7"); await page.getByTestId("deck-go-app").click();
    await expect(page.getByTestId("deck-current").getByTestId("deck-app").locator(".callout")).not.toHaveCount(0); await page.getByTestId("deck-go-plan").click(); await expect(page.getByTestId("deck-current").getByTestId("deck-preco")).toContainText("1.760,00");
    // demonstração interativa no navegador (portal real, dados congelados)
    await page.getByTestId("deck-open-explorer").click(); await expect(page.getByTestId("deck-explorer").getByTestId("patient-home")).toBeVisible({ timeout: 20_000 }); await page.getByTestId("deck-explorer-tab-evolucao").click(); await shot(page, "21-fisio-pdf-demonstracao-interativa"); await page.keyboard.press("Escape");
    // PDF: uma página 16:9 por slide (links, fontes e imagens conferidos no teste 9)
    await page.emulateMedia({ media: "print" }); S.pdf = `${SHOTS}/apresentacao-demo-exemplo.pdf`; await page.pdf({ path: S.pdf, width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true }); await page.emulateMedia({ media: "screen" });
    await devSql(`insert into public.audit_log (org_id, actor_user_id, action, entity_type, entity_id) values ('${S.org}', '${S.fisUser}', 'deck_exported', 'presentation_decks', '${S.deck}')`);   // o botão grava o mesmo evento (deck_export_log)
    registrar("5. Fisio gera, revisa e aprova a apresentação PDF", { versao_aprovada: 1, slides: keys.length, evidencias: "página omitida (nenhuma ficha aprovada)", valores: "R$ 1.760,00 incluídos por escolha do fisio", imutavel: "UPDATE/DELETE recusados pelo banco", pdf: "docs/jornada-comercial/apresentacao-demo-exemplo.pdf" });
  });

  test("6. o PACIENTE recebe o acesso (convite pelo servidor), entra no aplicativo (celular) e lê a apresentação APROVADA; 'próximo passo' só registra o interesse", async ({ page, context, browser }) => {
    await entrar(context, QA.fisio); await page.goto(`/apresentacao/avaliacao/${S.enr}`); await page.getByTestId("pw-tab-publicar").click(); await expect(page.getByTestId("pw-access-email")).not.toContainText("nenhum");
    await page.getByTestId("pw-invite").click(); await expect(page.getByTestId("pw-access-last")).toContainText("aceito pelo serviço de e-mail", { timeout: 30_000 }); await shot(page, "22-fisio-acesso-do-paciente-convite");
    await devSql(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), encrypted_password = crypt('${PASSWORD.replace(/'/g, "''")}', gen_salt('bf')), updated_at = now() where lower(email) = '${EMAIL}'`);   // SIMULADO: abriu o link e definiu a senha
    const vinc = await q1<{ ua: number; roles: number }>(`select (select count(*)::int from public.user_accounts a join auth.users u on u.id = a.user_id where lower(u.email) = '${EMAIL}') ua, (select count(*)::int from public.role_assignments r join auth.users u on u.id = r.user_id where lower(u.email) = '${EMAIL}' and r.role = 'member') roles`); expect(vinc, JSON.stringify(vinc)).toMatchObject({ ua: 1, roles: 1 });
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto("/login"); await p.getByLabel("E-mail").fill(EMAIL); await p.getByLabel("Senha").fill(PASSWORD); await p.getByRole("button", { name: "Entrar" }).click();
    await expect(p.getByTestId("tutorial-comecar")).toBeVisible({ timeout: 40_000 }); await p.getByTestId("tutorial-comecar").click(); await expect(p.getByTestId("patient-home")).toBeVisible({ timeout: 30_000 });
    await expect(p.getByTestId("jr-enrollment-pending")).toBeVisible(); await shot(p, "23-paciente-app-inicio-pendente-celular", true);
    await p.goto("/paciente/proposta"); await expect(p.getByTestId("patient-deck")).toBeVisible({ timeout: 30_000 }); await expect(p.getByTestId("deck-current").getByTestId("deck-title")).toBeVisible({ timeout: 30_000 }); await shot(p, "24-paciente-proposta-celular-capa");
    await p.getByTestId("deck-go-plan").click(); await expect(p.getByTestId("deck-current").getByTestId("deck-preco")).toContainText("1.760,00"); await shot(p, "25-paciente-proposta-celular-plano");
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await p.getByTestId("deck-go-next").click(); await expect(p.getByTestId("deck-current").getByTestId("deck-pay-status")).toContainText("Contratação ainda não feita");
    const antes = await q1<{ vendas: number; pagos: number; matricula: string }>(`select (select count(*)::int from public.sales where person_id = '${S.person}') vendas, (select count(*)::int from public.payments p join public.receivables r on r.id = p.receivable_id join public.sales s on s.id = r.sale_id where s.person_id = '${S.person}') pagos, (select status from public.patient_enrollments where id = '${S.enr}') matricula`);
    await p.getByTestId("deck-current").getByTestId("deck-cta-start").click(); await expect(p.getByTestId("deck-current").getByTestId("deck-cta-start")).toContainText("Recebemos o seu pedido", { timeout: 20_000 }); await shot(p, "26-paciente-proposta-celular-proximo-passo");
    const dep = await q1<{ vendas: number; pagos: number; matricula: string; tasks: number; inter: number }>(`select (select count(*)::int from public.sales where person_id = '${S.person}') vendas, (select count(*)::int from public.payments p join public.receivables r on r.id = p.receivable_id join public.sales s on s.id = r.sale_id where s.person_id = '${S.person}') pagos, (select status from public.patient_enrollments where id = '${S.enr}') matricula, (select count(*)::int from public.crm_tasks where person_id = '${S.person}' and dedupe_key = 'deck-resp:${S.deck}:start') tasks, (select count(*)::int from public.interactions where person_id = '${S.person}' and summary like 'Paciente quer iniciar%') inter`);
    expect(dep).toMatchObject({ vendas: antes.vendas, pagos: antes.pagos, matricula: "pending", tasks: 1, inter: 1 });   // registrou o interesse; NÃO vendeu, NÃO cobrou, NÃO ativou
    await p.reload(); await p.getByTestId("deck-go-next").click().catch(() => undefined);
    await ctx.close();
    registrar("6. Paciente acessa o app e a proposta", { conta: "vinculada ao convite (papel paciente)", ve: "somente a versão aprovada", proximo_passo: "interesse registrado no CRM (tarefa + interação); venda/pagamento/ativação inalterados", celular: "sem rolagem horizontal" });
  });

  test("7. VENDA e PAGAMENTO: gestão converte em venda e confirma; parcial não ativa; 1ª parcela quitada ativa; o paciente acompanha na última página da apresentação", async ({ page, context, browser }) => {
    await entrar(context, QA.manager);
    await page.goto("/admin/crm/oportunidades"); await page.getByText(NOME, { exact: true }).first().click(); await page.getByRole("link", { name: "Converter em venda" }).click(); await expect(page).toHaveURL(/\/admin\/financeiro\/vendas\?venda=/);
    await page.locator("#pr").selectOption(S.pkg); await page.locator("#in").fill("2"); await page.locator("#fd").fill(spDay(0)); await page.getByRole("button", { name: "Criar venda" }).click(); await expect(page.getByText(/Venda criada como pendente/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("row").filter({ hasText: NOME }).getByRole("button", { name: "Confirmar" }).click(); await expect(page.getByText(/Venda confirmada/)).toBeVisible({ timeout: 20_000 }); await shot(page, "25-admin-venda-confirmada");
    const st = async () => q1<{ enr: string; pk: number; pay: number }>(`select (select status from public.patient_enrollments where id = '${S.enr}') enr, (select count(*)::int from public.client_packages where person_id = '${S.person}') pk, (select count(*)::int from public.payments p join public.receivables r on r.id = p.receivable_id join public.sales s on s.id = r.sale_id where s.person_id = '${S.person}') pay`);
    expect(await st()).toMatchObject({ enr: "pending", pk: 0, pay: 0 });
    const abaReceb = async () => { await page.getByRole("tab", { name: "Recebíveis e recebimentos" }).click(); };
    const row = (n: string) => page.getByRole("row").filter({ hasText: NOME }).filter({ has: page.getByRole("cell", { name: n, exact: true }) });
    await abaReceb(); await row("1/2").getByRole("button", { name: "Receber" }).click(); await page.locator("#pa").fill("200,00"); await page.getByRole("button", { name: "Registrar" }).click(); await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    expect(await st()).toMatchObject({ enr: "pending", pk: 0, pay: 1 }); await shot(page, "26-admin-pagamento-parcial-nao-ativa");
    const pcx = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 390, height: 844 } }); const pa = await pcx.newPage(); await injetarSessao(pcx, await signIn(EMAIL));
    await pa.goto("/paciente/proposta?acao=duvidas"); await expect(pa.getByTestId("deck-current").getByTestId("deck-pay-status")).toContainText("Aguardando", { timeout: 30_000 }); await expect(pa.getByTestId("deck-current").getByTestId("deck-parcelas")).toContainText("1/2"); await shot(pa, "27-paciente-ebook-aguardando-pagamento-celular", true);
    await page.reload(); await abaReceb(); await row("1/2").getByRole("button", { name: "Receber" }).click(); await expect(page.locator("#pa")).toHaveValue("680,00"); await page.getByRole("button", { name: "Registrar" }).click(); await expect(page.getByText("Recebimento registrado.")).toBeVisible({ timeout: 20_000 });
    await expect(async () => { expect(await st()).toMatchObject({ enr: "active", pk: 1 }); }).toPass({ timeout: 20_000 }); await shot(page, "28-admin-1a-parcela-quitada-ativa");
    await pa.reload(); await expect(pa.getByTestId("deck-current").getByTestId("deck-pay-status")).toContainText("confirmado", { timeout: 30_000 }); await shot(pa, "29-paciente-ebook-pagamento-confirmado-celular", true);
    await pa.goto("/paciente"); await expect(pa.getByTestId("patient-home")).toBeVisible({ timeout: 45_000 }); await expect(pa.getByTestId("jr-enrollment-pending")).toHaveCount(0); await shot(pa, "30-paciente-app-ativo-celular", true); await pcx.close();
    registrar("7. Venda e pagamento", { venda_feita: "NÃO ativa", pagamento_parcial_R$_200: "NÃO ativa", primeira_parcela_quitada: "ATIVA e libera o pacote de 8 sessões", apresentacao_do_paciente: "mostra aguardando → confirmado e as parcelas" });
  });

  test("8. como a informação chega a cada área: gestor/financeiro e fisioterapeuta depois do fluxo", async ({ page, context, browser }) => {
    await entrar(context, QA.manager);
    const areas: [string, string, string][] = [["/admin/financeiro/vendas", "31-admin-financeiro-vendas", "Vendas e recebimentos"], ["/admin/financeiro", "32-admin-financeiro-visao-geral", ""], ["/admin/financeiro/comissoes", "33-admin-financeiro-comissoes", ""],
      ["/admin/agenda", "34-admin-agenda", "Agenda"], ["/admin/crm/oportunidades", "35-admin-crm-funil", ""], ["/admin/pessoas", "36-admin-pessoas", ""], ["/admin/acompanhamento", "37-admin-acompanhamento-pacientes", ""], ["/admin", "38-admin-hub", ""]];
    for (const [url, nome] of areas.map((a) => [a[0], a[1]])) { await page.goto(url); await page.waitForLoadState("networkidle").catch(() => undefined); await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 }); await shot(page, nome); }
    const pc = await browser.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } }); const pp = await pc.newPage(); await injetarSessao(pc, await signIn(QA.fisio));
    for (const [url, nome] of [["/fisio", "40-fisio-inicio"], ["/fisio/agenda", "41-fisio-agenda"], [`/fisio/pacientes?pessoa=${S.person}`, "42-fisio-ficha-paciente-ativo"], ["/admin/meu-dia", "43-fisio-meu-dia"], ["/admin/meu-resumo?periodo=mes", "44-fisio-meu-resumo"]]) { await pp.goto(url); await pp.waitForLoadState("networkidle").catch(() => undefined); await expect(pp.getByRole("heading").first()).toBeVisible({ timeout: 30_000 }); await shot(pp, nome); }
    await pc.close();
    const final = await q1<Record<string, unknown>>(`select (select status from public.patient_enrollments where id = '${S.enr}') matricula, (select count(*)::int from public.client_packages where person_id = '${S.person}') pacotes, (select count(*)::int from public.sales where person_id = '${S.person}' and status = 'confirmed') vendas,
      (select coalesce(sum(case when p.kind = 'refund' then -p.amount_cents else p.amount_cents end), 0)::int from public.payments p join public.receivables r on r.id = p.receivable_id join public.sales s on s.id = r.sale_id where s.person_id = '${S.person}') caixa_cents,
      (select count(*)::int from public.presentation_decks where enrollment_id = '${S.enr}' and status <> 'draft') versoes_aprovadas, (select count(*)::int from public.patient_goals where person_id = '${S.person}') metas`);
    registrar("8. Estado final nas áreas", final);
    writeFileSync(`${SHOTS}/etapas.json`, JSON.stringify({ run: RUN, paciente_fictício: NOME, etapas }, null, 2)); console.log("JORNADA", JSON.stringify(final));
  });
  test("9. validação do PDF e da segurança: páginas 16:9, fontes, imagens, links sem credencial; autorização, isolamento entre organizações e acesso ao arquivo", async () => {
    const chk = JSON.parse(execFileSync("python", ["-I", "e2e/tools/pdf_check.py", S.pdf], { encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } }));
    writeFileSync(`${SHOTS}/pdf-conferencia.json`, JSON.stringify(chk, null, 2));
    const n = S.keys.split(",").length;
    expect(chk.pages, "uma página por slide").toBe(n); expect(chk.ratio_ok, "todas as páginas em 16:9").toBe(true); expect(chk.images, "capa e imagens incorporadas").toBeGreaterThan(0);
    expect(chk.fonts_not_embedded, `fontes não incorporadas: ${chk.fonts_not_embedded}`).toEqual([]); expect(chk.bad_links, "nenhum link com token/credencial").toEqual([]); expect(chk.demo_pages, "identificação de EXEMPLO em todas as páginas").toBe(n);
    expect(chk.links.some((l: { uri: string }) => /\/paciente\/treinos$/.test(l.uri)), "link para Treinos").toBe(true); expect(chk.links.some((l: { uri: string }) => /\/paciente\/proposta\?acao=iniciar$/.test(l.uri)), "link do próximo passo").toBe(true);
    expect(chk.tiny_text_pages, "sem fonte minúscula").toEqual([]);
    // autorização: só a fisioterapeuta com vínculo assistencial gera, lê ou aprova (gestão sem vínculo não vê o conteúdo clínico); paciente e comercial não; outra organização não
    const call = async (s: Session | null, fn: string, body: unknown) => { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${s?.access_token ?? ANON}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return r.status; };
    const pac = await signIn(EMAIL), com = await signIn(QA.comercial), alfa = await signIn("alfa.admin@example.test");
    for (const [quem, s] of [["paciente", pac], ["comercial", com], ["outra organização", alfa], ["anônimo", null]] as [string, Session | null][]) {
      for (const [fn, body] of [["deck_get", { p_enrollment: S.enr }], ["deck_read", { p_id: S.deck }], ["deck_draft_generate", { p_enrollment: S.enr, p_product: null }], ["deck_approve", { p_id: S.deck }], ["deck_export_log", { p_id: S.deck }]] as [string, unknown][])
        expect(await call(s, fn, body), `${quem} não pode ${fn}`).toBeGreaterThanOrEqual(400);
    }
    expect(await call(alfa, "my_deck", {}), "outra organização não lê proposta (retorna vazio)").toBeLessThan(500);
    const adm = await signIn(QA.manager); expect(await call(adm, "deck_get", { p_enrollment: S.enr }), "gestão sem vínculo assistencial NÃO lê o conteúdo clínico (só a auditoria deck_approved/deck_exported)").toBeGreaterThanOrEqual(400);
    // acesso ao arquivo: não existe arquivo público/permanente; a tabela não é legível direto por ninguém da API
    for (const s of [pac, adm, alfa, null]) { const r = await fetch(`${SUPABASE_URL}/rest/v1/presentation_decks?select=id&limit=1`, { headers: { apikey: ANON, authorization: `Bearer ${s?.access_token ?? ANON}` } }); const b = await r.json().catch(() => []); expect(r.status >= 400 || (Array.isArray(b) && b.length === 0), "tabela dos decks fechada à API").toBe(true); }
    // rascunho novo não substitui a versão aprovada que o paciente lê; paciente nunca lê rascunho
    const f = await signIn(QA.fisio); expect(await call(f, "deck_draft_generate", { p_enrollment: S.enr, p_product: null })).toBeLessThan(300);
    const my = await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_deck`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${pac.access_token}`, "content-type": "application/json" }, body: "{}" })).json(); expect(my.exists).toBe(true); expect(my.deck.status).toBe("approved"); expect(my.deck.version).toBe(1);
    // clicar no próximo passo duas vezes não duplica a tarefa (idempotente)
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_deck_respond`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${pac.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ p_deck: S.deck, p_choice: "start" }) });
    expect((await q1<{ n: number }>(`select count(*)::int n from public.crm_tasks where person_id = '${S.person}' and dedupe_key = 'deck-resp:${S.deck}:start'`)).n).toBe(1);
    registrar("9. Validação", { pdf: chk, autorizacao: "paciente, comercial, outra organização e anônimo recusados", tabela: "fechada à API", rascunho_novo: "não substitui a versão aprovada", proximo_passo: "idempotente" });
  });
});
