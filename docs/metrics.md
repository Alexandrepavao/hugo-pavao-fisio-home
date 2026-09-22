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

## MRR / ARR e ponte de movimentação (`mrr_report`, `mrr_history` — migration 020)
Não há motor de cobrança recorrente automática nesta versão (nenhuma linha de `receivables` é gerada sozinha mês a mês). Por isso **MRR usa o único sinal real de recorrência já existente**: `products.recurrence = 'monthly'` + `receivables.competence_month` — o mesmo par de colunas que já alimenta `subscription_forecast`.
- **Base do mês M** (`private.mrr_base`): um recebível por (pessoa, produto) com `competence_month = M`, produto `recurrence='monthly'`, venda `confirmed`, recebível não cancelado. **Cobrança contratada do mês, não caixa recebido.**
- **MRR(M)** = soma dos valores da base do mês M. **ARR** = MRR × 12 (anualização, não os últimos 12 meses recebidos).
- **Ponte** (fecha matematicamente por construção, não por fórmula separada): `MRR inicial (M−1) + Novo + Expansão + Reativação − Contração − Cancelamento = MRR final (M)`.
  - **Novo**: par (pessoa, produto) presente em M, ausente em M−1, e nunca existiu antes de M−1.
  - **Reativação**: presente em M, ausente em M−1, mas já existiu em algum mês anterior a M−1 (churnou e voltou).
  - **Expansão / Contração**: par presente nos dois meses com valor maior/menor.
  - **Cancelamento**: presente em M−1, ausente em M.
- **Retenção bruta** = (MRR inicial − contração − cancelamento) ÷ MRR inicial (sem contar expansão). **Retenção líquida** = idem **com** expansão (pode passar de 100%). **Churn de receita** = (contração + cancelamento) ÷ MRR inicial. **Churn de clientes** = clientes recorrentes de M−1 que não seguem ativos ÷ clientes recorrentes de M−1. Todos ficam **indisponíveis** (não 0%) quando o MRR inicial ou a base de clientes do mês anterior é zero — nunca divide por zero.
- **Limitação conhecida**: sem motor de renovação automática, um cliente "ativo" depende de a equipe lançar a venda/recebível do mês seguinte; se isso não acontecer, o par simplesmente não aparece na base (vira "cancelamento" mesmo que o cliente continue de fato). Ficará mais preciso quando/se houver um motor de recorrência real.

## DRE / rentabilidade (`dre_report`, `revenue_by_unit` — migration 020)
Regime de caixa. **Deduções, custos diretos, margem de contribuição e resultado operacional ficam sempre `available:false`**: não há retenção de imposto por venda nem vínculo de conta a pagar a um produto/serviço específico nesta versão — mostrar um número aqui seria inventado. O que **tem** base real: receita bruta/líquida (recebimentos − estornos), despesas operacionais por categoria, e "resultado de caixa" — rotulado explicitamente como caixa, nunca chamado de lucro.

## Envelhecimento de vencidos (`overdue_aging`)
Soma do saldo não recebido das parcelas `open`/`partial` vencidas, em 4 faixas por dias de atraso: 1–30, 31–60, 61–90, acima de 90 (hoje − vencimento).

## Eficiência do negócio (`efficiency_report`)
Receita por paciente pagante / por sessão realizada: recebido líquido no período ÷ contagem no período. Taxa de recompra: pessoas com mais de uma venda confirmada no **histórico completo** ÷ total de compradores. Concentração por produto: participação % do recebido no período, top 10. **CAC, LTV e prazo de recuperação do CAC ficam sempre indisponíveis**: não há dados de investimento em mídia/aquisição no sistema.

## Distribuição geográfica (`geo_distribution` — migration 020)
Por `people.city`/`people.state_uf` (cadastro manual, nunca IP nem geolocalização do navegador). Um segmento (`patient`/`partner`/`student`) é definido por `person_kinds.kind` — a mesma pessoa pode aparecer em mais de um segmento, mas dentro de cada segmento é contada uma única vez (distinct por pessoa). `sem_localizacao` conta quem não tem UF cadastrada.

## Indicadores executivos adicionais do Início (`Dashboard.tsx`, consulta direta — sem RPC dedicada ainda)
- **Novos pacientes**: pessoas com `person_kinds.kind='patient'` criadas no período (por `people.created_at`).
- **Pacientes com pacote ativo**: pessoas com ao menos um `client_packages.status='active'` **hoje** (posição, não movimentação do período).
- **Parceiros ativos**: `partner_profiles.status='active'` **hoje**.
