# Mapas e rotas — "Rota de atendimentos"

Estado: **somente Dev** (branch `feat/rota-atendimentos`). Verificado em **14/11/2026**. Nada em produção, nenhum serviço contratado, nenhuma cobrança ativada.

> **Gratuito não significa ilimitado.** Todos os números abaixo são os limites *publicados* pelos provedores na data acima. Eles mudam. Quem opera o app deve rever as páginas oficiais antes de crescer o uso.

## 1. O que a funcionalidade faz (e o que não faz)

- Mostra, no **Meu dia → Rota**, os atendimentos do dia em mapa e em lista, com **tempo estimado de deslocamento** entre um e outro, folgas, e alertas de inviabilidade.
- Sugere uma **"rota sugerida"** (heurística: vizinho mais próximo + melhoria 2-opt sobre os atendimentos *flexíveis*). Ela **mantém os mesmos horários do dia e só troca quem ocupa cada um**; os fixos, confirmados, remotos e passados não se movem e nenhum atendimento é encurtado (uma ordem em que alguém não caiba no horário recebido é descartada). **Não é uma rota ótima**, e o sistema nunca a chama assim.
- Na **Agenda**, "Buscar melhor encaixe" ordena horários livres pelo menor acréscimo de deslocamento para o profissional, **com a razão de cada sugestão**.
- **Nunca altera a agenda sozinha.** Simular não grava nada. Aplicar exige comparação antes/depois, confirmação do usuário, revalidação no servidor e gera registro de auditoria.
- **Não** faz rastreamento contínuo, **não** exige endereço residencial do profissional (o ponto de partida é a unidade; um ponto próprio é opcional), **não** encurta atendimentos para caber mais pacientes e **não** envia mensagem a ninguém.
- Sem trânsito em tempo real e sem transporte público. A tela diz: **"Tempo estimado sem trânsito em tempo real."** Quando o serviço está indisponível: **"Estimativa indisponível"** — nunca se inventa trajeto, nunca se usa distância em linha reta como se fosse trajeto rodoviário e um trecho desconhecido **não vale zero**.

## 2. Pilha escolhida

| Camada | Escolha | Por quê |
|---|---|---|
| Renderização do mapa | **MapLibre GL JS** (BSD-3, sem chave) | Biblioteca livre; o provedor de tiles é trocável. Instalada (`maplibre-gl` 4.7.1) e carregada só quando um mapa abre; se falhar (rede/bloqueio) a tela mostra “Mapa indisponível” e a lista com os tempos continua funcionando. |
| Tiles (mapa de fundo) | **OpenFreeMap** (tiles vetoriais, `tiles.openfreemap.org`) | Sem chave, sem cadastro; uso comercial permitido; sem limite de visualizações declarado. **Sem SLA** (mantido por doação). Atribuição obrigatória: "© OpenMapTiles · Dados © OpenStreetMap". Logs anonimizados pelo provedor. |
| Rotas / matriz de tempos | **OpenRouteService (ORS)**, plano gratuito, **chave própria, só no backend** | Matriz e direções para carro/a pé/bicicleta. Detalhes e limites na seção 4. |
| Geocodificação | **Desligada por padrão** | Veja seção 5. O alfinete manual no mapa sempre existe. |
| CEP → endereço | **ViaCEP** (somente preenche campos de endereço; coordenada de CEP é **aproximada** e rotulada assim) | Já usado no cadastro. |

### Alternativas avaliadas e **recusadas**

- **Servidor de tiles público do OpenStreetMap (`tile.openstreetmap.org`)**: a política de uso proíbe uso pesado/produção e exige identificação; não serve de infraestrutura de produção.
- **Nominatim público**: política de uso (máx. 1 requisição/s, sem autocomplete, sem uso sistemático) — e **endereço de paciente é dado confidencial**; não será enviado a esse serviço.
- **OSRM público de demonstração (`router.project-osrm.org`)**: é um servidor de demonstração, sem garantia. Proibido como infraestrutura de produção.
- **Instalação própria** (OSRM/Valhalla/GraphHopper/Photon): viável tecnicamente e é a saída se os limites gratuitos não bastarem, **mas não é "custo zero"**: exige servidor com 8–16 GB de RAM para o recorte do Brasil/Sudeste, atualização periódica dos dados do OSM, monitoramento e alguém de plantão. É alternativa **registrada, não habilitada**.
- **Google Maps Platform / Mapbox**: pagos (têm cota gratuita, mas exigem cartão e cobrança). **Nunca habilitados automaticamente.**

