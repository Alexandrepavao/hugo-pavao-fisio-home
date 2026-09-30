// ACEITE da release v1 — nova interface (cabeçalho, filtro único, cartões por nível, mapa do Brasil). Só comportamentos NOVOS; os números dos cartões continuam
// cobertos por R07/R08/R11. Não cria nem altera dados (só lê); a preferência de tema é do navegador do teste.
import { expect, test, type Page } from "@playwright/test";
import { api, collectErrors, expectNoFatal, loginAs, QA, signIn } from "./helpers-release";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });

const noHScroll = async (page: Page, where: string) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `${where}: a página não pode rolar na horizontal (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
};

test.describe.serial("@release Nova interface (desktop)", () => {
  test.setTimeout(150_000);

  test("cabeçalho: logo e app atual, busca discreta, notificações, tema (persistente) e perfil; selo de ambiente fora da barra lateral", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin/adm");
    const header = page.locator("header.hp-header");
    await expect(header.getByRole("heading", { level: 1 })).toHaveText(/^Administrativo · /, { timeout: 30_000 });
    await expect(header.getByRole("button", { name: "Buscar (Ctrl+K)" })).toBeVisible();
    await expect(header.getByRole("button", { name: /^Notificações/ })).toBeVisible();
    await expect(header.getByRole("button", { name: "Usar tema escuro" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Menu do usuário" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Trocar de aplicativo" })).toBeVisible();
    // selo de ambiente: um só, no cabeçalho, sem sobrepor a barra lateral
    await expect(page.getByTestId("env-badge")).toHaveCount(1);
    await expect(page.getByTestId("env-badge")).toContainText("AMBIENTE DE TESTE");
    expect(await page.getByTestId("env-badge").evaluate((el) => !!el.closest("header"))).toBe(true);
    await expect(page.getByTestId("env-badge-fixed")).toBeHidden();
    // busca global abre
    await header.getByRole("button", { name: "Buscar (Ctrl+K)" }).click();
    await expect(page.getByPlaceholder(/Buscar páginas do painel/)).toBeVisible(); await page.keyboard.press("Escape");
    // notificações: só itens reais do próprio usuário (lista ou “nada atrasado”)
    await header.getByRole("button", { name: /^Notificações/ }).click();
    await expect(page.getByText("Precisa da sua atenção")).toBeVisible();
    await expect(page.getByText(/Nada atrasado sob a sua responsabilidade|atrasad/).first()).toBeVisible(); await page.keyboard.press("Escape");
    // tema escuro persiste ao recarregar
    await header.getByRole("button", { name: "Usar tema escuro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 30_000 });
    await expect(page.locator("header.hp-header").getByRole("button", { name: "Usar tema claro" })).toBeVisible();
    await page.locator("header.hp-header").getByRole("button", { name: "Usar tema claro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectNoFatal(page); expect(errors, errors.join("\n")).toEqual([]);
  });

  test("filtro único: período e unidade visíveis, contador de filtros ativos, resumo e “Limpar filtros” (Administrativo, CRM e Financeiro)", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    for (const path of ["/admin/adm", "/admin/crm", "/admin/financeiro"]) {
      await page.goto(path);
      const f = page.getByTestId("period-filter");
      await expect(f.getByRole("button", { name: /^Período: Mês atual/ })).toBeVisible({ timeout: 40_000 });
      await expect(f.getByLabel("Unidade")).toBeVisible();
      await expect(f.getByRole("button", { name: /^Filtros/ })).toBeVisible();
      await expect(f.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);            // nada ativo → sem botão
      // ativa "Ano atual" pelo popover
      await f.getByRole("button", { name: /^Período:/ }).click();
      await page.getByRole("button", { name: "Ano atual", exact: true }).click(); await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      await expect(f.getByRole("button", { name: /^Período: Ano atual/ })).toBeVisible();
      await expect(f.getByRole("button", { name: /^Filtros\s*1$/ })).toBeVisible();              // contador = 1 filtro ativo
      await expect(f.getByRole("button", { name: "Limpar filtros" })).toBeVisible();
      await f.getByRole("button", { name: "Limpar filtros" }).click();
      await expect(f.getByRole("button", { name: /^Período: Mês atual/ })).toBeVisible();
      await expect(f.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);
    }
  });

  test("cartões por nível: Administrativo, CRM, Financeiro e Hub têm Atenção, Resumo e Análise, com período e unidade de medida no cartão", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    for (const path of ["/admin", "/admin/adm", "/admin/crm", "/admin/financeiro"]) {
      await page.goto(path);
      for (const tag of ["Atenção", "Resumo", "Análise"]) await expect(page.locator(".hp-level-tag", { hasText: tag }).first()).toBeVisible({ timeout: 40_000 });
    }
    await page.goto("/admin/adm");
    const card = page.getByRole("button", { name: /^Cadastros incompletos/ }).first();
    await expect(card).toBeVisible({ timeout: 40_000 });
    await expect(card.locator(".hp-kpi-period")).toHaveText("Hoje");                              // período analisado
    await expect(card.locator(".hp-kpi-unit")).toHaveText("cadastros");                           // unidade de medida
    await expect(card).toHaveClass(/hp-kpi-attention/);                                           // nível de atenção
    // cartões de atenção com valor > 0 ficam destacados; o de resumo não
    await expect(page.getByRole("button", { name: /^Total de cadastros/ }).first()).not.toHaveClass(/hp-kpi-attention/);
  });

  test("comparação só com base real: ligar “Comparar” no CRM mostra variação ou “Sem base de comparação”, nunca número inventado", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/crm?periodo=mes&comparar=1");
    await expect(page.getByRole("button", { name: /^Novos leads no período/ })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("button", { name: /^Novos leads no período/ }).locator(".hp-kpi-delta")).toHaveText(/vs\. período anterior|Sem base de comparação|igual ao período anterior/, { timeout: 30_000 });
    await page.goto("/admin/crm?periodo=mes");
    await expect(page.getByRole("button", { name: /^Novos leads no período/ })).toBeVisible({ timeout: 40_000 });
    await expect(page.locator(".hp-kpi-delta")).toHaveCount(0);                                   // sem comparar, nenhuma comparação
  });

  test("mapa do Brasil (Administrativo): dados reais do servidor, balão com nome/quantidade/percentual, estado sem dado neutro, clique lista os cadastros e abre o Diretório filtrado", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager);
    const geo = (await api(s).rpc("adm_geo", { p_unit: null })).body as { total: number; sem_localizacao: number; by_state: { uf: string; count: number; pct: number }[] };
    expect(geo.by_state.length, "a base de teste precisa de ao menos um estado com cadastro").toBeGreaterThan(0);
    const top = geo.by_state[0];
    await page.goto("/admin/adm");
    const map = page.getByTestId("brazil-map");
    await expect(map).toBeVisible({ timeout: 40_000 });
    await expect(map.locator("path")).toHaveCount(27);
    // estados com dado ≠ neutro; estados sem dado = classe 0
    const withData = new Set(geo.by_state.map((x) => x.uf));
    for (const uf of withData) await expect(map.locator(`path[data-uf="${uf}"]`)).not.toHaveAttribute("data-class", "0");
    const noData = ["AC", "AP", "RR", "TO", "RO", "AM", "PA", "MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "DF", "GO", "MT", "MS", "ES", "SC", "RS"].find((u) => !withData.has(u));
    if (noData) await expect(map.locator(`path[data-uf="${noData}"]`)).toHaveAttribute("data-class", "0");
    // balão ao passar o mouse
    const p = map.locator(`path[data-uf="${top.uf}"]`);
    await p.hover({ force: true });
    const tip = page.getByTestId("brazil-map-tip"); await expect(tip).toBeVisible();
    await expect(tip).toContainText(`(${top.uf})`); await expect(tip).toContainText(top.count.toLocaleString("pt-BR"));
    await expect(tip).toContainText(`${String(top.pct).replace(".", ",")}% do total`);
    // rótulo acessível do estado
    await expect(p).toHaveAttribute("aria-label", new RegExp(`${top.count.toLocaleString("pt-BR")} cadastros`));
    // clique: lista do estado bate com o servidor (mesma RPC da lista do Diretório)
    await p.click({ force: true });
    const panel = page.getByRole("region", { name: `Cadastros de ${top.uf}` });
    await expect(panel).toBeVisible(); await expect(panel).toContainText(`${top.count.toLocaleString("pt-BR")} cadastro(s)`);
    const dir = (await api(s).rpc("adm_directory", { p_uf: top.uf, p_page_size: 1 })).body as { total: number };
    expect(dir.total).toBe(top.count);
    await panel.getByRole("link", { name: /no Diretório/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/adm/diretorio\\?uf=${top.uf}`));
    await expect(page.getByLabel("Estado")).toHaveValue(top.uf, { timeout: 30_000 });
    await expect(page.getByText(new RegExp(`${top.count.toLocaleString("pt-BR")}`)).first()).toBeVisible();
    // nada de marca/crédito externo na interface
    await page.goto("/admin/adm"); await expect(page.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/MapSVG|CC BY|Powered by/i)).toHaveCount(0);
  });

  test("mapa: rotas diretas, recarregar e voltar/avançar mantêm o Diretório filtrado por estado", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager);
    const geo = (await api(s).rpc("adm_geo", { p_unit: null })).body as { by_state: { uf: string; count: number }[] };
    const top = geo.by_state[0];
    await page.goto(`/admin/adm/diretorio?uf=${top.uf}`);
    await expect(page.getByLabel("Estado")).toHaveValue(top.uf, { timeout: 30_000 });
    await page.reload(); await expect(page.getByLabel("Estado")).toHaveValue(top.uf, { timeout: 30_000 });
    await page.goto("/admin/adm"); await expect(page.getByTestId("brazil-map")).toBeVisible({ timeout: 40_000 });
    await page.goBack(); await expect(page.getByLabel("Estado")).toHaveValue(top.uf, { timeout: 30_000 });
    await page.goForward(); await expect(page.getByTestId("brazil-map")).toBeVisible({ timeout: 30_000 });
  });

  test("mapa no Hub: distribuição geográfica com o mesmo mapa (sem crédito visual)", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Distribuição geográfica" })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/MapSVG|CC BY/)).toHaveCount(0);
  });

  test("permissões: gestor de unidade vê o mapa só da própria unidade; fisioterapeuta não abre o Administrativo", async ({ page, context }) => {
    const gu = await signIn(QA.gestorUnidade); const mg = await signIn(QA.manager);
    const g = (await api(gu).rpc("adm_geo", { p_unit: null })).body as { total: number };
    const all = (await api(mg).rpc("adm_geo", { p_unit: null })).body as { total: number };
    expect(g.total).toBeLessThanOrEqual(all.total);
    await loginAs(context, QA.fisio); await page.goto("/admin/adm");
    await expect(page.getByRole("heading", { name: "Sem permissão" })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe.serial("@release Nova interface (celular)", () => {
  test.setTimeout(150_000);
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("celular: sem rolagem lateral no Hub, Administrativo, CRM e Financeiro; cabeçalho cabe; filtros em gaveta mostram o que está ativo", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    for (const [path, wait] of [["/admin", /Bom dia|Boa tarde|Boa noite/], ["/admin/adm", /Prioridades administrativas/], ["/admin/crm", /Painel comercial/], ["/admin/financeiro", /Visão geral/]] as const) {
      await page.goto(path); await expect(page.getByRole("heading", { name: wait }).first()).toBeVisible({ timeout: 40_000 });
      await page.waitForTimeout(1500);
      await noHScroll(page, path);
      const h = await page.locator("header.hp-header").boundingBox(); expect(h!.width).toBeLessThanOrEqual(391);
    }
    await page.goto("/admin/crm?periodo=ano");
    const f = page.getByTestId("period-filter");
    await expect(f.getByRole("button", { name: /^Filtrar/ })).toBeVisible({ timeout: 40_000 });
    await expect(f.getByRole("list", { name: "Filtros ativos" })).toContainText("Período: Ano atual");   // filtro ativo claramente visível
    await f.getByRole("button", { name: /^Filtrar/ }).click();
    await expect(page.getByRole("button", { name: "Limpar", exact: true })).toBeVisible();              // aplicar e limpar sempre à mostra
    await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Limpar", exact: true }).click();
    await expect(f.getByRole("list", { name: "Filtros ativos" })).toHaveCount(0);
  });

  test("celular: mapa cabe na tela; tocar num estado mostra o balão e lista os cadastros", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager);
    const geo = (await api(s).rpc("adm_geo", { p_unit: null })).body as { by_state: { uf: string; count: number }[] };
    const top = geo.by_state[0];
    await page.goto("/admin/adm");
    const map = page.getByTestId("brazil-map"); await map.scrollIntoViewIfNeeded(); await expect(map).toBeVisible({ timeout: 40_000 });
    const box = await map.boundingBox(); expect(box!.width).toBeLessThanOrEqual(391);
    await map.locator(`path[data-uf="${top.uf}"]`).tap({ force: true });
    await expect(page.getByTestId("brazil-map-tip")).toContainText(`(${top.uf})`);
    await expect(page.getByRole("region", { name: `Cadastros de ${top.uf}` })).toBeVisible();
    await noHScroll(page, "mapa no celular");
  });
});
