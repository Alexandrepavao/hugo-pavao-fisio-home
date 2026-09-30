# Financeiro por linha de negócio (HP Fisioterapia / HP Academy)

> Migration `057`, telas de Financeiro e teste `S06`. **Aditivo**: nenhuma função financeira existente foi alterada — a visão **Geral** (`dashboard_metrics`, `dre_report`, vendas, recebíveis, fluxo de caixa, recorrência…) continua exatamente como era.
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
- Recorrência (MRR/ARR), Relatórios de eficiência e Conciliação bancária **ainda não têm seletor de linha** — a conciliação é do extrato bancário (não pertence a uma linha); MRR e eficiência ficam para a próxima etapa.
- Enquanto a migration 057 não estiver aplicada, as telas seguem funcionando (a coluna “Linha” aparece como “—”/“Não classificado” e o quadro por linha mostra erro).
