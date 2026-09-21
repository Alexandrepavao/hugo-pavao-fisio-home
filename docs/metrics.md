# Métricas

Cada indicador terá: definição, tabela de origem, regra de cálculo, e o filtro de data usado (criação, venda, pagamento ou atendimento). Ausência de dados → "indisponível", nunca zero. Custo de aquisição/ROI só com dados de mídia suficientes.

**Estado: nenhuma métrica implementada ainda** (Etapa 5). Regras já decididas:

| Conceito | Regra |
|---|---|
| Venda contratada | Valor do contrato/venda confirmada (não é dinheiro recebido) |
| Valor a receber | Soma das parcelas em aberto; a venda original **não** é somada às parcelas |
| Recebimento efetivo | Pagamentos confirmados (líquidos de estorno) |
| Serviço realizado | Sessões com status "realizada" |
| Receita reconhecida | Regra gerencial a definir com o responsável (proposta: por sessão realizada / competência mensal) |
| Projeção de mensalidades | Mensalidade paga na competência M gera projeção para M+1 (pessoa, produto, valor e data de origem visíveis); quem pagou só em M-1 não entra; estornos/cancelamentos removem; pagamentos duplicados na mesma competência contam uma vez. Rotulada como **projeção**, separada de contas a receber |