## 3. Arquitetura (o que protege chave, privacidade e custo)

```
Navegador ──JWT do usuário──► Edge Function `route-planner` ──chave ORS (Secret)──► provedor
                                  │  · confere permissão (can_view_prof_agenda / can_schedule)
                                  │  · só COORDENADAS saem para o provedor (nunca nome, telefone, diagnóstico, prontuário, orientações)
                                  │  · cache de trechos no banco (coordenadas arredondadas + perfil + validade)
                                  │  · contador por organização/dia + teto próprio abaixo da cota do provedor
                                  └► nada de endereço/coordenada em log de erro
```

- A **chave do provedor nunca vai ao navegador**. Sem a chave, a função responde `unavailable` e a tela mostra "Estimativa indisponível" — **não existe modo "fingir"**.
- **Adaptador de provedor** (`ors` hoje): trocar de serviço = escrever outro adaptador, sem mexer na tela nem no algoritmo.
- **Cache** (`route_leg_cache`): chave = perfil + coordenadas arredondadas a 3 casas (~110 m) + validade de 7 dias. Reduz chamadas e evita reenviar os mesmos pares.
- **Tetos próprios** (`route_usage`): padrão 400 matrizes/dia e 1.600 direções/dia por organização — abaixo das cotas gratuitas do provedor. Ao atingir: "Limite diário de estimativas atingido", sem fallback pago e sem trajeto inventado.
- **Retentativas limitadas** (1 retentativa, com espera) e tratamento explícito de `429`/`403`/timeout.
- **Link de navegação** ("Abrir navegação") usa só o destino do **próximo** atendimento, aberto pelo próprio aparelho (Google Maps/Apple Maps/Waze por link universal); a rota com todos os pacientes **nunca** é montada em link público.
- A rota completa só é montada na tela de quem tem permissão; coordenadas e endereços **não** vão para analytics nem para log de erro.

## 4. Limites do OpenRouteService (plano gratuito)

Fontes oficiais consultadas (verificação em 14/11/2026): página de planos e de restrições do ORS (openrouteservice.org/plans, GitHub openrouteservice e o portal `account.heigit.org`).

| Item | Valor publicado |
|---|---|
| Direções (`/v2/directions`) | 2.000 requisições/dia, 40/min |
| Matriz (`/v2/matrix`) | 500 requisições/dia, 40/min |
| Tamanho da matriz | até 3.500 rotas (origens × destinos) por requisição |
| Chave | uma por pessoa/conta; **nunca no cliente** |
| Erros | `429` (limite), `403` (chave inválida/sem cota) |
| Atribuição | obrigatória (mostrada no mapa e no rodapé da rota) |
| Trânsito em tempo real | **não** informado/garantido |
| Transporte público | **não** disponível |

### O que **não** foi confirmado (pendência objetiva do proprietário)

1. **Uso comercial** do plano gratuito para uma clínica: a leitura dos Termos de Uso no portal da HeiGIT (cadastro necessário) **não foi possível sem criar conta** — a conta é um ato do proprietário. Até ele ler e confirmar, **trate como não confirmado** e não rode a rota com dados reais de pacientes.
2. **Privacidade das coordenadas** enviadas ao ORS: confirmar a política de retenção/logs da HeiGIT. O app envia **só coordenadas** (sem identificação), mas coordenadas de residência são dado pessoal indireto. Alternativa mitigadora implementada: arredondamento a ~110 m no que é enviado ao provedor e **nenhum identificador** na requisição.

## 5. Geocodificação e locais

