# Administrativo — central de pendências administrativas

> Migration `062`, telas `Administrativo › Dashboard` e `Administrativo › Pendências`, testes `S10` (SQL) e `R11` (E2E). **Aditivo**: os totais PF/PJ, status cadastral, campos faltantes, vínculo e unidade (`adm_dashboard`, migration 056) continuam como eram; a central fica acima deles.
> Nada aqui lê dado clínico. Nenhuma saída traz número de documento (CPF/CNPJ). Nenhuma integração externa é necessária.

## Como ler
- **Situação de hoje** (cartões e quase todos os indicadores): a foto do momento. **Não muda** com o período do filtro. Vem com a etiqueta “Situação de hoje”.
- **No período**: acompanha o período escolhido. Hoje são só o tempo de resolução e as pendências concluídas (etiqueta “No período”); a evolução semanal usa o período para escolher as semanas.
- **Filtros** (canto direito, compactos; no celular viram uma gaveta): unidade e período (como no resto do app) + responsável, PF/PJ, vínculo e status das pendências. **Filtro que não se aplica a um conjunto exclui aquele conjunto** (ex.: vínculo em pessoa jurídica) — nunca é ignorado em silêncio, e cada indicador diz no `basis` o que é. O status (aberta/atrasada/concluída) restringe só a seção de pendências. Os totais PF/PJ do cadastro central usam só período e unidade.
- **Sem base = motivo, não zero.** Quando não há como calcular, o indicador vem como “indisponível” com o motivo (ex.: “nenhuma verificação de contato foi registrada ainda”, “nenhuma pendência concluída no período”, “sem cadastros no filtro”). Contagem real que é zero continua zero.
- Todo cartão e todo número com ação abre os **mesmos registros** que o compõem (`adm_central_detail` usa as mesmas funções-base de `adm_central`): o total do detalhe é igual ao do cartão, com os mesmos filtros e o mesmo escopo de unidade. A lista mostra até 50 registros; o total mostra todos.

## Cartões prioritários (situação de hoje)
| Cartão | Fórmula | Fonte |
|---|---|---|
| Pendências administrativas vencidas | pendências **abertas** com `due_date` anterior a hoje | `adm_pendencies` |
| Cadastros incompletos | cadastros PF + PJ que não atendem algum requisito **ativo e obrigatório** do tipo (PF/PJ) e de cada um dos seus vínculos | `people`, `legal_entities`, `person_kinds`, `adm_requirements` (+ contatos, documentos, contratos quando o requisito os exige) |
| Documentos vencendo em N dias | o documento **mais recente de cada tipo por cadastro** com validade de hoje até hoje + N (N padrão 30, configurável; limite inclusivo) | `person_documents`, `legal_entity_documents` |
| Contratos aguardando assinatura | contratos administrativos no estado “aguardando assinatura” | `adm_contracts` |
| Pacientes aguardando agendamento | pacientes **distintos** com **solicitação de agendamento em aberto** (lista de espera com status aguardando ou ofertada) | `waitlist` |
| Profissionais com integração administrativa incompleta | profissionais **ativos** que não atendem algum requisito ativo e obrigatório de “profissional” | `professionals` (+ unidades, agenda, acesso, documentos, contratos) |

**Não** se considera “aguardando agendamento” toda pessoa sem consulta: é preciso existir a solicitação (registro da Agenda › Lista de espera). “Cadastro ativo” não é paciente em tratamento, e `professionals.active` não prova vínculo contratual vigente (a tela diz isso).

