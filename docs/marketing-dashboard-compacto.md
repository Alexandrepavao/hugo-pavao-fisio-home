# Marketing — dashboard compacto (cartões e gráficos)

> Reformulação **visual e de composição** da Visão geral do Marketing (que também é a gestão de tráfego): mesmos cartões e gráficos, sem cartões gigantes, espaços vazios nem textos longos dentro dos cartões. **Só no Dev**; só o app Marketing foi alterado (cartões, gráficos e filtros compartilhados dos outros aplicativos **não** foram tocados). Branch `feat/marketing-dashboard-compacto`, migration **119**. Contexto geral: [`marketing-campanhas.md`](marketing-campanhas.md).
> Referências visuais consultadas apenas como inspiração de composição e leitura (nada foi instalado nem copiado): Mosaic (composição de cartões e gráficos), Plausible (simplicidade e escolha de métrica para atualizar o gráfico) e Rybbit (filtros, funil e exploração).

## 1. O que mudou visualmente

| Antes | Depois |
|---|---|
| Cartões de ~260 px com título, número e fórmula longa dentro | **Cartões de ~110–125 px**: ícone discreto, título curto, valor de 28 px (24 px no celular), variação (quando há comparação) e minigráfico real. Fórmula e fonte ficam no **ícone de informação** (abre com clique, teclado ou toque) |
| 6 cartões “hero” + funil em linhas + gráficos separados | **Seis cartões por objetivo → gráfico amplo com seleção de métrica → Meta × Google → funil por coorte → campanhas em cartões → conferência dos dados** |
| Sem controle visível de plataforma; filtros escondidos num painel | **Todas / Meta / Google** sempre visível, **filtros ativos em etiquetas** com “×” e **Limpar filtros**, comparação com o período anterior no filtro único |
| Faixa de cobertura longa e “Indisponível” grande | **Faixa de sincronização de uma linha** (dias coletados, última sincronização, período em andamento, falha de atualização com link) e estados compactos com o motivo e a ação (“Conectar conta”, “Ver integrações”, “Tentar de novo”) |
| Tabela de campanhas | **Cartões de campanha** com busca, ordenação e “Carregar mais” (9 por vez) |

Capturas (Dev, dados sintéticos de fixture N25 — nunca resultados reais): [`antes/`](screenshots/marketing/antes) e [`depois/`](screenshots/marketing/depois).

| | Antes | Depois |
|---|---|---|
| Desktop 1440 px (claro) | [visao-geral-1440-light](screenshots/marketing/antes/visao-geral-1440-light.png) | [dashboard-1440-light](screenshots/marketing/depois/dashboard-1440-light.png) |
| Desktop 1440 px (escuro) | [visao-geral-1440-dark](screenshots/marketing/antes/visao-geral-1440-dark.png) | [dashboard-1440-dark](screenshots/marketing/depois/dashboard-1440-dark.png) |
| Celular 390 px | [visao-geral-390-light](screenshots/marketing/antes/visao-geral-390-light.png) · [escuro](screenshots/marketing/antes/visao-geral-390-dark.png) | [dashboard-mobile-390-light](screenshots/marketing/depois/dashboard-mobile-390-light.png) · [escuro](screenshots/marketing/depois/dashboard-mobile-390-dark.png) |
| Objetivo Reconhecimento | — | [dashboard-reconhecimento](screenshots/marketing/depois/dashboard-reconhecimento-1440-light.png) |
| Período sem dados | — | [dashboard-sem-dados](screenshots/marketing/depois/dashboard-sem-dados-1440-light.png) |
| Sem conta conectada | — | [dashboard-conexao-pendente](screenshots/marketing/depois/dashboard-conexao-pendente-1440-light.png) |
| Falha de sincronização | — | [dashboard-falha-sincronizacao](screenshots/marketing/depois/dashboard-falha-sincronizacao-1440-light.png) |

As telas “antes” (Visão geral, de 09/11) mostram a versão anterior sobre a fixture do teste N22 (uma campanha); as “depois” usam a fixture N25 (15 campanhas, 21 dias, 63 leads) — por isso o volume difere, não o desenho.

## 2. Composição

**A. Cabeçalho e filtros** (um filtro único, em todas as páginas do Marketing): período e **comparação com o período anterior**; **Todas/Meta/Google**; conta de anúncios; unidade; linha de negócio (frente); campanha; **tipo/objetivo definido pelo administrador** (finalidade); produto, funil de destino e responsável. Todos os blocos usam o mesmo escopo; onde um filtro não se aplica, a tela diz (na comparação Meta × Google a **plataforma é ignorada** e isso está escrito no bloco). A **classificação administrativa** da campanha (frente, finalidade, resultado principal) nunca é confundida com o **objetivo original da plataforma**, que continua visível só na página Campanhas.

