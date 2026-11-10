# Marketing › Análises

> Tela nova (`/admin/marketing/analises`, item **Análises** no menu do Marketing) para entender **o porquê** dos números da Visão geral. Só Dev; sem merge nem produção. Migration `20261110000120_marketing_analises.sql` (uma função de **leitura**, nenhuma tabela nova), testes SQL `novos/N07` (31), unitários `mktAnalytics.test.ts` (28), E2E `N26` (7).

## Em uma frase
Pega os **leads captados no período** (o mesmo grupo de pessoas do funil da Visão geral) e mostra o que aconteceu com eles até hoje: quanto demoram, onde se perdem, quais campanhas trazem paciente de verdade, de onde vêm, quando chegam e quanto cada mês já devolveu.

## O que é “grupo de leads” (antes chamado “coorte”)
“Coorte” é o termo técnico (*cohort*) para **o grupo de pessoas que entrou no mesmo período**. Na tela passou a se chamar **“leads do período” / “data de captação do lead”**, sem jargão. A URL antiga `visao=coorte` continua funcionando. Quem lê a Visão geral “por data do evento” vê cada evento na sua própria data; a leitura por captação acompanha o **mesmo grupo** até hoje — por isso as conversões etapa a etapa fazem sentido.

## Blocos, fórmulas e fonte
Todos usam a mesma fonte dos cartões (`private.mkt_events`, visão por captação), a mesma permissão (gestor/comercial por unidade) e os mesmos filtros e período da barra do Marketing. Contagem por **pessoa distinta** (um lead = uma pessoa, na primeira oportunidade atribuída a campanha).

| Bloco | O que mostra | Fórmula / regra |
|---|---|---|
| **10 cartões** | Leads · custo por lead · custo por venda · lead → venda · ROAS · ticket médio · taxa de agendamento · taxa de comparecimento · tempo até o 1º contato · tempo até a 1ª venda | Custo por lead = investimento ÷ leads; custo por venda = investimento ÷ leads com venda; ROAS = valor vendido ÷ investimento; ticket = valor vendido ÷ nº de vendas; agendamento = agendados ÷ leads; comparecimento = compareceram ÷ agendados; tempos = **mediana** de dias corridos desde a captação. Sem gasto → “Sem base”, nunca zero |
| **Qualidade por campanha** | Dispersão custo × conversão + lista com investido, leads, custo/lead, vendas, custo/venda, lead → venda | Leitura (barata e converte / barata, converte pouco / cara, converte bem / cara e converte pouco) compara com a **mediana** das campanhas com ≥ 10 leads; menos que isso = “Volume baixo” |
| **Onde os leads se perdem** (gráfico) | Barras empilhadas do funil: azul = chegaram, faixa clara = ficaram pelo caminho, % sobre a etapa anterior; gráfico dos motivos de perda; por campanha sob demanda | “Maior perda” só quando a etapa anterior tem ≥ 10 leads. Motivos = `loss_reasons` das oportunidades perdidas do grupo |
| **Tempo até cada etapa** (gráfico) | Curva acumulada: % dos leads que chegaram a contato, agendamento, comparecimento e venda em até X dias; medianas e médias abaixo; por campanha sob demanda | Cada ponto usa só leads com **pelo menos X dias de vida** (leads recentes ainda não tiveram tempo) e só aparece com ≥ 10 leads; o trecho final sem base não é desenhado |
| **Retorno por região** (gráfico) | Barras de leads e vendas por zona de SP (Sul/Norte/Leste/Oeste/Centro) ou cidade + lista com agendamento, conversão e receita | Região vem do cadastro (zona só existe para SP capital). Cidades com grafias diferentes agrupam juntas. Sem zona nem cidade = “Sem localização” (aviso quando ≥ 30%). **Investimento não é medido por região** |
| **Dia da semana e horário** | Mapa de calor 7 dias × 6 faixas de 4 h (horário de Brasília) + mediana do tempo até o 1º contato por faixa | Leads por data de captação; “mais chegadas” só com ≥ 10 leads |
| **Retorno por mês de captação** (gráfico) | Barras de investido × recebido até hoje por mês + situação (“já pagou”, “recebeu X% do investido”); quadro “mês a mês” sob demanda | Recebido = pagamentos líquidos de estorno do grupo daquele mês até hoje; investido = gasto do mesmo mês no escopo. “Pago” = recebido ≥ investido. Últimos 12 meses do período |

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

## Quando ainda não há dados
Sem leads de campanha no período, a tela mostra os seis blocos “apagados”, cada um com o que vai trazer e o que precisa existir (conta de anúncios, campanhas, leads com origem, cidade/zona no cadastro) e uma linha de explicação com o caminho (Conectar conta / Ver campanhas). Nenhum número é inventado.

## Dados de demonstração (somente Dev)
Para ver as telas cheias no preview: `node supabase/tools/marketing-demo.mjs seed` cria 2 contas, 15 campanhas, ~75 dias de gasto, 126 leads, agendamentos, vendas, recebimentos, zonas e perdas — **tudo com “DEMO” no nome**. `... remove` apaga tudo; `... status` conta o que existe. O script recusa qualquer projeto que não seja o Dev.
**Atenção:** os dados DEMO convivem com o banco de teste compartilhado; rode `remove` antes de `promover.mjs` ou de testes que contem campanhas/leads totais (N25/N26 já foram ajustados para tolerar os DEMO, mas a contagem de testes antigos fora do Marketing não foi revisada).
