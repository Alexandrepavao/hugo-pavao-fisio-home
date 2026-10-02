# Nova interface (Hub, Administrativo, CRM, Financeiro)

> Referência de organização: painéis administrativos de mercado (estrutura e tipografia sóbrias, cartões expressivos, composição com filtros no topo). **Nada foi copiado** — código, logotipos,
> textos, marcas e componentes são do HP; não há “Powered by”, logo ou crédito visual de modelo externo na interface. Atribuições de terceiros: `docs/creditos.md`.
> Capturas (gerador: `node e2e/tools/shots-ui.mjs <url> <pasta> [dark]`, que também mede rolagem horizontal e erros de console):
> `docs/screenshots/ui-antes/` (interface original) · `docs/screenshots/ui-intermediario/` (1ª rodada, commit `a0b7d73`, mudança sutil) · `docs/screenshots/ui-depois/` (reformulação atual).

## 0. O que mudou de verdade na 2ª rodada (e o que a 1ª não tinha feito)
A 1ª rodada trocou tokens, filtros e responsividade: o resultado visual era quase igual ao original. Esta rodada mudou a **composição** das telas:

| Elemento | Antes (original e 1ª rodada) | Agora |
|---|---|---|
| **Moldura** | sidebar azul-marinho de ponta a ponta com a logo no topo; cabeçalho só sobre o conteúdo | **cabeçalho em largura total** (logo HP alinhada à sidebar, aplicativo ▸ seção, busca, notificações, tema, perfil com nome e papel); sidebar **clara**, abaixo dele |
| **Sidebar** | uma só (a geral do Hub) em quase todo lugar; o Financeiro aparecia como item com sub-menu na barra geral | **uma sidebar contextual por aplicativo**: Hub, Administrativo, CRM e **Financeiro (novo shell)** — cada uma só com a própria navegação, bloco de identidade do app (ícone com a cor do app) que abre o seletor de aplicativos, “Voltar ao Hub”, grupos, item ativo com fundo na cor do app e barra lateral, recolhida só com ícones, gaveta no celular |
| **Identidade por app** | uma cor para tudo | cor própria por aplicativo (Hub azul-marinho, Administrativo azul-petróleo, CRM índigo, Financeiro verde, Agenda âmbar, Academy violeta…), usada no ícone, no item ativo, nos cartões e no avatar |
| **Cartões** | todos iguais (caixa branca, rótulo, número, nota) | **quatro pesos**: *faixa prioritária* (número 2,25 rem, barra de cor no topo, ícone, minigráfico), *atenção* (painel âmbar próprio, ícone cheio, selo “Crítico/Atenção”, número na cor da gravidade, “Ver detalhes” sempre visível), *resumo* e *compacto* (uma linha: ícone, nome, número) |
| **Seções** | títulos soltos | cada nível tem ícone, rótulo (Atenção/Resumo/Análise) e título; **Atenção vira um painel tingido** que se destaca do resto |
| **Gráficos** | linhas e barras finas sem moldura comum | áreas com gradiente, barras arredondadas, **rosca** com total no centro, **ranking em barras**, legenda própria e estado vazio que explica o motivo |
| **Tabelas e vazios** | tabela cinza padrão, texto solto | cabeçalho em caixa alta discreto, linhas respiradas; estados vazios com ícone e borda tracejada |
| **Tipografia e ritmo** | título de página 22 px, seções coladas | título de página 28 px/800 (Manrope), números em Manrope 800, mais espaço entre seções, cartões com raio de 14 px e sombra em duas camadas |
| **Filtros** | pílulas simples | pílulas com sombra e destaque quando há filtro ativo, contador, “Limpar filtros”, chips no celular (mantidos da 1ª rodada, agora no novo visual) |
| **Mapa** | mapa pequeno, estado sem dado liso | mapa maior, **estado sem dado hachurado**, legenda com título e faixas, balão com cor do estado, ranking em barras |

Telas reorganizadas (faixa prioritária → atenção → mais indicadores → análise → atividades/pendências): **Hub, Administrativo, CRM (painel e relatórios), Financeiro (visão geral e relatórios)**.
`/admin/administrativo` agora redireciona para `/admin/adm` (caminho, parâmetros e âncora preservados).

