// NOVO — N42: Prospecção B2B, Fases 0.5 e 1 (somente Dev). Prova: (1) o módulo aparece só quando HABILITADO para a organização e só para quem tem papel; (2) as nove telas existem, cada uma diz
// com honestidade que ainda não está disponível (sem número/empresa/saldo inventado); (3) desabilitar o módulo esconde o aplicativo e a tela avisa; (4) CNPJ ALFANUMÉRICO ponta a ponta pela API real do cadastro.
// O teste habilita/desabilita o módulo SOMENTE na organização HP do Dev e restaura o estado original ao final.
import { expect, test } from "@playwright/test";
import { api } from "../helpers";
import { devSql } from "../release/helpers-release";
import { collectErrors, loginAs, QA } from "./helpers-novos";

test.use({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", viewport: { width: 1440, height: 900 } });
const HP = "268b67d7-faa3-43c2-bb91-0616c78e10d0";
const setModule = (on: boolean) => devSql(`insert into public.org_modules (org_id, module_key, enabled, source) values ('${HP}', 'prospeccao_b2b', ${on}, 'manual')
  on conflict (org_id, module_key) do update set enabled = excluded.enabled, changed_at = now()`);

const SCREENS: [string, string, string][] = [
  ["/admin/prospeccao", "Visão geral", "prospeccao-visao-geral"], ["/admin/prospeccao/nova-pesquisa", "Nova pesquisa", "prospeccao-nova-pesquisa"],
  ["/admin/prospeccao/pesquisas", "Minhas pesquisas", "prospeccao-pesquisas"], ["/admin/prospeccao/empresas", "Empresas adquiridas", "prospeccao-empresas"],
  ["/admin/prospeccao/decisores", "Decisores e contatos", "prospeccao-decisores"], ["/admin/prospeccao/oportunidades-digitais", "Oportunidades digitais", "prospeccao-oportunidades"],
  ["/admin/prospeccao/creditos", "Créditos", "prospeccao-creditos"], ["/admin/prospeccao/exportacoes", "Exportações", "prospeccao-exportacoes"],
  ["/admin/prospeccao/configuracoes", "Configurações do aplicativo", "prospeccao-configuracoes"],
];

// CNPJ alfanumérico válido gerado pelo algoritmo oficial (valor = ASCII − 48; pesos 2..9 da direita; módulo 11), independente do código sob teste
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function randomAlnumCnpj(): string {
  const base = Array.from({ length: 8 }, () => ALNUM[Math.floor(Math.random() * 36)]).join("") + "0001";
  const dv = (s: string) => { let sum = 0, w = 2; for (let i = s.length - 1; i >= 0; i--) { sum += (s.charCodeAt(i) - 48) * w; w = w === 9 ? 2 : w + 1; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base); return `${base}${d1}${dv(base + d1)}`;
}

test.describe.serial("@novos Prospecção B2B — casca do aplicativo e CNPJ alfanumérico", () => {
  test.setTimeout(180_000);
  let original: { enabled: boolean } | null = null;
  test.beforeAll(async () => {
    const r = (await devSql(`select enabled from public.org_modules where org_id = '${HP}' and module_key = 'prospeccao_b2b'`)) as { enabled: boolean }[];
    original = r[0] ?? null; await setModule(true);
  });
  test.afterAll(async () => {
    if (original) await setModule(original.enabled); else await devSql(`delete from public.org_modules where org_id = '${HP}' and module_key = 'prospeccao_b2b'`);
    await devSql(`delete from public.legal_entities where org_id = '${HP}' and legal_name like 'Empresa Alfanumerica N42 %'`);
  });

  test("N42-1 com o módulo habilitado: o aplicativo aparece para o gestor e as nove telas abrem com a sidebar própria, sem dado inventado", async ({ page, context }) => {
    await loginAs(context, QA.manager); const errors = collectErrors(page);
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /Prospecção B2B/ }).first()).toBeVisible({ timeout: 20_000 });
    for (const [path, title, testid] of SCREENS) {
      await page.goto(path);
      await expect(page.getByTestId(testid), path).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("heading", { name: title, exact: true }).first(), path).toBeVisible();
      await expect(page.getByText("Esta tela ainda não está disponível.")).toBeVisible();
      await expect(page.getByText("Em construção").first()).toBeVisible();
      // sidebar própria: todos os nove itens do aplicativo (gestor vê as Configurações), nenhum menu de outro aplicativo
      for (const [, label] of SCREENS) await expect(page.getByRole("link", { name: label, exact: true }).first(), `${path} → ${label}`).toBeVisible();
      await expect(page.getByRole("link", { name: "Pipeline (Kanban)" })).toHaveCount(0);
    }
    expect(errors.filter((e) => !/favicon|ResizeObserver/i.test(e))).toEqual([]);
  });

  test("N42-2 papel sem acesso (fisioterapeuta) não vê o aplicativo e a rota é recusada", async ({ page, context }) => {
    await loginAs(context, "qa.fisio@hp-test.dev");
    await page.goto("/admin/meu-dia");
    await expect(page.getByRole("link", { name: /Prospecção B2B/ })).toHaveCount(0);
    await page.goto("/admin/prospeccao");
    await expect(page.getByTestId("prospeccao-visao-geral")).toHaveCount(0);
    await expect(page.getByText(/Sem permissão/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("N42-3 módulo desabilitado para a organização: o aplicativo some do Hub e a tela avisa que não está habilitado", async ({ page, context }) => {
    await setModule(false);
    try {
      await loginAs(context, QA.manager);
      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1 }).or(page.getByText("Início").first()).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("link", { name: /Prospecção B2B/ })).toHaveCount(0);
      await page.goto("/admin/prospeccao");
      await expect(page.getByTestId("prospeccao-bloqueado")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("prospeccao-visao-geral")).toHaveCount(0);
    } finally { await setModule(true); }
  });

  test("N42-4 CNPJ alfanumérico ponta a ponta pela API real do cadastro (criar, não duplicar, recusar dígito errado, normalizar)", async ({ context }) => {
    const s = await loginAs(context, QA.manager); const cnpj = randomAlnumCnpj(); const masked = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
    const name = `Empresa Alfanumerica N42 ${cnpj}`;
    const a = await api(s).rpc("legal_entity_upsert", { p_id: null, p_data: { legal_name: name, cnpj: masked.toLowerCase() } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const stored = (await devSql(`select cnpj from public.legal_entities where org_id = '${HP}' and legal_name = '${name}'`)) as { cnpj: string }[];
    expect(stored[0]?.cnpj).toBe(cnpj);                                           // letras preservadas, maiúsculas, sem máscara
    const dup = await api(s).rpc("legal_entity_upsert", { p_id: null, p_data: { legal_name: `${name} duplicada`, cnpj: masked } });
    expect(dup.status).not.toBe(200);                                             // mesmo CNPJ na mesma organização não duplica
    const bad = await api(s).rpc("legal_entity_upsert", { p_id: null, p_data: { legal_name: `${name} errada`, cnpj: cnpj.slice(0, 13) + String((Number(cnpj[13]) + 1) % 10) } });
    expect(bad.status).not.toBe(200);                                             // dígito verificador errado é recusado
    expect(JSON.stringify(bad.body)).toMatch(/CNPJ/);
    const ex = await api(s).rpc("crm_company_create", { p_legal_name: "Qualquer", p_trade_name: null, p_cnpj: masked, p_email: null, p_phone: null, p_city: null, p_uf: null, p_unit: null, p_contact_person: null, p_contact_role: null, p_force: false });
    expect(ex.status, JSON.stringify(ex.body)).toBe(200); expect((ex.body as { status?: string }).status).toBe("existing");   // CRM reconhece a empresa existente
  });
});