## Indicadores complementares
| Indicador | Fórmula / critério | Fonte | Período | Indisponível quando |
|---|---|---|---|---|
| % de cadastros completos | completos ÷ cadastros (PF + PJ) × 100, com quebra por PF, PJ, cada vínculo e profissionais. Critério por grupo: requisitos de `pf` + os do vínculo (pessoa com vários vínculos é avaliada por todos) | idem cartão | hoje | sem cadastros no filtro, ou nenhum requisito ativo |
| Possíveis duplicidades | **grupos** de cadastros com o mesmo contato (não marcado como compartilhado), o mesmo documento ou o mesmo nome + data de nascimento. **Só para revisão; nada é mesclado.** O número é de grupos; a lista mostra os cadastros | `person_contacts`, `people` | hoje | — |
| Contatos com formato válido | contatos com e-mail válido (tem `@` e domínio) ou telefone com 10 a 13 dígitos ÷ contatos | `person_contacts` | hoje | sem contatos |
| Contatos verificados | contatos com **verificação registrada por uma pessoa da equipe** ÷ contatos. **Formato válido não é verificado.** Mudar o valor do contato apaga a verificação | `person_contacts.verified_at` | hoje | nenhuma verificação registrada ainda (motivo exibido) |
| Documentos ausentes | documentos **exigidos** por um requisito (por tipo/vínculo) sem nenhum registro | `adm_requirements` × documentos | hoje | sem requisito de documento: a tela avisa que “ausentes” não é “tudo em dia” |
| Documentos vencidos / vencendo | o mais recente de cada tipo por cadastro vence antes de hoje / até N dias. Renovar não deixa o antigo “vencido” | documentos | hoje | — |
| Documentos sem validade informada | tipo que vence registrado sem data: não conta como vigente nem como vencido | documentos | hoje | — |
| Contratos por situação e vencimento | rascunho · aguardando · assinado · cancelado; dos assinados: vigente, a vencer em N dias, vencido (pela data de término); aguardando com prazo de assinatura vencido | `adm_contracts` | hoje | — |
| Tempo médio e mediano de resolução | horas entre abrir (ou **reabrir**, o último) e concluir, das pendências concluídas no período, com quebra por tipo | `adm_pendencies` | período | nenhuma concluída no período |
| Tempo de integração de novos profissionais | dias entre o início da medição do profissional e a primeira vez visto com todos os requisitos. **A medição começa na primeira avaliação**; quem já estava completo nela não ganha data de conclusão inventada | `adm_professional_onboarding` | hoje | nenhum profissional concluiu depois de medido (motivo e data de início da medição exibidos) |
| Profissionais aptos a atender | profissionais ativos com todos os requisitos ÷ profissionais ativos | `professionals` | hoje | — |
| Solicitações de agendamento: espera | média, mediana, máximo (dias desde o registro da solicitação) e quantas passam do alerta (N padrão 7, inclusivo) | `waitlist` | hoje | nenhuma solicitação em aberto |
| Pacotes perto do fim sem próximo atendimento | pacotes **ativos**, dentro da validade, com saldo ≤ N sessões (padrão 2) e **sem nenhum atendimento futuro agendado** (scheduled/confirmed; um atendimento de reavaliação agendado tira o pacote da lista). Saldo é controle administrativo, não evolução clínica | `client_packages`, `session_ledger`, `appointments` | hoje | — |
| Convites e acessos | convites não aceitos (válidos × expirados, separados; o aceito e o revogado não contam); acessos a revisar = papel ativo de conta **suspensa** ou papel que **expira** em até N dias | `invitations`, `role_assignments`, `user_accounts` | hoje | — |
| Pendências por situação, responsável e unidade | abertas, atrasadas e concluídas no período, por responsável e por unidade | `adm_pendencies` | hoje / período | — |
| Evolução de pendências | por semana (segunda a domingo): abertas e concluídas por **evento registrado**, e “em aberto ao fim da semana” (o último evento até o fim da semana as deixa abertas) | `adm_pendency_events` | período | o histórico **começa no primeiro registro**; não há dado retroativo |

## Lista de prioridades
Pendências **abertas**, atrasadas primeiro e depois por prazo: registro (cadastro vinculado), motivo, responsável, prazo (com dias de atraso) e ação (**Concluir**, **Abrir** o cadastro). “Gerenciar todas” leva à página de pendências.

