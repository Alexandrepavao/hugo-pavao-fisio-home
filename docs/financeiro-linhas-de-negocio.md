# Financeiro por linha de negócio (HP Fisioterapia / HP Academy)

> Migrations `057` e `060`, telas de Financeiro e testes `S06` e `S09`. **Aditivo**: nenhuma função financeira existente foi alterada — a visão **Geral** (`dashboard_metrics`, `dre_report`, vendas, recebíveis, fluxo de caixa, recorrência…) continua exatamente como era.
> As linhas são **da mesma organização**: não viram unidades, empresas nem bancos.

## Onde classificar
- **Produtos** (Configurações › Operação): `HP Fisioterapia`, `HP Academy` ou `Não classificado` (padrão). **Nada é adivinhado**: produto antigo fica “Não classificado” até alguém classificar. Reclassificar um produto reclassifica **todo o histórico dele** (é uma classificação, não um lançamento contábil); fica auditado (`audit_log`).
- **Despesas** (Financeiro › Contas a pagar): `HP Fisioterapia`, `HP Academy`, `Compartilhado` ou `Não classificado`. Compartilhada **só é dividida com rateio explícito** (percentual da Fisioterapia; o restante vai à Academy; soma = 100%). Sem rateio fica em “Compartilhado / não alocado”.

## Como o dinheiro é atribuído (sem duplicar, em centavos exatos)
| Base | Critério (inalterado) | Atribuição à linha |
|---|---|---|
| Vendas confirmadas | `sold_at` no período (competência comercial) | linha do **produto de cada item**; venda mista é dividida pelo **líquido de cada item** (o desconto da venda é diluído proporcionalmente) |
| Recebimentos e estornos | `paid_at` no período (**caixa**) | mesma divisão da venda de origem; o resto de centavo vai à linha de **maior resto** — a soma das linhas é sempre o valor do pagamento |
| A receber (previsão) | saldo das parcelas abertas com vencimento no período | mesma divisão da venda |
| Receita reconhecida | regra da DRE (`results_by_product`: pacote = sessões realizadas × valor/sessão) | linha do produto |
| Comissões | pagamento que as gerou (estorno = negativo) | mesma divisão do pagamento/venda |
| Despesas pagas | `paid_at` no período (**caixa**) | linha da despesa; compartilhada com rateio → pelas frações; sem rateio → “não alocado” |
| Despesas por competência | `competence_month` no período, não canceladas | idem |
| Despesas a pagar (previsão) | em aberto com vencimento no período | idem |
| DRE por linha | deduções, custos diretos, despesas operacionais e “sem classificação” das contas pagas (categoria → classificação DRE existente) | idem |

Caixa, competência e previsão **continuam separados** — a linha só atribui valores, não muda o critério de nenhuma tela.

## Conferência “Geral = soma das partes”
`finance_by_line` devolve, com o quadro, uma **conferência** que compara o total das linhas com os totais **diretos** das tabelas em nove métricas (vendas, recebimentos, estornos, previsão a receber, receita reconhecida, comissões, despesas pagas, por competência e a pagar). A tela mostra “Conferido” ou “Divergência — não use estes números”. **Geral = HP Fisioterapia + HP Academy + Compartilhado/não alocado + Não classificado.**

## Permissões
Quadro e DRE por linha: mesmo escopo do painel financeiro existente (`private.dash_units`: gestor, administrador operacional e gestor de unidade nas suas unidades). Classificar produto: gestor/administrador operacional. Classificar/ratear despesa: quem tem acesso financeiro à unidade da despesa. Marcar vendas/recebíveis/comissões com a linha (`sale_line_shares`): quem já pode ler as vendas da unidade.

## Telas
Visão geral e DRE (seção por linha com seletor Geral / HP Fisioterapia / HP Academy na URL `?linha=`), Vendas e Recebíveis (coluna e filtro por linha), Comissões (coluna e filtro pela linha da venda), Contas a pagar (linha, rateio e filtro), Configurações › Operação (linha do produto).

## Limitações conhecidas
- “Receita reconhecida” segue a regra por produto da DRE; numa venda mista, a parte reconhecida depende dos produtos vendidos, não dos valores do item.
- Enquanto a migration 057 não estiver aplicada, as telas seguem funcionando (a coluna “Linha” aparece como “—”/“Não classificado” e o quadro por linha mostra erro).
- Enquanto a migration 060 não estiver aplicada, Recorrência, Relatórios e Conciliação seguem com o comportamento anterior; só a parte “por linha” mostra erro.

