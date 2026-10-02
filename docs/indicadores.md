# Indicadores — fórmulas, período e denominadores

> Escopo: Administrativo (`/admin/adm`), CRM › Relatórios (`/admin/crm/relatorios`) e Captação de leads › Indicadores (`/admin/captacao-leads`).
> A **central de pendências administrativas** (cartões prioritários, pendências, documentos, contratos, requisitos) está documentada em `docs/indicadores-administrativo.md`.
> Tudo é calculado **no servidor** (RPCs `adm_dashboard`, `crm_analytics`, `capture_analytics`), com os mesmos escopos de unidade/permissão das telas.
> Cada cartão, barra ou número de tabela abre os **registros** por trás dele (`adm_indicator_detail`, `crm_indicator_detail`, `capture_indicator_detail`): o total da lista e o
> número do indicador usam a mesma regra. Nada é estimado ou inventado retroativamente.

## Convenções
- **Período**: intervalo `[início, fim)` escolhido no filtro (fuso de São Paulo). “Foto de hoje” = situação de agora, não muda com o período.
- **Respostas × pessoas × oportunidades** (Captação): *resposta* = cada quiz iniciado ou formulário enviado; *pessoa* = pessoa distinta identificada nas respostas; *oportunidade* = oportunidade distinta gerada. A mesma pessoa pode ter várias respostas; uma resposta pode não gerar oportunidade.
- **Cliques no WhatsApp ≠ mensagens enviadas.** O clique só indica que o botão foi acionado; não confirma envio nem atendimento.
- **Sem histórico, sem invenção**: quando um dado não foi registrado, o indicador mostra “—”/limitação, nunca um número reconstruído.

## 1. Administrativo
Universo: cadastros **não arquivados e não mesclados** — PF = `people`, PJ = `legal_entities`. Escopo de unidade: gestor/administrador operacional veem a organização (ou a unidade filtrada); gestor de unidade e comercial, só as unidades deles.

| Indicador | Fórmula | Período | Denominador / observação |
|---|---|---|---|
| Total / PF / PJ | contagem do universo | foto de hoje | — |
| Novos no período | cadastros cujo `created_at` está no período (PF + PJ; também PF e PJ separados) | período | — |
| Ativos / Pendentes / Inativos | contagem por `registration_status` (**status cadastral**, não atividade comercial) | foto de hoje | PF + PJ somados no cartão; o gráfico separa PF e PJ |
| Incompletos | PF sem documento, cidade, UF **ou** nenhum contato; PJ sem CNPJ, cidade, UF **ou** e-mail geral/telefone | foto de hoje | mesma regra da planilha (`person_is_complete`) |
| Campos faltantes | quantos cadastros não têm cada campo (documento, cidade, UF, contato) | foto de hoje | um cadastro pode faltar em vários campos: a soma excede o número de incompletos |
| Por vínculo | pessoas por tipo (`person_kinds`) — só PF | foto de hoje | uma pessoa pode ter vários vínculos: a soma excede o total de PF |
| Por unidade | PF pela unidade principal; PJ em **cada** unidade vinculada | foto de hoje | uma PJ em duas unidades aparece nas duas |

## 2. CRM › Relatórios
Escopo: `private.crm_units` + `private.crm_effective_owner` (quem não vê o time enxerga só os próprios negócios, mesmo forçando o filtro). Todos os indicadores valem para **um funil** (o escolhido; por padrão, o de pacientes).