- **Não há geocodificação nesta entrega.** Nenhum endereço de paciente é enviado a serviço algum (nem Nominatim público, nem outro). O local de cada paciente é um **alfinete marcado manualmente** (no mapa, quando disponível, ou colando “latitude, longitude” copiado de um mapa) — sempre possível e sempre sob controle de quem cadastra.
- Se um dia houver geocodificação, ela entra como **adaptador próprio, desligado por padrão**, com provedor escolhido pela organização — nunca o Nominatim público.
- Estados de precisão do local: `exact` (alfinete no local), `street` (aproximado: rua/bairro), `cep` (aproximado por CEP: pode errar centenas de metros — **reservado no modelo para o futuro; nada o gera hoje**) e “Localização não definida”. Local aproximado **nunca** é tratado como certeza: o trecho aparece como “estimativa aproximada”; sem local, “Estimativa indisponível”.
- O ViaCEP continua só preenchendo os campos de endereço no cadastro (já era assim); ele não devolve coordenada.

## 6. Estimativa de consumo (ORS gratuito)

Premissas: profissional com ~8 atendimentos domiciliares/dia, 1 matriz por visualização/simulação (cache de 7 dias reaproveita pares repetidos), 1 chamada de direções para desenhar o trajeto escolhido.

- Uso típico por profissional/dia: **1–3 matrizes e 1–2 direções** (o cache derruba as repetições).
- Teto de matrizes (400/dia) comporta **~130–400 profissional-dias/dia**; o das direções, centenas.
- **Buscar melhor encaixe** (Agenda) usa 1 consulta por dia pesquisado (1, 3, 5 ou 7 dias; padrão 3), também com cache.
- Para o porte atual (poucos profissionais) a cota gratuita sobra com folga; ao crescer, o contador por organização mostra a proximidade do teto **antes** do bloqueio.

## 7. Configuração (uma vez só)

Se a chave faltar, a função devolve `unavailable` e a tela avisa. Para ativar:

1. Criar a conta gratuita em **account.heigit.org** (OpenRouteService) e gerar uma **API key** ("Dashboard → Request a token").
2. No Supabase **Dev** → Edge Functions → **Secrets**, criar o secret de nome exato **`ORS_API_KEY`** com a chave. (Opcional: `ORS_MATRIX_DAILY_CAP` e `ORS_DIRECTIONS_DAILY_CAP`.)
3. Nada a configurar no navegador e **nada a colar no chat**.

## 8. Modelo de dados (migration 130)

- `route_places`: ponto geográfico por unidade / pessoa (paciente) / profissional (partida opcional), com precisão e fonte. Sem acesso direto pelo cliente (só RPCs).
- `appointments.service_mode` (`in_clinic` | `home_visit` | `remote`) + **snapshot** do local (`visit_lat/lng/precision`) copiado no momento em que o atendimento é marcado/alterado — editar o cadastro depois **não muda** o local de atendimentos já marcados. Remarcação herda o snapshot (trigger).
- `professional_route_prefs`: meio de deslocamento, folga mínima entre atendimentos, ponto de partida (unidade por padrão; ponto próprio opcional).
- `route_leg_cache`, `route_usage`: cache e contador (só a função de backend, via service role).
- `route_apply_log`: antes/depois de cada aplicação (além do `audit_log`).
- RPCs: `route_day` (leitura do dia), `route_place_get/set/clear`, `route_prefs_set`, `appointment_set_mode` (formato + horário fixo; domiciliar copia o local), `route_apply` (aplicar com revalidação; trocas/ciclos A↔B resolvidos por “estacionamento” transacional), `route_usage_hit` (somente backend).

## 9. Regras de viabilidade

`fim do atendimento anterior + deslocamento + folga mínima ≤ início do próximo`. Exemplo: se o atendimento anterior termina às 10:00, o deslocamento estimado é de 30 min e a folga mínima é de 10 min, o próximo só pode começar **às 10:40**. Se começa antes, o trecho aparece como **inviável** (com quanto falta). Atendimentos **confirmados** e **fixos** nunca são movidos pela sugestão; nenhum atendimento é encurtado; atendimentos **remotos** não geram deslocamento nem exigem endereço; trecho sem estimativa é "desconhecido" (não zero) e impede indicar o dia como "viável".

## 10. Validação: o que é simulado e o que é real

