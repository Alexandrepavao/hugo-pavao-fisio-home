// ACEITE da release v1 — Configurações da conta: menu do canto superior + atalho na barra lateral, edição do próprio nome, segurança e acesso.
//  · o gestor chega às Configurações pelo menu do usuário (cabeçalho) e pela barra lateral de QUALQUER aplicativo; o nome editado aparece no cabeçalho e na saudação
//  · um papel que NÃO é gestor (fisioterapeuta) também edita o próprio nome (antes só gestor conseguia)
//  · senha: validações na tela (curta, confirmação diferente) SEM trocar a senha das contas de QA; "Configurações do sistema" só aparece para administradores
// Cada teste devolve o nome original no fim. Somente Dev/teste.
import { expect, test } from "@playwright/test";
import { api, canTimeTravel, collectErrors, devSql, expectNoFatal, loginAs, QA, runId } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });

test.describe.serial("@release Configurações da conta", () => {
  test.setTimeout(150_000);
  const novoNome = `Gestora QA ${runId.toUpperCase()}`; let nomeOriginal = "";

  test("gestor: menu do usuário e barra lateral levam às Configurações; renomear reflete no cabeçalho e na saudação", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    const cur = await api(s).get(`user_accounts?select=display_name&user_id=eq.${s.user.id}`); nomeOriginal = cur.body[0].display_name;
    try {
      await page.goto("/admin"); await expect(page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible({ timeout: 40_000 });

      // atalho na barra lateral (rodapé), no Hub e dentro de um aplicativo
      const side = page.getByTestId("sidebar-configuracoes"); await expect(side).toBeVisible(); await expect(side).toContainText("Configurações");
      await page.goto("/admin/crm"); await expect(page.getByTestId("sidebar-configuracoes")).toBeVisible({ timeout: 30_000 });
      await page.goto("/admin/financeiro"); await expect(page.getByTestId("sidebar-configuracoes")).toBeVisible({ timeout: 30_000 });

      // menu do usuário (canto superior): conta e, para administradores, sistema
      await page.goto("/admin"); await page.getByRole("button", { name: "Menu do usuário" }).click();
      await expect(page.getByTestId("menu-configuracoes-sistema")).toBeVisible();
      await page.getByTestId("menu-configuracoes-conta").click();
      await expect(page).toHaveURL(/\/admin\/conta$/); await expect(page.getByRole("heading", { name: "Configurações", exact: true })).toBeVisible();
      await expect(page.getByTestId("sidebar-configuracoes")).toHaveAttribute("aria-current", "page");
      await expectNoFatal(page);

      // renomear
      await expect(page.locator("#ac-name")).toHaveValue(nomeOriginal, { timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Salvar nome" })).toBeDisabled(); // nada mudou
      await page.locator("#ac-name").fill("A"); await page.getByRole("button", { name: "Salvar nome" }).click(); await expect(page.getByText(/ao menos 2 caracteres/)).toBeVisible();
      await page.locator("#ac-name").fill(novoNome); await page.getByRole("button", { name: "Salvar nome" }).click(); await expect(page.getByText("Nome atualizado.")).toBeVisible();
      await page.screenshot({ path: "docs/screenshots/conta/configuracoes-conta.png", fullPage: true });
      await page.getByRole("button", { name: "Menu do usuário" }).click();
      await expect(page.getByRole("menu")).toContainText(novoNome); await page.keyboard.press("Escape");
      await page.goto("/admin"); await expect(page.getByRole("heading", { name: new RegExp(`, ${novoNome.split(" ")[0]}!$`) })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Menu do usuário" }).click(); await page.screenshot({ path: "docs/screenshots/conta/menu-usuario.png", clip: { x: 900, y: 0, width: 540, height: 340 } }); await page.keyboard.press("Escape");
      expect(errors, errors.join("\n")).toEqual([]);

    } finally {
      // devolve o nome original SEMPRE, mesmo se uma verificação acima falhar (não deixa lixo na conta de QA)
      await api(s).rpc("my_account_update", { p_display_name: nomeOriginal });
    }
  });

  test("segurança: senha curta e confirmação diferente são recusadas na tela (sem trocar a senha); sair de todos os aparelhos pede confirmação", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/conta"); await expect(page.getByTestId("conta-seguranca")).toBeVisible({ timeout: 40_000 });
    await page.locator("#sec-pw").fill("curta"); await page.locator("#sec-pw2").fill("curta"); await page.getByRole("button", { name: "Alterar senha" }).click();
    await expect(page.getByText(/ao menos 10 caracteres/).first()).toBeVisible();
    await page.locator("#sec-pw").fill("uma-senha-bem-longa-123"); await page.locator("#sec-pw2").fill("outra-coisa-diferente-123"); await page.getByRole("button", { name: "Alterar senha" }).click();
    await expect(page.getByText("A confirmação não confere com a nova senha.")).toBeVisible();
    await page.getByRole("button", { name: "Sair de todos os aparelhos" }).click(); await expect(page.getByText("Sair de todos os aparelhos?")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click(); await expect(page).toHaveURL(/\/admin\/conta$/);
    await expect(page.getByTestId("conta-acesso")).toContainText("Gestor");
    await expect(page.getByTestId("conta-sistema")).toBeVisible(); // administrador vê o atalho para as configurações do sistema
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("fisioterapeuta (não é gestor): edita o próprio nome; não vê as configurações do sistema", async ({ page, context }) => {
    const s = await loginAs(context, QA.fisio); const errors = collectErrors(page);
    const cur = await api(s).get(`user_accounts?select=display_name&user_id=eq.${s.user.id}`); const original = cur.body[0].display_name as string;
    await page.goto("/admin/conta"); await expect(page.locator("#ac-name")).toHaveValue(original, { timeout: 40_000 });
    await expect(page.getByTestId("conta-sistema")).toHaveCount(0);
    await page.getByRole("button", { name: "Menu do usuário" }).click(); await expect(page.getByTestId("menu-configuracoes-conta")).toBeVisible(); await expect(page.getByTestId("menu-configuracoes-sistema")).toHaveCount(0); await page.keyboard.press("Escape");
    const nome = `Fisio QA ${runId.toUpperCase()}`;
    await page.locator("#ac-name").fill(nome); await page.getByRole("button", { name: "Salvar nome" }).click(); await expect(page.getByText("Nome atualizado.")).toBeVisible();
    const depois = await api(s).get(`user_accounts?select=display_name&user_id=eq.${s.user.id}`); expect(depois.body[0].display_name).toBe(nome);
    await page.locator("#ac-name").fill(original); await page.getByRole("button", { name: "Salvar nome" }).click(); await expect(page.getByText("Nome atualizado.")).toBeVisible();
    await api(s).rpc("my_account_update", { p_display_name: original });
    // quem não é administrador não abre a tela de configurações do sistema
    await page.goto("/admin/configuracoes"); await expect(page.getByText(/Sem permissão|não tem permissão/i).first()).toBeVisible({ timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("conta LIGADA a um cadastro de pessoa: o nome mostrado é o do cadastro (preferência; em branco, o nome completo) e o cabeçalho acompanha", async ({ page, context }) => {
    test.skip(!canTimeTravel(), "precisa de SUPABASE_ACCESS_TOKEN para ligar a conta de QA a um cadastro temporário");
    const s = await loginAs(context, QA.comercial); const errors = collectErrors(page); const uid = s.user.id;
    const original = (await api(s).get(`user_accounts?select=display_name&user_id=eq.${uid}`)).body[0].display_name as string;
    const completo = `Carla Mendes R28 ${runId.toUpperCase()}`; let pid = "";
    try {
      const r = (await devSql(`with o as (select org_id from public.user_accounts where user_id = '${uid}'), p as (insert into public.people (org_id, full_name) select org_id, '${completo}' from o returning id), k as (insert into public.person_kinds (person_id, kind) select id, 'staff' from p) select id from p`)) as { id: string }[];
      pid = r[0].id; await devSql(`update public.user_accounts set person_id = '${pid}' where user_id = '${uid}'`);
      await page.goto("/admin/conta"); await expect(page.locator("#ac-full")).toHaveValue(completo, { timeout: 40_000 });
      await expect(page.locator("#ac-name")).toHaveValue(""); await expect(page.locator('label[for="ac-name"]')).toHaveText("Como quer ser chamado(a)");
      await expect(page.getByTestId("conta-dados")).toContainText("Telefone"); // cadastro ligado: dados pessoais editáveis
      await expect(page.getByRole("button", { name: "Menu do usuário" })).toContainText(completo.split(" ").slice(0, 2).join(" "));
      await page.locator("#ac-name").fill("Carla"); await page.getByRole("button", { name: "Salvar nome" }).click(); await expect(page.getByText("Nome atualizado.")).toBeVisible();
      await page.goto("/admin"); await expect(page.getByRole("button", { name: "Menu do usuário" })).toContainText("Carla", { timeout: 30_000 });
      await page.getByRole("button", { name: "Menu do usuário" }).click(); await expect(page.getByRole("menu")).toContainText("Carla"); await page.keyboard.press("Escape");
      expect((await api(s).get(`user_accounts?select=display_name&user_id=eq.${uid}`)).body[0].display_name).toBe("Carla");
      await page.goto("/admin/conta"); await expect(page.locator("#ac-name")).toHaveValue("Carla", { timeout: 30_000 }); await page.locator("#ac-name").fill(""); await page.getByRole("button", { name: "Salvar nome" }).click(); await expect(page.getByText("Nome atualizado.")).toBeVisible();
      expect((await api(s).get(`user_accounts?select=display_name&user_id=eq.${uid}`)).body[0].display_name).toBe(completo);
      expect(errors, errors.join(" | ")).toEqual([]);
    } finally {
      await devSql(`update public.user_accounts set person_id = null, display_name = '${original.replace(/'/g, "''")}' where user_id = '${uid}'`);
      if (pid) await devSql(`delete from public.people where id = '${pid}'`);
    }
  });
});
