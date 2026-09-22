# Métricas do dashboard

Origem: função `public.dashboard_metrics(p_from, p_to, p_unit)` (migration 011). Cada indicador devolve `{value, available, basis}`.
**Ausência de dado = `available:false` ("Indisponível"), nunca zero.** Visível para gestor e administrador operacional (organização) e gestor de unidade (suas unidades). Custo de aquisição e ROI de mídia: **indisponíveis** (não há dados de investimento no sistema).

| Indicador | Definição / regra | Data usada |
|---|---|---|
| Visitas | Sessões únicas em `page_visits` (uma por sessão a cada 30 min) | data da visita |
| Leads | Envios em `form_submissions` | data do envio |
| Conversão das páginas | leads ÷ visitas (%) | período |
| Oportunidades criadas (+ por origem) | `opportunities` | data de criação |
| Tempo até 1º atendimento | média(`first_response_at − created_at`) das oportunidades criadas no período com contato registrado | data de criação |
| Conversão comercial | ganhas ÷ (ganhas + perdidas) | data de fechamento |
| Ticket médio | média de `sales.total_cents` das vendas confirmadas | data da venda |
| Motivos de perda | contagem por motivo das oportunidades perdidas | data de fechamento |
| Agendamentos vindos do CRM | `appointments` com oportunidade | data de criação do agendamento |
| Atendimentos / faltas / comparecimento | status `attended` / `no_show`; taxa = attended ÷ (attended + no_show) | data do atendimento |
| Ocupação | minutos agendados (scheduled/confirmed/attended) ÷ minutos de disponibilidade cadastrada no período | data do atendimento |
| Sessões contratadas / utilizadas | soma dos lançamentos `grant` / `consume` no livro de sessões | data do lançamento |
| Recebimentos | Σ pagamentos − Σ estornos (`payments`) | data do pagamento |
| Despesas | Σ `payables` com status pago | data do pagamento |
| Resultado de caixa | recebimentos − despesas pagas (regime de caixa) | data do pagamento |
| Inadimplência | Σ (valor − líquido recebido) das parcelas em aberto/parciais vencidas | hoje |
| A receber em 30 dias | parcelas **contratadas** em aberto com vencimento nos próximos 30 dias | vencimento |
| A pagar em 30 dias | contas a pagar em aberto até 30 dias | vencimento |
| **Projeção de mensalidades** | ver abaixo — *não é conta a receber* | competência |
| Alunos ativos | pessoas com direito de acesso ativo (não revogado, dentro da validade) | hoje |
| Certificados / conclusão | emitidos no período / certificados ÷ matrículas já concedidas | data de emissão |
| NPS / nota média | (promotores 9–10 − detratores 0–6) ÷ respostas; só com ≥ 5 respostas | data da resposta |
| Indicações | `referrals` | data |

## Cinco conceitos financeiros (separados)
1. **Venda contratada** — `sales.total_cents` (confirmada). 2. **Valor a receber** — parcelas em aberto; a venda original **não** é somada às parcelas. 3. **Recebimento efetivo** — `payments` líquidos de estorno. 4. **Serviço realizado** — atendimentos `attended`. 5. **Receita reconhecida** — regra gerencial **proposta** (a validar pelo responsável): pacote = sessões realizadas × (preço ÷ sessões do pacote); demais produtos = valor recebido. Ver `results_by_product`.

## Projeção de mensalidades (`subscription_forecast`)
Para o mês-alvo T, considera parcelas de produto mensal (`recurrence='monthly'`) com **competência T−1**, venda confirmada e **pagamento líquido > 0**: gera uma projeção por (pessoa, produto) com pagamento e data de origem. Não entram: quem pagou só antes de T−1; pagamentos totalmente estornados; vendas canceladas; quem já tem parcela contratada em T (já é conta a receber). Pagamentos duplicados não duplicam a projeção (uma por pessoa e produto). Atualiza-se a cada pagamento válido porque é calculada sobre os dados persistidos.