**B. Seis cartões por objetivo.** O conjunto segue o **resultado principal definido pelo administrador** nas campanhas do escopo (o da campanha ou, se vazio, o padrão da finalidade):

| Objetivo | Cartões |
|---|---|
| Captação (padrão, escopo misto ou sem classificação) | Investimento · Leads · CPL · Vendas · Receita · ROAS |
| Vendas (todas as campanhas são venda/matrícula) | Investimento · Vendas · Receita · ROAS · Custo por venda · Leads |
| Reconhecimento (todas as campanhas são “Reconhecimento de marca”) | Investimento · Impressões · CPM · Cliques · CTR · CPC |

“Reconhecimento de marca” é um **novo resultado principal** que o administrador pode escolher ao classificar uma campanha. **Alcance único e frequência não são coletados**, então não aparecem (e alcance nunca é somado entre campanhas).

**C. Evolução.** Um gráfico amplo; a métrica muda **clicando no cartão ou nos botões** (Plausible). Uma métrica por vez, na própria unidade (reais, taxas e quantidades nunca dividem a escala). Dias sem coleta ficam em branco (a linha quebra), nunca zero. O **período anterior** aparece tracejado **somente com a comparação ligada e quando há série real nele**.

**D. Meta × Google.** Barras pequenas, uma por métrica (investimento, leads, CPL, vendas, ROAS), cada uma na sua escala. CPL e ROAS são **recalculados pelos totais de cada canal**.

**E. Funil por coorte.** Lead → contato realizado → agendamento → comparecimento → protocolo vendido (Pacientes); Academy: lead → contato → qualificado → matrícula; Geral: lead → contato → qualificado → venda. O administrador cria e edita outros em *Funil e atribuição*. **Coorte** = leads captados no período; **janela** = o que aconteceu com eles **até hoje**, sem corte. Cada etapa conta quem a atingiu e a conversão é **etapa ÷ etapa anterior da mesma coorte** — nunca eventos independentes do mesmo período divididos entre si. Leads recentes ainda podem avançar (dito na tela). Clique numa etapa abre os **registros autorizados** (mesmo escopo de unidade e papel). A escolha do funil acompanha a linha de negócio filtrada (por nome: “Academy” → funil da Academy; fisioterapia ou sem filtro → Pacientes; demais → Geral) e pode ser trocada no seletor.

**F. Campanhas em cartões.** Nome (até 2 linhas) e plataforma; **tipo definido pelo administrador** (frente · finalidade) ou “Aguardando classificação”; **Situação na plataforma — somente leitura** (Ativa, Pausada… ou “Lançamento manual”); investimento; **resultado principal** e **custo por resultado**; tendência (minigráfico) apenas com série real; “Detalhar” abre o gerenciador da campanha. Não há nenhum controle que pause, ative ou edite anúncios — nada aqui altera campanhas na Meta ou no Google.

## 3. Fórmulas e fontes

| Indicador | Fórmula | Fonte | Observações |
|---|---|---|---|
| Investimento | Σ gasto efetivo (campanha × dia) | Plataformas (API) ou lançamento manual | Dias sem coleta não entram como zero; sobreposição manual × API resolvida por conta × dia |
| Leads únicos | Pessoas distintas com oportunidade atribuída a campanhas pagas | Captação (formulários/quizzes) + CRM + atribuição | **Não** é o “resultado” da plataforma |
| CPL | Investimento ÷ leads únicos (totais do período) | — | Sem gasto ou sem leads → **Sem base** |
| Vendas atribuídas | Vendas confirmadas atribuídas a campanhas (cada venda uma vez) | Financeiro/Vendas + atribuição (último toque pago, janela configurada) | Cohort/evento conforme a visão |
| Receita atribuída | Valor das vendas confirmadas atribuídas | Vendas | É receita **vendida**, não recebida; o recebido (líquido de estornos) está nos detalhamentos |
| ROAS | Receita atribuída ÷ investimento | — | Bruto, antes de custos, repasses e impostos; sem gasto → **Sem base** |
| Custo por venda | Investimento ÷ vendas atribuídas | — | Custo de mídia, **não** é o CAC completo |
| Impressões, cliques | Σ das plataformas | API / manual | Alcance único não é somado |
| CPM, CTR, CPC | Recalculados pelos **totais** (gasto ÷ impressões × 1000; cliques ÷ impressões; gasto ÷ cliques) | — | Nunca a média simples das taxas das campanhas |
| Contato realizado | Oportunidades com o **primeiro contato humano registrado** | CRM (`first_response_at`) | Depende do registro pela equipe |
| Conversões reportadas pela plataforma | Resultados informados pela Meta/Google | API | **Separadas** das confirmadas no HP; nunca somadas |

