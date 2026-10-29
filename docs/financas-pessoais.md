# Finanças pessoais (dentro do Financeiro)

Módulo **privado do proprietário**, no aplicativo Financeiro do HP Group Hub (`/admin/financeiro/pessoal`). Migrations 092–095, testes SQL `S30`–`S32` e E2E `R34`. **Só Dev** nesta entrega: produção e DNS não foram tocados.

## 1. Acesso e separação dos dados
- **Quem acessa:** apenas quem tem uma linha ativa em `pf_access` **e** a organização com `organizations.features.personal_finance = true`. Ser `manager` não dá acesso (propriedade ≠ papel). Revogar (`revoked_at`) vale na hora.
- **Quem concede:** somente a operação, por `node supabase/tools/pf-acesso.mjs --email=... [--ligar-recurso]` (só Dev; `--revogar`, `--listar`). **O app não tem tela de concessão de propósito.** Para a produção, a concessão exige confirmação explícita antes de existir a ferramenta/SQL equivalente.
- **Isolamento:** tabelas próprias `pf_*`. RLS só do dono (`owner_user_id = private.pf_user()`), `anon` sem nenhum privilégio, escrita **somente por funções** `security definer`. Nada é lido por DRE, caixa, relatórios, auditoria compartilhada, notificações ou busca global; a sidebar e o Ctrl+K só mostram a entrada para quem tem acesso. Testado pela API com gestor, financeiro, comercial e anônimo (S30 e R34).
- **Outros arquivos:** comprovantes no bucket privado `pf-private`, pasta = id do dono. Atenção: o `backup-projeto.mjs` exporta tabelas inteiras; os dados pessoais entrariam num backup da produção (decidir antes de promover).
- **White label:** o recurso liga por organização (`features`), e cada usuário autorizado tem os próprios dados.

## 2. Modelo
| Conceito | Onde |
|---|---|
| Contas (saldo inicial + data), cartões (limite, fechamento, vencimento, só 4 últimos dígitos), categorias/subcategorias | `pf_accounts`, `pf_cards`, `pf_categories` |
| Lançamento (obrigação/despesa/receita) | `pf_entries` (`kind`, `nature` fixo/variável, `repetition` avulso/recorrente/parcelado, `status` previsto/em aberto/parcial/liquidado/cancelado) |
| Regra de recorrência | `pf_series` (+ `pf_series_pauses`); ocorrências futuras **calculadas**, só viram lançamento quando tocadas |
| Liquidações (pagamento/recebimento parcial) | `pf_settlements` (estorno = `voided_at`, histórico preservado) |
| Faturas | `pf_invoices` + `pf_invoice_payments` |
| Transferências, aportes (reserva/meta/investimento) | `pf_transfers` |
| Orçamento, metas, lembretes, importações, vínculo com a empresa | `pf_budgets`, `pf_goals`, `pf_reminder_acks`, `pf_imports/_lines`, `pf_business_links` |

**Regras:** “fixo × variável” (comportamento do valor) é independente de “avulso × recorrente × parcelado” (repetição). Dia 29/30/31 em mês menor = **último dia do mês**. “A cada 14 dias” (`biweekly`) ≠ “duas vezes por mês” (`semimonthly`, dois dias). Parcelas: `split_cents` (soma exata). Idempotência por chave em lançamento, série, parcelamento, liquidação, fatura, transferência, importação e vínculo. Datas financeiras são `date` (sem fuso); “hoje” = America/Sao_Paulo.

**Edição de séries:** *somente esta* (marca a ocorrência como editada à parte), *esta e as próximas* (divide a série na data; o passado liquidado fica na série antiga) e *toda a série* (só campos descritivos/valor; não mexe nas liquidadas nem nas editadas à parte; mudar frequência/vencimento exige “esta e as próximas”). **Cancelar** recorrência encerra a partir da ocorrência e cancela só as pendentes futuras. **Pausar/retomar** pula as datas da pausa (não repõe) e não consome o limite de ocorrências.

**Cartão:** compra = **uma despesa** (competência = data da compra) + a obrigação da fatura. Pagar a fatura (parcial ou total) sai da conta e liquida a obrigação, **sem criar despesa**. Compra de cartão não é liquidada direto. Limite não é saldo: `limite − faturas em aberto` = disponível.

