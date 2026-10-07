# Cartões corporativos (Financeiro ▸ Cartões)

> Migrations `20260930000065_corporate_cards.sql` e `20260930000066_card_update.sql` (aditivas, **só no Dev**; produção não foi tocada) · tela `src/pages/admin/finance/Cards.tsx` · rota `/admin/financeiro/cartoes` ·
> testes `supabase/tests/release/S13_cartoes_corporativos.sql` (80 verificações), `S14_cartoes_edicao.sql` (43) e `e2e/release/R13-aplicativos-cartoes-calendario.spec.ts` / `R14-filtro-unico-edicao-cartao.spec.ts`.

## 1. O que o usuário vê
- Um **cartão visual por cadastro**: apelido, emissor, bandeira (texto), “•••• •••• •••• 4321” (só os 4 últimos dígitos, opcionais), responsável/unidade, **fechamento e vencimento**, **limite total**,
  **gasto no ciclo**, **valor disponível** e barra de uso do limite. Cartão bloqueado aparece em cinza com o selo “Bloqueado”.
- **Resumo** (limite total, gasto no ciclo atual, disponível, a pagar nas faturas) e **Atenção** (cartões bloqueados, faturas fechadas sem pagamento, limite acima de 85%) — sempre dados reais dos cartões
  exibidos; sem cartão cadastrado a tela mostra o estado vazio com o botão de cadastro.
- No cartão selecionado: **Compras** (data, estabelecimento, categoria, linha de negócio, fatura, valor; filtro de linha de negócio do filtro único) e **Faturas** (aberta / fechada — a pagar / paga,
  total, ciclo, vencimento, pagamento e a linha do extrato conciliada). Ações: **Novo cartão**, **Editar cartão** (limite, fechamento e vencimento — §6), **Registrar compra**, **Bloquear/Desbloquear** (com motivo), **Cancelar compra**, **Registrar pagamento da fatura**.
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
  parcela como compra); estorno de compra de fatura já paga não tem fluxo próprio. Apelido, emissor, bandeira, 4 últimos dígitos, responsável e conta padrão **não** são editáveis (só limite, fechamento e vencimento).
- “Gasto no ciclo” e “disponível” são calculados com o relógio de Brasília (America/Sao_Paulo).

## 6. Editar limite, fechamento e vencimento (migration 066)
**Como usar:** no cartão selecionado, **Editar cartão** → novo limite, dia do fechamento (1–28), dia do vencimento (1–28) e o **motivo** (obrigatório, mínimo 3 caracteres). Só quem tem `can_finance` na unidade do cartão edita (gestor, adm. operacional,
gestor de unidade e financeiro da unidade); comercial, fisioterapeuta, paciente e `anon` recebem `42501`, e a tabela continua sem escrita direta (só a função `card_update`).

**Regra central: faturas existentes nunca mudam.** Cada fatura guarda o seu ciclo, fechamento e vencimento (`card_invoices`) e a despesa de cada compra carrega o vencimento da fatura. A edição **não toca em nenhuma fatura, compra ou despesa**.
- **Limite:** vale imediatamente para as próximas compras (e para o “disponível” mostrado). Não pode ficar **abaixo do que já está em aberto** no cartão (compras de faturas abertas e fechadas ainda não pagas); igual ao em aberto é aceito (disponível R$ 0,00).
  Faturas já pagas não contam. Cartão bloqueado também pode ser editado (continua bloqueado).
- **Fechamento e vencimento — efeito nos ciclos futuros:** os novos dias valem **só para faturas que ainda não existem**. Ao lançar uma compra, o sistema usa (função privada `card_cycle_for`):
  1. a **fatura já criada** cujo ciclo contém a data da compra (aberta, fechada ou paga) — ciclo, fechamento e vencimento **antigos** preservados (compra em fatura paga continua recusada);
  2. senão, calcula o ciclo pelos **dias atuais** do cartão, com o início nunca antes do fechamento da fatura anterior + 1 (não há ciclos sobrepostos);
  3. se mesmo assim o ciclo calculado invadiria uma fatura existente (só acontece em compra **retroativa** depois de mudar os dias), a compra é recusada com explicação (“use uma data posterior ao último fechamento”).
  Na prática: a fatura aberta de hoje fecha e vence nas datas de antes; a primeira fatura criada **depois** do último fechamento já existente usa os dias novos (a resposta da edição informa essa data em `applies_from`, e a tela mostra “compras a partir de dd/mm”).
  O cartão visual mostra os dias **novos** (“Fecha dia X · Vence dia Y”), enquanto “fatura atual fecha em …” continua mostrando a fatura existente.
- **Exemplo:** fechamento 10 / vencimento 20, fatura de hoje fecha em 10/11. Troca para 25 / 5: compras de hoje continuam na fatura que fecha em 10/11 (vence 20/11); a compra de 11/11 já gera uma fatura que fecha em 25/11 e vence em 05/12 (início do ciclo em 11/11, não 26/10).

**Auditoria:** o gatilho `audit_corporate_cards` registra a diferença de cada coluna, e `card_update` acrescenta um registro com autor, **motivo**, valores antigos e novos, colunas alteradas, `applies_from` e `existing_invoices_kept: true`. Tentativas recusadas (permissão, motivo, limite, dias) não geram registro de alteração
e não alteram nada (atômico). Aparece em Gestão ▸ Auditoria.

**Testes:** `S14` (43 verificações: permissões e escrita direta, validações, limite abaixo/igual ao em aberto, snapshots idênticos de faturas e despesas, resumo, compra depois da mudança, ciclo futuro, retroativa em lacuna, sobreposição recusada, cartão bloqueado, auditoria) e
`R14` (tela: valores atuais, motivo obrigatório, limite baixo recusado, salvar, snapshots do banco idênticos, registro de auditoria, permissões no servidor).
