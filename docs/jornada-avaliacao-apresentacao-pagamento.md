# Jornada integrada: avaliação → apresentação personalizada → paciente pendente → pagamento confirmado → paciente ativo

> 17/11/2026 · branch `feat/apresentacao-jornada` · **somente Dev** (sem merge, produção ou DNS) · migrations **131, 132, 133** · testes SQL `N18`, `N19`, `N20` · E2E `N36`, `N37`.
> Legenda: ✅ validado de verdade (banco Dev + telas) · 🟡 validado só em parte (o que falta está dito) · 🔒 depende de configuração/serviço externo (não exercitado).

## 0. Regra substituída
**Antes:** “Venda feita” (confirmar a venda / mover a oportunidade para *Contratou*) criava o pacote, o saldo e o tipo *paciente*.
**Agora:** isso **não ativa mais ninguém**. A ativação depende de **pagamento confirmado da contratação de acompanhamento** (§7). A venda confirmada continua gerando contrato, parcelas e a etapa do CRM; pacote, saldo e o tipo *paciente* esperam o recebimento.
Mudança intencional de teste: `S02` (“venda de pacote concede sessões” → “não concede antes do pagamento; concede com a 1ª parcela quitada”).

## 1. Identidade (uma pessoa, um vínculo)
- Uma única pessoa em `people`. O estado do paciente vive em **`patient_enrollments`** (um vínculo aberto por pessoa e organização — índice único): `pending → active → ended`. Liga pessoa, oportunidade, organização, avaliação (agendamento existente), profissional, e — na ativação — a venda, a parcela e o recebimento que ativaram.
- Nada é copiado entre tabelas. “Migrar os dados da apresentação” = os mesmos registros autorizados passam a ser lidos pelo portal (§5, §6); a demonstração nunca vira dado clínico.
- Etapas do funil por **chave estável** (`pipeline_stages.key`: `new_contact`, `service`, `evaluation_scheduled`, `attended`, `proposal`, `hired`), com o nome apenas como reserva para funis sem chave. O handler que move a oportunidade ao agendar a avaliação também passou a usar a chave.

## 2. Entrada: “Avaliação agendada” (tipo Paciente) → vínculo pendente
- Gatilho em `opportunities` (só funil `patients`): em `evaluation_scheduled` cria **ou reaproveita** o vínculo pendente (trava por pessoa, idempotente; voltar/repetir a etapa não duplica). Paciente **ativo** (vínculo ativo ou pacote ativo anterior) tem o estado preservado. Parceiros, Academy e empresas não entram.
- A fisioterapeuta responsável recebe o **vínculo assistencial** (acesso clínico) no mesmo ato; ele é revogado se o vínculo for encerrado.
- Avaliação **sem lead prévio**: a fisioterapeuta usa o cadastro/deduplicação existente (`create_person`) e `enrollment_start_evaluation` cria o vínculo pendente **antes** da apresentação — só para pessoa **que ela cadastrou ou já atende**, nunca qualquer pessoa da organização.

## 3. Rotas e acesso
| Rota | Quem | Conteúdo |
|---|---|---|
| `/apresentacao` (e `/apresentação` → redireciona) | público | **Institucional/demonstrativa**: sem dados pessoais, sem banco, `noindex`; abre a demonstração com exemplos ilustrativos |
| `/apresentacao/avaliacao/:enrollmentId` | fisioterapeuta **com vínculo** (login) | Captura, evidências, apresentação, prévia real, publicação, acesso do paciente. Gestão/comercial são recusados (rota e API) |
| `/paciente/apresentacao` | o próprio paciente (pendente ou ativo) | Só a **versão liberada**, sem anotações internas |
Nenhum dado clínico em URL, `localStorage`/`sessionStorage`, logs ou analytics. A autorização é do banco (`presentation_can_edit` = vínculo assistencial); ID difícil de adivinhar não é autorização.

## 4. Captura (reaproveita metas, medidas e plano existentes)
Salvamento **automático** (800 ms), com indicação “Salvando… / Salvo às HH:MM”, retomada ao recarregar (o rascunho está no banco) e **concorrência otimista** (`rev`): se outra tela alterou, a tela avisa e oferece recarregar — nada é sobrescrito em silêncio.
- **Autoria separada:** *Relatado pelo paciente* (queixa, tempo, limitações, atividades) · *Avaliado/validado pelo profissional* (condição **avaliada ou hipótese** — são coisas diferentes e o paciente vê qual é qual; objetivo; plano) · *Interno — nunca publicado*.
- **16 áreas** (Acupuntura … Terapia Intensiva) como categorias de organização: não são diagnóstico e não geram tratamento nem número de sessões. Nenhuma alegação regulatória é publicada.
- **Medidas iniciais:** as que existem (`prof_patient_evolution`) + registro rápido de dor/atividade (`prof_measurement_add`, função existente). Sem medida → “Ainda não há medidas registradas” (nunca zero); um único registro mostra o ponto de partida, **não** tendência.
- **Plano:** frequência/duração/rotina/reavaliação **só se registrados**; senão “A definir com seu fisioterapeuta”. Não há número padrão de sessões. O paciente não aprova diagnóstico, prescrição nem plano.

