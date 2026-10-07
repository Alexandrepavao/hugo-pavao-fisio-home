// ACEITE da release v1 — permissões dos papéis incluídos, com sessões reais no Dev.
// Três camadas, sempre juntas: (1) menu que a pessoa vê, (2) rota digitada na mão, (3) backend (API/RLS/RPC) —
// esconder menu NÃO é autorização. Complementa supabase/tests/release/S01 (isolamento entre unidades) e S02 (financeiro).
import { expect, test } from "@playwright/test";
import { api, collectErrors, loginAs, QA, signIn } from "./helpers-release";

test.use({ locale: "pt-BR" });

// Aplicativos que o Hub oferece por papel (a barra lateral do Hub lista o início e os aplicativos; o menu de cada app só aparece ao entrar nele).
const ALL = ["Início", "Gestão", "Financeiro", "CRM", "Pages", "Operação", "Academy", "Parceiros", "Produtividade"];
const COMMON = ["Início", "Gestão", "Financeiro", "CRM", "Pages", "Operação", "Parceiros", "Produtividade"];
const NAV: Record<string, { email: string; see: string[] }> = {
  gestor: { email: QA.manager, see: ALL },
  gestorUnidade: { email: QA.gestorUnidade, see: COMMON },
  comercial: { email: QA.comercial, see: COMMON },
  financeiro: { email: QA.financeiro, see: ["Início", "Financeiro", "Parceiros", "Produtividade"] },
  fisio: { email: QA.fisio, see: ["Início", "Operação", "Produtividade"] },
};
// rotas digitadas na mão que cada papel NÃO pode abrir
const BLOCKED: Record<string, string[]> = {
  gestorUnidade: ["/admin/equipe", "/admin/auditoria", "/admin/configuracoes", "/admin/pesquisas"],
  comercial: ["/admin/equipe", "/admin/auditoria", "/admin/configuracoes", "/admin/acompanhamento", "/admin/contas-corporativas", "/admin/pesquisas", "/admin/academy"],
  financeiro: ["/admin/pessoas", "/admin/crm", "/admin/agenda", "/admin/equipe", "/admin/auditoria", "/admin/configuracoes", "/admin/paginas"],
  fisio: ["/admin/pessoas", "/admin/crm", "/admin/financeiro", "/admin/equipe", "/admin/auditoria", "/admin/configuracoes", "/admin/captacao-leads"],
};