## 1. Tokens visuais próprios (`src/styles/app.css`, escopo `html.hp-app`)
`app.css` foi reescrito por inteiro. Base: azul institucional, fundo `216 32% 95,5%`, cartões brancos com borda suave e sombra em duas camadas, raio de cartão 14 px; **Manrope** (títulos e números) e **Inter** (texto).
Tokens: `--app-accent` (cor do aplicativo, definida pelo shell), `--chart-1…6`/`--chart-grid`, `--map-0…4`/`--map-none`/`--map-stroke`, `--lvl-*` (gravidade dos cartões), `--sb-*` (sidebar clara) e o conjunto completo do **tema escuro**
(`html[data-theme="dark"]`, com realces calculados a partir da cor do app). O site público e o editor continuam com a identidade editorial (não usam este escopo).

## 2. Cabeçalho e barra lateral (`AppFrame`, `HeaderBar`, `apps.ts`)
- **`AppFrame`** é a única moldura: Hub (`AppShell`), CRM (`CrmShell`), Administrativo (`AdmShell`) e Financeiro (`FinShell`) só passam a própria navegação. O `ContextualAppShell` antigo foi removido.
- **Cabeçalho** (grade do shell: ocupa as duas colunas): coluna da marca com a logo HP (largura = sidebar, encolhe junto) · botão de recolher · **breadcrumb** com o seletor de aplicativo (ícone colorido + nome ▾) e a seção atual (`h1`, com o nome do app só para leitores de tela) · selo de ambiente
  · busca em pílula (Ctrl K) · **notificações** · tema claro/escuro · perfil (avatar na cor do app, nome e papel). No celular: menu, logo, ícone do app, seção, busca, sino e avatar; tema e “Voltar ao Hub” vão para o menu do perfil.
- **Notificações** só mostram o que é real e do próprio usuário (tarefas comerciais e pendências administrativas atrasadas sob a responsabilidade dele).
- **Sidebar contextual:** bloco do aplicativo (abre a lista de apps permitidos ao papel), “Voltar ao Hub”, grupos com rótulo, item ativo na cor do app, recolhimento só com ícones (dica ao passar o mouse), gaveta no celular. O Financeiro agrupa em Visão, Movimento, Resultados e Administração.
- **Registro de apps** (`src/components/hp/apps.ts`): Hub, Administrativo, CRM, Financeiro, Agenda, Academy, Parceiros e Captação, cada um com ícone e cor; papéis só controlam o que aparece no seletor — a autorização real continua no banco.

## 3. Filtro único (`src/lib/PeriodFilter.tsx`)
Um só componente para todos os aplicativos, sem misturar filtros de aplicativos diferentes (cada tela passa só os seus, em `extra`).
- **Desktop:** canto superior direito do título da página; pílula de **período** (mostra o intervalo no hover), seletor de **unidade**, **Filtros** com contador, **Limpar filtros** só quando há algo ativo e uma linha com o resumo dos filtros específicos. Pílulas ganham destaque quando há filtro ativo.
- **Celular:** botão **Filtrar** abre **gaveta** com Limpar e Aplicar no rodapé; os filtros ativos aparecem como **chips** logo abaixo.
- Estado de período/unidade/comparação na URL (`periodo`, `de`, `ate`, `unidade`, `comparar`): rota direta, recarregar e voltar/avançar funcionam. Responsável e funil (CRM) e os filtros da central (Administrativo) entram como filtros específicos.
- **Não feito:** “Linha de negócio” continua num seletor próprio dentro das seções “Por linha de negócio” do Financeiro (não foi movida para dentro do componente único).

