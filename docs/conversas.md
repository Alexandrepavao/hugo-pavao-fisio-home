# Central de Conversas (CRM)

> `/admin/crm/conversas` e `/admin/crm/mensagens-agendadas` · migration `20260930000077_crm_conversations.sql` · testes: SQL `supabase/tests/release/S19_conversas.sql` (96 itens) e E2E `e2e/release/R19-central-conversas.spec.ts` (9 testes). Somente Dev.

## O que é (e o que NÃO é)

O HP **não tem provedor de WhatsApp/e-mail conectado** (nem API oficial, nem Evolution/Chatwoot). Por isso a central é um **atendimento assistido com registro**, e a tela diz isso em vez de fingir:

| Ação | O que acontece de verdade | O que NÃO é |
|---|---|---|
| Mensagem ao contato | abre o `wa.me` com o texto pronto **e registra** na conversa (`delivery = whatsapp_opened`, “WhatsApp aberto · sem confirmação de entrega”) | não há confirmação de entrega nem de leitura |
| Resposta recebida | o atendente **registra à mão** o que o contato respondeu | não há caixa de entrada sincronizada com o WhatsApp |
| Nota interna | só a equipe do CRM vê; não vai ao contato | — |
| Mensagem agendada | grava a mensagem + cria um **lembrete** (tarefa do CRM) para o responsável pelo envio; no horário fica **“pronta para enviar”**; o atendente clica **Enviar** (abre o WhatsApp e registra) | **nada é enviado sozinho**; sem provedor não há envio no horário |

Disparo em massa continua **fora da v1** (precisa de provedor). Quando houver provedor, o modelo (`crm_messages.delivery`, mensagens agendadas) comporta estados reais de entrega; hoje só existem `registered` e `whatsapp_opened`.

## Tela (padrão 3 colunas, inspirado no *Chats* do shadcn Admin, com a identidade HP)

- **Esquerda — lista:** abas *Minhas · Fila · Todas* (com contador de não lidas), filtro de estado, busca por nome/mensagem; cada linha traz nicho, etapa, estado, nº de atendentes e agendadas pendentes.
- **Centro — mensagens:** cabeçalho (voltar, atendentes, entrar/sair, ficha), faixa de mensagens agendadas (Enviar/Remarcar/Cancelar), balões (enviada, recebida, nota, sistema) e compositor com três modos (*Mensagem ao contato · Resposta recebida · Nota interna*) e **Agendar**.
- **Direita — ficha do lead (recolhível):** dados e etapa da oportunidade, **ficha do nicho**, atendimentos (só para Fisioterapia, administrativo), vendas confirmadas, tarefas e atalhos. Abaixo de 1280 px a ficha vira **gaveta**; no celular a tela mostra **uma coluna por vez** (lista → conversa; “voltar” retorna à lista). O estado “ficha aberta/fechada” fica no navegador.
- **Abrir por link:** `?pessoa=<id>[&oportunidade=<id>]` cria (ou reaproveita) a conversa; a oportunidade tem o botão **Abrir conversa**.

## Ficha por nicho

Nicho = tipo do funil da oportunidade (`pipelines.kind`). Campos **administrativos** (nunca clínicos), guardados em `opportunities.profile` e validados no servidor (`crm_lead_profile_save`: só chaves do nicho, valores da lista, texto até 200 caracteres; campo de outro nicho é recusado mesmo chamando a API direto). Salvar **substitui** o conjunto.

| Nicho (`kind`) | Campos |
|---|---|
| Paciente · HP Fisioterapia (`patients`) | motivo do contato (administrativo), melhor período, forma de atendimento (particular/convênio/a definir), indicado por · aviso “não registre dados clínicos” · próximo atendimento e atendimentos realizados (leitura, sem dados clínicos) |
| Aluno · HP Academy (`education`) | curso/mentoria de interesse, perfil (fisioterapeuta/estudante/outro da saúde/outro), registro no conselho, formato preferido |
| Parceiro (`partners`) | tipo de parceria, organização, cidade/UF, registro no conselho |
| Empresa (`companies`) | empresa, cargo do contato, faixa de colaboradores, programa de interesse |
| Funil livre (`custom`) | sem campos de nicho |

As chaves ficam em `private.lead_profile_spec` (SQL) e `src/pages/admin/crm/niches.ts` (rótulos); mudar um campo exige mudar os dois. Os campos **não são configuráveis pela interface** (decisão desta rodada: simplicidade e validação no servidor).

## Multiatendimento

- Uma conversa por **pessoa e canal** (`unique (org_id, person_id, channel)`); abrir de novo devolve a mesma.
- **Responsável (owner, sempre um)** + **colaboradores**. Quem abre vira responsável. Conversa sem atendente = **Fila**; quem “Entrar” primeiro assume.
- Ler: qualquer papel do CRM **da unidade** (mesma regra das oportunidades). **Responder/agendar/registrar:** só quem está na conversa **ou** gestor/adm. operacional/gestor de unidade.
- **Adicionar atendente** (precisa ter papel do CRM na unidade), **Sair** (o colaborador mais antigo assume; sem ninguém, volta à fila) e **Transferir** (só o responsável ou gestor; opção de continuar como colaborador). A transferência leva a **oportunidade** (responsável, com evento na trilha) e as **mensagens agendadas/lembretes pendentes**.
- **Não lida é por usuário** (`crm_conversation_reads`): só a resposta registrada conta; abrir a conversa marca como lida.
- Cada entrada/saída/transferência/mudança de estado vira uma mensagem de **sistema** na conversa (trilha visível).

## Integração com o restante do app

| Onde | O que ocorre |
|---|---|
| Histórico do lead / Pipeline | só a **mensagem enviada** vira interação (`whatsapp`, “WhatsApp aberto com a mensagem (sem confirmação de envio): …”): atualiza *último contato* e *primeira resposta*; a resposta recebida e a nota **não** contam como resposta da empresa |
| Tarefas e Ritmo do dia | mensagem agendada cria tarefa `reminder` (`dedupe_key = sched:<id>`); concluída ao registrar o envio, removida ao cancelar, movida ao remarcar |
| Pipeline / Oportunidade | etapa alterada pela ficha; transferência troca o responsável; botão “Abrir conversa” na oportunidade |
| Vendas | atalho “Converter em venda” e total de vendas confirmadas da pessoa |
| Auditoria | `crm_conversations` e `crm_scheduled_messages` auditadas (`private.audit_row`) |

## Segurança

Escrita **só por função** (`security definer`, `search_path = ''`, `GRANT` repetido); leitura por RLS; mensagens **imutáveis** (sem `update/delete`). Paciente, parceiro, fisioterapeuta e comercial de **outra unidade** não leem nada (testes `S19` e `R19` pela API). Acesso administrativo não libera informação de saúde: a ficha não tem campos clínicos.

## Limitações conhecidas (não declaradas como resolvidas)

- Sem provedor: nada entrega/lê mensagem; respostas são registradas manualmente; agendada depende de alguém clicar em Enviar.
- Atualização por **consulta periódica** (mensagens 8 s, lista 20 s, agendadas 30 s), não em tempo real.
- Na tela só o canal **WhatsApp** é aberto (o banco aceita `phone` e `email`, ainda sem interface).
- Sem anexos, áudio, modelos de mensagem ou etiquetas de conversa.
- O clique em “Abrir WhatsApp” depende do navegador permitir a nova janela; os testes interceptam `wa.me` (nenhuma mensagem real foi enviada).
- A reprodução real no WhatsApp do atendente (aplicativo/Web) **não foi testada** por automação.