test.describe("@release Permissões por papel", () => {
  for (const [papel, cfg] of Object.entries(NAV)) {
    test(`${papel}: vê só o que o papel permite no menu e não abre rotas proibidas`, async ({ page, context }) => {
      await loginAs(context, cfg.email); const errors = collectErrors(page);
      await page.goto("/admin");
      const nav = page.locator("aside nav").first(); await expect(nav).toBeVisible();
      const seen = (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim());
      for (const label of cfg.see) expect(seen, `${papel} deve ver "${label}"`).toContain(label);
      for (const label of ALL.filter((l) => !cfg.see.includes(l))) expect(seen, `${papel} NÃO deve ver "${label}"`).not.toContain(label);
      expect(seen, "recursos incompletos ficam fora da navegação da v1").not.toContain("Estado dos módulos");
      for (const path of BLOCKED[papel] ?? []) {
        await page.goto(path); await expect(page.getByText("Sem permissão"), `${papel} abrindo ${path}`).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }

  test("recursos incompletos (disparo em massa, estado dos módulos): fora do menu do CRM e das rotas, mesmo digitando o endereço", async ({ page, context }) => {
    await loginAs(context, QA.manager);
    await page.goto("/admin/crm");
    const side = page.getByRole("navigation", { name: "Navegação do CRM" });
    await expect(side.getByRole("link", { name: "Conversas" })).toBeVisible();
    await expect(side.getByRole("link", { name: "Lembretes de envio" })).toBeVisible();          // ligada na v1 pela migration 077 como “Lembretes de envio” (lembrete + registro manual; R19)
    await expect(side.getByRole("link", { name: "Disparo de mensagens" })).toHaveCount(0);
    for (const p of ["/admin/crm/disparo", "/admin/status"]) {
      await page.goto(p); await expect(page.getByText("Recurso ainda não disponível nesta versão")).toBeVisible();
    }
    await page.goto("/admin/configuracoes");
    await expect(page.getByText("Pendente", { exact: true })).toHaveCount(0);                    // cartões sem tela ficam fora
    await expect(page.getByTestId("build-info")).toContainText("commit");
    await expect(page.getByTestId("build-info")).toContainText("banco Dev");
    await expect(page.getByTestId("env-badge")).toContainText("AMBIENTE DE TESTE");                    // fora de produção o selo está sempre visível
  });

  // Dentro de cada aplicativo a sidebar é exclusiva dele, e o papel continua filtrando os itens (a rota e o banco seguem sendo a autorização de verdade).
  const SIDE: [string, string, string, string[], string[]][] = [
    ["gestor", QA.manager, "/admin/adm", ["Dashboard", "Pendências", "Contratos", "Planilha administrativa", "Pessoas", "Unidades", "Equipe e acessos", "Produtos e serviços", "Configurações", "Auditoria"], ["Cartões", "Agenda", "Pipeline"]],
    ["gestorUnidade", QA.gestorUnidade, "/admin/adm", ["Dashboard", "Pendências", "Contratos", "Planilha administrativa", "Pessoas"], ["Unidades", "Equipe e acessos", "Produtos e serviços", "Configurações", "Auditoria"]],
    ["comercial", QA.comercial, "/admin/paginas", ["Páginas", "Captação de leads"], ["Pesquisas"]],
    ["financeiro", QA.financeiro, "/admin/financeiro", ["Visão geral", "Vendas", "Contas a receber", "Contas a pagar", "Cartões", "Fluxo de caixa", "Conciliação", "Recorrência", "DRE", "Comissões e repasses", "Relatórios", "Contas corporativas", "Configurações"], ["Pessoas", "Pipeline", "Agenda"]],
    ["fisio", QA.fisio, "/admin/agenda", ["Agenda", "Acompanhamento"], ["Pessoas", "Contas a pagar", "Cartões"]],
  ];
  for (const [papel, email, rota, ve, naoVe] of SIDE) {
    test(`${papel}: dentro do aplicativo, a sidebar é só dele e respeita o papel (${rota})`, async ({ page, context }) => {
      await loginAs(context, email); const errors = collectErrors(page);
      await page.goto(rota);
      const nav = page.locator("aside nav").first(); await expect(nav).toBeVisible({ timeout: 30_000 });
      const seen = (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim());
      for (const l of ve) expect(seen, `${papel} deve ver "${l}" em ${rota}`).toContain(l);
      for (const l of naoVe) expect(seen, `${papel} NÃO deve ver "${l}" em ${rota}`).not.toContain(l);
      for (const hub of ["Início", "Aplicativos"]) expect(seen, "o menu do Hub não se mistura com o do aplicativo").not.toContain(hub);
      await expect(page.getByRole("link", { name: "Voltar ao Hub" }).first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("backend: cada papel só lê e só executa o que lhe cabe (chamadas diretas à API, sem passar pela interface)", async () => {
    const [mgr, gu, com, fin, fis, par, alu] = await Promise.all([QA.manager, QA.gestorUnidade, QA.comercial, QA.financeiro, QA.fisio, QA.parceiro, QA.aluno].map(signIn));
    const cnt = async (s: typeof mgr, path: string) => { const r = await api(s).get(`${path}${path.includes("?") ? "&" : "?"}select=id`); return Array.isArray(r.body) ? r.body.length : -1; };
    const total = { people: await cnt(mgr, "people"), payments: await cnt(mgr, "payments"), payables: await cnt(mgr, "payables"), opps: await cnt(mgr, "opportunities"), audit: await cnt(mgr, "audit_log") };
    expect(total.people).toBeGreaterThan(5); expect(total.payments).toBeGreaterThan(0); expect(total.audit).toBeGreaterThan(0);

    // comercial: enxerga pessoas/oportunidades, NÃO enxerga contas a pagar nem auditoria e não registra recebimento
    expect(await cnt(com, "people")).toBeGreaterThan(0); expect(await cnt(com, "payables")).toBe(0); expect(await cnt(com, "audit_log")).toBe(0);
    expect(await cnt(com, "payments"), "comercial não lê recebimentos").toBe(0);
    expect((await api(com).rpc("payment_record", { p_receivable: "00000000-0000-0000-0000-000000000000", p_amount_cents: 100, p_paid_at: new Date().toISOString(), p_method: "pix", p_account: null, p_idempotency_key: `perm-${Date.now()}` })).status).toBe(403);
    expect((await api(com).rpc("dashboard_metrics", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date().toISOString(), p_unit: null })).status, "dashboard de gestão não é do comercial").toBe(403);
    // financeiro: lê o financeiro, não lê oportunidades/auditoria e não agenda
    expect(await cnt(fin, "payments")).toBeGreaterThan(0);
    // decisão do modelo: o financeiro lê as PESSOAS DA PRÓPRIA UNIDADE (precisa identificar quem paga), nunca de outra unidade
    const finUnits = (await api(fin).get("people?select=unit_id")).body as { unit_id: string }[]; expect(finUnits.length).toBeGreaterThan(0);
    const myUnits = ((await api(fin).get("role_assignments?select=unit_id&user_id=eq." + fin.user.id)).body as { unit_id: string }[]).map((r) => r.unit_id);
    expect(finUnits.every((p) => myUnits.includes(p.unit_id)), "pessoas só da própria unidade").toBe(true); expect(await cnt(fin, "opportunities")).toBe(0); expect(await cnt(fin, "audit_log")).toBe(0);
    expect((await api(fin).rpc("book_appointment", { p_person: "00000000-0000-0000-0000-000000000000", p_unit: "00000000-0000-0000-0000-000000000000", p_professional: "00000000-0000-0000-0000-000000000000", p_service: "00000000-0000-0000-0000-000000000000", p_start: new Date(Date.now() + 864e5).toISOString() })).status).toBe(403);
    // fisioterapeuta: nada de financeiro/CRM/pessoas; só a própria agenda
    for (const t of ["payments", "payables", "sales", "receivables", "opportunities", "people", "commission_entries"]) expect(await cnt(fis, t), `fisio lê ${t}`).toBe(0);
    const myProfs = ((await api(fis).get("professionals?select=id&user_id=eq." + fis.user.id)).body as { id: string }[]).map((p) => p.id);
    const seenAppts = (await api(fis).get("appointments?select=professional_id")).body as { professional_id: string }[];
    expect(seenAppts.every((a) => myProfs.includes(a.professional_id)), "fisio só vê a própria agenda").toBe(true);
    // gestor de unidade: opera a unidade, mas não lê auditoria nem se promove
    expect(await cnt(gu, "people")).toBeGreaterThan(0); expect(await cnt(gu, "audit_log")).toBe(0);
    expect((await api(gu).post("role_assignments", { org_id: (await api(gu).get("organizations?select=id")).body[0].id, user_id: gu.user.id, role: "manager" })).status).toBeGreaterThanOrEqual(400);
    // paciente e parceiro: nenhuma tabela administrativa; funções de gestão negadas
    for (const s of [par, alu]) {
      for (const t of ["payments", "payables", "opportunities", "audit_log", "sales", "commission_entries", "crm_tasks", "staff_tasks"]) expect(await cnt(s, t), `${s.user.id.slice(0, 4)} lê ${t}`).toBe(0);
      expect((await api(s).rpc("dashboard_metrics", { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date().toISOString(), p_unit: null })).status).toBe(403);
      expect((await api(s).rpc("sale_create", { p_opportunity: null, p_person: "00000000-0000-0000-0000-000000000000", p_unit: "00000000-0000-0000-0000-000000000000", p_items: [], p_discount_cents: 0, p_installments: 1, p_first_due: "2026-01-01" })).status).toBe(403);
    }
    expect(await cnt(alu, "people"), "paciente vê só o próprio cadastro").toBe(1);
    expect(await cnt(par, "people"), "parceiro não lê cadastro de pessoas").toBeLessThanOrEqual(1);
  });
});