## 4. Cartões e níveis (`StatCard`, `KpiGrid`, `LevelSection`, `makeDelta`)
Cada cartão tem nome, **número principal**, **unidade**, **período analisado**, **comparação** (só com base real), **descrição curta** (a regra de cálculo), indicador de situação/tendência e, se clicável, “Ver detalhes” (abre o detalhamento).
| Nível | Uso | Aparência |
|---|---|---|
| **Faixa prioritária** (`hero`) | os 3–4 números que resumem a tela | número grande, barra de cor no topo, ícone, minigráfico **só quando existe série real** (ex.: entradas mensais, negócios ganhos por mês) |
| **Atenção** (`attention`) | pendências, atrasos, riscos | dentro de um painel âmbar; cartão com ícone cheio, selo e número na cor da gravidade; valor zero vira cartão compacto “em dia” |
| **Resumo** (`summary`) | totais e situação atual | cartão padrão com ícone e CTA |
| **Apoio** (`compact`) | leitura complementar | uma linha: ícone, nome e número (a descrição fica na dica) |
**Comparação:** `makeDelta` só devolve variação quando as duas medições estão disponíveis e a base anterior não é zero; senão mostra “Sem base de comparação”; com a comparação desligada, nada aparece. Sem dado fictício: sem série não há minigráfico; sem dado, o gráfico explica o motivo.
Ordem das telas: **Hub** (indicadores prioritários → alertas → mais indicadores → evolução e funil → distribuição geográfica → minhas pendências), **Administrativo** (cadastro central → prioridades administrativas → indicadores complementares → gráficos e mapa → lista de prioridades),
**CRM** (indicadores do funil → atenção → mais indicadores → evolução/funil/origem → tarefas e atividades; relatórios: indicadores → atenção → apoio → tempo e etapas → tabelas), **Financeiro** (caixa e contas → atenção/vencidos → mais indicadores → por linha de negócio → evolução e composição; relatórios: eficiência → “sem base de dados”, com o motivo em cada cartão).

## 5. Mapa do Brasil (`src/components/hp/BrazilMap.tsx`)
- **Geometria:** `@svg-maps/brazil` (derivada do mapa do Brasil da MapSVG; **CC BY 4.0** — atribuição, link da licença e alterações em `docs/creditos.md`). Componente **próprio**, sem código do plugin
  comercial; nenhuma chamada externa e nenhum dado de pessoa sai da página; **nenhuma marca externa na interface**.
- **Dados reais:** Administrativo → RPC `adm_geo` (PF + PJ por UF, mesmo escopo de unidade do painel, migration 064); Hub → `geo_distribution` (pacientes, parceiros, alunos). Estado sem cadastro fica **neutro** (cinza),
  não zero colorido. Quem não tem UF informada aparece em “sem estado informado”, com atalho para completar.
- **Escala acessível:** 4 faixas iguais sobre o maior valor real, em azul com variação de luminosidade (não depende só de matiz), legenda com as faixas e “Sem dados”.
- **Interação:** passar o mouse, focar (teclado) ou tocar mostra o **balão com nome, quantidade e percentual**; cada estado é um botão com rótulo para leitor de tela; **clicar** seleciona o estado e
  lista os cadastros dele (mesma regra do Diretório, `adm_directory` com `p_uf`), com link “Ver os N no Diretório” (`/admin/adm/diretorio?uf=SP`). No Hub, clicar filtra o ranking de cidades.
- **Desktop e celular:** o mapa escala com a largura; no celular o toque abre o balão e a lista abaixo.

## 6. Migration 064 (`20260930000064_adm_geo_and_directory_uf.sql`)
`adm_geo(p_unit)`; `adm_directory` e `adm_export` ganham `p_uf` (assinaturas antigas removidas para evitar ambiguidade). **Correção de escopo:** sem filtro de unidade, a listagem não restringia o gestor
de unidade/comercial às próprias unidades (o painel e o mapa sim); agora a listagem usa o mesmo `adm_scope_units` — gestor/administrador da organização vê tudo, os demais só as unidades deles.
Testes: `supabase/tests/release/S12_mapa_administrativo.sql` (26 verificações: contagens, percentual, arquivados/mesclados fora, soma por estado + sem localização = total, escopo por unidade, lista por UF,
permissões e `anon`).

## 7. Calendário (§19 do pedido)
Continua **só Google Calendar** (sem iPhone/Apple/`.ics`), com agenda interna, conexão individual, status, sincronização automática, desconexão e privacidade clínica — `docs/calendarios.md`, verificado
pelo E2E `R10` após a nova interface.

