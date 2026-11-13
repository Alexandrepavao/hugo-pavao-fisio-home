// NOVO — N29: barra de pesquisa global (Ctrl+K) — foco em pessoas e leads, com tipo + lugar na mesma frase (fisioterapeuta + bairro, cidade ou zona); páginas só com “/”.
// Dados próprios (runId), removidos no fim. Nada aqui toca produção.
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { collectErrors, devSql, loginAs, QA, runId } from "../release/helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const shot = async (p: Page, name: string) => { if (process.env.MKT_SHOTS) await p.screenshot({ path: join(process.env.MKT_SHOTS, `${name}.png`) }); };
const noOverflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe.serial("@novos Busca global de pessoas e leads", () => {
  test.setTimeout(240_000);
  const tag = `N29 ${runId}`; const fisioRio = `Fisio Copa ${tag}`; const fisioSp = `Fisio Moema ${tag}`; const paciente = `Paciente Moema ${tag}`; const lead = `Lead Campinas ${tag}`;
  const clean = async () => {
    await devSql(`set local session_replication_role = replica;
      delete from public.professional_profiles where person_id in (select id from public.people where full_name like '% ${tag}');
      delete from public.professionals where person_id in (select id from public.people where full_name like '% ${tag}');
      delete from public.person_contacts where person_id in (select id from public.people where full_name like '% ${tag}');
      delete from public.person_kinds where person_id in (select id from public.people where full_name like '% ${tag}');
      delete from public.people where full_name like '% ${tag}';`).catch(() => null);
  };
  test.beforeAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });
  test.afterAll(async () => { if (process.env.SUPABASE_ACCESS_TOKEN) await clean(); });

  test("fixture: fisioterapeuta no Rio (Copacabana, atende Zona Sul e Oeste), fisioterapeuta em São Paulo (Moema), paciente em Moema e lead em Campinas", async () => {
    await devSql(`do $$ declare v_org uuid; ua uuid; a uuid; b uuid; c uuid; d uuid; pf uuid;
    begin
      select id into v_org from public.organizations where slug = 'hp-group'; select id into ua from public.units where org_id = v_org and slug = 'sao-paulo';
      insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, '${fisioRio}', 'Rio de Janeiro', 'RJ', 'Copacabana', 'rj-sul') returning id into a;
      insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, '${fisioSp}', 'São Paulo', 'SP', 'Moema', 'sul') returning id into b;
      insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood, zone) values (v_org, ua, '${paciente}', 'São Paulo', 'SP', 'Moema', 'sul') returning id into c;
      insert into public.people (org_id, unit_id, full_name, city, state_uf, neighborhood) values (v_org, ua, '${lead}', 'Campinas', 'SP', 'Cambuí') returning id into d;
      insert into public.person_kinds (person_id, kind) values (a, 'staff'), (b, 'staff'), (c, 'patient'), (d, 'lead');
      insert into public.person_contacts (org_id, person_id, type, value, normalized, is_primary) values (v_org, a, 'phone', '(21) 98888-2929', '5521988882929', true), (v_org, a, 'email', 'copa.n29@example.com', 'copa.n29@example.com', true);
      insert into public.professionals (org_id, display_name, person_id, active) values (v_org, '${fisioRio}', a, true) returning id into pf;
      insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (a, v_org, pf, 'pf', array['rj-sul', 'rj-oeste']);
      insert into public.professionals (org_id, display_name, person_id, active) values (v_org, '${fisioSp}', b, true) returning id into pf;
      insert into public.professional_profiles (person_id, org_id, professional_id, work_as, service_zones) values (b, v_org, pf, 'pf', array['sul']);
    end $$;`);
    const n = ((await devSql(`select count(*)::int n from public.people where full_name like '% ${tag}'`)) as { n: number }[])[0].n; expect(n).toBe(4);
  });

  const abrir = async (page: Page) => { await page.keyboard.press("Control+k"); await expect(page.getByRole("dialog")).toBeVisible(); return page.getByRole("dialog"); };
  const digitar = async (page: Page, texto: string) => { const i = page.getByPlaceholder(/Buscar pessoa/); await i.fill(""); await i.fill(texto); };

  test("abre sem lista de páginas: mostra como buscar (exemplos clicáveis) e o placeholder fala de pessoa, lead, bairro, cidade e zona", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin"); await expect(page.locator("body")).toBeVisible(); await page.waitForLoadState("networkidle");
    const dlg = await abrir(page);
    await expect(page.getByPlaceholder("Buscar pessoa, lead, fisioterapeuta, bairro, cidade ou zona…")).toBeVisible();
    await expect(dlg.getByTestId("cmd-ajuda")).toBeVisible(); await expect(dlg.getByTestId("cmd-item")).toHaveCount(0);   // nada de lista de páginas
    await expect(dlg).not.toContainText("Configurações da conta");
    await dlg.getByRole("button", { name: "fisioterapeuta zona sul" }).click(); await expect(page.getByPlaceholder(/Buscar pessoa/)).toHaveValue("fisioterapeuta zona sul");
    await shot(page, "busca-ajuda"); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("tipo + bairro, cidade e zona na mesma frase: o que foi entendido aparece e os resultados mostram zona, contato e as zonas que a fisioterapeuta atende", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin"); await page.waitForLoadState("networkidle"); const dlg = await abrir(page);
    // fisioterapeuta + bairro
    await digitar(page, `fisioterapeuta copacabana ${runId}`); const rows = dlg.getByTestId("cmd-pessoa"); await expect(rows).toHaveCount(1, { timeout: 20_000 });
    await expect(rows.first()).toContainText(fisioRio); await expect(rows.first()).toContainText("Copacabana, Rio de Janeiro/RJ"); await expect(rows.first()).toContainText("Zona Sul"); await expect(rows.first()).toContainText("(21) 98888-2929");
    await expect(rows.first()).toContainText("Atende: Zona Sul, Zona Oeste"); await expect(rows.first()).toContainText("Fisioterapeuta");
    await expect(dlg.getByTestId("cmd-entendi")).toContainText("Fisioterapeutas e parceiros"); await expect(dlg.getByTestId("cmd-entendi")).toContainText("copacabana");
    await shot(page, "busca-fisio-copacabana");
    // fisioterapeuta + zona: onde mora E zonas que atende (Rio e São Paulo)
    await digitar(page, `fisioterapeuta zona sul ${runId}`); await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(dlg.getByTestId("cmd-entendi")).toContainText("Zona Sul"); await expect(dlg).toContainText(fisioRio); await expect(dlg).toContainText(fisioSp);
    await digitar(page, `fisioterapeuta zona oeste ${runId}`); await expect(rows).toHaveCount(1, { timeout: 20_000 }); await expect(rows.first()).toContainText(fisioRio);   // atende a zona oeste
    await digitar(page, `fisioterapeuta zona sul rio de janeiro ${runId}`); await expect(rows).toHaveCount(1, { timeout: 20_000 }); await expect(rows.first()).toContainText(fisioRio);
    // paciente, lead, sem acento nem caixa
    await digitar(page, `PACIENTE moema ${runId}`); await expect(rows).toHaveCount(1, { timeout: 20_000 }); await expect(rows.first()).toContainText(paciente);
    await digitar(page, `lead campinas ${runId}`); await expect(rows).toHaveCount(1, { timeout: 20_000 }); await expect(rows.first()).toContainText(lead);
    await digitar(page, `sao paulo fisioterapeuta ${runId}`); await expect(rows).toHaveCount(1, { timeout: 20_000 }); await expect(rows.first()).toContainText(fisioSp);
    // e-mail e telefone
    await digitar(page, "copa.n29@example"); await expect(rows.filter({ hasText: fisioRio })).toHaveCount(1, { timeout: 20_000 });
    await digitar(page, "98888 2929"); await expect(rows.filter({ hasText: fisioRio })).toHaveCount(1, { timeout: 20_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("resultado abre a pessoa em Pessoas; a busca fica nas recentes; sem resultado explica; “/” procura páginas sem misturar com pessoas", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin"); await page.waitForLoadState("networkidle"); let dlg = await abrir(page);
    await digitar(page, `paciente moema ${runId}`); await dlg.getByTestId("cmd-pessoa").first().click(); await expect(page).toHaveURL(/\/admin\/pessoas\?q=/); await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/admin"); await page.waitForLoadState("networkidle"); dlg = await abrir(page);
    await expect(dlg.getByTestId("cmd-ajuda")).toBeVisible(); await expect(dlg).toContainText("Buscas recentes"); await expect(dlg).toContainText(`paciente moema ${runId}`);
    await digitar(page, `fisioterapeuta nomequenaoexiste ${runId}`); await expect(dlg.getByTestId("cmd-vazio")).toContainText("Nenhuma pessoa encontrada", { timeout: 20_000 });
    // páginas só com “/”
    await digitar(page, "/agenda"); await expect(dlg.getByTestId("cmd-item").first()).toBeVisible(); await expect(dlg.getByTestId("cmd-pessoa")).toHaveCount(0);
    await shot(page, "busca-paginas"); await dlg.getByTestId("cmd-item").first().click(); await expect(page).toHaveURL(/\/admin\//);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("390 px: a busca cabe na tela, mostra o que foi entendido e não gera rolagem horizontal", async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Sao_Paulo", viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); await loginAs(ctx, QA.manager); const p = await ctx.newPage(); const errors = collectErrors(p);
    await p.goto("/admin"); await p.waitForLoadState("networkidle"); await p.keyboard.press("Control+k"); const dlg = p.getByRole("dialog"); await expect(dlg).toBeVisible();
    await digitar(p, `fisioterapeuta zona sul ${runId}`); await expect(dlg.getByTestId("cmd-pessoa")).toHaveCount(2, { timeout: 20_000 });
    expect(await noOverflow(p)).toBe(true); const box = await dlg.boundingBox(); expect(box && box.x >= 0 && box.x + box.width <= 391, "diálogo dentro da tela").toBe(true);
    await shot(p, "busca-mobile"); expect(errors, errors.join("\n")).toEqual([]); await ctx.close();
  });
});
