# Zonas e bairros nas capitais

> Pedido do usuário (12/11/2026): replicar o conceito de **zona e bairro, com mapa da cidade**, para todos os cadastros **apenas das cidades que são capitais de estado** (exemplo: Rio de Janeiro sim; Santo André não). Decisões tomadas com o usuário: (1) a “zona” é a **divisão oficial de cada cidade**, com o nome local; (2) entrega **em lotes, começando pelo Rio de Janeiro**; (3) o **bairro é escolhido de uma lista** da cidade e a zona vem junto (com “Outro bairro” como saída).

## O que já está liberado
| Capital | Zonas | Bairro | Fonte do mapa e da divisão |
|---|---|---|---|
| **São Paulo** (SP) | Sul, Norte, Leste, Oeste, Centro | digitado (como desde a migration 118) | 96 distritos do GeoSampa/Prefeitura, agrupados pela subprefeitura |
| **Rio de Janeiro** (RJ) | Zona Sul, Zona Norte, Zona Oeste, Centro | **escolhido de 164 bairros** oficiais | Prefeitura do Rio (Data.Rio, ODbL): limites dos bairros + Região de Planejamento. Centro = AP1; Zona Sul = RP 2.1; Zona Norte = RP 2.2 (Grande Tijuca) + AP3; Zona Oeste = AP4 (Barra e Jacarepaguá) + AP5 |
| **Belo Horizonte** (MG) | Regional Barreiro, Centro-Sul, Leste, Nordeste, Noroeste, Norte, Oeste, Pampulha e Venda Nova | digitado (como São Paulo) | Prefeitura de BH (dados.pbh.gov.br): as 9 regionais administrativas, desenho simplificado. O Hipercentro é divisão interna do Centro-Sul e não vira regional própria |

As demais capitais **continuam perguntando só a cidade** até serem liberadas; cidades que não são capital (Niterói, Santo André, Campinas…) nunca perguntam zona.

## Onde aparece
- **Quiz de captação:** capital liberada → bairro + zona. No Rio, o bairro é uma lista e a **zona vem preenchida** (campo bloqueado); “Outro bairro (não está na lista)” abre um campo livre e a zona passa a ser escolhida. Em São Paulo segue bairro digitado + zona escolhida.
- **Cadastro do paciente e do fisioterapeuta (onboarding):** o mesmo; endereço pelo CEP já preenche o bairro e, se ele estiver na lista, a zona.
- **Fisioterapeuta — zonas que atende:** escolhe a capital (padrão: onde mora) e marca as zonas; pode marcar zonas de mais de uma capital (a tela e o Admin mostram “Zona Sul (Rio de Janeiro)”).
- **CRM › Distribuição geográfica:** clicar numa **capital liberada** abre, **logo abaixo da linha da cidade**, o painel com o **mapa das zonas** (pintado pela quantidade de contatos), filtros por zona (incluindo “Sem zona informada”) e a lista com **a zona e o bairro que cada pessoa cadastrou**. Outras cidades abrem a lista simples, também abaixo da própria linha.
- **Resumo do lead (modal) e Admin › dados do cadastro:** mostram bairro e zona com o nome da cidade.

## Como funciona por dentro
- **Banco (migration 122; BH na 124, que só acrescenta linhas em `geo_zones` e ajusta a busca):** tabela `geo_zones` (cidade, UF, id da zona, nome) com a lista oficial; leitura pública, escrita só por migration. Ids únicos: São Paulo mantém `sul/norte/leste/oeste/centro`; as demais usam prefixo (`rj-sul`…). `quiz_save_progress`, o trigger que leva a zona do quiz ao cadastro, `onb_address` e `onboarding_submit_physio` passam a validar **a zona da cidade informada** (zona de outra cidade é recusada; cidade fora da lista ignora bairro/zona). Os checks de `people.zone`, `quiz_leads.zone` e `professional_profiles.service_zones` passam a consultar `geo_zones`. CRM: `crm_capital_contacts(cidade, UF)` (leitura).
- **Site:** `src/lib/capitals.ts` (lista de capitais liberadas e helpers), `src/lib/geo/<cidade>.ts` (bairros + desenho, carregados só quando a tela precisa), `BairroZonaFields` (quiz e cadastros), `CityZoneMap` e `CapitalCityPanel` (CRM). Front e banco precisam andar juntos: capital nova = linha em `geo_zones` **e** entrada em `CAPITALS`.

## Como liberar a próxima capital (roteiro)
1. Achar a **divisão oficial** da prefeitura (zonas, regionais, RPAs ou regiões administrativas) e o **limite dos bairros** em dados abertos (Data.Rio, GeoSampa, DataGEO etc.); conferir a licença.
2. Gerar `src/lib/geo/<cidade>.ts` (bairros com a zona de cada um, desenho simplificado por zona, rótulo dentro de um bairro da zona) com o mesmo script do Rio.
3. Acrescentar a capital em `CAPITALS` e as zonas em uma migration (`geo_zones`).
4. Testes: SQL (zona da cidade vale, de outra cidade não), unitário dos dados (bairros únicos, cada um numa zona) e E2E (quiz, CRM, cadastro).
5. Conferir o mapa visualmente (claro e escuro) antes de publicar.

## Limitações
- Só **São Paulo, Rio de Janeiro e Belo Horizonte** estão liberadas; as outras 24 capitais dependem de levantar e conferir uma fonte oficial para cada uma. (Regra do usuário: uma capital só é trabalhada quando **já existe alguém dela no cadastro**; em 13/11/2026 não havia ninguém das demais 24.)
- **Belo Horizonte sem lista de bairros:** a base oficial de bairros da PBH (322 áreas) não traz nomes populares como Savassi, Funcionários, Centro ou Santa Efigênia; uma lista assim faria muita gente cair em “Outro bairro”. Por isso o bairro é digitado e a **regional é escolhida**. Para ter a lista (como no Rio), falta a base de “bairros populares” da PBH, que o portal só entrega pelo navegador.
- Em BH o nome das zonas é “Regional X”; na busca global vale “regional barreiro”, “fisioterapeuta regional norte belo horizonte” (e “zona sul” continua sendo só São Paulo e Rio).
- A divisão do Rio segue a Prefeitura: **Barra da Tijuca e Jacarepaguá estão na Zona Oeste**, e a Grande Tijuca (Tijuca, Vila Isabel…) na Zona Norte. Quem usa outra convenção pode escolher “Outro bairro” e a zona que preferir.
- Os mapas servem para ilustrar e filtrar; **não** servem para medir áreas ou localizar endereços. A zona de cada contato é a que **ele informou** (nada é deduzido).
- Cadastros antigos ficam em “Sem zona informada”.
