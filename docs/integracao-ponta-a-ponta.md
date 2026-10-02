# Integração ponta a ponta — jornadas operacionais do HP Group Hub

> Referenciado por `docs/release-v1.md` (migrations 078, 079 e 080). Este documento fecha a lacuna: para cada jornada que atravessa mais de um aplicativo, registra o que é reaproveitado do cadastro central, a regra de negócio que vale, a evidência de teste e uma classificação honesta do estado atual. Verificado em 2026-10-01/02 contra o Supabase **Dev** (`fsvtzowcwhvwtluwrhnb`), branch `release/v1`.

**Legenda:** ✅ **Validada ponta a ponta** (testada pela interface e pelo banco, nos dois lados da jornada) · 🟡 **Implementada, não totalmente validada** (código e testes existem, mas falta alguma perna da jornada ou uma evidência ao vivo) · 🔶 **Parcial** (parte da jornada depende de decisão/configuração do usuário que ainda não foi feita) · 🔒 **Bloqueada por configuração externa** (Google, Bunny, Resend, provedor de WhatsApp — não é falha de código).

## 1. Páginas/formulários/quizzes → cadastro central → CRM

| | |
|---|---|
| Apps envolvidos | Pages (site público) → Pessoas (cadastro central) → CRM (oportunidades, tarefas) |
| Registro compartilhado | `people` / `person_contacts` (nunca duplica por nome só; dedup é por contato + nome semelhante) · `opportunities` (origem e campanha preservadas) · `form_submissions` |
| Regra | Contato já cadastrado com **mesmo contato e nome semelhante** reaproveita a pessoa; reenvio no mesmo dia não duplica pessoa/oportunidade/captação; homônimo com outro contato OU mesmo contato com nome muito diferente **nunca são mesclados automaticamente** — vira pessoa separada marcada para revisão (`dedupe_review`); envios simultâneos (corrida) do mesmo contato novo geram UMA pessoa/oportunidade/captação |
| Evidência | SQL `S20_idempotencia_venda_oportunidade.sql` (oportunidade duplicada recusada) · E2E `R21-captacao-crm-venda.spec.ts` (8 testes: contato existente, reenvio, homônimo, contato compartilhado, 3 envios simultâneos, indicador de captação reconciliando, permissões) |
| Estado | ✅ **Validada ponta a ponta** — revalidada em 2026-10-02 |

## 2. CRM → Conversas → tarefas → venda

| | |
|---|---|
| Apps envolvidos | CRM (oportunidades) → Conversas (central multiatendimento) → Tarefas → Financeiro (venda) |
| Registro compartilhado | `crm_conversations` (uma por pessoa+canal) · `crm_tasks` (lembretes vinculados à oportunidade e à pessoa certas) · `sales` (criada a partir da oportunidade, com chave de idempotência) |
| Regra | "Abrir WhatsApp" **só abre e registra a abertura** (nunca "enviada"); lembrete de envio cria tarefa, não envia nada sozinho; converter em venda leva pessoa/produto/unidade/linha; duplo clique e retentativa **não geram venda duplicada** (migration 078: uma venda pendente por oportunidade, chave de idempotência) |
| Evidência | SQL `S19_conversas.sql` (96 itens) · `S20_idempotencia_venda_oportunidade.sql` · E2E `R19-central-conversas.spec.ts` (9) · `R21-captacao-crm-venda.spec.ts` (conversão, duplo clique, oportunidade duplicada recusada) |
| Estado | ✅ **Validada ponta a ponta** |
| Limitação conhecida (não é bug) | Sem provedor de WhatsApp/e-mail conectado: nada é entregue/lido automaticamente; disparo em massa fica fora da v1 (`docs/conversas.md`) |

## 3. Venda → pagamento → pacote → agenda → atendimento/cancelamento/falta → saldo de sessão

| | |
|---|---|
| Apps envolvidos | Financeiro (venda, parcelas, recebimento) → Pacotes → Agenda → Portal do paciente/profissional |
| Registro compartilhado | `sales` → `receivables`/`payments` → `client_packages` → `appointments` → `session_ledger` |
| Regra | Falta (`no_show`) só pode ser marcada **depois do horário**; falta do paciente nunca vira "realizado"; falta do profissional **nunca consome** sessão (e devolve se um engano já havia consumido); confirmação antecipada (paciente/profissional) é independente de presença e de consumo — não muda status nem prova comparecimento; cancelamento pelo paciente dentro de `late_cancel_hours` consome, fora não; duplo clique/retentativa não duplicam recebimento, consumo nem estorno |
| Evidência | SQL `S02_vendas_financeiro.sql` (32) · `S03_confirmacao_presenca_consumo.sql` (56) · `S04_cancelamento_passado_agendas.sql` (47) · E2E `R01-jornada-operacional.spec.ts` (8/8) · `R04-confirmacao-presenca-consumo.spec.ts` (4) · `R05-cancelamento-passado-agendas.spec.ts` (4) |
| Estado | ✅ **Validada ponta a ponta** — corrigido nesta rodada um ajuste de teste em `R04` (seletor ambíguo entre "Meus atendimentos" e "Minha jornada" no portal; sem enfraquecer nenhuma verificação) |