## 5. Evidências científicas — **a biblioteca científica NÃO existia no projeto**
Foi criada vazia e com revisão (nada inventado; sem DOI/URL a ficha não existe; sem PDFs ou figuras copiados):
- `evidence_references`: título, autores, revista, ano, **DOI ou link** (obrigatório), desenho, população, comparação, benefícios, duração, seguimento, limitações, áreas, condições, **versão, revisor, data e verificação da fonte**.
- Fisioterapeuta **propõe** (rascunho); só a **gestão** aprova (“conferi a fonte original” é obrigatório); editar uma ficha aprovada a devolve à revisão (nova versão). Só fichas **aprovadas** chegam ao paciente.
- Sugestão (`evidence_suggest`) compara **área e condição** do caso com as fichas aprovadas **dentro do banco** (nenhum dado do paciente vai a serviço externo) e mostra **por que** foi sugerida; a profissional confirma a pertinência, escreve a relação com o caso (em linguagem simples — o paciente lê) e as diferenças; de 1 a 3 estudos.
- 🟡 **Não implementado:** busca/importação automática por DOI em fontes externas (PubMed/Crossref). A entrada é manual e verificável; automatizar exige decidir a fonte e uma Edge Function sem dados do paciente.

## 6. Apresentação guiada (7 etapas) e **prévia real de /paciente**
Avançar/Voltar/progresso/navegação livre. 1 Seu objetivo · 2 Seu ponto de partida · 3 Como será o acompanhamento · 4 A importância da rotina · 5 Seu plano · 6 A ciência por trás do acompanhamento · 7 **Esta é a sua área do paciente**.
- **Etapa 7 da fisioterapeuta = o portal real.** Os mesmos componentes (`PatientDashboard`) alimentados pelo **mesmo construtor de modelo** (`buildJourneyModel`) com os **gêmeos profissionais** das mesmas chamadas (`prof_patient_evolution`, `professional_journey`, `prof_training`, `prof_journey_plan`, `prof_education`, + `presentation_preview_home/appointments`): só leitura, faixa **“Prévia da área do paciente”**, sem ações exclusivas do paciente, sem saldo de pacote inventado, sem fixtures. *Nota técnica:* as consultas não são literalmente as `my_*` (elas usam `auth.uid()` do paciente); são os gêmeos autorizados por vínculo. O “ver como” existente é só-gestor e exige conta; aqui o acesso é da fisioterapeuta com vínculo, sem assumir sessão nem conhecer a senha.
- O portal real ganhou dois blocos (usados também na prévia): **“Seu acompanhamento: pendente”** (estado verdadeiro, sem cobrança/culpa) e **“A ciência por trás do seu acompanhamento”**.

## 7. Ativação por pagamento (regra)
Condição (`private.enrollment_evaluate`, a partir do **estado financeiro**, não do evento): venda **confirmada** de **contratação de acompanhamento** (item de produto `package` ou `plan`) **e a primeira parcela (entrada da própria venda) quitada, líquida de estorno**.
- **Não ativam:** venda feita / oportunidade ganha; checkout aberto/página de sucesso (não existem aqui); pagamento **parcial abaixo da parcela 1**; **avaliação/consulta avulsa** (produto `service`); curso/mentoria (Academy segue a própria regra).
- **Ativa:** 1ª parcela quitada — **sem exigir quitação integral**. O **mesmo vínculo** passa de pendente a ativo (mesmo id), conta/senha mantidas, avaliação/metas/versões preservadas; pacote e saldo conforme a contratação (uma vez); tipo *paciente*; nenhuma sessão é marcada como realizada.
- Motor: handler `h_payment_enrollment` em `payment.confirmed`/`payment.refunded` (fila com **retentativa** já existente) + `enrollment_reconcile` (financeiro/gestão, idempotente) para falha entre o recebimento e a ativação.
- **Estorno/chargeback:** vínculo ativo fica **sinalizado** (`review_flag`) para análise administrativa; **nada é apagado**; pagamento regularizado limpa o sinal. **Perda** da oportunidade: encerra só o vínculo **pendente** sem outra oportunidade e sem recebimento (revoga acesso clínico e convites); paciente ativo e conflito financeiro são preservados/sinalizados.
- 🔒 **Provedor de pagamento/checkout/webhook: NÃO existem no projeto.** O recebimento entra por `payment_record` (manual, só financeiro; já guarda `provider`, `external_ref`, `idempotency_key`). Nenhum gateway foi escolhido ou contratado. Quando houver provedor, o webhook deve chamar **a mesma função de registro** (validar assinatura, conferir venda/valor/moeda, idempotência) e esta regra continua valendo. **Por isso, autenticidade de webhook, eventos fora de ordem de um provedor e reconsulta ao provedor NÃO foram exercitados**: foi provada a idempotência e a independência de ordem no nível financeiro (SQL N18).