| Indicador | Fórmula | Período | Denominador / observação |
|---|---|---|---|
| Em aberto agora | oportunidades com `status = 'open'` | foto de hoje | — |
| Tempo na etapa atual | `agora − entrada na etapa atual`; entrada = último evento `created/stage_changed` para essa etapa (sem evento: criação) | foto de hoje | média, mediana e máximo por etapa, só oportunidades em aberto |
| Paradas | em aberto **sem troca de etapa nem contato** há mais de N dias (padrão **7**, configurável no filtro) | foto de hoje | atividade = maior entre entrada na etapa e último contato registrado |
| Duração por etapa (histórico) | tempo entre a entrada numa etapa e a saída, de passagens **concluídas** cuja saída caiu no período | período | média/mediana e nº de passagens; **limitação**: oportunidades sem evento de criação não têm a duração da 1ª etapa (o registro de eventos começou com o CRM; nada é reconstruído) |
| Chegaram à etapa | coorte = oportunidades **criadas** no período; “chegou à etapa *k*” = esteve na etapa *k* ou em posterior (maior posição já alcançada, contando só etapas abertas; ganhas contam como tendo percorrido todas) | coorte do período | etapas de perda nunca contam como progresso |
| Conversão entre etapas | `chegaram à etapa k ÷ chegaram à etapa k−1`; “sobre a 1ª” divide pelo total da 1ª etapa; “Ganho” = ganhas da coorte ÷ chegaram à última etapa aberta | coorte do período | mesma coorte em todas as linhas |
| Conversão geral | ganhas da coorte ÷ criadas no período | coorte do período | oportunidades ainda abertas contam no denominador (a taxa cresce conforme elas fecham) |
| Taxa de ganho (fechadas) | ganhas ÷ (ganhas + perdidas) **fechadas no período** | período de fechamento | exclui abertas |
| Ciclo de venda | `closed_at − created_at` das **ganhas fechadas no período**; média e mediana | período de fechamento | só ganhas |
| Motivos de perda | perdidas fechadas no período por motivo; % = motivo ÷ total de perdidas do período | período de fechamento | “Sem motivo” quando vazio |
| Por responsável / origem | criadas (no período), ganhas e perdidas (fechadas no período), em aberto (hoje), conversão = ganhas ÷ (ganhas + perdidas), valor ganho | período (em aberto: hoje) | origem = campo `source` da oportunidade; vazio = “Sem origem” |

## 3. Captação de leads › Indicadores
Fontes: `quiz_leads` (quizzes de atendimento e parceria, por `started_at`) e `form_submissions` (formulários do HP Pages, por `created_at`). Escopo por unidade do quiz/formulário; papéis: gestor, administrador operacional, gestor de unidade e comercial.

| Indicador | Fórmula | Período | Denominador / observação |
|---|---|---|---|
| Respostas | quizzes iniciados + formulários enviados | período | a mesma pessoa pode contar várias vezes |
| Pessoas distintas | `count(distinct person_id)` das respostas | período | respostas sem pessoa identificada não entram |
| Oportunidades distintas | `count(distinct opportunity_id)` das respostas | período | — |
| Quizzes iniciados / concluídos | status do quiz | período de início | — |
| Taxa de conclusão | concluídos ÷ iniciados | período de início | — |
| Taxa de abandono | não concluídos **e** sem atividade há mais de 24 h ÷ iniciados | período de início | calculada **na leitura**; nunca gravada; quem tem atividade há menos de 24 h aparece como “em andamento” |
| Abandono por pergunta | abandonados agrupados por `step_reached` | período de início | — |
| Origem / campanha | `utm_source` / `utm_campaign` da resposta; vazio = “(sem origem)” / “(sem campanha)” | período | respostas, pessoas e oportunidades por grupo |
| Evolução | respostas e quizzes concluídos por dia (por semana se o período passa de 92 dias) | período | — |
| Cliques no WhatsApp | quizzes iniciados no período com clique registrado | período de início | **clique ≠ mensagem enviada** |
| Conversão até a venda | pessoas capturadas (1ª captação no período) que, **depois** dela, ganharam: oportunidade · atendimento criado · atendimento realizado (`attended`) · venda confirmada | coorte do período | % = etapa ÷ pessoas capturadas; as etapas **não são sequenciais** (alguém pode comprar sem passar pelas outras) |

## Limitações conhecidas
- Páginas de formulários não registram início/abandono (só o envio): **não existe taxa de abandono de formulário** — só de quiz.
- O tempo por etapa usa o registro de eventos do CRM; oportunidades antigas sem evento de criação têm a duração da 1ª etapa indisponível.
- Conversão para “atendimento criado” conta a pessoa uma vez, mesmo que o atendimento tenha sido cancelado ou remarcado depois.