## 4. Cadastro/acesso do profissional → agenda → atendimento → repasses → Financeiro

| | |
|---|---|
| Apps envolvidos | ADM (cadastro PF do profissional) → Agenda/Meu dia → Financeiro (regras de comissão, repasses) → Produtividade (Meu resumo) |
| Registro compartilhado | `professionals` → `appointments` → `payments` (fato gerador) → `commission_entries` → `payables`/`finance_by_line` |
| Regra | Fato gerador é o **recebimento**, não o atendimento realizado; percentual **guardado no lançamento** (histórico imutável mesmo que a regra mude depois); regras se somam (cada uma ao seu beneficiário); máquina de estados estrita `pendente → autorizada → paga` (+ `estornada`), sem autopagamento; conferência recalcula e compara com a Visão geral; o gestor vê o atendimento, **não** o repasse individual do profissional |
| Evidência | SQL `S18_repasses.sql` (**30/30, revalidado ao vivo em 2026-10-02**) · E2E `R20-repasses.spec.ts` (**8/8, revalidado ao vivo em 2026-10-02** — regra criada pela tela, recebimento parcial/quitação, autorizar→pagar, "Meu resumo" do profissional com pendente/autorizado/pago/líquido sem expor o paciente, estorno proporcional, permissões, celular) |
| Estado | ✅ **Validada ponta a ponta**, revalidação ao vivo feita nesta rodada de reconciliação (não apenas documental) |

## 5. Paciente → convite/login → atendimentos → jornada → vídeos → pedido de renovação

| | |
|---|---|
| Apps envolvidos | Convite/Auth → Portal do paciente → Jornada (objetivos, avaliações, vídeos) → Fila administrativa |
| Registro compartilhado | `invitations`/`person_portal_access` → `patient_goals`/`patient_plan` → `patient_reassessments` → `renewal_requests` |
| Regra | Plano clínico sempre definido pelo fisioterapeuta (nunca pelo paciente ou automaticamente); pedir renovação/contato **não gera cobrança**; vídeo é atribuído pelo profissional, nunca público; consumo de sessão não é tratado como prova de melhora |
| Evidência | SQL `S07_jornada_paciente.sql` (60) · E2E `R09-jornada-paciente.spec.ts` (preparo, visão do paciente, visão da fisioterapeuta, privacidade do gestor — 4/4 confirmados nesta rodada; o 5º teste, de limpeza dos dados de QA, falhou numa execução com 2 workers simultâneos, sob investigação de concorrência de teste, não de produto) |
| Estado | ✅ **Validada ponta a ponta** no código/regra · 🔒 **Vídeo real bloqueado por configuração**: falta `BUNNY_EMBED_TOKEN_KEY` nos Secrets do Supabase e o ID da biblioteca no Bunny — isso depende de uma ação sua, não é um bug |

## 6. Academy → venda → matrícula → acesso → progresso

| | |
|---|---|
| Apps envolvidos | Academy (catálogo/administração) → Financeiro (venda) → `/academy` (área do aluno) |
| Registro compartilhado | `products`(linha Academy) → `courses`/`lessons` → `sales` → `entitlements` → `lesson_progress` |
| Regra | Acesso segue a **regra do produto** (`on_full_payment` = só a quitação libera; `on_first_payment` = qualquer recebimento libera) — nunca "parcial libera tudo" por padrão; estorno parcial não revoga, estorno que zera o líquido revoga na hora; administração do Academy é separada da área de consumo do aluno; a etapa final da oportunidade de educação só avança quando a regra se cumpre (migration 079 — antes avançava no 1º recebimento mesmo sem acesso, corrigido) |
| Evidência | E2E `R22-academy-venda-acesso.spec.ts` (9 testes: quitação em duas parcelas sem acesso prematuro, bloqueio de URL direta, liberação + progresso persistido, administração fechada para o aluno, estorno parcial × total, segundo produto com regra de 1º pagamento, reconciliação por linha, celular) |
| Estado | ✅ **Validada ponta a ponta** |

## 7. Parceiros → indicação → oportunidade → resultado → repasse

