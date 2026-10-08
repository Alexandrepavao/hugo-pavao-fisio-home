// ACEITE da release v1 — Onboarding do paciente (/onboarding-paciente): rota aberta, cadastro em Pessoas, acesso ao portal e tutorial.
//  · o formulário valida (CPF, CEP, emergência, saúde só com consentimento) e cria o paciente em Pessoas com a ficha (emergência, referência, motivo)
//  · se o e-mail JÁ está cadastrado, nada do cadastro existente muda no envio; só depois do dono confirmar o acesso é que os campos vazios são preenchidos
//  · e-mail que já tem conta recebe orientação; depois do e-mail confirmado o paciente entra, vê o TUTORIAL do perfil dele e abre o portal
// E-mails NÃO são enviados: o teste intercepta só a criação da senha e simula a confirmação no banco de teste. Somente Dev; limpa o que cria.
import { expect, test, type Page } from "@playwright/test";
import { api, canTimeTravel, collectErrors, createConfirmedUser, deleteAuthUser, devSql, loginAs, QA, runId, signIn, uiLogin } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1280, height: 900 } });

const cpfFrom = (seed: number) => {
  const d = Array.from({ length: 9 }, (_, i) => (seed * (i + 5) + i * 3) % 10); if (new Set(d).size === 1) d[0] = (d[0] + 1) % 10;
  const dv = (n: number[]) => { const r = (n.reduce((a, v, i) => a + v * (n.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d); const d2 = dv([...d, d1]); return [...d, d1, d2].join("");
};
const PASS = `E2e-${runId}-Paciente!1`;
const stubSignUp = async (page: Page) => page.route("**/auth/v1/signup**", async (route) => {
  const body = route.request().postDataJSON() as { email: string };
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-0000-0000-0000000000b1", aud: "authenticated", role: "", email: body.email, identities: [{ id: "x" }], created_at: new Date().toISOString() }) });
});
const next = (page: Page) => page.getByRole("button", { name: /^(Continuar|Concluir cadastro)/ }).click();
const fillAddress = async (page: Page, ref = "") => {
  await page.locator("#ob-cep").fill("09015-000"); await page.locator("#ob-cep").blur(); await page.waitForTimeout(1200);
  await page.locator("#ob-street").fill("Rua do Paciente E2E"); await page.locator("#ob-number").fill("50"); await page.locator("#ob-neigh").fill("Jardim"); await page.locator("#ob-city").fill("Santo André"); await page.locator("#ob-uf").selectOption("SP");
  if (ref) await page.locator("#ob-ref").fill(ref);
};

test.describe.serial("@release Onboarding do paciente + tutorial", () => {
  test.setTimeout(240_000);
  test.skip(!canTimeTravel(), "precisa de SUPABASE_ACCESS_TOKEN (cria e limpa dados de teste no Dev)");
  const seed = Number.parseInt(runId.slice(-3), 36); const cpf = cpfFrom(seed + 7); const email = `pac.r30.${runId.toLowerCase()}@example.com`; const nome = `Paulo Souza Teste R30 ${runId.toUpperCase()}`;
  const leadEmail = `lead.r30.${runId.toLowerCase()}@example.com`; const leadCpf = cpfFrom(seed + 19); const authUsers: string[] = [];

  test.afterAll(async () => {
    for (const id of authUsers) await deleteAuthUser(id).catch(() => undefined);
    const like = `%r30.${runId.toLowerCase()}%`;
    await devSql(`delete from public.invitations where email like '${like}'; delete from public.onboarding_submissions where email like '${like}';
      delete from public.people where id in (select person_id from public.person_contacts where value like '${like}')`).catch(() => undefined);
  });

  test("paciente preenche o formulário aberto (com validações) e o cadastro entra em Pessoas com a ficha", async ({ page }) => {
    const errors = collectErrors(page); await stubSignUp(page);
    await page.goto("/onboarding-paciente"); await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
    await next(page); await expect(page.getByText("Informe o nome completo")).toBeVisible(); await expect(page.getByText("CPF inválido.")).toBeVisible();
    await page.locator("#ob-name").fill(nome); await page.locator("#ob-pref").fill("Paulo"); await page.locator("#ob-birth").fill("1950-03-02"); await page.locator("#ob-cpf").fill(cpf);
    await page.screenshot({ path: "docs/screenshots/onboarding/paciente-etapa-1.png" }); await next(page);
    await expect(page.getByTestId("onboarding-etapa")).toContainText("Etapa 2 de 4");
    await page.locator("#ob-email").fill(email); await page.locator("#ob-phone").fill("11977776666"); await fillAddress(page, "portão azul"); await next(page);
    // etapa 3: emergência e saúde
    await next(page); await expect(page.getByText("Informe o nome do contato de emergência.")).toBeVisible(); await expect(page.getByText("Informe o telefone do contato com DDD.")).toBeVisible();
    await page.locator("#ob-em-name").fill("Marta Souza"); await page.locator("#ob-em-rel").fill("Filha"); await page.locator("#ob-em-phone").fill("11966665555");
    await page.locator("#ob-complaint").fill("Dor no joelho ao subir escadas"); await expect(page.locator("#ob-health")).toBeVisible();
    await next(page); await expect(page.getByText("autorize o uso de dado de saúde")).toBeVisible();
    await page.locator("#ob-health").check(); await page.locator("#ob-how").selectOption({ index: 1 }); await page.screenshot({ path: "docs/screenshots/onboarding/paciente-etapa-3.png", fullPage: true });
    await next(page);
    // etapa 4
    await expect(page.getByTestId("onboarding-login-email")).toHaveText(email);
    await page.locator("#ob-pw").fill(PASS); await page.locator("#ob-pw2").fill(PASS); await next(page); await expect(page.getByText("É preciso aceitar para concluir")).toBeVisible();
    await page.locator("#ob-consent").check(); await next(page);
    await expect(page.getByTestId("onboarding-concluido")).toBeVisible({ timeout: 40_000 }); await expect(page.getByTestId("onboarding-concluido")).toContainText(email);
    await expect(page.getByTestId("onboarding-concluido")).toContainText("quantas ainda faltam");
    await page.screenshot({ path: "docs/screenshots/onboarding/paciente-concluido.png", fullPage: true });
    expect(errors, errors.join(" | ")).toEqual([]);
  });

  test("o paciente entrou em Pessoas, a ficha foi guardada e e-mail já cadastrado NÃO tem o cadastro alterado até confirmar", async ({ page, context }) => {
    const g = api(await signIn(QA.manager));
    const p = (await g.get(`people?select=id,origin,registration_status,city,document_number&document_number=eq.${cpf}`)).body as { id: string; origin: string; registration_status: string; city: string }[];
    expect(p).toHaveLength(1); expect(p[0]).toMatchObject({ origin: "onboarding_paciente", registration_status: "ativo", city: "Santo André" });
    const kinds = (await g.get(`person_kinds?select=kind&person_id=eq.${p[0].id}`)).body as { kind: string }[]; expect(kinds.map((k) => k.kind)).toEqual(["patient"]);
    const intake = (await g.get(`person_intake?select=emergency_name,emergency_relation,address_reference,main_complaint,how_found,health_consent_at&person_id=eq.${p[0].id}`)).body[0] as Record<string, string | null>;
    expect(intake).toMatchObject({ emergency_name: "Marta Souza", emergency_relation: "Filha", address_reference: "portão azul", main_complaint: "Dor no joelho ao subir escadas" }); expect(intake.health_consent_at).not.toBeNull();
    expect((await g.get(`invitations?select=role,person_id&email=eq.${email}`)).body).toEqual([{ role: "member", person_id: p[0].id }]);

    // a gestão vê a ficha completa na planilha administrativa
    await loginAs(context, QA.manager); await page.goto(`/admin/adm/diretorio?q=${encodeURIComponent(nome)}`); await page.getByRole("button", { name: nome }).click();
    const ficha = page.getByTestId("adm-onboarding-dados"); await expect(ficha).toBeVisible({ timeout: 30_000 });
    await expect(ficha).toContainText("Marta Souza (Filha)"); await expect(ficha).toContainText("portão azul"); await expect(ficha).toContainText("Dor no joelho ao subir escadas");
    await page.screenshot({ path: "docs/screenshots/onboarding/gestor-ficha-paciente.png", fullPage: true });
    // cadastro que JÁ existia com este e-mail (ex.: lead do quiz): o envio não escreve nada nele
    await devSql(`with o as (select id from public.organizations where slug = 'hp-group'), p as (insert into public.people (org_id, full_name, city) select id, 'Lead Antigo Teste R30 ${runId.toUpperCase()}', 'Cidade do Lead' from o returning id, org_id),
      c as (insert into public.person_contacts (org_id, person_id, type, value, is_primary) select org_id, id, 'email', '${leadEmail}', true from p) select 1`);
    const anon = api(null);
    const dados = { full_name: `Lead Antigo Teste R30 ${runId.toUpperCase()}`, preferred_name: "Lead", birth_date: "1960-01-01", cpf: leadCpf, email: leadEmail, phone: "(11) 95555-4444", cep: "09015-000", street: "Rua Nova", street_number: "9", neighborhood: "Centro", city: "Cidade Nova", state_uf: "SP",
      emergency_name: "Contato", emergency_phone: "(11) 94444-3333", emergency_relation: "Irmão" };
    const r = await anon.rpc("onboarding_submit_patient", { p_data: dados, p_consent_version: "onboarding-v1", p_health_consent: false, p_honeypot: "" }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lead = (await g.get(`people?select=id,document_number,city,birth_date&full_name=ilike.*Lead Antigo Teste R30 ${runId.toUpperCase()}*`)).body[0] as { id: string; document_number: string | null; city: string; birth_date: string | null };
    expect(lead.document_number, "CPF NÃO foi gravado no cadastro existente").toBeNull(); expect(lead.city).toBe("Cidade do Lead"); expect(lead.birth_date).toBeNull();
    expect((await g.get(`person_intake?select=person_id&person_id=eq.${lead.id}`)).body).toHaveLength(0);
    expect((await g.get(`onboarding_submissions?select=status&person_id=eq.${lead.id}`)).body).toEqual([{ status: "awaiting_confirmation" }]);
    // o dono do e-mail confirma o acesso: só agora os vazios são preenchidos (a cidade que já existia permanece)
    authUsers.push(await createConfirmedUser(leadEmail, PASS));
    const after = (await g.get(`people?select=document_number,city,birth_date,preferred_name&id=eq.${lead.id}`)).body[0] as Record<string, string | null>;
    expect(after).toMatchObject({ document_number: leadCpf, city: "Cidade do Lead", birth_date: "1960-01-01", preferred_name: "Lead" });
    expect((await g.get(`person_intake?select=emergency_name&person_id=eq.${lead.id}`)).body).toEqual([{ emergency_name: "Contato" }]);
    expect((await g.get(`onboarding_submissions?select=status&person_id=eq.${lead.id}`)).body).toEqual([{ status: "applied" }]);
  });

  test("e-mail que já tem conta é orientado a entrar (mensagem na tela)", async ({ page }) => {
    await page.goto("/onboarding-paciente"); await expect(page.getByTestId("onboarding-form")).toBeVisible({ timeout: 40_000 });
    await page.locator("#ob-name").fill("Paciente Com Conta Teste"); await page.locator("#ob-birth").fill("1980-01-01"); await page.locator("#ob-cpf").fill(cpfFrom(seed + 41)); await next(page);
    await page.locator("#ob-email").fill(QA.paciente); await page.locator("#ob-phone").fill("11955554444"); await fillAddress(page); await next(page);
    await page.locator("#ob-em-name").fill("Contato"); await page.locator("#ob-em-rel").fill("Irmão"); await page.locator("#ob-em-phone").fill("11944443333"); await next(page);
    await page.locator("#ob-pw").fill(PASS); await page.locator("#ob-pw2").fill(PASS); await page.locator("#ob-consent").check(); await next(page);
    await expect(page.getByTestId("onboarding-erro")).toContainText("já tem acesso ao sistema", { timeout: 30_000 });
    await expect(page.getByTestId("onboarding-concluido")).toHaveCount(0);
  });

  test("depois do e-mail confirmado: o paciente entra, vê o TUTORIAL do perfil dele e abre o portal", async ({ page }) => {
    const errors = collectErrors(page);
    const uid = await createConfirmedUser(email, PASS); authUsers.push(uid);
    const g = api(await signIn(QA.manager));
    const person = (await g.get(`people?select=id&document_number=eq.${cpf}`)).body[0].id as string;
    expect((await g.get(`user_accounts?select=person_id,display_name&user_id=eq.${uid}`)).body).toEqual([{ person_id: person, display_name: "Paulo" }]);
    expect((await g.get(`role_assignments?select=role&user_id=eq.${uid}`)).body).toEqual([{ role: "member" }]);
    await uiLogin(page, email, PASS);
    await expect(page).toHaveURL(/\/boas-vindas$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Bem-vindo\(a\), Paulo!/ })).toBeVisible();
    const t = page.getByTestId("tutorial-member"); await expect(t).toContainText("Suas sessões"); await expect(t).toContainText("quantas você já fez e quantas ainda faltam"); await expect(t).toContainText("Sua evolução");
    await expect(page.getByTestId("tutorial-physio")).toHaveCount(0); await expect(page.getByTestId("tutorial-privacidade")).toContainText("Nenhum outro paciente vê as suas informações");
    await page.screenshot({ path: "docs/screenshots/onboarding/tutorial-paciente.png", fullPage: true });
    await page.getByTestId("tutorial-comecar").first().click();
    await expect(page).toHaveURL(/\/paciente$/, { timeout: 30_000 });
    await expect(page.getByText(/Sem permissão ou falha/)).toHaveCount(0);
    await page.goto("/app"); await expect(page).toHaveURL(/\/paciente$/, { timeout: 30_000 });             // próximo login: vai direto ao portal
    expect(errors.filter((e) => !/403|permission|42501|Failed to load resource/i.test(e)), errors.join(" | ")).toEqual([]);
  });
});
