# Plano técnico do escopo ampliado (etapas 2 a 4)

> Complementa a lista de acompanhamento de `docs/project-status.md`. Escrito em 2026-09-30 depois de **conferir o código** (nada aqui é suposição sobre o que existe).
> Princípios: aditivo (nada do que funciona é reescrito); cada etapa só é marcada como concluída depois de aplicada no Dev e testada (SQL `supabase/tests/release` + E2E).

## Etapa 1 — Indicadores (código pronto, aguardando aplicação/teste)
Migration `056`, telas e `docs/indicadores.md` prontos; `S05` escrito. **Falta**: aplicar a 056 no Dev, rodar `S05`, escrever/rodar o E2E das três telas e atualizar a tabela.

## Etapa 2 — Financeiro por linha de negócio (HP Fisioterapia / HP Academy / Geral)
**O que existe hoje**
- Tabelas: `products` (sem classificação de linha), `sales`/`sale_items`, `receivables`, `payments` (recebimentos e estornos), `payables`, `commission_rules`/`commission_entries`, `recurring_contracts`, `financial_accounts`.
- RPCs e telas que precisarão aceitar a linha: `dashboard_metrics`, `dashboard_card_detail`, `dre_report`, `cash_flow_monthly`, `revenue_by_unit`, `mrr_report`/`mrr_history`, `efficiency_report`, `geo_distribution`, `sale_create`/`sale_confirm`/`sale_cancel`, `payment_record`/`payment_refund`, `payable_pay`, `commission_set_status`; telas `Vendas`, `Contas a pagar`, `Fluxo de caixa`, `Recorrência`, `DRE`, `Conciliação`, `Comissões e repasses`, `Relatórios`, `Configurações`.
- Não existe o conceito de linha de negócio em lugar nenhum (conferido por busca no código e nas migrations).

**Desenho proposto (aditivo)**
1. `products.business_line` ∈ `physio | academy | unclassified` (padrão `unclassified`; **sem adivinhar** linha de produto antigo — aparece como “Não classificado” até o gestor classificar em Configurações › Operação). `sale_items.business_line` congelado na venda (snapshot do produto), para o histórico não mudar se o produto for reclassificado.
2. **Venda com itens das duas linhas**: a linha é por **item**. Recebimentos/estornos/descontos são do nível da venda; a atribuição por linha é **proporcional ao líquido de cada item** (subtotal − desconto rateado), com o resto de centavos na maior linha, de modo que a soma por linha **é exatamente** o valor do pagamento (reconcilia, sem duplicar).
3. `payables.business_line` ∈ `physio | academy | shared | unclassified` e `payable_allocations(payable_id, line, basis_points)` para rateio **explícito** (soma = 10.000 pontos-base); despesa `shared` sem rateio aparece como “Compartilhada / não alocada”, nunca dividida por suposição.
4. Comissões herdam a linha do pagamento que as gerou (mesma proporção). Contratos recorrentes herdam a linha do produto.
5. Seletor **Geral / HP Fisioterapia / HP Academy** (na URL, junto do período/unidade) nas telas acima; **Geral = Fisioterapia + Academy + Compartilhado + Não classificado**, com um quadro de reconciliação visível. Caixa × competência × previsão permanecem como estão (a linha só filtra/atribui, não muda o critério de cada tela).
6. Linhas de negócio **não** viram unidades, empresas ou bancos.

**Riscos / cuidados**: são ~15 funções centrais e ~9 telas, com definições redefinidas em várias migrations — cada uma será lida na sua versão **mais recente** antes de alterar; o teste de reconciliação (`Geral = soma das partes`, por tela) é obrigatório e exige banco.
**Bloqueio atual**: não há acesso ao Dev nesta sessão (ver `project-status.md`); a etapa 2 começa com leitura e teste no banco.

## Etapa 3 — Área do paciente / jornada de acompanhamento
**O que existe hoje**: portal `/paciente` (atendimentos, pacotes, orientações do acompanhamento, dados pessoais, mensagens, **confirmação e cancelamento** de atendimento); acompanhamento restrito por vínculo (`care_relationships`, `care_assignments`, `care_contents` com arquivo no bucket privado `care-private`); `surveys` de satisfação.
**Não existe**: objetivos, plano de sessões, avaliações de evolução com série temporal, reavaliação/indicação de continuidade, solicitação de renovação, **integração Bunny** (nenhuma referência no repositório).

**Desenho proposto**: tabelas `patient_goals` (objetivo, autor profissional, datas), `patient_plans` (modelo inicial de **10 sessões configurável**, ajustável pelo profissional), `patient_assessments` (escala/nota 0–10, tipo, data, **autoria: paciente ou profissional**), `patient_reassessments` (indicação `continuidade | manutencao | alta`, nota clínica restrita), `renewal_requests` (pedido do paciente; **nenhuma cobrança automática**), vídeos Bunny por **URL de incorporação** (biblioteca + id do vídeo) atribuídos ao paciente pelo profissional. RLS: só o paciente e o profissional vinculado; **papel administrativo não libera dados de saúde**. Saldo do pacote continua vindo do livro de sessões; realizadas, faltas e saldo são mostrados separados e **sem** interpretar consumo como melhora clínica.
**Bunny — limitação a informar**: incorporar por URL pública funciona sem credencial; **proteção por token/assinatura** dos vídeos exige a chave de autenticação da biblioteca no servidor (não existe no projeto) → vídeos ficariam acessíveis a quem tiver a URL. Decisão/credencial pendente do usuário.

## Etapa 4 — Meu dia e calendários
**O que existe hoje**: `Meu dia` com visão diária, tarefas pessoais privadas, agenda própria do profissional (`my_day`) e, desde a 055, seletor de agendas de outros profissionais só por permissão (`my_agenda_professionals`/`professional_day`), sem confirmação em nome de terceiros. **Não existe**: visões semanal/mensal, nenhuma integração de calendário (nada de `.ics`, Google, Apple — conferido).
**Desenho proposto**
- Visões diária/semanal/mensal com uma RPC de intervalo (`my_calendar(p_from, p_to, p_professional)`) no mesmo escopo e permissões de `professional_day`.
- **Assinatura de calendário (somente leitura)**: feed `.ics` por usuário com **token secreto** (hash guardado no servidor, revogável/regenerável), servido por função do servidor; funciona no Calendário da Apple/iPhone (`webcal://`) e no Google Calendar “Adicionar por URL”. É **assinatura**, não sincronização bidirecional; o cliente atualiza no ritmo dele (Google pode levar horas). UID estável por atendimento/tarefa (evita duplicar), cancelamento gera `STATUS:CANCELLED`, horários em UTC com `TZID`.
- **Google Calendar (sincronização bidirecional)**: exige **OAuth do Google** (Client ID/Secret num projeto do Google Cloud, tela de consentimento e escopo de calendário) — **credencial inexistente hoje; bloqueio específico**. Só depois dela: tokens criptografados no servidor, eventos com `extendedProperties` para evitar duplicidade, desconexão que revoga o token. Compromissos **externos nunca geram atendimento, cobrança ou consumo de sessão**.
- Apple Calendar “nativo” (CalDAV) não será implementado; a assinatura `.ics` é o alcance informado para iPhone/Apple.
