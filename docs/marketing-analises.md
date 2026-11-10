# Marketing › Análises

> Tela nova (`/admin/marketing/analises`, item **Análises** no menu do Marketing) para entender **o porquê** dos números da Visão geral. Só Dev; sem merge nem produção. Migration `20261110000120_marketing_analises.sql` (uma função de **leitura**, nenhuma tabela nova), testes SQL `novos/N07` (28), unitários `mktAnalytics.test.ts` (21), E2E `N26` (7).

## Em uma frase
Pega os **leads captados no período** (o mesmo grupo de pessoas do funil da Visão geral) e mostra o que aconteceu com eles até hoje: quanto demoram, onde se perdem, quais campanhas trazem paciente de verdade, de onde vêm, quando chegam e quanto cada mês já devolveu.

## O que é “grupo de leads” (antes chamado “coorte”)
“Coorte” é o termo técnico (*cohort*) para **o grupo de pessoas que entrou no mesmo período**. Na tela passou a se chamar **“leads do período” / “data de captação do lead”**, sem jargão. A URL antiga `visao=coorte` continua funcionando. Quem lê a Visão geral “por data do evento” vê cada evento na sua própria data; a leitura por captação acompanha o **mesmo grupo** até hoje — por isso as conversões etapa a etapa fazem sentido.

## Blocos, fórmulas e fonte
Todos usam a mesma fonte dos cartões (`private.mkt_events`, visão por captação), a mesma permissão (gestor/comercial por unidade) e os mesmos filtros e período da barra do Marketing. Contagem por **pessoa distinta** (um lead = uma pessoa, na primeira oportunidade atribuída a campanha).

| Bloco | O que mostra | Fórmula / regra |
|---|---|---|
| **Cartões** | Leads · tempo até a 1ª venda · lead → venda · maior perda | Leads = pessoas do grupo. Tempo = **mediana** de dias corridos da captação à 1ª venda. Lead → venda = leads com venda ÷ leads. Maior perda = etapa com maior queda % sobre a anterior |
| **Qualidade por campanha** | Dispersão custo × conversão + lista com investido, leads, custo/lead, vendas, custo/venda, lead → venda | Custo/lead = investimento ÷ leads; custo/venda = investimento ÷ leads com venda; conversão = venda ÷ leads. **Leitura** (barata e converte / barata, converte pouco / cara, converte bem / cara e converte pouco) compara com a **mediana** das campanhas com ≥ 10 leads; menos que isso = “Volume baixo” |
| **Onde os leads se perdem** | Funil do grupo com quanto ficou pelo caminho, maior perda e motivos de perda; por campanha sob demanda | Cada etapa = quem a atingiu ÷ etapa anterior. “Maior perda” só quando a etapa anterior tem ≥ 10 leads. Motivos = `loss_reasons` das oportunidades perdidas do grupo |
| **Tempo até cada etapa** | Mediana (e média) até contato, agendamento, comparecimento e venda; por campanha sob demanda | Dias corridos desde a captação, só de quem chegou à etapa; leads recentes ainda avançam, então tende a subir |
| **Retorno por região** | Leads, agendados, vendas, receita e % por zona de SP (Sul/Norte/Leste/Oeste/Centro) ou cidade | Região vem do cadastro (zona só existe para SP capital). Cidades com grafias diferentes agrupam juntas. Sem zona nem cidade = “Sem localização” (aviso quando ≥ 30%). **Investimento não é medido por região**: mostra resultado, não custo |
| **Dia da semana e horário** | Mapa de calor 7 dias × 6 faixas de 4 h (horário de Brasília) + mediana do tempo até o 1º contato por faixa | Leads por data de captação; “mais chegadas” só com ≥ 10 leads |
| **Retorno por mês de captação** | Para cada mês: leads, vendas, investido, recebido acumulado e % do investimento já devolvido; quadro “mês a mês” sob demanda | Recebido = pagamentos líquidos de estorno do grupo daquele mês até hoje; investido = gasto do mesmo mês no escopo. “Pago” = recebido ≥ investido. Últimos 12 meses do período |

## Estados honestos
- Sem gasto coletado → “Sem base” (nunca R$ 0). Sem leads no período → mensagem única, sem blocos vazios. Sem venda → “Sem base”.
- Zero real é mostrado como zero (ex.: Zona Norte com 6 leads e 0 vendas).
- Volume pequeno nunca vira conclusão (“Volume baixo”, “Volume pequeno: ainda não dá para apontar…”).

## Segurança
`mkt_analytics` é `security definer` com `search_path = ''`, exige leitor do Marketing (`mkt_require_reader`), respeita unidade/organização e é negada ao anônimo. Testado: comercial de outra unidade e outra organização não veem nada; anônimo recebe 42501.

## Validação
1440 px e 390 px, tema claro e escuro (capturas em `docs/screenshots/marketing/analises/`); sem rolagem horizontal; sem erros de console. O E2E confere que **leads = funil = regiões = horários = meses** e que leads e contatos batem com o funil da Visão geral. Dados de teste só nas fixtures identificadas “N26”.

## Limitações
- Alcance/frequência continuam não coletados.
- Meta/Google reais seguem sem validação (lançamento manual nos testes).
- Região depende do cadastro: cadastros antigos ficam em “Sem localização”.
- Tempos e retornos dos meses recentes sobem à medida que os leads avançam.
