# Rota de atendimentos — privacidade e termos do provedor de rotas

> **MINUTA PARA REVISÃO JURÍDICA.** Documento técnico-factual (16/11/2026). Não é texto jurídico final nem foi publicado ao paciente. Nenhum texto de consentimento, política ou termo em produção foi alterado.
> O app **ainda não tem** página pública de Política de Privacidade nem de Termos de Uso; os únicos textos legais no produto são as três minutas de consentimento (`consent_texts`, versão `v0-minuta`). Esta minuta serve de insumo para quem redigir esses documentos.

## 1. O que sai do sistema, para quem, e o que NÃO sai

| Destino | Quando | O que é enviado | O que NÃO é enviado |
|---|---|---|---|
| **OpenRouteService (ORS)** — `api.openrouteservice.org`, operado pelo HeiGIT (Alemanha) | Ao abrir a aba Rota, "Sugerir rota", "Desenhar trajeto", "Buscar melhor encaixe" | Lista de **coordenadas arredondadas a 3 casas decimais (≈110 m)** dos pontos do dia (unidade, ponto de partida opcional do profissional, locais de atendimento domiciliar), o perfil (carro / a pé / bicicleta) e a chave de API da conta HP. Até 25 pontos por consulta | Nome, telefone, e-mail, id do paciente, diagnóstico, prontuário, serviço, horário, orientações clínicas, endereço por extenso |
| | | A chamada parte do **servidor** (Edge Function do Supabase), não do navegador: o ORS vê o IP do servidor, não o do usuário | — |
| **OpenFreeMap** — `tiles.openfreemap.org` | Ao exibir o mapa | O **navegador** do usuário pede blocos de mapa da região visualizada (o provedor pode ver região aproximada, IP e user-agent do navegador) | Nenhum dado de paciente (os pontos são desenhados localmente) |
| **Google Maps** (somente no aparelho de quem clica) | Ao clicar em "Abrir navegação" | Link com **um único destino** (coordenadas com 5 casas, precisão de poucos metros) e o modo de deslocamento | A rota com todos os pacientes nunca vira link |

Não há rastreamento contínuo, nem uso de GPS do profissional, nem exigência de endereço residencial do profissional.

## 2. O que fica guardado no sistema HP

- **Local do paciente** (`route_places`): coordenada marcada manualmente (precisão: exato / rua / CEP aproximado); copiada como instantâneo para cada atendimento domiciliar. Acesso por RLS e papel.
- **Cache de tempos de deslocamento** (`route_leg_cache`): chave com coordenadas arredondadas (≈110 m), **sem pessoa associada**, validade de **7 dias**.
- **Contador diário de consultas** (`route_usage`) e **registro das aplicações de rota** (`route_apply_log`: antes/depois de horários, **sem nomes e sem coordenadas**) e auditoria.

## 3. O que está confirmado e o que NÃO está sobre o ORS (leitura em 16/11/2026)

**Confirmado em fontes oficiais:** o ORS se descreve como gratuito, com cotas diárias e por minuto (diretrizes: 2.000/dia e 40/min; matriz 500/dia e 40/min); exige **atribuição** ("Rotas © openrouteservice.org by HeiGIT · Dados © OpenStreetMap contributors", já exibida na tela); ao exceder a cota a API devolve erro; um aviso de 2019 diz que **não oferece mais suporte gratuito a interesses comerciais** e remete a `enquiry@openrouteservice.org`; existe uma Política de Privacidade do HeiGIT, e dúvidas de privacidade/LGPD-GDPR vão para `eprivacy@heigit.org`.

**NÃO confirmado (o texto integral dos Termos e da Política não pôde ser lido — as páginas oficiais são carregadas por JavaScript e vieram vazias):**
1. Se o **uso comercial** de uma clínica é permitido com a chave gratuita (uma fonte de terceiros diz que produção/comercial exige plano pago; contradiz a página oficial; **não verificado**).
2. Se o ORS **registra** as coordenadas recebidas, por quanto tempo, e se as repassa a terceiros.
3. O papel do HeiGIT sob a lei de proteção de dados (operador? controlador?) e se há contrato de tratamento (DPA).
4. Garantia de disponibilidade (o serviço público não indica SLA; o sistema já mostra "Estimativa indisponível" quando falha e nunca inventa trajeto).

> **Recomendação:** tratar a ligação de `ORS_API_KEY` na produção como **uso inicial sujeito a esta confirmação**. Coordenadas arredondadas sem identificador reduzem o risco, mas a localização aproximada de residências de pacientes continua sendo informação sensível no contexto de saúde.

### Rascunho de e-mail ao ORS (NÃO enviado — aguarda decisão do responsável)
Para `enquiry@openrouteservice.org` (uso comercial) e `eprivacy@heigit.org` (privacidade):

> We are a physiotherapy clinic in Brazil using the openrouteservice Matrix and Directions APIs (free key) from our server to estimate travel times between appointment locations. We send only rounded coordinates (3 decimals), a profile and our API key; no names or health data. Could you confirm: (1) whether this commercial use is permitted on the free plan, or which plan we need; (2) whether request coordinates are logged, for how long, and whether they are shared with third parties; (3) your role under GDPR (and Brazilian LGPD) and whether a data processing agreement is available; (4) any availability guarantees. We display the required attribution.

## 4. Minuta de trecho para a Política de Privacidade (para o jurídico adaptar)

> **Rotas de atendimento domiciliar.** Para estimar o tempo de deslocamento entre atendimentos, o sistema envia a um serviço de rotas de terceiros (OpenRouteService, HeiGIT) apenas coordenadas geográficas aproximadas (precisão de cerca de 110 metros) dos locais do dia, sem nome, telefone, dados de saúde ou qualquer outro identificador do paciente. O mapa exibido é carregado de um provedor de mapas (OpenFreeMap), que pode receber o endereço IP e a região visualizada pelo navegador do usuário. O sistema não rastreia a localização do profissional em tempo real. O local de atendimento do paciente é informado pela clínica e armazenado de forma restrita, com acesso limitado a quem atende e à gestão.

## 5. Perguntas para o jurídico
1. Coordenadas aproximadas (≈110 m) de residências, sem identificador, ainda são dado pessoal/sensível neste contexto? Qual a base legal aplicável?
2. É necessário citar o provedor nominalmente na política, e coletar consentimento específico ou basta informação?
3. Há necessidade de contrato de tratamento (DPA) com o HeiGIT e de cláusula de transferência internacional (Alemanha)?
4. A minuta do item 4 atende, ou o trecho precisa entrar no consentimento de "saúde"?
5. Retenção do cache (7 dias) e do local do paciente: prazos adequados?

## 6. Decisão operacional
- **Chave já criada na produção** (secret `ORS_API_KEY`, conferido pelo nome em 16/11/2026): a Rota passa a mostrar tempos reais assim que for aberta com locais de pacientes cadastrados.
- Para **pausar** o envio de coordenadas enquanto o jurídico/ORS respondem: remover o secret `ORS_API_KEY` da produção (a função volta a "Estimativa indisponível" sem alterar o resto).