| Camada | Como foi validada | Natureza |
|---|---|---|
| Regras de viabilidade, rota sugerida, melhor encaixe (`route-core.ts`) | 28 testes unitários (vitest: 19 do núcleo + 9 do adaptador) com matrizes de tempo **inventadas** | **Simulado** (lógica pura) |
| Adaptador do provedor (cabeçalhos, só coordenadas, 429/401/5xx, arredondamento, perfil) | testes unitários com `fetch` **dublê** | **Simulado** — prova o contrato, **não** a integração real |
| Banco: permissões, snapshot de local, aplicar com tudo-ou-nada, auditoria sem coordenadas, contador de uso | `supabase/tests/novos/N17_rota_atendimentos.sql` (63 verificações, Dev) | **Real** (banco Dev) |
| Edge Function `route-planner` no Dev: autenticação, permissão, cache, “Estimativa indisponível” sem chave, recusa de apply sem estimativa | chamadas reais à função publicada no Dev (E2E N35) | **Real** para tudo que não depende do provedor |
| Tempos de deslocamento exibidos nos testes de tela | fixture “Rota Teste” com tempos **SIMULADOS** no cache (`provider='simulado'`, semeado pelo próprio teste) e teto diário marcado como esgotado para forçar “Estimativa indisponível”; a tela mostra “Dados de teste: tempos SIMULADOS”. Não gasta cota do provedor | **Simulado** |
| Chamada ao OpenRouteService | **Realizada em 14/11/2026 (Dev)**: com `ORS_API_KEY` configurada, `status` → `configured: true` e `day` de 23/11 (4 atendimentos domiciliares, coordenadas de TESTE, nenhum paciente real) devolveu matriz 5×5 do provedor (`provider: ors`, `simulated: false`, `source: provider`, durações entre ~9 e ~28 min, atribuição presente). Resultado é do provedor, sem trânsito em tempo real | **Real** (uma chamada; limites e termos ainda não confirmados) |
| Mapa (MapLibre + OpenFreeMap) | E2E N35-2b: `data-state=ready`, tiles reais do OpenFreeMap, pontos numerados 1–4 + ponto de partida, atribuição visível; desktop e celular (390 px) sem rolagem lateral. Capturas `docs/screenshots/rota/rota-desktop-mapa.png` e `rota-celular-mapa-real.png` | **Real** (navegador do teste) |
| Linha do trajeto (“Desenhar trajeto no mapa”, `directions`) | 1 chamada real em 14/11 (dia 23/11, coordenadas de teste): `status: ok`, 824 pontos, ~51 km, ~94 min, atribuição presente. A linha só é desenhada com a geometria do provedor | **Real** (uma chamada; desenho na tela ainda sem captura) |

Validação real parcial: matriz de tempos e geometria do trajeto (ORS) e mapa. Ainda não validados: comportamento sob 429/limite real do provedor e os Termos de Uso do ORS.

## 11. Pendências externas objetivas

1. ~~Instalar `maplibre-gl`~~ **Feito em 14/11** (4.7.1, cache em D:; `mapLib.ts` carrega a biblioteca sob demanda).
2. ~~Chave do OpenRouteService~~ **Feita em 14/11** (Secret `ORS_API_KEY` no Dev). “Desenhar trajeto” (`directions`) também foi exercido (1 chamada real). Falta registrar o consumo depois de uso de verdade.
3. **Ler os Termos de Uso do ORS** (uso comercial e privacidade das coordenadas) antes de qualquer dado real de paciente — §4.
4. Revisar a política de privacidade/termos do HP Group para informar o uso de provedor de rotas (só coordenadas arredondadas saem do sistema).
5. Produção: nada foi levado. Para promover: migration 130 + publicar a função `route-planner` + Secrets, nessa ordem, só com autorização.

## 12. Google Calendar (reaproveitado, sem mudança)

A rota **não cria nem publica nada no Google**. Aplicar uma sugestão **move o próprio atendimento** de horário (mesmo id, mesmo paciente, mesmo pacote — nada de atendimento novo): a sincronização automática existente **atualiza o MESMO evento** (id determinístico por atendimento — impossível duplicar). O evento continua só com “Atendimento HP” + unidade (sem paciente por padrão, **sem endereço do paciente nem do profissional, sem dado clínico**). Mudar formato/local/horário fixo **não dispara sincronização** (o gatilho só observa `status`, `period` e `professional_id`; verificado no teste SQL N17). Simulações nunca chegam ao Google. **Não validado contra uma conta Google real nesta entrega** (depende da conexão OAuth de cada usuário).