## Recorrência (MRR/ARR) por linha — migration 060
- **Linha do contrato = linha do produto do contrato.** Um contrato tem um só produto, então **não há divisão de centavos**. Contrato sem produto (ou com produto ainda “Não classificado”) aparece em “Não classificado”; reclassificar o produto move o MRR dele, inclusive no histórico.
- `mrr_by_line` devolve, por linha: MRR inicial, novo, expansão, reativação, contração, cancelamento, MRR final, ARR, contratos, clientes, receita média por cliente, churn de clientes e de receita, retenção bruta e líquida. A ponte de cada linha fecha sozinha.
- **Conferência contra `mrr_report`** (o relatório consolidado, que não foi alterado): MRR inicial, novo, expansão, reativação, contração, cancelamento, MRR final e ARR — a soma das linhas tem de igualar o consolidado.
- **Clientes não somam**: quem tem contratos nas duas linhas conta em cada uma; o Geral conta a pessoa uma vez. Por isso clientes **não** entram na conferência (a tela explica).
- `mrr_history_by_line` alimenta o gráfico de 12 meses da linha escolhida. A projeção de mensalidades do mês seguinte é filtrada pela linha do produto de cada mensalidade.
- Permissão: a mesma do relatório consolidado (`private.dash_units`).
- Os cartões do **Geral** continuam abrindo o detalhe por contrato; o detalhe por contrato **de uma linha** ainda não existe (a tela avisa).

## Relatórios de eficiência por linha — migration 060
- `efficiency_by_line`: recebido líquido (caixa, com a mesma divisão exata de `finance_by_line`), pacientes pagantes, atendimentos realizados, receita por paciente, receita por sessão, taxa de recompra e concentração por produto.
- **Atendimentos realizados** ganham linha pelo **produto do pacote** que a sessão consumiu; atendimento **sem pacote** (avulso) fica em “Não classificado”.
- **Conferência**: só o que é somável — recebido líquido e quantidade de atendimentos. **Pessoas (pacientes pagantes, compradores, recompradores) não são conferidas** porque o mesmo paciente pode estar nas duas linhas.
- **Receita por sessão**: recebido líquido da linha ÷ atendimentos da linha no período — pode misturar pacotes vendidos em outra data; é referência, não preço de sessão. Indisponível (“—”) quando a linha não tem atendimentos.
- **CAC, LTV e prazo de recuperação** seguem indisponíveis (sem dados de investimento em mídia) e **não são divididos por linha**.
- A concentração por produto mantém a regra original (recebido por produto do recebível) e acrescenta a linha do produto e a participação dentro da linha.

## Conciliação bancária por linha — migration 060
- **O extrato importado nunca é alterado pela linha de negócio.** `bank_statement_lines` (data, descrição, valor, referência) fica exatamente como veio; a linha é uma **camada separada**.
- **Movimento conciliado** herda a linha do lançamento conciliado: recebimento → a divisão da venda de origem; conta paga → a linha (ou o rateio) da despesa. **Não há alocação manual** num movimento conciliado (a função recusa) — isso evitaria contar duas vezes. Se um movimento já alocado manualmente for conciliado, a alocação manual é removida por gatilho.
- **Movimento pendente ou ignorado** pode receber **alocação manual** (`bank_line_set_allocation`, em pontos-base somando 10.000: HP Fisioterapia, HP Academy, Compartilhado), com divisão exata em centavos. Sem alocação fica “Não classificado”. A alocação manual é **auditada** (autor, antes e depois). Desfazer a conciliação devolve o movimento a “Não classificado”.
- **Movimentos bancários × Financeiro por linha**: o quadro “Movimentos bancários por linha de negócio” (Financeiro › Conciliação) é o que **passou pela conta** (data do extrato), com **entradas e saídas separadas**. Não substitui Vendas/Recebíveis/Contas a pagar por linha (competência/caixa dos lançamentos) e não altera nenhum deles.
- **Conferência contra o extrato original**: entradas, saídas e saldo líquido das linhas = soma direta de `bank_statement_lines` no mesmo período/conta.
- Permissão: a mesma da conciliação existente (`private.can_finance` da unidade do movimento). Escrita só pela função validada; a tabela `bank_line_allocations` não aceita escrita direta.