## 8. Primeiro acesso e Resend (auditoria no Dev)
**Fluxo existente (reaproveitado):** convite `invitations` + `person_portal_access` → Supabase Auth (tokens, senha, sessão) → **Send Email Hook** (`auth-email-hook`) → **Resend**. Sem autenticação caseira; senha nunca por e-mail.
**Auditado em 17/11 (somente nomes de secret, nunca valores):** `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET` ✅ presentes; hook habilitado → `/functions/v1/auth-email-hook` (v17); site_url `hp-group-hub.netlify.app`; confirmação de e-mail ligada (sem autoconfirm). 🔒 **`PUBLIC_SITE_URL` está AUSENTE no Dev**: o hook recusa o envio (`site_url_not_configured`) — **hoje, no Dev, nenhum e-mail do Auth (convite, primeiro acesso, recuperação) é entregue**. É uma URL pública (não é segredo): para o preview, `https://preview--hp-group-hub.netlify.app`, que também precisa estar na lista de redirecionamento do Auth.
**Novo (133):** `person_portal_access` virou núcleo + wrapper (a fisioterapeuta com vínculo convida **só e-mail já cadastrado da pessoa**); `portal_access_state` (e-mail **mascarado**, conta, convite aberto, último envio, primeiro acesso); `portal_invite_run/result` (só `service_role`) e a Edge Function **`patient-invite`** (autoriza no banco; conta existente → reutiliza identidade e **não** mexe na senha; sem e-mail → “Acesso pendente — cadastrar e-mail”; vínculo encerrado → não convida; reenvio limitado a 10 min; convite vencido gera novo). Link do e-mail → `/confirmar` → **definir senha** (`/redefinir-senha`) → login → `/paciente`.
**Envio aceito × entrega × primeiro acesso:** registramos *aceito pelo serviço de e-mail*; **entrega confirmada NÃO é rastreada** (exigiria o webhook do Resend); *primeiro acesso concluído* vem do convite aceito. Falha de e-mail **não desfaz** cadastro nem avaliação. **Nenhum convite em massa** e nenhum aos registros antigos.
🔒 **Envio real NÃO exercitado:** depende de `PUBLIC_SITE_URL` no Dev. O teste `N37-3` só envia se `N37_REAL_SEND_TO` (o único endereço de teste permitido) for informado.

## 9. Permissões do paciente pendente
Pode: entrar no próprio portal (após o primeiro acesso), completar dados autorizados, ver a apresentação liberada, objetivos, plano proposto e evidências. **Não** vê saldo/pacote como contratado (“—”), e exercícios/vídeos dependem da liberação profissional. Não há checkout no produto: a “proposta/checkout” aparece como orientação para falar com a equipe.

## 10. Testes: o que é real e o que é simulado
| Camada | Resultado | Natureza |
|---|---|---|
| SQL `N18` (vínculo, ativação por pagamento, estorno, perda, permissões) | 48 ✅ | **Real** (banco Dev) |
| SQL `N19` (apresentação, evidências, versões, prévia, entrada sem lead) | 62 ✅ | **Real** |
| SQL `N20` (convite, conta existente, vencido, mascaramento, service_role) | 22 ✅ | **Real** (sem e-mail) |
| E2E `N36` (7): lead→pendente→captura→evidência (proposta+aprovação)→prévia real→publicar→paciente→venda/pagamento→ativo; acesso | 7/7 ✅ | **Real** (telas + banco); recebimento via `payment_record` (manual) |
| E2E `N37` (3) | 2 ✅ + 1 condicionado | **Real** até o limite do e-mail; **envio real não executado** |
| Regressão SQL release | ver `docs/test-report.md` | Real |
Capturas em `docs/screenshots/jornada/`.

## 11. Pendências concretas
1. 🔒 **`PUBLIC_SITE_URL` no Dev** (+ URL de preview na lista de redirecionamento do Auth) para o e-mail do Auth funcionar; depois rodar `N37-3` com o endereço de teste.
2. 🔒 **Provedor de pagamento**: escolha/contratação (decisão sua) e o webhook; testes de assinatura/duplicado/fora de ordem/reconsulta só então.
3. 🟡 **Revisão jurídica**: textos de consentimento seguem em minuta; a apresentação e o uso de terceiros (ORS, e-mail) precisam constar na política.
4. 🟡 Entrega de e-mail não rastreada (webhook do Resend); busca automática por DOI não implementada; conteúdo clínico da biblioteca depende da revisão da gestão.
5. Produção: **nada foi levado** (migrations 131–133, função `patient-invite`, secrets).
