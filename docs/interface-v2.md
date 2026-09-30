# Nova interface (Hub, Administrativo, CRM, Financeiro)

> Referência de organização: painéis administrativos de mercado (estrutura e tipografia sóbrias, cartões expressivos, composição com filtros no topo). **Nada foi copiado** — código, logotipos,
> textos, marcas e componentes são do HP; não há “Powered by”, logo ou crédito visual de modelo externo na interface. Atribuições de terceiros: `docs/creditos.md`.
> Capturas: `docs/screenshots/ui-antes/` (antes) e `docs/screenshots/ui-depois/` (depois; inclui tema escuro). Gerador: `node e2e/tools/shots-ui.mjs <url> <pasta> [dark]`, que também mede rolagem horizontal e erros de console.

## 1. Tokens visuais próprios (`src/styles/app.css`, escopo `html.hp-app`)
Azul institucional como cor principal, fundo claro, bordas suaves e sombras discretas; fontes **Manrope** (títulos e números) e **Inter** (texto).
Novos tokens: `--chart-1…6` e `--chart-grid` (gráficos), `--map-0…4`/`--map-none`/`--map-stroke` (mapa), `--lvl-*` (níveis de cartão) e o conjunto completo do **tema escuro**
(`html[data-theme="dark"]`). O site público e o editor continuam com a identidade editorial (não usam este escopo).

## 2. Cabeçalho e barra lateral (`HeaderBar`, usado por `AppShell`, `ContextualAppShell` e `CrmShell`)
- **Esquerda:** recolher/abrir menu, logo (no celular; no desktop está no topo da barra lateral) e o título “Aplicativo · Seção” (`h1`, usado também pela acessibilidade).
- **Direita:** selo do ambiente (fora de produção), **busca discreta** (Ctrl K), troca de aplicativo, **notificações**, **tema** (claro/escuro, guardado por pessoa no navegador) e perfil.
- **Notificações** só mostram o que é real e do próprio usuário: tarefas comerciais vencidas atribuídas a ele e pendências administrativas abertas e vencidas sob a responsabilidade dele
  (cada consulta respeita a permissão; quem não enxerga a tabela simplesmente não vê o item). Sem nada atrasado: “Nada atrasado sob a sua responsabilidade”.
- **Barra lateral contextual** persistente no desktop (recolhível), **gaveta** no celular. O selo “AMBIENTE DE TESTE” saiu do canto que sobrepunha o último item da barra lateral e mora no cabeçalho
  (`data-testid="env-badge"`; no celular mostra “TESTE”, com o texto completo para leitores de tela).

## 3. Filtro único (`src/lib/PeriodFilter.tsx`)
Um só componente para todos os aplicativos (Hub, Administrativo, CRM, Financeiro, Captação, Pesquisas, Contas corporativas). Não mistura filtros de aplicativos diferentes: cada tela passa só os seus
filtros específicos (`extra`).
- **Desktop:** canto superior direito do cabeçalho da tela; pílula de **período** (mostra o intervalo ao passar o mouse), seletor de **unidade** visível, botão **Filtros** com **contador** de filtros
  ativos (período ≠ mês atual, unidade, comparação, filtros da tela), **Limpar filtros** (aparece só quando há algo ativo) e uma linha com o resumo dos filtros específicos ativos. Popover compacto com
  rolagem interna (Limpar/Aplicar sempre visíveis).
- **Celular:** botão **Filtrar** (com contador) abre uma **gaveta** com Limpar e Aplicar fixos no rodapé; os filtros ativos aparecem como **chips** logo abaixo do botão, com “Limpar filtros”.
- O estado de período/unidade/comparação continua na URL (`periodo`, `de`, `ate`, `unidade`, `comparar`): rota direta, recarregar e voltar/avançar funcionam.

## 4. Cartões e níveis (`StatCard`, `LevelSection`, `makeDelta`)
Cada cartão tem nome, **número principal**, **unidade de medida**, **período analisado**, **comparação** (só com base real), **descrição curta** (a regra de cálculo) e, se clicável, abre o detalhamento.
Três níveis visuais, com um rótulo em cada seção:
| Nível | Uso | Aparência |
|---|---|---|
| **Atenção** | pendências, atrasos, riscos | cartões maiores, borda lateral âmbar/vermelha e fundo suave quando o valor é > 0 (`tone` = warning/danger); valor zero vira cartão compacto |
| **Resumo** | totais e situação atual | cartão padrão; os de apoio usam o tamanho **compacto** |
| **Análise** | gráficos, evolução, conversão, comparações, mapa | gráficos em moldura única (`ChartCard`/`BarBlock`/`LineBlock`) com a paleta do HP |
**Comparação com período anterior:** `makeDelta` só devolve variação quando as duas medições estão disponíveis e a base anterior não é zero; caso contrário mostra “Sem base de comparação”; com a
comparação desligada, nenhuma linha de comparação aparece. Nada de dado fictício em gráficos, tendências ou comparações: sem dado, o espaço mostra um aviso.
Aplicado em: **Administrativo** (Prioridades → Indicadores complementares + cadastro central → Gráficos, evolução e mapa → Lista de prioridades), **CRM** (Atenção: sem retorno/abertos/valor em negociação;
Resumo: leads, ganhos, conversão; Análise: etapas, evolução, origem, desempenho), **Financeiro** (Atenção: vencidos e faixas de atraso; Resumo: vendas, recebimentos, contas, caixa, ticket, projeção,
por linha de negócio; Análise: entradas×saídas, forma de pagamento, produto — o Financeiro agora **compara de verdade** com o período anterior) e **Hub** (alertas → visão executiva → evolução, funil e mapa).

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
- SQL: `S01–S12` e `N02` (todas as verificações OK).
- E2E da release inteiro (Playwright, Edge, um worker) **e** `R12-nova-interface.spec.ts` (novo): cabeçalho/tema persistente/selo de ambiente único fora da barra lateral/busca/notificações; filtro único com
  contador, “Limpar filtros” e chips no celular; níveis nos quatro apps; comparação só com base real; mapa com dado real do servidor (quantidade, percentual, neutro, balão, clique, Diretório filtrado por UF,
  voltar/avançar); permissões; celular sem rolagem lateral. Os testes antigos foram mantidos; ajustes mínimos de locator em `R11` (`Limpar` com `exact`, pois agora há também “Limpar filtros”) e em `07-finance-behaviors` (`#rec-acc`: a seção de linhas de negócio da rodada anterior já tinha tornado “Conta bancária” ambíguo). Também rodaram as suítes `novos` e as gerais: todas OK.
- Capturas `ui-antes` × `ui-depois` (1440 e 390 px, claro e escuro) com medição de rolagem horizontal: **0 px** em todas as telas (antes: Administrativo 151 px e CRM 188 px no celular).

## 9. Limitações e pendências
- O tema escuro cobre a área logada e foi conferido nas telas principais; telas raramente usadas podem ter detalhes de contraste a refinar.
- O mapa agrega por **UF do cadastro**; não há geolocalização nem coordenadas. Cidades só aparecem no Hub (ranking), não no mapa.
- Os indicadores do Administrativo no Dev incluem cadastros criados por testes automáticos (profissionais “Fisio E2E …”); em produção isso não existe.