## 8. Como foi verificado
- **SQL no Dev** (somente leitura, transações desfeitas; nenhuma migration aplicada nesta rodada): `S01–S12` — todas as verificações OK (16, 32, 43, 42, 44, 35, 42, 39, 30, 33, 19, 26).
- **E2E (Playwright, Edge, um worker, em grupos pequenos por falta de memória do computador):** release inteira (65 testes, em 5 lotes), `novos` 4/4 e gerais `01–09` (32 testes) — todos passando ao final. Ocorrências durante a rodada:
  - `R11` (pendências no celular) falhou **uma vez** em lote e passou isolada e no arquivo inteiro (intermitente sob pouca memória).
  - `R04` (falta do profissional) lia o banco logo depois de a tela mostrar o rótulo: era corrida do teste; agora ele **espera a condição real** (`expect.poll` até o banco chegar a `professional_no_show`) — a verificação em si não foi enfraquecida.
  - `07` (configurações do Financeiro): o `h1` do cabeçalho agora é “Financeiro · Configurações”, e o locator `heading "Configurações"` ficou ambíguo; passou a usar `exact: true` (mudança intencional da interface).
  - `04-agenda-concurrency` estourou o tempo uma vez numa bateria longa (teste só de API, sem interface) e passou ao ser reexecutado.
  - `08-lead-quizzes` (página pública, sem o shell novo) falhou numa repetição seguida e passou (3/3) depois; **a causa não foi confirmada** (na 11ª rodada se verificou que o limitador de 8 inícios por 10 min NÃO era a explicação — ver `docs/project-status.md`).
- **Typecheck:** OK. **Build:** OK. **Lint:** 23 erros e 21 avisos — os 23 erros já existiam antes desta rodada (funções Edge `auth-email-hook`, `bunny-playback`, `google-calendar` e o spec `R06`); nenhum erro novo.
- Depois dos últimos ajustes de CSS (altura igual dos cartões, logo maior, cabeçalho mobile), `R02`, `R11` e `R12` foram reexecutados: 26/26.
- Capturas 1440 e 390 px, claro e escuro, com medição de rolagem horizontal (0 px) e de erros de console (nenhum).

## 9. Limitações e pendências
- O tema escuro cobre a área logada e foi conferido nas telas principais; telas raramente usadas podem ter detalhes de contraste a refinar.
- Os cartões “Indicadores complementares” do Administrativo (grupos com listas) mantêm o desenho em caixa; só ganharam a nova moldura, tipografia e espaçamento.
- As demais telas (Pessoas, Agenda, Academy, Parceiros, Captação…) herdam header, sidebar, tipografia, tabelas e filtros novos, mas **não** foram reorganizadas em faixa/atenção/análise.
- Linha de negócio fora do componente de filtros (ver §3). O mapa agrega por **UF do cadastro** (sem geolocalização).
- Os indicadores do Administrativo no Dev incluem cadastros criados por testes automáticos (profissionais “Fisio E2E …”); em produção isso não existe.

## 10. Aplicativos contextuais, Cartões e Calendário (3ª etapa)
Estrutura por aplicativo, rotas, filtros e referências: `docs/aplicativos.md`. Cartões corporativos: `docs/cartoes-corporativos.md`. Calendário: `docs/calendarios.md`. Capturas (Hub, Financeiro e CRM com sidebars diferentes,
gaveta dos aplicativos no celular, Cartões e Calendário em desktop e celular): `docs/screenshots/apps-cartoes-calendario/` (gerador `e2e/tools/shots-novas-telas.mjs`, que cria dados de demonstração no Dev e os remove ao final).
O app “Administrativo” agora é **Gestão**; o título do cabeçalho passa a ser “Gestão · Seção”.

## 11. Filtro único nos módulos restantes (4ª etapa)
Agenda, Academy, Parceiros, Contas a pagar, Conciliação e Planilha administrativa usam o mesmo filtro (`PeriodFilter`/`ListFilterBar`): o essencial à vista (busca, unidade, dia ou período) e o resto no botão “Filtros”, com contador, chips e “Limpar filtros”; no celular, gaveta. Quadro completo em `docs/aplicativos.md` §4.
Edição de limite/fechamento/vencimento do cartão: `docs/cartoes-corporativos.md` §6.