## Fluxos mínimos criados (registro, responsável, prazo, status, resolução e histórico)
- **Pendências** (`Administrativo › Pendências`): criar (tipo, motivo, cadastro vinculado opcional, responsável, prazo — sem prazo vale o padrão do tipo), atribuir, mudar prazo, **concluir** (exige descrever a resolução), **reabrir** (exige motivo; conta a reabertura), **cancelar** (exige motivo) e **histórico** completo (quem, quando, o quê). Exportação CSV pela mesma função de listagem (respeita permissão e escopo). Responsável precisa ser da equipe com acesso ativo.
- **Pendências automáticas** (`adm_sync`, só gestor/administrador operacional, rodada ao abrir o Dashboard): detecta documentos vencidos/vencendo, contratos aguardando assinatura, integração de profissional incompleta, convites expirados, solicitações de agendamento acima do alerta, pacotes perto do fim sem próximo atendimento e acessos a revisar. **Idempotente** (um problema aberto nunca vira duas pendências); quando a condição deixa de existir, a pendência automática é encerrada com “Regularizado — verificado automaticamente”. Pendências manuais **nunca** são tocadas. Cadastro incompleto **não** gera pendência em massa (trabalha-se no Diretório).
- **Documentos**: tipos configuráveis (PF/PJ, vence ou não), registro com emissão/validade/referência (arquivo opcional nesta etapa), remoção. PJ reaproveita `legal_entity_documents` (colunas novas); PF usa `person_documents`.
- **Contratos administrativos** (`adm_contracts`): rascunho → enviado para assinatura (com prazo) → **assinatura registrada manualmente** (data) · cancelado; responsável e histórico. **Registrar assinatura não é assinatura eletrônica.** `contracts` (venda), `corporate_contracts` e contratos de receita recorrente **não** foram usados como contrato administrativo (não têm estado de assinatura; recorrente é receita).
- **Verificação de contato** (`Pendências › Contatos`): registro humano com método (conversa, código confirmado, documento, outro); valor mascarado na tela. A escrita direta dessas colunas é bloqueada (só pela função).
- **Requisitos e prazos** (`Pendências › Requisitos e prazos`): por tipo de cadastro e vínculo — dado do cadastro, documento vigente ou contrato assinado e vigente. Padrão = o critério que já valia (documento, cidade, UF, contato para PF e PJ) + pré-requisitos do profissional (registro no conselho, unidade, acesso ativo, agenda). Prazos: janela de “vencendo”, limite de pacote, alerta de espera e prazo padrão por tipo de pendência. Só gestor/administrador operacional edita; quem administra a unidade lê.

## Permissões e privacidade
- Leitura (painel, listas, detalhes, exportação): mesmas regras do Administrativo atual (`private.can_adm` + escopo de unidade de `adm_scope_units`): gestor e administrador operacional (organização); gestor de unidade e comercial (suas unidades). Fisioterapeuta, paciente e demais papéis: 42501.
- Escrita (pendências, documentos, contratos, verificação): gestor, administrador operacional e **gestor da unidade**; **comercial só lê**. Sincronização e configuração: só gestor/administrador operacional.
- Todas as tabelas novas têm RLS e **nenhum GRANT**: nem o gestor as lê diretamente — tudo passa por funções com checagem de permissão e de unidade. Os auxiliares internos do schema `private` não são executáveis por `anon`/`authenticated`.
- O Administrativo **não** lê objetivos, avaliações, reavaliações nem respostas de saúde (testado com um objetivo clínico de teste que não aparece em nenhuma saída). Contatos saem mascarados; nenhuma saída traz CPF/CNPJ.

## White label
Prazos e requisitos vivem em tabelas de configuração por organização (`adm_settings`, `adm_doc_types`, `adm_requirements`), sem nada específico do HP no código além dos **valores padrão** (editáveis). Nenhuma arquitetura nova: mesmas RPCs, mesmo padrão de escopo.

## Dependências e limitações
- **Nada depende de credencial externa.** O que depende de **você** é configurar: quais documentos e contratos cada tipo/vínculo exige (hoje só vêm os requisitos de dado), o responsável das pendências e os prazos.
- Sem requisitos de documento/contrato configurados, “documentos ausentes” fica em 0 **por falta de requisito**; a tela avisa.
- Verificação de contato é manual; não há verificação automática por código nesta etapa.
- Tempo de resolução, evolução e integração só existem a partir dos registros feitos com esta central (não há histórico retroativo).
- Duplicidades: sem botão de “não é duplicata”; a revisão é feita no Diretório (nada é mesclado automaticamente).
- Arquivos de documento (upload) ficam para depois; hoje é o registro com validade.

## Testes
- `supabase/tests/release/S10_central_pendencias_administrativas.sql` — **127 verificações** com valores calculados à mão: cada cartão × lista, limites de vencimento (hoje, +30, +31, ontem; documento renovado; sem validade), limites de espera e de pacote, requisitos por vínculo (desativar, documento, contrato), filtros, ciclo da pendência (criar, atribuir, concluir, reabrir, cancelar, histórico, tempo de resolução, evolução), sincronização (idempotência, auto-encerramento, integração medida depois), ausência de dados (motivo em vez de zero), permissões por papel, isolamento entre unidades, privacidade (sem dado clínico nem CPF/CNPJ) e superfície pública.
- `e2e/release/R11-central-pendencias-administrativas.spec.ts` — desktop: cartões = servidor e detalhes reconciliados, filtros, ciclo completo da pendência pela tela, lista de prioridades, documentos/contratos/contatos, permissões; **celular (390 × 844)**: sem rolagem lateral da página, filtro em gaveta, abas e ações.