## MRR / ARR — auditoria semântica e mudança de origem (migration 024/025, sessão 2026-09-22)
**Isto supera a definição anterior** (que usava `products.recurrence='monthly'` + `receivables.competence_month` — na prática, o sinal de uma *venda avulsa parcelada de um produto marcado como mensal*, não de um **contrato recorrente de fato**). A auditoria (item 1 do pedido desta sessão) confirmou: "a ponte fechar matematicamente é necessário, mas não comprova que os dados representam MRR" — o sinal antigo não distinguia contrato ativo de mensalidade paga, não tinha vigência/histórico e confundia inadimplência com cancelamento. Correção: criadas `public.recurring_contracts` (o contrato) e `public.recurring_contract_changes` (histórico **append-only** de mudanças com `effective_on` — nunca sobrescreve; uma mudança lançada hoje com data efetiva de hoje não altera relatórios de meses passados).
- **Contrato recorrente**: criado por `recurring_contract_start` (pessoa, unidade, produto opcional, periodicidade `monthly/quarterly/semiannual/annual`, valor do **período contratado** + desconto do período — convertidos para mensal no servidor por divisão inteira). Mudanças (`recurring_contract_change`): `expansion`/`contraction`/`pause`/`resume`/`cancel`, cada uma com `effective_on` próprio; `contraction`/`cancel` exigem motivo.
- **Estado "as of"**: `private.contract_state_at(contract, data)` resolve o estado num instante via `DISTINCT ON (contract_id) ... WHERE effective_on <= data ORDER BY effective_on DESC, created_at DESC` — garante imutabilidade histórica.
- **Base do mês M** (`private.mrr_base`, migration 024): contratos com estado `active` em M (via `contract_state_at`), valor = bruto − desconto do período ÷ meses do período. **Nunca** inclui venda avulsa, parcela de produto não-recorrente, nem pagamento recebido — só o que está registrado como contrato ativo naquele mês.
- **MRR(M)** = soma da base. **ARR** = MRR × 12. Ponte (`mrr_report`, migration 025): `MRR inicial (M−1) + Novo + Expansão + Reativação − Contração − Cancelamento = MRR final (M)`, agora chaveada por `contract_id` (não mais por par pessoa+produto).
  - **Novo**: contrato nunca esteve ativo antes de M. **Reativação**: esteve ativo antes, pausou/cancelou, voltou em M. **Expansão/Contração**: mesmo contrato, valor mensal mudou. **Cancelamento**: ativo em M−1, não está mais em M (pausa ou cancelamento — **inadimplência não cancela**; só uma mudança explícita registrada muda o MRR).
  - Retenção bruta/líquida e churn de clientes/receita: mesmas fórmulas de antes, agora sobre a base de contratos; seguem `available:false` (nunca 0%) quando não há base anterior.
- **Testado** (`supabase/tests/013_mrr_contracts.sql`, 14/14): contrato anual normalizado por mês; venda avulsa parcelada excluída da base; contrato ativo com parcela em atraso continua contando (inadimplência ≠ cancelamento); cancelamento com data futura; expansão e contração; estorno; reativação; mudança lançada hoje não altera histórico de meses passados.
- **Recebimentos, Contas a receber e Forecast por pagamentos continuam entidades separadas** (não usam `recurring_contracts`): Recebimentos = `payments` líquidos; Contas a receber = parcelas contratadas em aberto; **Forecast por pagamentos** (`subscription_forecast`) é uma projeção heurística baseada em quem pagou no mês anterior — a UI da tela Recorrência agora rotula isso explicitamente como "não é MRR contratual nem conta a receber" para nunca ser confundido com o MRR real.
- **Cohort de retenção/churn**: um "cliente recorrente do mês M−1" é qualquer pessoa com contrato `active` em M−1 (via `contract_state_at`); ela "segue ativa" em M se algum contrato dela está `active` em M — mesma pessoa com múltiplos contratos conta uma vez por contrato, não por pessoa (decisão consciente: contratos são a unidade de MRR, não pessoas).

## DRE / rentabilidade — classificação (migration 027, sessão 2026-09-22)
**Evoluiu de "sempre indisponível" para dado real classificável**, mantendo a regra "não é o mesmo indicador que aceitar registrar tudo": ausência de classificação nunca vira zero, e ausência de custo por produto não trava os totais consolidados que têm base válida.
- **Classificação DRE** (`finance_categories.dre_classification`: `deducao`/`custo_direto`/`despesa_operacional`, opcional): configurável em Financeiro → Configurações → Categorias de despesa. Sem classificação, a categoria some das somas de dedução/custo/despesa operacional mas continua aparecendo separada como "sem classificar" — nunca é somada por padrão.
- **`dre_report`**: `deducoes_cents`/`custos_diretos_cents`/`despesas_operacionais_cents` ficam `available:true` assim que **existir ao menos uma** categoria classificada (não depende do período ter valor — "disponível" reflete se a classificação existe, não se o número do período é diferente de zero). `sem_classificacao_cents` soma à parte o que não tem categoria/classificação. `cobertura_classificacao_pct` = % das contas pagas do período já classificadas.
- **Receita de caixa ≠ receita reconhecida**: `receita_caixa_cents` = recebimentos líquidos de estorno; `receita_reconhecida_cents` reaproveita a regra já existente de `results_by_product` (pacote = sessões realizadas × preço/sessão; demais produtos = valor recebido). **Limitação honesta, não corrigida nesta sessão**: para produtos não-pacote, o reconhecimento é por *quando o pagamento foi recebido*, não pela `competence_month` do recebível — ou seja, ainda é um proxy de caixa, não reconhecimento por competência real. Ficou documentado explicitamente na `basis` do indicador em vez de ser escondido.
- **Margem por produto** (`margin_by_product`, nova): só fica disponível para o produto que tiver um custo direto **atribuído a ele especificamente** (`payables.product_id`, campo opcional em Contas a pagar). Os demais mostram a receita reconhecida com margem `Indisponível` — nunca estimada.
- **Testado** (`supabase/tests/014_dre_classification.sql`, 11/11): pagamento em mês diferente da competência, cancelamento, estorno, cobertura parcial, categoria sem classificação nunca vira despesa operacional.

