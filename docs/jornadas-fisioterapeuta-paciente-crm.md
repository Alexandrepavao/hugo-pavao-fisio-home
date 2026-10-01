# Auditoria das jornadas Fisioterapeuta, Paciente e CRM

> 2026-10-01 · `release/v1` · Dev apenas. Conferência feita **no código** (não em documentos) antes de implementar; depois, cada lacuna foi fechada e a jornada **executada de ponta a ponta** pelas telas e pelo servidor.
> Legenda: ✅ implementado e comprovado por teste · 🟡 parcial (o que falta está dito) · ❌ ausente · 🔒 depende de serviço externo (não comprovado).
> “Antes” = estado do código no commit `030753d`. Testes: SQL `supabase/tests/release/S*.sql` (transação desfeita, contra o Dev) e E2E `e2e/release/R*.spec.ts` (Playwright, Dev).

## 1. Fisioterapeuta

| # | Item | Antes | Agora | Evidência |
|---|---|---|---|---|
| 1.1 | Cadastro de **pessoa** e **profissional** | 🟡 só “nome + unidade”; criava o profissional sem pessoa no cadastro central | ✅ profissional nasce de uma pessoa **já cadastrada** (busca em Pessoas) ou cria a pessoa nova (tipo “equipe”); uma pessoa só vira um profissional | `professional_save` (068) · `ProfessionalsAdmin` · S15 · R15 |
| 1.2 | **Registro profissional** | ❌ coluna existia (`council_registration`) e nunca era preenchida/editada | ✅ campo na tela, validado (3–40 caracteres), editável, auditado | 068 · S15 · R15. *Limite:* é texto livre; não consulta o conselho (CREFITO) |
| 1.3 | **Unidades** | 🟡 uma unidade no cadastro, sem editar | ✅ várias unidades; retirar uma unidade é **recusado** se houver atendimento futuro nela | S15 · R15 |
| 1.4 | **Disponibilidade** | 🟡 só adicionar (sem editar, remover nem validar sobreposição) | ✅ adicionar, editar, remover; fim > início; **sem sobreposição** do mesmo profissional; validade opcional; só unidade onde ele atende; auditoria | `professional_availability_save/_remove` · S15 · R15 |
| 1.5 | **Convite** | 🟡 convite genérico por papel/unidade, sem ligar ao cadastro profissional | ✅ “Liberar acesso” gera convite “fisioterapeuta” ligado à **pessoa e ao profissional**; conta que já existe é ligada na hora; conta confirmada sem registro (sem papel) também (072) | `professional_grant_access` · S15 · R15. 🔒 o **envio** do e-mail (Resend) não é provado: o teste prova o **registro** do convite |
| 1.6 | **Criação de senha e login** | 🟡 telas existiam (`Primeiro acesso`, `Login`, `Redefinir senha`) | ✅ conta criada pelo convite → login **pela tela** → cai no painel; tela de nova senha valida tamanho/confirmação, troca a senha e invalida a antiga | R15 (login e troca de senha), 01 (login/rotas) · 🔒 o clique no link do e-mail é ação humana: o E2E cria a conta já confirmada no Auth do Dev (mesmo gatilho do convite) |
| 1.7 | **Recuperação de senha** | 🔒 tela e hook existem; entrega depende do Resend | 🔒 igual: link inválido/expirado tratado (01) e nova senha (R15) comprovados; **e-mail de recuperação real não provado** | 01 · R15 · `docs/release-v1.md` §7 |
| 1.8 | **Agenda própria** e agenda alheia **só com permissão** | ✅ já existia | ✅ confirmado: o fisioterapeuta novo vê só a própria agenda; a de outro profissional é negada no servidor | `my_agenda_professionals`, `professional_day` · R05 · R15 |
| 1.9 | **Resumo individual** (agendados, realizados, cancelamentos, faltas do paciente e do profissional, pacientes atendidos) | ❌ não existia | ✅ tela **Meu resumo** (`/admin/meu-resumo`) com período; números do banco; só os atendimentos dele; gestor/gestor de unidade veem o de profissionais da própria unidade | `my_professional_summary` (068, 071) · S15 (contagens, período, permissões) · R15 (tela = servidor). *Regra:* “Agendados” = todos os futuros (071); os demais seguem o período |
| 1.10 | **Repasses autorizados** | 🟡 regras de comissão e lançamentos existem (Financeiro › Comissões), sem visão do profissional | ✅ no **Meu resumo**: só autorizados e pagos, **com regra e dados reais**; sem regra → “Indisponível” (nada de zero inventado); pendentes e de outras pessoas não entram; só o próprio vê | S15 (autorizado 150, pago 90, pendente 70 fora) · R15 (estado “Indisponível”). *Limite:* a regra com beneficiário vem de Financeiro › Comissões (já existente); não há teste de tela com repasse positivo (só SQL) |
| 1.11 | **Google Calendar individual** | ✅ implementado (Dev) | ✅ botão “Conectar Google Calendar” no Meu dia para o fisioterapeuta novo; SQL S11/R10 | R10 · R15 · 🔒 a **autorização real** no Google exige conta de teste e não foi exercida nesta rodada |
| 1.12 | **Nenhum acesso clínico fora do vínculo** | ✅ já existia | ✅ reconfirmado: sem vínculo, `professional_journey`, `patient_goal_save` e leituras financeiras/vendas são negados | S07 · S15 · R15 |

