import { expect, test } from "@playwright/test";
import { MANAGER, STUDENT, api, noConsoleErrors, runId, signIn, useSession } from "./helpers";

// "Meu dia" (produtividade pessoal): jornada real na interface (criar → focar → concluir) e isolamento
// direto pela API. O isolamento entre colegas de equipe já é coberto a fundo em
// supabase/tests/010_productivity.sql (13 asserções); aqui validamos o que só existe na camada HTTP/UI:
// nenhum erro de console (a regressão original era exatamente um "Query data cannot be undefined" no
// console, invisível a um teste puramente SQL), e que uma pessoa não-staff (aluna) não enxerga nem
// altera a tarefa de outra pessoa mesmo com a tabela liberada por RLS para "authenticated".
test.describe("Meu dia (produtividade pessoal)", () => {
  const title = `Tarefa E2E ${runId}`;
  let taskId = "";

  test("gestor cria tarefa pela interface, foca e conclui, sem erros de console", async ({ page }) => {
    const errors = await noConsoleErrors(page, async () => {
      const s = await signIn(MANAGER); await useSession(page.context(), s);
      await page.goto("/admin/meu-dia");
      await expect(page.getByRole("heading", { name: "Meu dia", level: 2 })).toBeVisible();          // h1 é a trilha de navegação do AppShell; h2 é o título da página

      await page.getByRole("button", { name: "Nova tarefa" }).click();
      await page.getByLabel("Título").fill(title);
      await page.getByRole("button", { name: "Criar tarefa" }).click();
      await expect(page.getByText(title)).toBeVisible();

      // sessão de foco: iniciar pela tarefa e ver o cronômetro ao vivo (RPC focus_start; consulta "focus-open" sem quebrar)
      await page.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Focar" }).click();
      await expect(page.getByText(/^\d{2}:\d{2}$/)).toBeVisible();
      await page.getByRole("button", { name: "Encerrar sessão" }).click();
      await expect(page.getByText("Nenhuma sessão ativa. Escolha a duração:")).toBeVisible();

      // concluir e confirmar que persiste no servidor (não só otimista no cliente)
      await page.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Marcar como concluída" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: title }).locator("p")).toHaveClass(/line-through/);
      await page.reload();
      await expect(page.getByRole("listitem").filter({ hasText: title }).locator("p")).toHaveClass(/line-through/);

      taskId = (await api(s).get(`staff_tasks?select=id&title=eq.${encodeURIComponent(title)}`)).body[0].id;
    });
    expect(errors).toEqual([]);
  });

  test("tarefa privada: outra pessoa autenticada (não-staff) não vê nem consegue alterar pela API direta", async () => {
    expect(taskId, "a tarefa precisa ter sido criada no teste anterior").not.toBe("");
    const gs = api(await signIn(STUDENT));
    expect((await gs.get(`staff_tasks?select=id&id=eq.${taskId}`)).body).toHaveLength(0);           // SELECT: RLS esconde a tarefa de outra pessoa
    const toggle = await gs.rpc("staff_task_toggle", { p_id: taskId });                              // alternar tarefa alheia: sem erro, mas sem efeito (comportamento silencioso)
    expect(toggle.status).toBe(204);                                                                 // função void: PostgREST responde 204 sem corpo
    const after = (await api(await signIn(MANAGER)).get(`staff_tasks?select=completed_at&id=eq.${taskId}`)).body[0];
    expect(after.completed_at).not.toBeNull();                                                       // segue concluída (do teste anterior); a aluna não conseguiu reabri-la
  });

  test("visitante anônimo não lê nem escreve em staff_tasks", async () => {
    const anon = api(null);
    expect((await anon.get("staff_tasks?select=id&limit=1")).status).toBe(401);
    expect((await anon.post("staff_tasks", { title: "hackeado" })).status).toBe(401);
  });
});
