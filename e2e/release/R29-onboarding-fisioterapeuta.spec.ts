// ACEITE da release v1 — Onboarding do fisioterapeuta (/onboarding-fisio), "Primeiro acesso" só para cadastrados e tutorial do primeiro login.
//  · o gestor gera um link único na tela; sem link/ com link inválido não há formulário; o link serve uma vez
//  · o formulário valida (CPF, CEP, CREFITO, PIX…); PF cria Pessoa PF; com CNPJ cria empresa PJ + representante; profissional ativo na unidade
//  · o convite de acesso nasce; depois do e-mail confirmado o fisioterapeuta entra, vê o TUTORIAL do perfil dele e NÃO vê dado sensível de outras pessoas
//  · "Primeiro acesso": e-mail sem cadastro recebe mensagem de erro clara; e-mail com conta orienta a entrar
// E-mails NÃO são enviados: o teste intercepta só a criação da senha (signUp) e simula a confirmação do e-mail no banco de teste. Somente Dev; limpa o que cria.
import { expect, test, type Page } from "@playwright/test";
import { api, canTimeTravel, collectErrors, createConfirmedUser, deleteAuthUser, devSql, loginAs, QA, runId, signIn, uiLogin } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1280, height: 900 } });

const cpfFrom = (seed: number) => {
  const d = Array.from({ length: 9 }, (_, i) => (seed * (i + 3) + i * 7) % 10); if (new Set(d).size === 1) d[0] = (d[0] + 1) % 10;
  const dv = (n: number[]) => { const r = (n.reduce((a, v, i) => a + v * (n.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d); const d2 = dv([...d, d1]); return [...d, d1, d2].join("");
};
const cnpjFrom = () => {
  const d = [...Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)), 0, 0, 0, 1];
  const dv = (n: number[]) => { const w = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = n.reduce((a, v, i) => a + v * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(d); const d2 = dv([...d, d1]); return [...d, d1, d2].join("");
};
const fmt = (cpf: string) => `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
const PASS = `E2e-${runId}-Senha!1`;

/** Intercepta só o signUp (nada de e-mail real) e devolve um sucesso como o Supabase devolveria. */
const stubSignUp = async (page: Page) => page.route("**/auth/v1/signup**", async (route) => {
  const body = route.request().postDataJSON() as { email: string };
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-0000-0000-0000000000a1", aud: "authenticated", role: "", email: body.email, identities: [{ id: "x" }], created_at: new Date().toISOString() }) });
});

const fillAddress = async (page: Page) => {
  await page.locator("#ob-cep").fill("09015-000"); await page.locator("#ob-cep").blur(); await page.waitForTimeout(1200);
  await page.locator("#ob-street").fill("Rua Teste E2E"); await page.locator("#ob-number").fill("100"); await page.locator("#ob-neigh").fill("Centro"); await page.locator("#ob-city").fill("Santo André"); await page.locator("#ob-uf").selectOption("SP");
};
const next = (page: Page) => page.getByRole("button", { name: /^(Continuar|Concluir cadastro)/ }).click();

test.describe.serial("@release Onboarding do fisioterapeuta + Primeiro acesso + tutorial", () => {
  test.setTimeout(240_000);
  test.skip(!canTimeTravel(), "precisa de SUPABASE_ACCESS_TOKEN (cria e limpa dados de teste no Dev)");
  const cpfA = cpfFrom(Number.parseInt(runId.slice(-3), 36) + 11); const emailA = `fisio.r29.${runId.toLowerCase()}@example.com`; const nameA = `Fernanda Teste R29 ${runId.toUpperCase()}`;
  const cpfB = cpfFrom(Number.parseInt(runId.slice(-3), 36) + 29); const emailB = `pj.r29.${runId.toLowerCase()}@example.com`; const cnpjB = cnpjFrom();
  let linkA = ""; let linkB = ""; const authUsers: string[] = [];

  test.afterAll(async () => {
    for (const id of authUsers) await deleteAuthUser(id).catch(() => undefined);
    const like = `%r29.${runId.toLowerCase()}%`;
    await devSql(`delete from public.onboarding_submissions where email like '${like}'; delete from public.invitations where email like '${like}'; delete from public.professionals where person_id in (select person_id from public.person_contacts where value like '${like}');
      delete from public.legal_entities where cnpj = '${cnpjB}'; delete from public.people where id in (select person_id from public.person_contacts where value like '${like}');
      delete from public.onboarding_links where email like '${like}' or full_name like '%R29 ${runId.toUpperCase()}%'`).catch(() => undefined);
  });

  test("gestor gera o link único na tela (Operação › Agenda › Profissionais)", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await expect(page.getByTestId("onboarding-links")).toBeVisible({ timeout: 40_000 });
    for (const [mail, nome, key] of [[emailA, nameA, "A"], [emailB, `Rafael PJ Teste R29 ${runId.toUpperCase()}`, "B"]] as const) {
      await page.locator("#ol-email").fill(mail); await page.locator("#ol-name").fill(nome);
      await page.locator("#ol-unit").selectOption({ index: 1 }); await page.getByRole("button", { name: "Gerar link de convite" }).click();
      const url = await page.getByTestId("onboarding-link-url").inputValue();
      expect(url).toMatch(/\/onboarding-fisio\?convite=[0-9a-f]{48}$/);
      if (key === "A") linkA = url; else linkB = url;
    }
    await page.screenshot({ path: "docs/screenshots/onboarding/gestor-links.png", fullPage: false });
    await expect(page.getByTestId("onboarding-link-linha").filter({ hasText: emailA })).toContainText("Aguardando preenchimento");
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("sem link ou com link inválido não existe formulário", async ({ page }) => {
    await page.goto("/onboarding-fisio"); await expect(page.getByTestId("onboarding-link-invalido")).toContainText("só abre com o link de convite", { timeout: 30_000 });
    await expect(page.getByTestId("onboarding-form").locator("form")).toHaveCount(0);
    await page.goto("/onboarding-fisio?convite=" + "0".repeat(48)); await expect(page.getByTestId("onboarding-link-invalido")).toContainText("não foi reconhecido", { timeout: 30_000 });
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
  });

  test("fisioterapeuta PF preenche o formulário (com validações) e o cadastro entra em Pessoas", async ({ page }) => {
    const errors = collectErrors(page); await stubSignUp(page);
    await page.goto(linkA); await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: 40_000 });
    // etapa 1: validações
    await expect(page.locator("#ob-name")).toHaveValue(nameA);                                  // o nome informado ao gerar o link já vem preenchido
    await page.locator("#ob-name").fill("Fernanda"); await next(page); await expect(page.getByText("Informe o nome completo")).toBeVisible();
    await expect(page.getByText("Informe a data de nascimento.")).toBeVisible();
    await page.locator("#ob-name").fill(nameA); await page.locator("#ob-pref").fill("Fe"); await page.locator("#ob-birth").fill("1990-05-10"); await page.locator("#ob-cpf").fill("11111111111"); await page.locator("#ob-rg").fill("12.345.678-9");
    await next(page); await expect(page.getByText("CPF inválido.")).toBeVisible();
    await page.locator("#ob-cpf").fill(cpfA); await expect(page.locator("#ob-cpf")).toHaveValue(fmt(cpfA));
    await page.screenshot({ path: "docs/screenshots/onboarding/fisio-etapa-1.png" });
    await next(page); await expect(page.getByTestId("onboarding-etapa")).toContainText("Etapa 2 de 5");
    // etapa 2: e-mail travado pelo convite
    await expect(page.locator("#ob-email")).toHaveValue(emailA); await expect(page.locator("#ob-email")).toHaveAttribute("readonly", "");
    await page.locator("#ob-phone").fill("11988887777"); await expect(page.locator("#ob-phone")).toHaveValue("(11) 98888-7777");
    await next(page); await expect(page.getByText("CEP inválido")).toBeVisible();
    await fillAddress(page); await page.screenshot({ path: "docs/screenshots/onboarding/fisio-etapa-2.png" });
    await next(page); await expect(page.getByTestId("onboarding-etapa")).toContainText("Etapa 3 de 5");
    // etapa 3: profissional (PF)
    await next(page); await expect(page.getByText("Informe o número do CREFITO.")).toBeVisible(); await expect(page.getByText("Escolha ao menos uma especialidade.")).toBeVisible();
    await page.locator("#ob-council").fill("123456-F"); await page.locator("#ob-council-uf").selectOption("SP");
    await page.getByLabel("Ortopedia e traumatologia").check(); await page.getByLabel("Geriatria").check(); await page.locator("#ob-edu").fill("UFSCar"); await page.locator("#ob-regions").fill("ABC");
    await expect(page.locator("#ob-cnpj")).toHaveCount(0); await page.screenshot({ path: "docs/screenshots/onboarding/fisio-etapa-3.png", fullPage: true });
    await next(page); await expect(page.getByTestId("onboarding-etapa")).toContainText("Etapa 4 de 5");
    // etapa 4: PIX
    await next(page); await expect(page.getByText("Informe a chave PIX")).toBeVisible();
    await page.locator("#ob-pixtype").selectOption("cpf"); await page.locator("#ob-pix").fill(cpfA); await next(page);
    // etapa 5: senha e termo
    await expect(page.getByTestId("onboarding-login-email")).toHaveText(emailA);
    await page.locator("#ob-pw").fill("curta"); await page.locator("#ob-pw2").fill("curta"); await next(page); await expect(page.getByText("Use ao menos 10 caracteres.")).toBeVisible();
    await page.locator("#ob-pw").fill(PASS); await page.locator("#ob-pw2").fill(PASS + "x"); await next(page); await expect(page.getByText("As senhas não coincidem.")).toBeVisible();
    await page.locator("#ob-pw2").fill(PASS); await next(page); await expect(page.getByText("É preciso aceitar para concluir")).toBeVisible();
    await page.locator("#ob-consent").check(); await page.screenshot({ path: "docs/screenshots/onboarding/fisio-etapa-5.png", fullPage: true });
    await next(page); await expect(page.getByTestId("onboarding-concluido")).toBeVisible({ timeout: 40_000 }); await expect(page.getByTestId("onboarding-concluido")).toContainText(emailA);
    await page.screenshot({ path: "docs/screenshots/onboarding/fisio-concluido.png", fullPage: true });
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("o cadastro apareceu em Pessoas (PF), o profissional está ativo, e o link não serve de novo", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const g = api(s);
    const p = (await g.get(`people?select=id,full_name,document_number,registration_status,origin,city,state_uf&document_number=eq.${cpfA}`)).body as { id: string; full_name: string; origin: string; city: string }[];
    expect(p, "pessoa criada com o CPF só em dígitos").toHaveLength(1); expect(p[0].origin).toBe("onboarding_fisio"); expect(p[0].city).toBe("Santo André");
    const prof = (await g.get(`professionals?select=id,active,council_registration,user_id&person_id=eq.${p[0].id}`)).body as { active: boolean; council_registration: string; user_id: string | null }[];
    expect(prof).toHaveLength(1); expect(prof[0].active).toBe(true); expect(prof[0].council_registration).toBe("CREFITO-SP 123456-F"); expect(prof[0].user_id).toBeNull();
    const sub = (await g.get(`onboarding_submissions?select=doc_kind,status,consent_version&person_id=eq.${p[0].id}`)).body as { doc_kind: string; status: string; consent_version: string }[];
    expect(sub[0]).toMatchObject({ doc_kind: "pf", status: "applied", consent_version: "onboarding-v1" });
    expect((await g.get(`legal_entities?select=id&legal_name=ilike.*${runId}*`)).body).toHaveLength(0);
    const inv = (await g.get(`invitations?select=role,accepted_at&email=eq.${emailA}`)).body as { role: string; accepted_at: string | null }[]; expect(inv).toHaveLength(1); expect(inv[0].role).toBe("physio");
    // a tela do gestor mostra o convite como preenchido
    await page.goto("/admin/agenda"); await page.getByRole("tab", { name: "Profissionais e disponibilidade" }).click();
    await expect(page.getByTestId("onboarding-link-linha").filter({ hasText: emailA })).toContainText("Preenchido", { timeout: 40_000 });
    // a gestão vê TUDO o que foi enviado, na ficha da pessoa (planilha administrativa)
    await page.goto(`/admin/adm/diretorio?q=${encodeURIComponent(nameA)}`); await page.getByRole("button", { name: nameA }).click();
    const dados = page.getByTestId("adm-onboarding-dados"); await expect(dados).toBeVisible({ timeout: 30_000 });
    await expect(dados).toContainText("12.345.678-9"); await expect(dados).toContainText("Ortopedia e traumatologia, Geriatria".split(", ").sort().join(", ")); await expect(dados).toContainText(`CPF: ${cpfA}`); await expect(dados).toContainText("Pessoa física");
    await page.screenshot({ path: "docs/screenshots/onboarding/gestor-ficha-fisio.png", fullPage: true });
    // o mesmo link não abre de novo
    await page.goto(linkA); await expect(page.getByTestId("onboarding-link-invalido")).toContainText("já foi usado", { timeout: 30_000 });
  });

  test("com CNPJ o cadastro vira pessoa jurídica (empresa + representante)", async ({ page }) => {
    const errors = collectErrors(page); await stubSignUp(page);
    await page.goto(linkB); await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: 40_000 });
    await page.locator("#ob-name").fill(`Rafael PJ Teste R29 ${runId.toUpperCase()}`); await page.locator("#ob-birth").fill("1985-02-20"); await page.locator("#ob-cpf").fill(cpfB); await next(page);
    await page.locator("#ob-phone").fill("11977776666"); await fillAddress(page); await next(page);
    await page.locator("#ob-council").fill("654321-F"); await page.locator("#ob-council-uf").selectOption("SP"); await page.getByLabel("Neurologia").check();
    await page.getByLabel("Pessoa jurídica (CNPJ: MEI, Ltda…)").check();
    await page.locator("#ob-cnpj").fill("11.111.111/1111-11"); await page.locator("#ob-legal").fill(`Gomes Fisio R29 ${runId} Ltda`); await next(page); await expect(page.getByText("CNPJ inválido.")).toBeVisible();
    await page.locator("#ob-cnpj").fill(cnpjB); await expect(page.locator("#ob-cnpj")).toHaveValue(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/); await next(page);
    await page.locator("#ob-pixtype").selectOption("cnpj"); await page.locator("#ob-pix").fill(cnpjB); await next(page);
    await page.locator("#ob-pw").fill(PASS); await page.locator("#ob-pw2").fill(PASS); await page.locator("#ob-consent").check(); await next(page);
    await expect(page.getByTestId("onboarding-concluido")).toBeVisible({ timeout: 40_000 });
    const g = api(await signIn(QA.manager));
    const ent = (await g.get(`legal_entities?select=id,legal_name,origin&cnpj=eq.${cnpjB}`)).body as { id: string; origin: string }[]; expect(ent).toHaveLength(1); expect(ent[0].origin).toBe("onboarding_fisio");
    const reps = (await g.get(`legal_entity_representatives?select=representation_type,is_primary&legal_entity_id=eq.${ent[0].id}`)).body as { representation_type: string; is_primary: boolean }[];
    expect(reps).toEqual([{ representation_type: "legal_representative", is_primary: true }]);
    const sub = (await g.get(`onboarding_submissions?select=doc_kind&email=eq.${emailB}`)).body as { doc_kind: string }[]; expect(sub[0].doc_kind).toBe("pj");
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("Primeiro acesso: e-mail sem cadastro recebe mensagem de erro; e-mail que já tem conta é orientado a entrar", async ({ page }) => {
    const unknown = `nao.cadastrado.r29.${runId.toLowerCase()}@example.com`;
    await page.goto("/primeiro-acesso"); await expect(page.getByRole("heading", { name: "Primeiro acesso" })).toBeVisible();
    await page.getByLabel("E-mail").fill(unknown); await page.getByLabel("Crie uma senha").fill(PASS); await page.getByLabel("Confirme a senha").fill(PASS);
    await page.getByRole("button", { name: "Criar acesso" }).click();
    await expect(page.getByRole("alert")).toContainText("não está cadastrado no sistema", { timeout: 30_000 });
    await page.screenshot({ path: "docs/screenshots/onboarding/primeiro-acesso-sem-cadastro.png" });
    await expect(page.getByText("Verifique seu e-mail")).toHaveCount(0);
    // e-mail que já tem conta confirmada (usuário de QA)
    await page.getByLabel("E-mail").fill(QA.manager); await page.getByRole("button", { name: "Criar acesso" }).click();
    await expect(page.getByRole("alert")).toContainText("já tem acesso ao sistema", { timeout: 30_000 });
  });

  test("depois do e-mail confirmado: o fisioterapeuta entra, vê o TUTORIAL do perfil dele e nenhum dado sensível de outras pessoas", async ({ page }) => {
    const errors = collectErrors(page);
    // simula o clique no link do e-mail: conta já confirmada, que o gatilho de convites liga à pessoa e ao profissional
    const uid = await createConfirmedUser(emailA, PASS); authUsers.push(uid);
    const g = api(await signIn(QA.manager));
    const person = (await g.get(`people?select=id&document_number=eq.${cpfA}`)).body[0].id as string;
    const acc = (await g.get(`user_accounts?select=person_id,display_name&user_id=eq.${uid}`)).body as { person_id: string; display_name: string }[];
    expect(acc[0].person_id).toBe(person); expect(acc[0].display_name).toBe("Fe");
    expect((await g.get(`professionals?select=user_id&person_id=eq.${person}`)).body[0].user_id).toBe(uid);
    expect((await g.get(`role_assignments?select=role&user_id=eq.${uid}`)).body).toEqual([{ role: "physio" }]);

    await uiLogin(page, emailA, PASS);
    await expect(page).toHaveURL(/\/boas-vindas$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Bem-vindo\(a\), Fe!/ })).toBeVisible();
    await expect(page.getByTestId("tutorial-physio")).toContainText("Sua agenda"); await expect(page.getByTestId("tutorial-physio")).toContainText("Acompanhamento dos pacientes");
    await expect(page.getByTestId("tutorial-gestao")).toHaveCount(0);
    await expect(page.getByTestId("tutorial-privacidade")).toContainText("NÃO vê dados sensíveis");
    await page.screenshot({ path: "docs/screenshots/onboarding/tutorial-fisio.png", fullPage: true });
    await page.getByTestId("tutorial-comecar").click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
    // sem dado sensível: não abre Financeiro nem configurações do sistema, e não lê dados de pagamento/ficha alheios
    await page.goto("/admin/financeiro"); await expect(page.getByText(/Sem permissão|não tem permissão|Acesso/i).first()).toBeVisible({ timeout: 30_000 });
    const mine = api({ access_token: (await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.endsWith("-auth-token")); return k ? JSON.parse(localStorage.getItem(k)!).access_token : ""; })), user: { id: uid } } as never);
    const bank = (await mine.get("person_bank_info?select=person_id")).body as { person_id: string }[]; expect(bank.map((b) => b.person_id)).toEqual([person]);
    expect((await mine.get("people?select=id")).body).toHaveLength(1);
    // próximo login não repete o tutorial
    await page.goto("/app"); await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Menu do usuário" }).click(); await expect(page.getByTestId("menu-tutorial")).toBeVisible();
    expect(errors.filter((e) => !/403|permission|42501|Failed to load resource/i.test(e)), errors.join(" | ")).toEqual([]);
  });
});