## 2. Paciente

| # | Item | Antes | Agora | Evidência |
|---|---|---|---|---|
| 2.1 | Cadastro **vinculado ao paciente correto** | 🟡 convite por `person_id` existia (só gestor/adm. operacional); conta **já existente** nunca era ligada | ✅ `person_portal_access`: convite, ou vínculo imediato se a conta existe; **trava** — o e-mail da conta precisa ser um dos e-mails cadastrados da pessoa e nunca move uma conta já ligada a outra pessoa; conta confirmada sem papel é tratada (072) | 070/072 · S15 · R16 (convite A; conta existente B; cada um na pessoa certa) |
| 2.2 | Convite/primeiro acesso, senha, login, recuperação | 🟡 telas existiam | ✅ login pela tela cai em `/paciente`; ✅ senha (tela compartilhada com o fisioterapeuta, R15); 🔒 e-mail de convite e de recuperação reais **não provados** | R16 · R15 · 01 |
| 2.3 | Portal: próximos atendimentos | ✅ | ✅ | R16 · R03 |
| 2.4 | **Confirmação** e **cancelamento** conforme a política | ✅ (054/055) | ✅ confirmar ≠ presença ≠ consumo; cancelar com antecedência não desconta sessão e avisa **antes**; dentro do prazo do pacote desconta e avisa | R04 · R05 · R16 |
| 2.5 | Histórico e **sessões separadas** (contratadas, realizadas, consumidas por falta, por cancelamento tardio, devolvidas, ajustes, saldo) | 🟡 só “saldo de total” no pacote e contagens do plano | ✅ cartão do pacote com os 7 números **separados**, a partir do livro de sessões; histórico de atendimentos com a situação de cada um | `my_package_breakdown` (068) · S15 (10 + 1 − 2 − 1 − 1 + 1 = 8) · R16. *Limite:* o histórico mostra os **100 atendimentos mais recentes** |
| 2.6 | **Jornada, evolução e vídeos Bunny** conforme permissões | ✅ (058) | ✅ objetivos, plano, evolução (autoria/data), reavaliação; vídeo só para o paciente atribuído, identificador do Bunny nunca vai ao navegador | S07 · R09 · R16 · 🔒 **reprodução real no Bunny não provada** (segredo `BUNNY_EMBED_TOKEN_KEY` e biblioteca não cadastrados: a tela mostra “indisponível por configuração”) |
| 2.5b | **Plano definido pelo profissional** (nada de dez sessões) | ❌ `patient_plan_save` assumia 10 (configurável) quando vazio; portal e painel citavam “modelo de 10” | ✅ quantidade **obrigatória**, definida pelo fisioterapeuta com vínculo; paciente e comercial não definem; o portal diz que não existe número padrão; a configuração antiga vira só “sugestão” exibida ao profissional | 068 · S07/S15 · R16 |
| 2.7 | **Pedido de renovação conforme orientação do fisioterapeuta** | 🟡 qualquer paciente podia “renovar” | ✅ “Quero renovar” só aparece após reavaliação com continuidade/manutenção; o servidor também recusa; “falar com a equipe” segue livre; o pedido só avisa a equipe (tarefa) — **sem cobrança nem consumo** | 068/073 · S07 · R16 |
| 2.8 | **Isolamento entre pacientes** | ✅ (RLS) | ✅ outro paciente não vê (nem age sobre) atendimentos, pacote, livro, plano, objetivos, avaliações, reavaliações, renovações, mensagens, vídeos nem cadastro; não abre áreas de staff | S01 · S15 · R16 · R03 |
| 2.9 | **Celular** | 🟡 | ✅ portal a 390 px sem rolagem lateral | R16 (390×844) · capturas |

## 3. CRM