## 3. Fórmulas dos indicadores (todas no banco; o cartão e o detalhamento usam as mesmas linhas)
- **Receitas recebidas** = Σ liquidações de receita com data no período.
- **Despesas realizadas** = Σ pagamentos de despesa (conta) com data no período + compras no cartão com data da compra no período e ≤ hoje. O pagamento da fatura não conta.
- **Receitas/despesas previstas** = saldo ainda não pago com vencimento no período + ocorrências calculadas + compras/parcelas de cartão com data futura.
- **Resultado realizado** = recebidas − realizadas. **Saldo das contas** = saldo inicial + recebimentos − pagamentos ± transferências − faturas pagas (limite nunca entra).
- **Saldo projetado** = saldo hoje + entradas previstas − saídas comprometidas (inclui vencidas, faturas e ocorrências calculadas) até a data-limite (fim do período ou +30 dias).
- **Vencidas / a vencer 7 e 30 dias / faturas em aberto:** saldo a pagar de contas, ocorrências e faturas por data de vencimento.
- **Fixas × variáveis:** realizado + previsto do período por comportamento. **Compromissos recorrentes** = equivalente mensal das séries de despesa ativas (semanal×52/12, quinzenal×26/12, duas vezes por mês×2, trimestral÷3, semestral÷6, anual÷12).
- **Custo de vida** (ano-calendário ou próximos 12 meses) = **realizado + compromissos em aberto + variáveis projetados**, por mês; média mensal = total ÷ meses. Variáveis = estimativas (manuais ou **média dos últimos até 6 valores reais**, com a fonte exibida) + **sobra do orçamento** por categoria (orçado − já projetado; só mês atual e futuros). Sem estimativa/histórico/orçamento a projeção é marcada **incompleta**; nada é inventado. Transferências, investimentos e aportes ficam fora; a **necessidade de caixa** soma os aportes mensais das metas.
- **% do orçamento utilizado** = (realizado + compromissos nas categorias com orçamento) ÷ total orçado do mês. **Comprometimento da renda** = despesas fixas do mês ÷ renda do mês (recebida; se zero, a prevista). Sem base → “Sem base para cálculo”.
- **Reserva** = Σ saldos (≥ 0) das contas marcadas como reserva. **Meses de cobertura** = reserva ÷ custo de vida mensal projetado. **Meta** = saldo da conta da meta (se houver) ou soma dos aportes ÷ valor-alvo.
- **Planejar o mês seguinte:** renda de referência (a recebida no mês anterior, se a opção estiver ligada) − compromissos − estimativas − aportes = disponível para distribuir; o **saldo disponível** (contas líquidas) é mostrado à parte.

## 4. Importação e vínculo com a empresa
- **Extrato (CSV):** conta pessoal escolhida → mapeamento de colunas/formatos → prévia (validação por linha, duplicidade por conta+data+valor+descrição com contagem de repetições, sugestão de correspondência) → decisões (associar e liquidar, criar já liquidado, ignorar, deixar) → confirmação tudo-ou-nada. Reimportar o mesmo arquivo marca as linhas como duplicadas. **Não** grava em contas/lançamentos da empresa; sem conexão bancária.
- **Retirada da empresa:** lista retiradas **pagas** do financeiro empresarial às quais o usuário tem acesso financeiro; cria/aponta a receita pessoal (valores iguais), de forma atômica e idempotente; sem entrada pessoal vira **pendência recuperável**. O lado empresarial não é alterado nem reclassificado. Hoje o modelo empresarial não tem “pró-labore/distribuição” como conceito próprio: a retirada é reconhecida por categoria/descrição (retirada, pró-labore, distribuição, reembolso).

## 5. Limitações conhecidas
- Sem integração com Google Calendar (futura, opcional e separada). Lembretes só dentro do app.
- Recorrência com cartão cria a fatura somente quando a ocorrência é tocada; a saída de caixa futura aparece na data da fatura.
- Cartões: fechamento/vencimento entre 1 e 28. Moeda única (BRL).
- `pf_overview`/`pf_charts` recalculam a cada abertura (sem cache); períodos longos (≥ ~800 dias) são recusados na agenda.
- Produção: antes de promover, decidir backup (dados pessoais em exportações) e como conceder acesso ao Hugo (`contato@hpfisioterapia.com.br`, sem conta no Dev) e ao Jan.