## Envelhecimento de vencidos (`overdue_aging`)
Soma do saldo não recebido das parcelas `open`/`partial` vencidas, em 4 faixas por dias de atraso: 1–30, 31–60, 61–90, acima de 90 (hoje − vencimento).

## Eficiência do negócio (`efficiency_report`)
Receita por paciente pagante / por sessão realizada: recebido líquido no período ÷ contagem no período. Taxa de recompra: pessoas com mais de uma venda confirmada no **histórico completo** ÷ total de compradores. Concentração por produto: participação % do recebido no período, top 10. **CAC, LTV e prazo de recuperação do CAC ficam sempre indisponíveis**: não há dados de investimento em mídia/aquisição no sistema.

## Distribuição geográfica (`geo_distribution` — migrations 020/028)
Por `people.city`/`people.state_uf`/`people.country` (cadastro manual, nunca IP nem geolocalização do navegador). Um segmento (`patient`/`partner`/`student`) é definido por `person_kinds.kind` — a mesma pessoa pode aparecer em mais de um segmento, mas dentro de cada segmento é contada uma única vez (distinct por pessoa). `sem_localizacao` conta apenas quem não tem cidade/UF/país informado **e** está no Brasil (`country='BR'` ou nulo) — um cadastro de outro país sem UF brasileira não é mais contado como "sem localização" (migration 028, achado corrigindo o mapa: antes misturava as duas coisas). `by_country_other` agrupa por país quem está fora do Brasil, exibido à parte no painel de Distribuição geográfica.
- **Mapa do Brasil por UF** (`GeoSection.tsx`, nova): geometria estática do pacote `@svg-maps/brazil` (CC-BY-4.0, ~147 KB, zero chamada externa) — nenhum dado de pessoa é enviado a serviço nenhum para desenhar o mapa. Clicar num estado filtra o ranking de cidades abaixo; legenda de intensidade e tooltip nativo por estado com contagem/participação %.

## Autoatendimento do paciente (`my_profile_update` — migration 029, sessão 2026-09-22)
RPC com lista explícita de campos permitidos: `preferred_name`, `phone` (vira o telefone principal em `person_contacts`, demovendo o anterior antes de promover o novo — evita violar o índice único parcial de "um principal por tipo"), `city`, `state_uf` (normalizado para maiúsculas, valida contra o `CHECK` de 2 letras da coluna). **Nunca expõe**: `full_name`, `unit_id`, identificadores internos, dados clínicos, contratos/pagamentos — a função não aceita esses parâmetros, então não há como um payload malicioso alterá-los. Alteração de e-mail de autenticação não passa por aqui (segue o fluxo próprio do Supabase Auth). Auditada por um trigger dedicado (`audit_people_self_edit`). Testado (`supabase/tests/015_patient_self_edit.sql`, 10/10): edição legítima, troca de telefone sem deixar dois "principais", telefone inválido rejeitado, conta sem pessoa vinculada rejeitada, e tentativa de escrita direta em cadastro de outra pessoa continua bloqueada pela RLS de sempre (o RPC nem aceita um "para quem" — só edita a própria pessoa autenticada).

## Bugs reais corrigidos ao escrever os testes desta sessão (2026-09-22)
- `private.dash_units()`: o `else` excluía o papel `finance` do filtro por unidade — usuários só com papel financeiro recebiam "sem permissão para o painel" em **todos** os relatórios de Financeiro, apesar de terem acesso à rota (migration 026).
- `bank_statement_import`: reimportar o mesmo extrato duplicava as linhas (sem checagem de idempotência por conteúdo) — corrigido para ignorar linha idêntica a uma já existente na mesma conta (migration 030).
- `bank_statement_import`: `if v_unit is null or not can_finance(v_unit) then 'sem permissão'` rejeitava **qualquer** conta financeira sem unidade — e nenhuma conta cadastrada via Configurações tinha unidade (o formulário nunca pedia). Mensagem agora diferencia "conta não encontrada" de "conta sem unidade definida" de "sem permissão"; Configurações passou a exigir unidade ao cadastrar conta financeira (migration 031 + `Settings.tsx`).
- `Commissions.tsx`: lia `t.name` de `list_team()`, que devolve `display_name` — todo select de beneficiário aparecia em branco (bug só de frontend, sem migration).

## Indicadores executivos adicionais do Início (`Dashboard.tsx`, consulta direta — sem RPC dedicada ainda)
- **Novos pacientes**: pessoas com `person_kinds.kind='patient'` criadas no período (por `people.created_at`).
- **Pacientes com pacote ativo**: pessoas com ao menos um `client_packages.status='active'` **hoje** (posição, não movimentação do período).
- **Parceiros ativos**: `partner_profiles.status='active'` **hoje**.
