# Cartões corporativos (Financeiro ▸ Cartões)

> Migration `20260930000065_corporate_cards.sql` (aditiva, **só no Dev**; produção não foi tocada) · tela `src/pages/admin/finance/Cards.tsx` · rota `/admin/financeiro/cartoes` ·
> testes `supabase/tests/release/S13_cartoes_corporativos.sql` (80 verificações) e `e2e/release/R13-aplicativos-cartoes-calendario.spec.ts`.

## 1. O que o usuário vê
- Um **cartão visual por cadastro**: apelido, emissor, bandeira (texto), “•••• •••• •••• 4321” (só os 4 últimos dígitos, opcionais), responsável/unidade, **fechamento e vencimento**, **limite total**,
  **gasto no ciclo**, **valor disponível** e barra de uso do limite. Cartão bloqueado aparece em cinza com o selo “Bloqueado”.
- **Resumo** (limite total, gasto no ciclo atual, disponível, a pagar nas faturas) e **Atenção** (cartões bloqueados, faturas fechadas sem pagamento, limite acima de 85%) — sempre dados reais dos cartões
  exibidos; sem cartão cadastrado a tela mostra o estado vazio com o botão de cadastro.
- No cartão selecionado: **Compras** (data, estabelecimento, categoria, linha de negócio, fatura, valor; filtro de linha de negócio do filtro único) e **Faturas** (aberta / fechada — a pagar / paga,
  total, ciclo, vencimento, pagamento e a linha do extrato conciliada). Ações: **Novo cartão**, **Registrar compra**, **Bloquear/Desbloquear** (com motivo), **Cancelar compra**, **Registrar pagamento da fatura**.
- **Não existe** campo para número completo, CVV, validade, senha ou foto do cartão — nem na tela, nem no banco (o teste S13 confere que nenhuma coluna de `corporate_cards`, `card_invoices` ou `card_purchases`
  tem esse tipo de nome, e a função recusa mais de 4 dígitos).

## 2. Modelo de dados (aditivo, RLS, escopo por organização/unidade, auditoria)
| Tabela | Papel |
|---|---|
| `corporate_cards` | cadastro: unidade, apelido (único na organização), emissor, bandeira, `last4` opcional, responsável opcional, limite (centavos), `closing_day`/`due_day` (1–28), conta padrão de pagamento, situação `active`/`blocked` (+ motivo, quem e quando) |
| `card_invoices` | uma por cartão e fechamento (`unique (card_id, closing_date)`): ciclo, fechamento, vencimento, `open`/`paid`, quando/por quem/em qual conta foi paga e o total pago |
| `card_purchases` | liga a compra à fatura e à **despesa**: `payable_id` **único** (a compra É aquela despesa), data, estabelecimento, observação, cancelamento (quem, quando, motivo) |
| `bank_statement_lines.matched_invoice_id` | novo vínculo da linha do extrato com a **fatura** (único; só para saídas) — as checagens existentes foram generalizadas (no máximo um vínculo por linha) |

- **RLS:** leitura só com `private.can_finance(unit)` (gestor, adm. operacional, gestor de unidade e financeiro da unidade); **nenhuma escrita direta** (não há `grant insert/update`): tudo passa por funções
  `security definer` que checam permissão e unidade. Comercial e fisioterapeuta não leem nem escrevem; outra unidade e `anon` também não.
- **Auditoria:** gatilhos `private.audit_row` em cartões, faturas e compras, mais registro explícito do bloqueio (com motivo).

## 3. Regras (e por que não há despesa duplicada)
1. **Compra = uma despesa em `public.payables`** (a mesma tabela de Contas a pagar): competência = **mês da compra**, vencimento = **o da fatura**, categoria, estabelecimento (fornecedor), unidade e
   **linha de negócio** (Geral/Fisioterapia/Academy/compartilhada, com o mesmo rateio explícito `payable_set_line`). Por isso ela aparece **uma vez** em DRE (competência e caixa), fluxo de caixa/previsão,
   relatórios e quadro por linha — nenhum cálculo novo foi criado; S13 mede a diferença exata (+R$ 300,00 uma vez) em `finance_by_line` e na `dre_report`.