Cada cartão traz a fórmula, a fonte e a base na dica (ícone de informação); “Registros” abre os registros por trás do número. Denominador zero ou dado ausente mostra **“Sem base”** com o motivo curto (nunca um resultado inventado). A faixa de sincronização mostra a **última coleta** e marca **período em andamento** (o período inclui hoje) como **dados parciais**.

## 4. Banco (migration 119 — só acrescenta)

* Evento **`contacted`** (contato realizado) em `private.mkt_events`, no detalhamento (`mkt_indicator_detail`) e no catálogo de etapas (19 etapas); 3 **funis padrão por coorte** semeados por organização (`mkt_funnels_list` garante).
* `mkt_series` devolve também **impressões, cliques e valor vendido** por dia/semana.
* **`mkt_overview`**: comparação por canal (Meta × Google) e totais de vendas/receita, calculada no banco pelos totais.
* `mkt_campaign_table`: **todos os eventos por campanha** (`events`) e **resultado principal efetivo** (o da campanha ou o padrão da finalidade).
* Resultado principal **“Reconhecimento de marca”** (`awareness`).
* Testes SQL `novos/N06` (**27** verificações: contato realizado em evento e coorte, funil por coorte pelos totais, série, canais, “sem base”, permissões/isolamento). N03 (170) e N04 (46) seguem passando (N04: catálogo agora tem 19 etapas e o seletor do funil “Pacientes: do anúncio…” ficou específico — mudanças intencionais).

## 5. Validação

* **Visual (desktop 1440 px e celular 390 px; claro e escuro):** capturas acima. Verificado por teste: cartões entre 100 e 140 px de altura, valores ≥ 26 px, **duas colunas de indicadores no celular**, sem rolagem horizontal e sem bloco passando da tela, nome de campanha longo quebrando em até duas linhas sem estourar.
* **Estados:** período sem dados (“Sem base”, sem zero inventado), unidade sem conta (“Conectar conta”), falha de sincronização (“Falha na atualização em 2 dia(s)”), período em andamento e falha ao carregar (“Tentar de novo”).
* **E2E** `N25` (8 testes — layout, seleção de métrica por cartão e botão, comparação, plataforma, filtros ativos e “Limpar”, busca e “Carregar mais”, objetivos Reconhecimento e Vendas, estados, registros dos cartões e do funil, 390 px, permissões: fisioterapeuta, aluno e anônimo não entram) e `N22` (9 testes; adaptado à interface nova **mantendo os mesmos valores esperados**: R$ 500 de gasto, 1 lead, R$ 1.000 vendidos, ROAS 2x, funil 1→1→1→1→1).
* vitest da lógica de métricas (`mktMetrics.test.ts`, 17 testes: objetivo por resultado principal, custo por resultado, séries derivadas, “sem base”, variação só com base real, formatação). Typecheck, lint e build sem erros.
* **Dados sintéticos** existem **somente** nas fixtures de teste (prefixo “N25”, gasto lançado manualmente) e são removidos no fim de cada execução; nada disso aparece como resultado real.

## 6. Limitações e dependências externas

* **APIs reais não verificadas** (como já registrado em `marketing-campanhas.md`): faltam `META_APP_ID/SECRET` e `GOOGLE_ADS_CLIENT_ID/SECRET`; toda a validação usa lançamento manual. Nada aqui prova a comunicação com Meta ou Google.
* **Alcance e frequência** não são coletados; o objetivo Reconhecimento usa impressões, CPM, cliques, CTR e CPC.
* **Leads por canal** são pessoas distintas **dentro de cada canal**; quem aparece em campanhas dos dois canais conta nos dois (o total geral de leads únicos não duplica).
* **Contato realizado** depende de a equipe registrar o primeiro contato no CRM; cadastros sem esse registro ficam fora da etapa.
* A **escolha automática do funil** por linha de negócio usa o nome da frente/funil; o seletor permite trocar. Organizações novas recebem os funis padrão na primeira abertura.
* **Tendência por campanha** usa a série do resultado principal quando ela existe por dia (leads, vendas, impressões); nos demais resultados mostra o investimento por dia.
* Alguns controles de qualidade (“campanhas aguardando classificação”, “contas com dias sem coleta”) são **situação atual da organização**, não seguem o filtro de unidade.
* No celular os **minigráficos dos indicadores ficam ocultos** (o valor ocupa a largura); o gráfico principal e os das campanhas permanecem.
* Fora do escopo desta rodada (ficam para aprovação): estender o novo cartão compacto aos demais aplicativos, painéis personalizados com os mesmos cartões, e qualquer envio de dados às plataformas.
