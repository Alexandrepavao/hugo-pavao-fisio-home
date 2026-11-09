# Marketing — conversões externas (PROJETO, nada ligado)

> **Status: documento de projeto. Nada disto está implementado, habilitado ou enviando dados.** Hoje o Hub **só lê** Meta Ads e Google Ads. Nenhum evento, lista, pixel ou conversão sai do Hub para plataformas de anúncio. Este texto existe para que uma decisão futura seja tomada com os riscos à vista — ele **não** autoriza a implementação. Qualquer passo abaixo exige decisão explícita da direção, revisão jurídica e, quando aplicável, do encarregado de dados (LGPD).

## 1. Por que isto é delicado aqui

O HP Group atende **saúde** (fisioterapia). Enviar à Meta ou ao Google *quem* contratou um serviço de saúde, ou *qual* serviço, pode revelar dado de saúde de uma pessoa identificável — dado **pessoal sensível** pela LGPD (art. 5º, II, e art. 11). As próprias plataformas restringem publicidade/medição com dados de saúde (categorias de saúde e “dados sensíveis” em políticas de ambas). Por isso a regra de partida é **não enviar**; só se envia se, e quando, houver base legal clara, consentimento específico e um desenho que não revele saúde.

## 2. O que poderia ser enviado (e o que NUNCA será)

| Pode ser considerado (com base legal + política da plataforma + consentimento) | NUNCA |
|---|---|
| Evento genérico de conversão de **negócio sem sentido clínico** (ex.: “lead”, “compra”) de pessoas que **consentiram expressamente** com mensuração de anúncios | Diagnóstico, queixa, sintoma, região do corpo, evolução, tratamento, profissional, serviço clínico específico, respostas de quiz/questionário, vídeos prescritos |
| Valor monetário agregado do evento, em moeda, sem item clínico | Nome do serviço/pacote quando revela condição de saúde |
| Identificadores de clique (`gclid`, `fbclid`/`fbc`) guardados **só com consentimento** (já é a regra do rastreamento atual) | Lista de pacientes, lista de “quem agendou/compareceu”, públicos personalizados de pacientes |
| E-mail/telefone **com hash** apenas para o público que consentiu, nunca para pacientes de saúde | Qualquer dado de paciente em e-mail/telefone, mesmo com hash |

Frente **HP Academy** (mentorias/cursos) e **HP Tech** não são saúde por natureza; são os candidatos naturais a uma primeira etapa, separados da fisioterapia. A fisioterapia **fica de fora** salvo parecer jurídico favorável.

## 3. Como seria o desenho técnico (se aprovado)

1. **Interruptor por conexão e por frente**: `mkt_connections.conversions_enabled` (hoje inexistente) e uma lista de frentes elegíveis; padrão **desligado**. Ligar exige administrador, registra quem/quando e mostra faixa permanente “Envio de conversões LIGADO”.
2. **Fila de saída auditável** (`mkt_conversion_outbox`): cada evento candidato é gravado **antes** de enviar, com payload mínimo, status (`pendente → aprovado → enviado | recusado | falhou`), id do evento (para desduplicar), plataforma, tentativa e resposta resumida. Nenhum envio sem linha na fila.
3. **Elegibilidade no banco** (função `private.mkt_conversion_eligible`): exige (a) frente elegível, (b) consentimento de mensuração registrado e vigente, (c) ausência de qualquer vínculo com atendimento clínico, (d) identificador de clique ou dado com hash consentido. O que não passa fica **bloqueado com o motivo**, visível ao administrador.
4. **Higienização do payload** em função única (lista de campos permitidos; qualquer campo fora da lista é descartado e o evento é recusado). Teste que falha se um campo clínico entrar.
5. **Envio pelo servidor** (Edge Function), com o mesmo cuidado do conector de leitura: credenciais cifradas, nada no navegador, retentativa limitada, idempotência por `event_id`. APIs-alvo: **Meta Conversions API** e **Google Ads — conversões offline / Enhanced Conversions**. Cada uma exige permissões e aprovação de app próprias, **diferentes** das da leitura.
6. **Aprovação humana na primeira fase**: o administrador revê a fila antes do envio (modo “aprovar para enviar”); só depois de um período sem incidentes se discute envio automático.
7. **Painel de transparência**: quantos eventos enviados/recusados/bloqueados e por quê; botão de **pausar tudo** imediato; exclusão/retratação seguindo a política de cada plataforma.

## 4. Pré-requisitos que o código não resolve

* **Revisão jurídica** (LGPD e políticas das plataformas) por frente de negócio — sem parecer favorável, não se constrói.
* **Texto de consentimento** específico para mensuração de anúncios no formulário/site, com registro de data, versão e revogação (hoje só existe consentimento para guardar ids de clique).
* **Contas e acessos**: Business Manager/Pixel (Meta) e conta Google Ads com permissão de conversão offline; revisão de app quando exigida.
* **Definição de negócio**: quais eventos valem como conversão (lead, venda de mentoria…), janela de envio e valor.
* **Plano de reversão**: como desligar, o que fazer se um envio indevido for detectado (notificação, remoção, registro do incidente).

## 5. Estado atual (verificável)

* Tela **Marketing → Integrações → “Envio de conversões”** mostra **Desativado** e explica que nada é enviado. Teste E2E `N22` confere isso.
* Nenhuma tabela, função ou rota de envio existe. O conector `marketing-ads` só tem operações de **leitura** (lista permitida aplicada no servidor, com teste).
* O assistente de IA do Marketing (`marketing-assistant`) lê **só agregados** do próprio Hub; ele também **não** envia nada às plataformas de anúncio.

## 6. Decisão pendente

Não há trabalho a fazer neste documento até que a direção decida: **(a)** manter desligado (situação atual), ou **(b)** abrir um projeto separado, começando por Academy/Tech, com parecer jurídico e consentimento antes de qualquer linha de código.