| | |
|---|---|
| Apps envolvidos | Pages (`?ref=código`) → CRM (oportunidade indicada) → Portal do parceiro → Financeiro (Contas a pagar) |
| Registro compartilhado | `referrals` (liga parceiro, pessoa e oportunidade ANTES do atendimento) → `opportunities` → `partner_payouts` → `payables` |
| Regra | Indicação convertida em venda **não gera repasse automaticamente**; repasse só existe por **decisão expressa do Financeiro** (criar → autorizar → pagar), nunca por regra automática de indicação; parceiro indicador é **distinto** do fisioterapeuta prestador — nenhuma comissão de atendimento nasce para o indicador; autorizar cria a conta a pagar (compromisso), pagar fecha a mesma conta (caixa/DRE); parceiro vê só primeiro nome e etapa da indicação, nunca contato nem dado clínico |
| Evidência | SQL `S21_repasse_parceiro_financeiro.sql` (16 itens, revalidado ao vivo em 2026-10-02) · E2E `R23-parceiro-indicacao-resultado.spec.ts` (7 testes: indicação pelo link, privacidade no portal do parceiro, administração vê quem indicou quem, conversão sem remuneração automática, repasse expresso autorizar→pagar com reflexo único no caixa, permissões, celular) |
| Estado | ✅ **Validada ponta a ponta** |

## 8. Financeiro → conciliação → relatórios por linha → Hub consolidado

| | |
|---|---|
| Apps envolvidos | Financeiro (vendas, recebíveis, despesas, comissões) → Conciliação bancária → Visão geral/DRE |
| Registro compartilhado | `sales`/`sale_items` (linha do produto) → `payments`/`payables` → `bank_reconcile_*` → `finance_by_line` |
| Regra | Venda com itens de linhas diferentes divide proporcionalmente; despesa compartilhada exige rateio explícito ou fica marcada "compartilhada/não alocada" — nunca escondida; histórico sem classificação aparece como "Não classificado", nunca some do total; o **Geral sempre reconcilia com a soma das linhas** (conferência do servidor, não do olho); extrato bancário original nunca é alterado pela alocação por linha |
| Evidência | SQL `S06_linhas_de_negocio.sql` (44) · `S09_linhas_recorrencia_eficiencia_conciliacao.sql` (61) · E2E `R08-financeiro-por-linha.spec.ts` (Visão geral/DRE, Recorrência MRR/ARR, Relatórios de eficiência, Conciliação) · reconciliação específica também coberta em `R22` (Academy) e `R23` (Parceiros) como consequência |
| Estado | ✅ **Validada ponta a ponta** |

## 9. Operação → Meu dia → Google Calendar

| | |
|---|---|
| Apps envolvidos | Agenda interna (Meu dia) → Google Calendar (sincronização automática) |
| Registro compartilhado | `appointments` → gatilho + job de sincronização (5 em 5 min, `pg_net`/`pg_cron`) → eventos no Google do próprio usuário |
| Regra | Cada pessoa conecta o **próprio** Google Calendar; `state` do OAuth é de uso único; nenhuma confirmação em nome de outro profissional; agenda alheia só para quem o servidor autoriza (gestor/administrador/gestor de unidade — só as unidades dele); retry não duplica evento |
| Evidência | SQL `S11_google_sync_automatica.sql` (19) · E2E `R10-calendarios.spec.ts` (fluxo OAuth até o callback com state/escopos corretos, **sem autorizar de fato**; status de conexão e desconexão) |
| Estado | 🔒 **Bloqueada por configuração externa** — o código, a função (`google-calendar`) e o job estão publicados e testados até o callback; falta a **sua autorização real no Google** (escolher a conta e conceder a permissão) para o evento aparecer de fato no Google. Sem essa ação, não declaro esta integração "concluída" — só o lado do HP está pronto. |

---

## Resumo

| Jornada | Estado |
|---|---|
| 1. Páginas/quizzes → CRM | ✅ |
| 2. CRM → Conversas → tarefas → venda | ✅ |
| 3. Venda → pagamento → pacote → agenda → saldo | ✅ |
| 4. Profissional → agenda → repasses → Financeiro | ✅ (revalidada ao vivo nesta rodada) |
| 5. Paciente → jornada → renovação | ✅ código/regra · 🔒 vídeo real (Bunny) |
| 6. Academy → venda → acesso → progresso | ✅ |
| 7. Parceiros → indicação → repasse | ✅ |
| 8. Financeiro → conciliação → Hub | ✅ |
| 9. Operação → Google Calendar | 🔒 autorização real no Google pendente |

**Nenhuma integração externa (Google, Bunny, Resend, WhatsApp) é declarada concluída só por mock ou configuração** — cada uma tem, acima, exatamente o que falta e de quem depende.