2. **Ciclo:** compra até o dia do fechamento (inclusive) entra na fatura que fecha naquele mês; no dia seguinte, na próxima. Vencimento no mês do fechamento se o dia de vencimento for depois do de
   fechamento; senão, no mês seguinte (testado nas virada de mês/ano e em fevereiro bissexto).
3. **Limite:** disponível = limite − compras ainda não pagas (faturas abertas e fechadas sem pagamento). Compra acima do disponível é recusada; cartão **bloqueado não aceita compra**; compra futura (além de
   amanhã) ou com mais de 400 dias, valor ≤ 0, categoria que não seja despesa e linha inválida são recusados.
4. **Cancelar compra:** só enquanto a fatura não foi paga; a despesa vira `cancelled` (some da DRE e libera o limite). Não se lança compra em ciclo cuja fatura já foi paga.
5. **Pagar a fatura** (`card_invoice_pay`, só depois do fechamento): baixa **as despesas do ciclo** na conta e na data informadas — nunca cria despesa nova. A despesa de cartão **não pode ser paga
   isoladamente** (`payable_pay` recusa) nem conciliada isoladamente; em Contas a pagar ela aparece com o selo “Cartão” e o atalho “Pagar pela fatura”.
6. **Conciliação (fatura agregada do banco):** a linha de saída do extrato é **ligada à fatura já paga** (`card_invoice_reconcile`), exigindo valor igual ao total pago, mesma unidade e **mesma conta bancária**
   que pagou. A regra do sistema continua: **a conciliação só aponta** — não cria nem altera despesa nem o extrato (S13 e R13 comparam quantidade/total de despesas e o texto/valor/data da linha antes e depois),
   uma fatura só liga a uma linha (índice único), desfazer só solta a ligação. A sugestão aparece em Conciliação (“Fatura do cartão …”), e na visão por linha de negócio a saída é dividida como as próprias
   despesas da fatura (`private.bank_line_split` ganhou o ramo “fatura de cartão”).
7. Funções existentes ajustadas (mesma assinatura, grants repetidos): `payable_pay`, `bank_reconcile_confirm`, `bank_reconcile_suggestions`, `bank_reconcile_undo`, `private.bank_line_split`.

## 4. Testes executados
- **SQL S13 (80 OK, 0 falha):** ciclo (6 casos), nenhuma coluna sensível, permissões e RLS (financeiro da unidade, outra unidade, comercial, fisioterapeuta, anon, escrita direta), validações, compra = 1 despesa
  (payables, `finance_by_line`, `dre_report`), rateio, limite/disponível/gasto do ciclo, bloqueio, cancelamento, pagamento da fatura (conta/data/sem duplicar), conciliação (sugestão, valor/conta diferentes,
  compra isolada recusada, duas linhas na mesma fatura, extrato intacto, linha de negócio, desfazer), auditoria e funções privadas.
- **E2E R13:** cadastro pela tela (sem pedir CVV/número; visual sem número completo), compras (antiga e atual) com 2 despesas exatas, “Cartão” em Contas a pagar, bloqueio/desbloqueio, limite, pagamento da
  fatura, conciliação pela tela sem alterar despesas/extrato, permissões e celular sem rolagem lateral; os dados de teste são removidos ao final.
- Regressão: S01–S12, N01–N02 e os E2E R01–R12 (ver `docs/interface-v2.md` §8 e `docs/project-status.md`).

## 5. Configuração necessária e limitações
- **Nada a configurar** além de ter **contas financeiras** cadastradas (Financeiro ▸ Configurações) para pagar a fatura e **categorias de despesa** (para a DRE; sem categoria a despesa fica em “sem classificação”).
- Em **produção** a migration 065 precisa ser aplicada na ordem (depende da 057 e da 060); não foi aplicada lá.
- **Não há integração com o emissor/banco**: compras e faturas são lançadas pelo usuário (como o resto do financeiro); o extrato é o CSV da Conciliação. Parcelamento de compra no cartão não existe (lança-se cada
  parcela como compra); estorno de compra de fatura já paga não tem fluxo próprio; não há edição de limite/dias depois do cadastro (cadastre de novo ou peça ajuste ao suporte).
- “Gasto no ciclo” e “disponível” são calculados com o relógio de Brasília (America/Sao_Paulo).
