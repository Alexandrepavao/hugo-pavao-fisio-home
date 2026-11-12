# CRM — resumo do lead em modal e mapa de São Paulo por zona

> Pedido do usuário (12/11/2026): (1) nos cartões do painel que listam leads (ex.: “Leads sem retorno há mais de 48h”), poder **clicar no lead e ver um modal com o resumo**; (2) em **CRM › Distribuição geográfica**, ao clicar em **São Paulo**, descer logo abaixo da cidade um painel com **a zona que cada pessoa cadastrou**, de preferência com **mapa da cidade**.

## 1. Resumo do lead (modal)
- **Onde:** qualquer cartão cuja lista de registros são oportunidades — Início › Alertas › *Leads sem retorno*, e no CRM *Novos leads*, *Negócios em aberto*, *Valor em negociação*, *Negócios ganhos*, *Conversão comercial*, *Oportunidades sem retorno* e *Comissão potencial*. Cada item vira um botão (“Ver resumo”). Cartões que listam outra coisa (contas, pacotes, atendimentos…) continuam sem clique.
- **O que mostra:** nome; situação (em aberto/ganha/perdida), etapa e funil; aviso “Sem contato há N dias” quando passou de 48 h; telefone (com link de WhatsApp), e-mail, bairro · cidade/UF e a zona (em São Paulo capital); quando chegou, último contato, origem (fonte e campanha), responsável, valor, próximo contato e, se perdida, o motivo; os 3 últimos registros de contato; até 3 tarefas em aberto; e as **respostas do formulário** (recolhidas, com as mesmas regras de acesso: respostas de saúde só para a gestão).
- **Botões:** *Ver cadastro* (Pessoas) e *Abrir no CRM* (lista de oportunidades, onde se age: mover de etapa, registrar contato). O modal é **só leitura**.
- **Acesso:** consultas diretas com as regras de acesso (RLS) do próprio usuário — o servidor só devolve o que ele pode ver; se o lead não for visível aparece “não encontrei este lead (ou você não tem acesso a ele)”. Nenhuma função nova no banco para isso.
- Arquivos: `src/components/hp/LeadSummaryDialog.tsx`, `src/lib/CardDetailSheet.tsx`.

## 2. São Paulo por zona, com mapa
- **Como funciona:** em *Distribuição geográfica* (CRM › Contatos e Dashboard), clicar em **São Paulo** abre um painel **logo abaixo da linha da cidade** (uma linha a mais da mesma tabela, não um bloco depois da tabela). Outras cidades também passam a abrir a lista abaixo da própria linha.
- **Mapa:** São Paulo dividida nas 5 zonas (Norte, Sul, Leste, Oeste, Centro), pintadas pela quantidade de contatos que informaram cada uma (mais escuro = mais contatos). Clicar numa zona filtra a lista; também funciona por teclado e toque. Atrás há os filtros em botões (*Todas*, cada zona e *Sem zona informada*).
- **Lista:** nome (abre o formulário da pessoa), **Zona** (a que a pessoa cadastrou), bairro, telefone, e-mail e tipo. “Não informada” = cadastros antigos, em que a zona não era perguntada (nada é deduzido).
- **Geometria:** os 96 distritos do município (GeoSampa/Prefeitura de São Paulo, dados abertos) agrupados nas zonas pela **subprefeitura** (Sé = Centro; Lapa, Butantã e Pinheiros = Oeste; Perus, Pirituba‑Jaraguá, Freguesia‑Brasilândia, Casa Verde‑Cachoeirinha, Santana‑Tucuruvi, Jaçanã‑Tremembé e Vila Maria‑Vila Guilherme = Norte; Mooca e as demais da região = Leste; Ipiranga, Vila Mariana, Jabaquara, Santo Amaro, Cidade Ademar, Campo Limpo, M’Boi Mirim, Capela do Socorro e Parelheiros = Sul), simplificada e **embutida no site** (`src/lib/spMapData.ts`, ~45 KB): nenhum serviço de mapa externo e nenhum dado enviado para fora. Serve para ilustrar; não serve para medir áreas ou endereços.
- **Banco:** migration `20261112000121_crm_sp_contatos.sql` — uma função de **leitura** (`crm_sp_contacts`), mesma regra de acesso e mesma base das funções de zona da migration 118; sem tabela nova e sem alterar dados.

## Testes
SQL `novos/N05` (32 OK, inclui a lista de São Paulo, acesso negado a fisioterapeuta e anônimo) · E2E `N24` (painel abaixo da linha, mapa, filtros por zona, zona de cada contato) · E2E `N27` (modal do lead: conteúdo, botões, cartões sem clique, 390 px).
