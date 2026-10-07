# Repasses e comissões

> Migrations `20260930000075_commission_detail_reconciliation.sql` e `20260930000076_commission_status_machine.sql` (aplicadas no Dev; os arquivos do repositório foram conferidos função por função contra `pg_proc` do Dev e são **idênticos**) · testes: SQL `supabase/tests/release/S18_repasses.sql` (29 itens) e `S15` (resumo do profissional) · E2E `e2e/release/R20-repasses.spec.ts` (8 testes) · telas: Financeiro › Comissões e repasses (`/admin/financeiro/comissoes`) e Produtividade › Meu resumo (`/admin/meu-resumo`).

## Fato gerador e regra (nada fixo no código)

- **Fato gerador:** cada **recebimento** (`payments.kind = 'payment'`) de uma venda que contém o produto da regra gera **um lançamento** (`commission_entries`) por regra ativa que casa. Valor = `valor recebido × percentual da regra` (arredondado ao centavo). Um **estorno** gera **um** lançamento negativo proporcional (`status = reversed`).
- **Regra** (`commission_rules`, cadastrada pelo Financeiro): nome, **produto** (vazio = todos), **beneficiário** (vazio = responsável da oportunidade no momento do pagamento) e **percentual**. Não há valor fixo (R$ 100/R$ 60 aparecem só como exemplos de cálculo nos testes: 20% de R$ 500/R$ 300) e **nenhuma política universal**: cada organização cadastra as suas regras (compatível com o white label).
- As regras **se somam** (cada uma vai ao seu beneficiário). O percentual aplicado é **guardado no lançamento** (`percent_bp`): mudar a regra depois não recalcula o passado. Lançamentos anteriores à 075 (134 no Dev) não têm percentual guardado e aparecem como “da regra atual / estimado”; se divergirem do recálculo, a conferência mostra a divergência em vez de escondê-la.
- Idempotência: o lançamento é único por `(payment_id, rule_id)`; repetir o recebimento (mesma chave) ou o estorno (mesma chave) não duplica.

## Estados

`pendente → autorizada → paga`; **paga** e **estornada** são finais; mesmo clique repetido não muda nada; pular a autorização ou voltar é recusado (`transição inválida`). Só o Financeiro/gestão autoriza e paga (`can_finance(unit)`); o beneficiário **não** autoriza a própria comissão. Toda mudança é auditada (`audit_commission_entries`).

## Visões

- **Financeiro:** lançamentos do período (data do recebimento), filtro por beneficiário/estado/linha, base, percentual, regra e linha; **conferência** que recalcula cada lançamento (base × percentual), mostra o total líquido e compara com a linha “Comissões” da Visão geral (`finance_by_line`): diferença R$ 0,00 = conferido.
- **Profissional (Meu resumo):** pendente, autorizado, pago, estornos e **líquido**; detalhamento com data do recebimento, produto(s), regra, base e percentual — **nunca o paciente**. Só o próprio profissional vê o repasse; o gestor/gestor de unidade vê os atendimentos dele, **não** o repasse individual. Sem regra e sem lançamento: “indisponível” (sem zero inventado).

## O que NÃO existe (decisão pendente quando houver)

- Repasse por **atendimento realizado** (fato gerador alternativo): hoje o gatilho é o **recebimento**. Se a organização quiser pagar o fisioterapeuta por sessão realizada, é outra regra/fato gerador e precisa de decisão.
- Pagamento efetivo do repasse (transferência bancária): “Marcar paga” registra a decisão do Financeiro; não gera despesa/lançamento no contas a pagar nem integra banco.
- Parceiro **indicador** não recebe repasse por indicação: só existe remuneração se uma regra for cadastrada explicitamente para ele; não há regra automática por encaminhamento.
