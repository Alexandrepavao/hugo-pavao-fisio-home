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
