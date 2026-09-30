// NOVO (etapa ADM+Contábil) — importação CSV de PJ na interface: modelo, mapeamento, prévia, erros por linha, reimportação sem
// duplicar e atualização só por decisão explícita. Não faz parte da suíte de regressão (01–09).
import { expect, test } from "@playwright/test";
import { api, loginAs, maskCnpj, patch, QA, randomCnpj, collectErrors, shot } from "./helpers-novos";

test.describe("@novo ADM — importação de PJ (CSV)", () => {
  test("modelo, mapeamento manual, prévia com erros por linha, criação, reimportação idempotente e conflito com decisão explícita", async ({ page, context }) => {
    const s = await loginAs(context, QA.manager); const errors = collectErrors(page);
    const run = Date.now().toString(36).toUpperCase(); const c1 = randomCnpj(); const c2 = randomCnpj(); const bad = "11222333000182";
    // cabeçalho com uma coluna que o sistema NÃO reconhece sozinho ("Fornecedor") — o usuário mapeia manualmente para Nome fantasia
    const csv = [
      "Empresa;Documento;Fornecedor;Município;Estado;E-mail",
      `Alfa ${run} Ltda;${maskCnpj(c1)};Alfa Fantasia ${run};São Paulo;sp;alfa${run.toLowerCase()}@teste.com`,
      `Beta ${run} SA;${c2};Beta Fantasia;Santos;SP;`,
      `CNPJ Errado ${run};${bad};X;Santos;SP;`,
      `Alfa Repetida ${run};${c1};;;;`,
      `;${randomCnpj()};Sem Razão;;;`,
    ].join("\n");
    const file = { name: `pj-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") };
    const openDialog = async () => { await page.goto("/admin/adm/diretorio"); await page.getByRole("button", { name: /Importar PJ/ }).click(); await expect(page.getByRole("dialog")).toBeVisible(); };
    const dlg = () => page.getByRole("dialog");

    await openDialog();
    // 1) modelo para download
    const [tpl] = await Promise.all([page.waitForEvent("download"), dlg().getByRole("button", { name: "Baixar modelo (CSV)" }).click()]);
    const tplText = (await import("node:fs")).readFileSync(await tpl.path()!, "utf8");
    expect(tplText).toContain("CNPJ;Razão social;Nome fantasia"); expect(tplText).toContain("00.000.000/0000-00");

    // 2) mapeamento: auto-mapeia o que reconhece; obrigatórios cobertos; Fornecedor fica sem destino até o usuário escolher
    await dlg().locator("#pj-imp-f").setInputFiles(file);
    await expect(dlg().getByLabel("CNPJ *")).toHaveValue("1");            // coluna "Documento"
    await expect(dlg().getByLabel("Razão social *")).toHaveValue("0");     // coluna "Empresa"
    await expect(dlg().getByLabel("Nome fantasia")).toHaveValue("");
    await dlg().getByLabel("Nome fantasia").selectOption({ label: "Fornecedor" }); await shot(page, "11-adm-importacao-mapeamento-de-colunas");
    // remover CNPJ do mapeamento bloqueia o avanço
    await dlg().getByLabel("CNPJ *").selectOption("");
    await expect(dlg().getByText(/Faltam campos obrigatórios: CNPJ/)).toBeVisible();
    await expect(dlg().getByRole("button", { name: "Ver prévia" })).toBeDisabled();
    await dlg().getByLabel("CNPJ *").selectOption("1");
    await dlg().getByRole("button", { name: "Ver prévia" }).click();

    // 3) prévia: nada gravado; contagens e erros por linha (linha física do arquivo)
    await expect(dlg().getByText("2 novas")).toBeVisible();
    await expect(dlg().getByText("2 com erro")).toBeVisible();
    await expect(dlg().getByText("1 ignoradas")).toBeVisible();
    await expect(dlg().getByLabel("Erros de validação")).toContainText("Linha 4: CNPJ com dígito verificador inválido");
    await expect(dlg().getByLabel("Erros de validação")).toContainText("Linha 6: Razão social ausente"); await shot(page, "12-adm-importacao-previa-erros-por-linha");
    let r = await api(s).get(`legal_entities?select=id&cnpj=in.(${c1},${c2})`); expect(r.body).toHaveLength(0);
    await dlg().getByLabel("Unidade de destino *").selectOption({ index: 1 });
    await dlg().getByRole("button", { name: /Importar 2 nova\(s\)/ }).click();

    // 4) resultado + relatório por linha
    await expect(dlg().getByText("2 criadas")).toBeVisible(); await shot(page, "13-adm-importacao-resultado-relatorio");
    const [rep] = await Promise.all([page.waitForEvent("download"), dlg().getByRole("button", { name: "Baixar relatório (CSV)" }).click()]);
    const repText = (await import("node:fs")).readFileSync(await rep.path()!, "utf8");
    expect(repText).toContain("linha_arquivo;cnpj;razao_social;resultado;detalhe");
    expect(repText).toMatch(new RegExp(`4;${bad.slice(0, 2)}\\.${bad.slice(2, 5)}.*;Erro;CNPJ com dígito verificador inválido`));
    expect(repText).toContain("Ignorada;CNPJ repetido no arquivo");
    r = await api(s).get(`legal_entities?select=id,trade_name,state_uf,origin&cnpj=in.(${c1},${c2})&order=cnpj`);
    expect(r.body).toHaveLength(2);
    const alfa = (await api(s).get(`legal_entities?select=id,trade_name,state_uf,origin,legal_name,phone&cnpj=eq.${c1}`)).body[0];
    expect(alfa).toMatchObject({ trade_name: `Alfa Fantasia ${run}`, state_uf: "SP", origin: "importacao_csv" });

    // 5) reimportação do MESMO arquivo: nada duplica e o botão de importar fica desabilitado (nada a fazer)
    await page.keyboard.press("Escape"); await openDialog();
    await dlg().locator("#pj-imp-f").setInputFiles(file);
    await dlg().getByLabel("Nome fantasia").selectOption({ label: "Fornecedor" });
    await dlg().getByRole("button", { name: "Ver prévia" }).click();
    await expect(dlg().getByText("0 novas")).toBeVisible(); await expect(dlg().getByText("2 sem alteração")).toBeVisible();
    await dlg().getByLabel("Unidade de destino *").selectOption({ index: 1 });
    await expect(dlg().getByRole("button", { name: /^Importar 0 nova/ })).toBeDisabled();
    r = await api(s).get(`legal_entities?select=id&cnpj=in.(${c1},${c2})`); expect(r.body).toHaveLength(2);

    // 6) CNPJ existente com dados diferentes: aparece como conflito, nada é marcado por padrão, só o campo escolhido muda
    await page.keyboard.press("Escape"); await openDialog();
    const csv2 = ["CNPJ;Razão social;Telefone", `${c1};Alfa Renomeada ${run};(11) 3333-4444`].join("\n");
    await dlg().locator("#pj-imp-f").setInputFiles({ name: "conflito.csv", mimeType: "text/csv", buffer: Buffer.from(csv2, "utf8") });
    await dlg().getByRole("button", { name: "Ver prévia" }).click();
    await expect(dlg().getByText("1 com CNPJ já cadastrado e dados diferentes")).toBeVisible();
    const boxName = dlg().getByRole("checkbox", { name: /Razão social/ }); const boxPhone = dlg().getByRole("checkbox", { name: /Telefone/ });
    await expect(boxName).not.toBeChecked(); await expect(boxPhone).not.toBeChecked();
    await expect(dlg().getByText("sobrescrever valor existente")).toBeVisible(); await expect(dlg().getByText("preencher campo vazio")).toBeVisible(); await shot(page, "14-adm-importacao-conflito-decisao-explicita");
    await dlg().getByLabel("Unidade de destino *").selectOption({ index: 1 });
    await expect(dlg().getByRole("button", { name: /^Importar 0 nova/ })).toBeDisabled();       // sem decisão → nada a gravar
    await boxPhone.check();
    await dlg().getByRole("button", { name: /atualizar 1/ }).click();
    await expect(dlg().getByText("1 atualizadas")).toBeVisible();
    const after = (await api(s).get(`legal_entities?select=legal_name,phone&cnpj=eq.${c1}`)).body[0];
    expect(after.phone).toBe("1133334444"); expect(after.legal_name).toBe(`Alfa ${run} Ltda`);          // razão social NÃO foi sobrescrita

    // limpeza: arquiva as PJ de teste (o CNPJ continua reservado, mas some das listagens)
    for (const row of (await api(s).get(`legal_entities?select=id&cnpj=in.(${c1},${c2})`)).body as { id: string }[]) await patch(s, `legal_entities?id=eq.${row.id}`, { archived_at: new Date().toISOString() });
    expect(errors).toEqual([]);
  });

  test("gestor de unidade/comercial não vê os botões de importação e o servidor nega a análise", async ({ page, context }) => {
    const s = await loginAs(context, QA.comercial);
    await page.goto("/admin/adm/diretorio");
    await expect(page.getByRole("button", { name: "Colunas" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Importar PJ/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Importar PF/ })).toHaveCount(0);
    const r = await api(s).rpc("legal_entity_import_check", { p_rows: [] });
    expect(r.status).toBe(403);                                                                    // 42501 no PostgREST
  });
});
