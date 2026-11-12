// NOVO — N27: clicar num lead da lista de um cartão (Início › Alertas › “Leads sem retorno”, CRM) abre um modal com o resumo do lead; cartões que não listam leads continuam sem clique.
// Dados próprios (runId), removidos no fim. Nada aqui toca produção.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe.serial("@novos CRM: resumo do lead em modal", () => {
  test.setTimeout(240_000);
  const nome = `Lead Resumo N27 ${runId}`; const email = `lead.resumo.n27.${runId.toLowerCase()}@example.com`;
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.interactions where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.crm_tasks where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.opportunity_events where opportunity_id in (select id from public.opportunities where person_id in (select id from public.people where full_name = '${nome}'));
      delete from public.opportunities where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.person_contacts where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.person_kinds where person_id in (select id from public.people where full_name = '${nome}');
      delete from public.people where full_name = '${nome}';`).catch(() => null);
  };
  test.beforeAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixture: um lead aberto, sem retorno há mais de um ano (o mais antigo da fila), com telefone, e-mail, zona e um registro de contato", async () => {
    await devSql(`do $$
    declare v_org uuid; ua uuid; mgr uuid; pipe uuid; p uuid; o uuid;
    begin
      select id into v_org from public.organizations where slug = 'hp-group'; select id into ua from public.units where org_id = v_org and slug = 'sao-paulo';
      select u.id into mgr from auth.users u where u.email = '${QA.manager}';
      select id into pipe from public.pipelines where org_id = v_org and name = 'Pacientes' limit 1;
      insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, '${nome}', 'São Paulo', 'SP', 'Pinheiros', 'oeste') returning id into p;
      insert into public.person_contacts (org_id, person_id, type, value, normalized, is_primary) values (v_org, p, 'email', '${email}', '${email}', true), (v_org, p, 'phone', '(11) 98888-7766', '5511988887766', false);
      set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
      o := public.crm_create_opportunity(p, pipe, ua, 'Quiz — avaliação (N27)', null, 0, mgr, 'teste n27', null);
      reset role;
      insert into public.interactions (org_id, person_id, unit_id, opportunity_id, channel, summary, created_by) values (v_org, p, ua, o, 'call', 'Primeira ligação: pediu para retornar depois do feriado (N27)', mgr);
      update public.opportunities set created_at = now() - interval '420 days', last_contact_at = now() - interval '400 days' where id = o;
    end $$;`);
    const n = ((await devSql(`select count(*)::int n from public.opportunities where person_id in (select id from public.people where full_name = '${nome}')`)) as { n: number }[])[0].n; expect(n).toBe(1);
  });

  test("Início › Leads sem retorno: o item abre o resumo do lead em um modal (contato, zona, origem, último registro) e o cartão da lista continua aberto por baixo", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin"); await page.getByRole("button", { name: /Leads sem retorno/ }).click();
    const sheet = page.getByRole("dialog").first(); await expect(sheet).toContainText("Leads sem retorno há mais de 48h", { timeout: 30_000 });
    const item = sheet.getByTestId("card-item-lead").filter({ hasText: nome }); await expect(item).toBeVisible({ timeout: 30_000 }); await expect(item).toContainText("Ver resumo");
    await item.click();
    const modal = page.getByTestId("lead-resumo"); await expect(modal).toBeVisible(); await expect(modal).toContainText(nome);
    await expect(modal).toContainText("Em aberto"); await expect(modal).toContainText("Pacientes"); await expect(modal).toContainText(/Sem contato há \d{3} dias/);
    const contato = modal.getByTestId("lead-resumo-contato"); await expect(contato).toContainText("(11) 98888-7766"); await expect(contato).toContainText(email); await expect(contato).toContainText("Pinheiros · São Paulo/SP"); await expect(contato).toContainText("Zona Oeste");
    await expect(contato.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/5511988887766");
    await expect(modal.getByTestId("lead-resumo-fatos")).toContainText("teste n27"); await expect(modal.getByTestId("lead-resumo-fatos")).toContainText("Chegou em");
    await expect(modal.getByTestId("lead-resumo-historico")).toContainText("Primeira ligação"); await expect(modal.getByTestId("lead-resumo-historico")).toContainText("Ligação");
    await expect(modal.getByTestId("lead-resumo-formulario")).toBeVisible();
    await shot(page, "lead-resumo");
    await page.keyboard.press("Escape"); await expect(page.getByTestId("lead-resumo")).toHaveCount(0);
    await expect(page.getByRole("dialog").first()).toContainText("Leads sem retorno há mais de 48h");   // a lista segue aberta
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("botões do modal: Ver cadastro e Abrir no CRM levam às telas certas; cartões que não listam leads continuam sem clique", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin"); await page.getByRole("button", { name: /Leads sem retorno/ }).click();
    await page.getByTestId("card-item-lead").filter({ hasText: nome }).click();
    await page.getByTestId("lead-resumo").getByRole("link", { name: "Ver cadastro" }).click(); await expect(page).toHaveURL(/\/admin\/pessoas\?q=/);
    await page.goto("/admin"); await page.getByRole("button", { name: /Leads sem retorno/ }).click(); await page.getByTestId("card-item-lead").filter({ hasText: nome }).click();
    await page.getByTestId("lead-resumo").getByRole("link", { name: "Abrir no CRM" }).click(); await expect(page).toHaveURL(/\/admin\/crm\/oportunidades/);
    // um cartão que lista outra coisa (contas, pacotes…) não ganha clique nos itens
    await page.goto("/admin"); await page.getByRole("button", { name: /Pacientes com pacote ativo/ }).click(); await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("card-item-lead")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px: o modal cabe na tela, rola por dentro e não gera rolagem horizontal", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto("/admin"); await p.getByRole("button", { name: /Leads sem retorno/ }).click(); await p.getByTestId("card-item-lead").filter({ hasText: nome }).click();
    const modal = p.getByTestId("lead-resumo"); await expect(modal).toBeVisible(); expect(await noOverflow(p)).toBe(true);
    const box = await modal.boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= 391, "modal dentro da tela").toBe(true);
    await shot(p, "lead-resumo-mobile"); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
