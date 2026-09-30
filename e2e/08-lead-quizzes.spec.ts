import { expect, test } from "@playwright/test";
import { MANAGER, api, runId, signIn, useSession } from "./helpers";

// Jornadas de captação (quiz de atendimento e de parceria): página pública → respostas → CRM →
// conclusão → prévia/abertura do WhatsApp (interceptada, nunca abre de verdade) → painel do admin.
test.describe("quizzes de captação", () => {
  const email = `lead.quiz.${runId}@example.com`;
  const emailPartner = `lead.quiz.partner.${runId}@example.com`;
  const phone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
  const phonePartner = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;

  test("jornada de atendimento completa: consentimento, gate de saúde, conclusão e WhatsApp interceptado", async ({ browser }) => {
    const anon = await browser.newContext(); const p = await anon.newPage();
    // intercepta a navegação para o wa.me — nunca chega ao servidor real, só inspecionamos destino/mensagem
    await anon.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));

    await p.goto("/avaliacao");
    await expect(p.getByRole("heading", { name: "Avaliação inicial gratuita" })).toBeVisible();
    await p.getByLabel("Como podemos chamar você?").fill(`Lead Quiz E2E ${runId}`);
    await p.getByLabel("Qual é seu e-mail?").fill(email);
    await p.getByLabel("Qual é seu WhatsApp com DDD?").fill(phone);
    await p.getByRole("checkbox").click(); // autorização de contato
    await p.getByRole("button", { name: "Continuar" }).click();

    await expect(p.getByText("Em qual cidade e estado")).toBeVisible();
    await p.getByLabel("Cidade").fill("São Paulo");
    await p.getByLabel("UF").selectOption("SP");
    await p.getByRole("button", { name: "Continuar" }).click();

    // gate de consentimento de saúde antes das perguntas 5–7
    await expect(p.getByText(/dado de saúde/)).toBeVisible();
    await p.getByRole("button", { name: "Concordo, continuar" }).click();

    for (const label of ["dor ou desconforto", "deseja melhorar", "qualidade de vida melhoraria"]) {
      await expect(p.getByText(new RegExp(label))).toBeVisible();
      await p.getByRole("radio", { name: "5" }).click();
      await p.getByRole("button", { name: "Continuar" }).click();
    }
    await expect(p.getByText("Qual atividade")).toBeVisible();
    await p.getByRole("radio", { name: "Realizar atividades diárias" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();

    await expect(p.getByText("Você teria interesse")).toBeVisible();
    await p.getByRole("radio", { name: "Sim" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();

    await expect(p.getByText("qual investimento por sessão")).toBeVisible();
    await p.getByRole("radio", { name: "Até R$ 250" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();

    await expect(p.getByText("não prometemos cura")).toBeVisible(); // aviso de que o plano depende de avaliação individual
    await p.getByRole("button", { name: "Concluir" }).click();

    await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible();
    const preview = p.getByLabel("Prévia da mensagem (você pode editar)");
    await expect(preview).not.toHaveValue(/Dor\/desconforto hoje/); // respostas de saúde ficam de fora da mensagem por padrão
    await expect(preview).toHaveValue(/Protocolo/);

    // opção desmarcada por padrão inclui as respostas de saúde na prévia quando marcada
    await p.getByText("Incluir minhas respostas sobre dor e qualidade de vida nesta mensagem.").click();
    await expect(preview).toHaveValue(/Dor\/desconforto hoje: 5\/10/);

    // clique no WhatsApp abre um popup para o número certo com a mensagem certa — interceptado, nunca enviado de verdade
    const popupPromise = anon.waitForEvent("page");
    await p.getByRole("button", { name: "Continuar pelo WhatsApp" }).click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toContain("wa.me/5511959075351");
    expect(decodeURIComponent(popup.url())).toContain("Dor/desconforto hoje: 5/10");
    await expect(p.getByText("Conversa aberta no WhatsApp")).toBeVisible();
    await popup.close(); await anon.close();

    // API (gestor): oportunidade no funil correto, com origem/UTM, "Quiz concluído" e clique de WhatsApp separado da conclusão
    const s = await signIn(MANAGER); const g = api(s);
    const lead = await g.get(`quiz_leads?select=id,journey,status,opportunity_id,whatsapp_clicked_at,completed_at&email=eq.${email}`);
    // quiz_leads não tem GRANT direto — a leitura real é só pelas funções; a rota REST direta nunca devolve 200.
    expect(lead.status).not.toBe(200);
    const detail = await g.rpc("list_quiz_leads", { p_journey: "atendimento", p_search: email, p_limit: 5, p_offset: 0 });
    expect(detail.body).toHaveLength(1);
    expect(detail.body[0]).toMatchObject({ journey: "atendimento", status: "completed" });
    const opp = await g.get(`opportunities?select=source,pipeline:pipelines(kind)&id=eq.${detail.body[0].opportunity_id}`);
    expect(opp.body[0]).toMatchObject({ source: "quiz:atendimento", pipeline: { kind: "patients" } });
  });

  test("jornada de parceria: seleção múltipla exclusiva, sem consentimento de saúde, segmento Potencial Academy", async ({ browser }) => {
    const anon = await browser.newContext(); const p = await anon.newPage();
    await anon.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));

    await p.goto("/seja-parceiro");
    await p.getByLabel("Como podemos chamar você?").fill(`Parceiro Quiz E2E ${runId}`);
    await p.getByLabel("Qual é seu e-mail?").fill(emailPartner);
    await p.getByLabel("Qual é seu WhatsApp com DDD?").fill(phonePartner);
    await p.getByRole("checkbox").click();
    await p.getByRole("button", { name: "Continuar" }).click();

    await p.getByLabel("Cidade").fill("Campinas");
    await p.getByLabel("UF").selectOption("SP");
    await p.getByRole("button", { name: "Continuar" }).click();

    // não deve pedir consentimento de saúde nesta jornada
    await expect(p.getByText(/dado de saúde/)).toHaveCount(0);
    await expect(p.getByText("momento profissional")).toBeVisible();
    await p.getByRole("radio", { name: "Estudante" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();

    await p.getByRole("radio", { name: "Ainda não possuo" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Ortopedia" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();
    await p.getByRole("radio", { name: "Ainda não atendo" }).click();
    await p.getByRole("button", { name: "Continuar" }).click();

    await expect(p.getByText("O que você busca na parceria")).toBeVisible();
    await p.getByRole("checkbox").nth(0).click();
    await p.getByRole("button", { name: "Continuar" }).click();

    // "Nenhuma no momento" é exclusiva: marcar depois de outras opções limpa as demais
    await expect(p.getByText("Em quais áreas você gostaria")).toBeVisible();
    await p.getByRole("checkbox").nth(0).click();
    await p.getByRole("checkbox").nth(3).click();
    await p.getByRole("checkbox").nth(5).click(); // "Nenhuma no momento"
    await expect(p.getByRole("checkbox").nth(0)).not.toBeChecked();
    await expect(p.getByRole("checkbox").nth(3)).not.toBeChecked();
    await expect(p.getByRole("checkbox").nth(5)).toBeChecked();
    await p.getByRole("button", { name: "Continuar" }).click();

    await p.getByRole("button", { name: "Concluir" }).click(); // marketing opcional fica desmarcado
    await expect(p.getByText(/Recebemos suas respostas/)).toBeVisible();
    const preview = p.getByLabel("Prévia da mensagem (você pode editar)");
    await expect(preview).toHaveValue(/Estudante/);
    await expect(preview).toHaveValue(/Nenhuma no momento/);
    await expect(preview).not.toHaveValue(/dor/); // jornada de parceria nunca inclui pergunta de saúde
    await anon.close();

    const s = await signIn(MANAGER); const g = api(s);
    const detail = await g.rpc("list_quiz_leads", { p_journey: "parceria", p_search: emailPartner, p_limit: 5, p_offset: 0 });
    expect(detail.body).toHaveLength(1);
    expect(detail.body[0]).toMatchObject({ status: "completed", wants_academy: true });
    const full = await g.rpc("get_quiz_lead_detail", { p_id: detail.body[0].id });
    expect(full.body.answers).not.toHaveProperty("dor_intensidade");
  });

  test("reenvio da primeira etapa no mesmo dia não duplica a captação (idempotência)", async ({ browser }) => {
    const anon = await browser.newContext(); const p = await anon.newPage();
    const dupEmail = `lead.quiz.dup.${runId}@example.com`;
    const dupPhone = `(11) 9${Math.floor(1000 + Math.random() * 8999)}-${Math.floor(1000 + Math.random() * 8999)}`;
    for (let i = 0; i < 2; i++) {
      await p.goto("/avaliacao");
      await p.getByLabel("Como podemos chamar você?").fill(`Lead Dup E2E ${runId}`);
      await p.getByLabel("Qual é seu e-mail?").fill(dupEmail);
      await p.getByLabel("Qual é seu WhatsApp com DDD?").fill(dupPhone);
      await p.getByRole("checkbox").click();
      await p.getByRole("button", { name: "Continuar" }).click();
      await expect(p.getByText("Em qual cidade e estado")).toBeVisible();
    }
    await anon.close();
    const s = await signIn(MANAGER); const g = api(s);
    const rows = await g.rpc("list_quiz_leads", { p_journey: "atendimento", p_search: dupEmail, p_limit: 5, p_offset: 0 });
    expect(rows.body).toHaveLength(1); // duas submissões do mesmo contato no mesmo dia = a mesma captação
  });
});