| # | Item | Antes | Agora | Evidência |
|---|---|---|---|---|
| 3.1 | **Importação CSV**: modelo, mapeamento, prévia, validação, erros por linha | ❌ só havia importação de **pessoas** (Pessoas), sem oportunidade, funil, origem, lista nem mapeamento de colunas | ✅ assistente em 4 passos em **Gestão de leads › Importar CSV**: modelo para baixar (só cabeçalho), arquivo com `,` ou `;` e acentos (BOM), mapeamento sugerido pelo cabeçalho e editável, prévia por linha (nova/existente/já importada/conflito/inválida) com o **motivo**, relatório CSV com a **linha física do arquivo** | 069 · `CrmImportDialog` · S16 · R17 |
| 3.2 | **Deduplicação no servidor**; reimportar não duplica | 🟡 existia para pessoas | ✅ pessoa reconhecida por e-mail/telefone (mesmo contato) ou nome parecido; oportunidade **aberta** do mesmo funil não é recriada; participação de lista idempotente. A tela não decide nada: o servidor revalida em cada gravação | S16 · R17 (reimportar o mesmo arquivo: 0 criadas, nada duplicado) |
| 3.3 | **Conflitos** com decisão explícita, sem sobrescrever | ❌ | ✅ mesma pessoa com dados diferentes, homônimo, contato em mais de uma pessoa e cadastro de outra unidade → **conflito**; ações: pular, usar a pessoa existente (só candidata visível), atualizar **só os campos escolhidos** (telefone/e-mail acrescentam contato; nome troca), ou criar nova pessoa. Sem decisão, a linha **não é gravada** | S16 (55) · R17 (nome intacto, telefone acrescentado, sem auditoria de nome) |
| 3.4 | **Origem, campanha, unidade, responsável, lista e etapa inicial** | ❌ | ✅ padrões do lote + coluna por linha (a coluna vale mais); responsável por e-mail e **só com papel comercial na unidade**; etapa só **aberta** do funil; lista precisa existir; valor em reais | S16 · R17. *Limites:* até 500 linhas e 1 MB por arquivo; origem/campanha de pessoa existente **não** são alteradas |
| 3.5 | Pessoas **vinculadas ao cadastro central** | ✅ | ✅ importação cria/usa `people` (tipo “lead”); a lista só referencia a pessoa | S16 · R18 (lista não duplica cadastro) |
| 3.6 | **Listas** | ✅ tela existia; 🟡 **brecha**: paciente, parceiro e fisioterapeuta criavam/liam/apagavam listas pela API | ✅ criar, abrir, adicionar pessoa pelo cadastro central, remover, excluir; **RLS restrita aos papéis do CRM** (074) | S16 · R18 |
| 3.7 | **Oportunidades**, histórico, **tarefas**, drag and drop | ✅ | ✅ abrir pelo funil, registrar contato (atualiza “último contato”), criar tarefa; Tarefas lista e conclui; arrastar no Kanban não duplica | R18 · R06 · R01 |
| 3.8 | **Metas** | ✅ (SQL) | ✅ gestor define a meta; comercial vê o progresso igual ao servidor; comercial não abre “Time” nem grava meta (RLS) | R18 · SQL 023 |
| 3.9 | **Detalhamentos dos KPIs** | ✅ | ✅ cartões abrem os registros; reconciliam com o número | R07 · S05 |
| 3.10 | **Tempo por etapa, paradas, conversão entre etapas e geral, ganhos/perdas, ciclo, desempenho por origem e responsável** | ✅ calculados (056), conferidos só contra fórmulas | ✅ conferidos por **recálculo independente** sobre massa controlada, com valores calculados à mão (abertas 4, paradas 2, tempo médio por etapa, 66,7 %, 50,0 %, 16,7 % geral, ciclo 20 d, motivo de perda 100 %, origem e responsável) | S17 (22) · S05 · R07 |

## 4. Defeitos reais encontrados e corrigidos nesta rodada
1. **Segurança — listas do CRM abertas** a paciente, parceiro e fisioterapeuta (política só checava a organização) → migration **074**, testes em S16 e R18.
2. **Resumo do profissional** nunca mostrava consultas futuras (contava só dentro do período, que termina hoje) → **071**.
3. **Convite nunca processado** para conta já confirmada e sem registro em `user_accounts` (o gatilho só roda na criação/confirmação) → **072**.
4. **“Última decisão” da reavaliação não determinística** quando duas decisões tinham o mesmo `now()` (o S07 passava por sorte) → **073** (`clock_timestamp()`).
5. **“10 sessões por padrão”** silencioso no plano, no portal e no painel → removido (**068**).
6. Chaves React duplicadas na busca global (`CommandMenu`) — corrigido na rodada anterior (registrado aqui por ter aparecido na regressão).

## 5. O que NÃO foi provado (dependências externas e limites)
- **Entrega de e-mail** (convite, primeiro acesso, recuperação): depende de Resend, domínio verificado e do hook do Supabase Auth em produção. Os testes provam o **registro** do convite, a **criação da conta** (já confirmada, no Auth do Dev) e a **tela de nova senha**; não provam que o e-mail chegou.
- **Vídeos Bunny**: reprodução real não testada (segredo e biblioteca não cadastrados); só a autorização, a revogação, o isolamento e a mensagem honesta.
- **Google Calendar**: autorização OAuth real não exercitada nesta rodada.
- **Repasses**: caminho positivo só em SQL; a tela foi provada no estado “indisponível”.
- Produção, DNS e backup/PITR: fora do escopo (somente Dev).
- Limites de produto: histórico do portal = 100 atendimentos mais recentes; importação = 500 linhas/1 MB; registro profissional é texto livre.
