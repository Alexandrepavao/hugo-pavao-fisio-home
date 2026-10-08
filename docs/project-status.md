# HP Group Hub — Status do Projeto

## ESCOPO AMPLIADO AUTORIZADO (2026-09-30) — lista de acompanhamento (preservar entre sessões)

> **Autorização do usuário**: executar no **Dev**, em `release/v1`, preservando o que funciona, conferindo o estado antes de alterar. **Sem merge, sem publicação em produção, sem DNS.** Pode criar migrations no Dev (convenções do projeto). Testar cálculos, permissões e jornadas reais de cada etapa. Atualizar o PR #3 (rascunho) e o preview do `hp-group-hub`. **Não pedir nova aprovação deste escopo.** Se uma integração exigir credencial/decisão não inferível: explicar o bloqueio específico e seguir com o resto. **Não declarar tudo concluído enquanto houver item pendente.** Ordem: indicadores → financeiro → jornada do paciente → calendários.

**Regras transversais**: usar dados reais; documentar fórmula, período e denominador de cada indicador (`docs/indicadores.md`); diferenciar respostas, pessoas e oportunidades; clique no WhatsApp ≠ mensagem enviada; se faltar histórico, começar a registrar e informar a limitação (sem inventar retroativo); credenciais/tokens só no servidor; acesso administrativo não libera informação de saúde.

**1. Indicadores e gráficos** — filtros compactos, cartões clicáveis que abrem os registros.
- *Administrativo*: totais PF/PJ, novos por período, ativos/inativos, incompletos + campos faltantes, distribuição por vínculo e unidade.
- *CRM*: tempo na etapa atual, tempo médio e mediano por etapa, oportunidades paradas, conversão entre etapas, conversão geral, ciclo de venda, motivos de perda, desempenho por responsável e origem.
- *Captação*: entradas por formulário/quiz, conclusão e abandono dos quizzes, origem/campanha, evolução temporal, conversão em oportunidade, agendamento e venda.

**2. Financeiro por linha de negócio** (mesma organização; não são unidades/empresas/bancos): seletor Geral / HP Fisioterapia / HP Academy em vendas, recebimentos, contas a receber, despesas, comissões, relatórios e DRE; venda com itens de ambas as linhas; parcial/desconto/estorno reconciliam; despesa compartilhada com rateio explícito ou "compartilhada/não alocada"; histórico sem classificação = "Não classificado"; Geral reconcilia com as duas linhas + compartilhados + não classificados, sem duplicar; preservar caixa × competência × previsão.

**3. Área do paciente / jornada de acompanhamento**: objetivos com o fisioterapeuta; plano de sessões, próximas consultas e histórico; realizadas, faltas e saldo separados; gráficos de evolução com avaliações reais (data e autoria); vídeos Bunny atribuídos pelo profissional; reavaliação e indicação de continuidade/manutenção/alta; solicitar renovação/contato sem cobrança automática; 10 sessões como modelo inicial configurável; sem prometer resultado nem tratar consumo de sessão como prova de melhora; acesso individual e restrições clínicas.

**4. Meu dia e calendários**: visões diária/semanal/mensal; agenda própria por padrão; seleção/visão conjunta só com autorização e por unidade; nenhuma confirmação em nome de outro profissional; tarefas pessoais privadas; cada usuário conecta o próprio Google Calendar e usa a agenda no Calendário da Apple/iPhone (distinguir assinatura somente leitura de sincronização bidirecional; `.ics` avulso não basta); tratar criação/alteração/cancelamento/fuso/desconexão/duplicidade; compromisso externo nunca gera atendimento, cobrança ou consumo.

### Tabela única de acompanhamento (atualizada a cada entrega)
Legenda: ✅ feito · 🟡 parcial · ❌ não · 🔒 bloqueado (motivo na linha) · — não se aplica.

| # | Item | Implementado | Testado | Pendente / Bloqueado |
|---|---|---|---|---|
| 0 | Escopo registrado neste documento | ✅ | — | — |
| 1a | Indicadores Administrativo (+ detalhes clicáveis) | ✅ código + migration 056 **aplicada no Dev** | ✅ SQL `S05` (82 OK) · ✅ E2E `R07` (cartões = servidor; detalhe reconcilia) | — |
| 1b | Indicadores CRM (tempo/etapa, conversão, ciclo, perdas, responsável/origem) | ✅ código + migration 056 **aplicada no Dev** | ✅ SQL `S05` (fórmulas, permissões, detalhes que reconciliam com os cartões) · ✅ E2E `R07` | — |
| 1c | Indicadores Captação (quiz/formulário, conversão até venda) | ✅ código + migration 056 **aplicada no Dev** | ✅ SQL `S05` (respostas ≠ pessoas ≠ oportunidades; clique no WhatsApp ≠ mensagem) · ✅ E2E `R07` | Limitação: formulário não registra início/abandono (só envio) |
| 1d | `docs/indicadores.md` (fórmula, período, denominador) | ✅ | — | revisar depois dos testes |
| 1e | **Administrativo — central de pendências administrativas** (6 cartões prioritários, indicadores complementares, gráficos, lista de prioridades, fluxos de pendências/documentos/contratos/contatos/requisitos) | ✅ código + migration 062 **aplicada no Dev** (`docs/indicadores-administrativo.md`) | ✅ SQL `S10` (127 OK) · ✅ E2E `R11` desktop e celular · suíte SQL S01–S10 = 565 OK · regressão R02/R07/N10/N11 verde | depende de **você configurar** quais documentos/contratos cada tipo/vínculo exige (hoje só vêm requisitos de dado); verificação de contato é manual; sem histórico retroativo; upload de arquivo de documento fica para depois |
| 2a | Linha de negócio no modelo (Fisioterapia / Academy / Não classificado) | ✅ código + migration 057 **aplicada no Dev** | ✅ SQL `S06` (44 OK) | classificar os produtos em Configurações › Operação (nada é adivinhado) |
| 2b | Seletor Geral/Fisioterapia/Academy em vendas, recebíveis, despesas, comissões, relatórios, DRE | ✅ Visão geral, DRE, Vendas, Recebíveis, Comissões, Contas a pagar, Produtos (057) · Recorrência (MRR/ARR), Relatórios de eficiência e Conciliação (060) — **aplicadas no Dev** | ✅ SQL `S06` (44 OK) e `S09` (61 OK); todas as RPCs respondem 200 para o gestor · ✅ E2E `R08` (Visão geral, DRE, Recorrência, Relatórios, Conciliação) | —. Conciliação: extrato original preservado; linha = camada separada |
| 2c | Venda com itens das duas linhas; parcial/desconto/estorno reconciliam | ✅ divisão proporcional exata (venda mista, desconto, parcial, estorno) | ✅ SQL `S06` (valores calculados à mão) | — |
| 2d | Despesas compartilhadas com rateio / não alocadas; Geral reconcilia sem duplicar | ✅ rateio explícito + compartilhado/não alocado + quadro de conferência | ✅ SQL `S06` | — |
| 2e | Recorrência, eficiência e conciliação por linha (migration 060) | ✅ código + migration 060 **aplicada no Dev** (`mrr_by_line`, `mrr_history_by_line`, `efficiency_by_line`, `bank_by_line`, `bank_line_set_allocation`, `bank_line_shares`) + telas | ✅ SQL `S09` (61 OK: MRR, eficiência, conciliação, extrato intacto, auditoria, permissões) · ✅ E2E `R08` | CAC/LTV seguem indisponíveis e não são divididos por linha. Achado e corrigido: `efficiency_report` (migration 020) falhava sempre (função de janela dentro de agregado) — corrigido na 060 |
| 3a | Objetivos, plano de sessões, próximas consultas, histórico, saldo separado | ✅ código + migration 058 **aplicada no Dev** | ✅ SQL `S07` (60 OK) · ✅ E2E `R09` (portal e painel do fisioterapeuta) | — |
| 3b | Avaliações de evolução (registro com data/autoria) e gráficos | ✅ avaliações imutáveis com data e autoria + gráfico (dor/funcionalidade/bem-estar, 0–10) | ✅ SQL `S07` | Sem escalas clínicas validadas específicas |
| 3c | Vídeos Bunny atribuídos pelo profissional | ✅ atribuição, revogação, validade, log de acesso; função `bunny-playback` **publicada no Dev**; UI 'indisponível por configuração' | 🟡 SQL `S07` (autorização, log, revogação, isolamento) e função responde 503 `bunny_not_configured` sem chave — **reprodução real NÃO testada** | 🔒 **precisa de você**: cadastrar `BUNNY_EMBED_TOKEN_KEY` nos Secrets do Supabase e o ID da biblioteca em Configurações › Operação; configurar a biblioteca no Bunny (`docs/jornada-do-paciente.md`). Pendente de configuração e de teste real |
| 3d | Reavaliação e indicação continuidade/manutenção/alta; solicitar renovação/contato | ✅ reavaliação (continuidade/manutenção/alta, nota clínica restrita) + pedido de renovação/contato sem cobrança + fila administrativa | ✅ SQL `S07` · ✅ E2E `R09` | — |
| 4a | Meu dia: visões diária/semanal/mensal; agenda conjunta por autorização | ✅ visões Dia/Semana/Mês, agenda própria por padrão, outras agendas só por permissão/unidade, sem confirmar por outro (migration 059 **aplicada no Dev**) | ✅ SQL `S08` (39 OK) · ✅ E2E `R10` (Dia/Semana/Mês, navegação) | — |
| 4b | Assinatura de calendário (Apple/iPhone, Google "por URL"): somente leitura | ➖ **aposentada por decisão**: assinatura .ics/Apple/iPhone removida da interface; função `calendar-feed` despublicada e código removido; tabelas/funções da 059 ficam como histórico | — (o teste real do .ics feito antes vale como histórico) | — |
| 4c | Google Calendar do próprio usuário (sincronização) | ✅ Google Calendar é a única integração: credenciais, chave de criptografia, URL de retorno e Vault configurados no Dev; sincronização **automática** (gatilho + job de 5 min); tela com status/desconectar | ✅ planejador (22) · SQL `S11` (19) · função publicada (`state` de uso único, escopos, Google aceita cliente/callback) · E2E `R10` | 🔒 **falta a sua autorização no Google** (escolher a conta e conceder as permissões): só depois disso o evento aparece de fato no Google — pendente de teste real |
| 5 | PR #3 e preview `hp-group-hub` atualizados | ✅ preview `release-v1` publicado como **rascunho** (deploy `6abd7eb3784e286f70c75e93`, commit `e45716da5466`, `ready`, não publicado na URL principal) · PR #3 segue em rascunho | ✅ mesmo bundle servido localmente: 20 E2E (R02, R07, R11) passaram · `version.json` confere (perfil v1, backend Dev) | 🔒 URL publicada exige login da equipe Netlify (401 sem sessão): telas não abertas por HTTP nesse endereço |

---

## Sessão mais recente (2026-10-08, 23ª rodada) — onboarding de fisioterapeuta e paciente, Primeiro acesso só para cadastrados (branch `feature/onboarding`)

> Pedido do usuário. Decisões dele: fisioterapeuta **só por link único** gerado pelo gestor; paciente por **rota aberta** com acesso automático. **Ainda não está em produção** (migration 086 + merge + deploy dependem de autorização). Detalhes em [`docs/onboarding.md`](onboarding.md).
- **Migration 086:** `onboarding_links` (token só como hash, uso único), `onboarding_submissions`, `professional_profiles`, `person_bank_info`, `person_intake` (RLS: só a própria pessoa e gestor/administrativo; sem acesso anônimo), `people.rg`; funções `onboarding_link_create/revoke` (gestor), `onboarding_link_info`, `onboarding_submit_physio`, `onboarding_submit_patient` e `first_access_email_status` (públicas, com limite por IP e isca anti-robô).
- **Rotas:** `/onboarding-fisio?convite=…` (5 etapas: dados, contato/endereço com busca por CEP, atuação profissional, PIX, acesso) e `/onboarding-paciente` (4 etapas, com contato de emergência e saúde só com consentimento). PF × PJ pelos dados (CNPJ válido → empresa + representante). O fisioterapeuta nasce profissional ativo na unidade do convite.
- **Segurança:** e-mail que já existe no cadastro NÃO é alterado no envio do paciente; os dados ficam retidos e só preenchem campos vazios depois que o dono do e-mail confirma o acesso; CPF já usado por outra pessoa nunca vira vínculo (cadastro novo pendente, sem CPF).
- **Primeiro acesso:** agora confere o e-mail antes de criar a senha (`not_found` → mensagem “Este e-mail não está cadastrado no sistema…”, `registered_no_access`, `has_account`, `invited`).
- **Tutorial** `/boas-vindas`: por perfil, abre no primeiro login (exceto gestão) e fica em “Tutorial do sistema” no menu. **Gestão:** link único em Operação › Agenda › Profissionais; dados do onboarding (RG, perfil, PIX, emergência, motivo) na ficha da pessoa (Planilha administrativa).
- **Verificação:** SQL `S25` = 91/91 e suíte SQL completa 1.219/0 falha; E2E `R29` (fisioterapeuta, PJ, Primeiro acesso, tutorial) e `R30` (paciente) = 11/11, e `R28` = 4/4; typecheck, lint dos arquivos novos e build ok; formulário conferido no celular (390 px, sem rolagem horizontal). Os testes interceptam só a criação da senha (nenhum e-mail real) e simulam a confirmação no banco de teste.
- **Limites:** a confirmação real por e-mail depende do Resend/hook de cada ambiente (em produção está configurado e já foi usado); o tutorial é de leitura, não um tour guiado na tela.

## Sessão anterior (2026-10-08, 22ª rodada) — o nome mostrado é o nome do cadastro de pessoa (branch `feature/nome-do-cadastro`)

> Pedido do usuário: “Nome no cabeçalho sempre será o Nome do contato que se cadastrar”. **Ainda não está em produção** (migration 085 + merge + deploy dependem de autorização).
- **Migration 085:** `user_accounts.display_name` de contas LIGADAS a uma pessoa passa a ser sempre derivado do cadastro: nome de preferência (`people.preferred_name`) e, em branco, o nome completo (`people.full_name`). Gatilhos: ao criar/ligar a conta, ao mudar o cadastro (a conta acompanha na hora) e contra edição direta (gestor recebe “o nome deste usuário vem do cadastro de pessoa”). Contas sem pessoa mantêm o nome de exibição próprio (ou o prefixo do e-mail). Como o campo alimenta cabeçalho, saudação, responsáveis, históricos e relatórios, o nome do cadastro aparece em todos eles. Contas já ligadas são ajustadas na própria migration (em produção: Hugo Pavão e Jan Darioush Peres de Freitas).
- **Configurações da conta:** com cadastro ligado, mostra o nome completo (só leitura) e o campo “Como quer ser chamado(a)” grava a preferência no cadastro (em branco = nome completo); os dados pessoais ficam com telefone, cidade e UF. Sem cadastro, continua o “Nome de exibição”.
- **Limite:** o formulário de “Primeiro acesso” não pede nome; o nome vem do cadastro de pessoa ligado ao convite. Conta sem pessoa (ex.: gestor criado pelo bootstrap) mostra o prefixo do e-mail até alguém ligar o cadastro.
- **Verificação:** SQL `S24` = 18/18 e `S23` = 15/15; suíte SQL completa 1.128/0 falha; E2E `R28` = 4/4 (inclui conta ligada a um cadastro temporário, desfeito no fim); typecheck, lint e build ok.

## Sessão anterior (2026-10-08, 21ª rodada) — Configurações da conta (mesclada: PR #5)

> Pedido do usuário (já logado como gestor em produção): menu de configurações no canto superior e na barra lateral para editar nome e informações da conta. **Ainda não está na `main` nem em produção** (precisa de autorização: merge, migration 084 e deploy).
- **Migration 084** (`my_account_update`): qualquer usuário da equipe altera o PRÓPRIO nome de exibição (antes só gestor, pela política `accounts_update`); só essa coluna e só a própria linha; validações (2–80 caracteres, sem controle) e auditoria com valor antigo/novo. Aplicada **só no Dev**; produção não tem a função.
- **Tela `/admin/conta`** ("Configurações"): Perfil (nome de exibição; e-mail só leitura), Dados pessoais (preferência de nome, telefone, cidade/UF — só se a conta estiver ligada a um cadastro de pessoa; senão aparece o aviso), Acesso e papéis (leitura), Segurança (trocar senha, mínimo de 10; sair de todos os aparelhos) e, para administradores, atalho para as configurações do sistema.
- **Entradas:** menu do usuário no cabeçalho (“Configurações da conta” e, para administradores, “Configurações do sistema”), rodapé da barra lateral de TODOS os aplicativos (“Configurações”) e a busca Ctrl+K. O cabeçalho e a saudação passaram a usar o nome de exibição (antes mostravam o prefixo do e-mail, ex.: “contato”).
- **Fora desta versão:** trocar o e-mail de acesso (o hook de e-mail só entrega para o endereço atual; o fluxo seguro de troca manda confirmação ao e-mail antigo e ao novo e o hook não cobre os dois).
- **Verificação:** SQL `S23` = 15/15 e suíte SQL completa 1.110/0 falha; E2E novo `R28` = 3/3 (renomear gestor e fisioterapeuta, atalhos, validações de senha sem trocar a senha de QA); `01` = 5/5; typecheck, lint e build ok. Vitest: 2 falhas antigas e sem relação (`release.novo.test.ts` espera `crm_scheduled_messages` desligado; `google-sync-plan.test.mjs` é script com `process.exit`). O restante da suíte E2E depende de dados de base do Dev que a limpeza de 07/10 apagou.

## Sessão anterior (2026-10-07, 20ª rodada) — v1 na `main` e na produção (DNS fora)

> Autorização explícita do usuário em chat: backup, migrations em produção, merge na `main` e deploy de produção. **DNS não foi tocado** (`hpfisioterapia.com.br` continua no GitHub Pages, site antigo).
- **Backup antes de tudo:** produção tinha só 66 linhas de seed, 0 usuários, 0 arquivos (registro em `D:\Claude\backups-hp-group\2026-10-07-producao-core\LEIA-ME.txt`, fora do Git). Tag de retorno do código: `pre-v1-main-64add39`. Backup gerenciado do Supabase: lista vazia e PITR desligado → **ativar no painel antes de entrar dado real**.
- **Migrations em produção:** as 42 pendentes (038–047, 052–083) aplicadas uma a uma pelo endpoint de migrations (histórico registrado); o schema ficou igual ao do Dev, salvo o módulo Contábil (`acc_*`, só em `feature/lead-quizzes`) e 5 funções que no Dev perderam variáveis não usadas/comentários (mesma lógica; `audit_row`, `seed_default_pipelines`, `dashboard_metrics`, `get_public_page`, `submit_public_form`).
- **Merge:** PR #3 saiu do rascunho e foi mesclado (merge commit `6b48f58`, histórico por tema preservado).
- **Deploy de produção:** site Netlify `hp-group-hub-producao`, build feito a partir da `main` (numa branch `release/v1` o `netlify.toml` aplica o contexto de branch `preview` e a trava do build recusa — por isso o build de produção sai sempre da `main`). `version.json`: commit `6b48f58951e6`, perfil `v1`, ambiente `production`, backend produção (`wfqkjrpqkaarpavjheoj`); o pacote não cita o Dev. Variáveis do contexto production: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (pública), `VITE_APP_ENV=production`, `VITE_RELEASE_PROFILE=v1`. Endereço de teste: https://hp-group-hub-producao.netlify.app.
- **`leafy-cascaron-325147`:** site Netlify de outra conta, ligado ao repositório pelo app do GitHub; decisão do usuário: pode ser sobrescrito. Não foi tocado por mim.
- **Ainda manual / pendente:** (1) Auth da produção: `site_url` ainda `http://localhost:3000` e sem URLs permitidas (a alteração via API foi bloqueada; fazer em Authentication → URL Configuration: Site URL `https://hp-group-hub-producao.netlify.app` e redirects dele + do domínio); (2) e-mail: sem SMTP e sem o hook `auth-email-hook` atualizado (prod tem a v2, o Dev a v12), sem `RESEND_API_KEY`/`EMAIL_FROM` no Netlify; (3) edge functions `bunny-playback` e `google-calendar` não existem na produção (precisam de chaves); (4) backup/PITR; (5) gestores: contato@hpfisioterapia.com.br e jan.darioush@yahoo.com.br viram gestores no primeiro acesso verificado; (6) **DNS**: só com nova autorização.

## Sessão anterior (2026-10-07, 19ª rodada) — suíte completa verde e preview publicado

> `release/v1`, PR #3 em rascunho; Dev apenas. Token do Supabase **trocado** (o comprometido foi revogado) e Netlify autenticado por token de usuário.
- **Suíte completa contra o Dev (token novo, 1 worker):** SQL `S01–S22` = **1.095 OK, 0 falha** (o `S16` foi ajustado: lista de teste agora tem tipo); E2E `@release` = **190/190** (185 na rodada inteira + os 5 do `R14` que ela não chegou a rodar, aprovados em rodada própria). A única falha da rodada inteira era interferência entre testes (o `R08` deixa uma linha de extrato com o mesmo identificador da rodada e o `R14` esperava só a dele): `R14` passou a buscar só as próprias linhas; `R08`+`R14` na mesma rodada = 20/20.
- **Preview de rascunho publicado:** deploy `6ac62ffba311316afeef9cc2` (branch-deploy `release-v1`, sem data de publicação = não entrou na URL principal), commit `f5a0d07ed6e5`, `version.json`: perfil `v1`, ambiente `preview`, backend Dev (`fsvtzowcwhvwtluwrhnb`); o pacote só referencia o Dev. URL protegida por login do time Netlify.
- **Falta para a `main`:** ver o passo a passo combinado (Fase 3 produção: backup/PITR, e-mail, variáveis do site de produção, 42 migrations; depois o merge do PR #3 com a sua autorização explícita).

## Sessão anterior (2026-10-06, 18ª rodada) — CRM com tipos de lead, listas com tipo, empresas B2B e várias oportunidades por lead

> `release/v1`, PR #3 em rascunho; Dev apenas. Regras, telas e limites: [`docs/crm-tipos-de-lead.md`](crm-tipos-de-lead.md). Migration **083** aplicada no Dev.
- **Quatro tipos de lead** (Paciente · Fisioterapeuta-Equipe · Fisioterapeuta-HP Academy · Empresa-B2B) = tipo do funil, visíveis no Pipeline (cartões com contagem), no Painel comercial, na Gestão de leads (coluna e filtro), nas Listas, na importação e na ficha.
- **Um lead, várias oportunidades:** a ficha lista as oportunidades da pessoa em todos os funis, cada uma com a própria etapa (avançar uma não move a outra), “Abrir” a de outro funil e “Adicionar a outro funil”. O quiz de parceria com interesse no programa de clínica própria também abre a oportunidade da HP Academy.
- **Listas com tipo obrigatório** (filtro, selo, classificação das antigas); a importação CSV segue o tipo da lista (funil travado); lista de empresas guarda empresas.
- **Empresas (B2B):** menu Cadastro › Empresas, planilha administrativa com abas Pessoas físicas × Empresas (PJ), “Nova empresa” sem duplicar (CNPJ/nome/contato) e oportunidade B2B ligada à empresa (uma aberta por empresa e funil).
- **Testes:** SQL `S22` (39/39, direto no Dev), E2E `R27` (6/6), `R25` (5/5, com a oportunidade da Academy), `R24`, `R07`, `R02`, `R12`, `R13` (menu) e o filtro da planilha (`R14`) verdes. `R17`/`R18` ajustados e **não reexecutados** (token de gestão do Dev sem leitura de banco).
- **Limpeza de leads (06/10):** os leads só-lead foram apagados do Dev (164 pessoas/oportunidades, 121 leads de quiz, 40 captações) com filtro que preservou quem já tem venda, atendimento, pacote, matrícula, login, profissional ou parceria.

## Sessão anterior (2026-10-06, 17ª rodada) — botões do site → quiz, quiz novo e perguntas do programa de clínica própria

> `release/v1`, PR #3 em rascunho; Dev apenas. Detalhes, regras e limites: [`docs/captacao-site-quiz.md`](captacao-site-quiz.md).
- **Botões do site sem WhatsApp direto:** cabeçalho, Hero, Cobertura, botão flutuante, rodapé, “Quero fazer parte” (Trabalhe Conosco e WorkWithUs) agora levam ao quiz da jornada (paciente → `/avaliacao`; fisioterapeuta → `/seja-parceiro`), cuja 1ª etapa captura **nome completo**, e-mail e WhatsApp; o WhatsApp só aparece no fim.
- **Interface do quiz refeita** (duas colunas, Voltar, progresso, cartões, escala 0–10, tela final); textos das perguntas existentes preservados.
- **Quiz do fisioterapeuta:** duas perguntas finais sobre um futuro programa de ensino para ter a própria clínica (interesse; prazo só com interesse). O texto diz que o programa ainda não existe e que não há garantia de faturamento.
- **Migrations 081 e 082** (aplicadas no Dev): validação/conclusão das perguntas novas e limite de `step_reached` (1..20; o E2E achou que o limite 10 recusava a resposta).
- **Testes:** E2E novo `R25` (5/5) + `08` e `09` (5/5) e `R03` (2/2) com os rótulos atualizados; `tsc` e `eslint` limpos. `R01` teve só os rótulos trocados e **não foi reexecutado** (precisa do token de gestão do Dev, que hoje não tem leitura de banco).
- **Mapa do site refeito** (seção “Cobertura nacional”): o contorno desenhado à mão foi trocado pela geometria real dos 26 estados + DF (`@svg-maps/brazil`, mesma do painel), com as 16 cidades posicionadas por latitude/longitude (conferidas por computação dentro do estado certo), destaque ao escolher a cidade e lista de cidades; E2E `R26` (desktop e celular).
- **Limpeza de leads no Dev (06/10):** apagados os leads que eram só lead (164 pessoas, 164 oportunidades, 121 leads de quiz, 40 captações de formulário), em uma transação, com filtro que preservou quem já tem venda, atendimento, pacote, matrícula, login, profissional ou parceria (30 pessoas, 30 leads de quiz e as vendas/pagamentos/pacotes seguem). Sem registros órfãos.
- **Pendente de decisão:** a tag “Potencial Academy” segue valendo para todo lead de parceria (não alterada); usar a resposta nova para refiná-la é decisão de produto.

## Sessão anterior (2026-10-02, 16ª rodada) — reconciliação entre sessões, revalidação de Repasses e doc de integração ponta a ponta

> `release/v1`, PR #3 em rascunho; Dev apenas. Esta rodada **não é trabalho novo de produto**: a sessão anterior (17/01–02/10) bateu o limite de uso no meio de uma sequência já comitada (Repasses, idempotência de venda/oportunidade, Academy, Parceiros) sem dar push nem fechar a documentação. Esta sessão leu tudo sem confiar na memória (`CLAUDE.md`, `docs/transferencia-claude.md`, status, release, docs de Repasses/Conversas), conferiu o estado real do git/Dev contra o que os documentos afirmavam, e **corrigiu duas afirmações desatualizadas**: Repasses já estava comitado (não "pendente") e as migrations 075/076 já estavam no repositório (não "ausentes").
- **Revalidado ao vivo contra o Dev (não só por documento):** SQL completo `test:sql:release` S01–S21 = **1056/1056, 0 falha**; `S18_repasses` isolado = 30/30; E2E `R20-repasses` isolado = 8/8 (caso de valor positivo pela interface do profissional **e** do Financeiro, por pedido explícito desta rodada).
- **Lacuna fechada:** `docs/integracao-ponta-a-ponta.md` (referenciado três vezes em `docs/release-v1.md` desde a rodada anterior, mas nunca criado) — matriz das 9 jornadas ponta a ponta do escopo autorizado, cada uma classificada com evidência real; duas seguem **bloqueadas por configuração externa** (vídeo Bunny — falta a chave e o ID da biblioteca; Google Calendar — falta a autorização real na conta do Google), nenhuma declarada concluída por mock.
- **Preservado do working tree da sessão anterior:** correção real em `e2e/release/R04-confirmacao-presenca-consumo.spec.ts` (o atendimento futuro passou a aparecer em duas listas do portal do paciente — "Meus atendimentos" e "Minha jornada" — e o seletor do teste ficou ambíguo; corrigido sem enfraquecer nenhuma verificação) + 7 capturas de tela de Conversas.
- **Pendência de segurança levada ao usuário:** token do Supabase colado no chat em 30/09 (registrado em `docs/transferencia-claude.md`) continua comprometido; revogação em `supabase.com/dashboard/account/tokens` depende do usuário.

## Sessão anterior (2026-10-01, 15ª rodada) — layout da central de Conversas e rótulos honestos

> `release/v1`, PR #3 em rascunho; Dev apenas. Escopo desta rodada: **somente o layout de Conversas** (referência: *Chats* do shadcn Admin). Provedor de WhatsApp, envio automático e recebimento ficam para depois (nada foi configurado nem contratado). **Repasses** (075/076, `S18`, `Commissions.tsx`, `MySummary.tsx`, `S15`) segue **sem commit e fora desta entrega**.
- **Layout:** lista (avatar, nome, última interação, horário, busca) · conversa ocupando a maior parte da tela (cabeçalho com avatar e nome, separadores de data, horários nos balões, compositor fixo) · **ficha do lead recolhida por padrão**, abre ao clicar no nome; celular: uma coluna por vez com botão de voltar. Sem mensagens fictícias e sem botões sem função.
- **Rótulos (nunca “enviada” para a abertura do WhatsApp):** “**Abrir WhatsApp**” só abre o `wa.me` e registra a abertura; “**Lembrete de envio**” (antes “agendar mensagem”; menu “Lembretes de envio”, estados Vencido/Agendado/WhatsApp aberto/Cancelado); prévia da lista “WhatsApp aberto: …”.
- **Testes (Dev, 01/10):** E2E `R19` (9) reescrito para o novo layout/rótulos + regressão `R02` (13), `R12` (9), `R13` e `R18` (7) verdes; `tsc` e `eslint` limpos. `R13`: o teste lia os links da sidebar do CRM antes de ela renderizar (instantâneo da falha mostra a sidebar completa; lista vazia no momento da leitura) — incluí a espera pela sidebar; **não** foi enfraquecida nenhuma verificação. Capturas desktop e celular em `docs/screenshots/conversas/`.
- **Publicação:** preview do `hp-group-hub` (rascunho) a partir de **worktree isolado** do commit desta rodada, sem Repasses (ver o fechamento da rodada no chat/`transferencia`). A migration 077 é a única dependência de banco e já está no Dev; as 075/076 de Repasses também já estão **aplicadas no Dev** (sem commit no repositório) e **não** são necessárias a Conversas.

## Sessão anterior (2026-10-01, 14ª rodada) — Central de Conversas (CRM)

> `release/v1`, PR #3 em rascunho; Dev apenas; produção, DNS e merge intocados. Detalhes, limites e fórmulas: [`docs/conversas.md`](conversas.md). O trabalho de **Repasses** (migrations 075/076, `S18`, `Commissions.tsx`, `MySummary.tsx`, `S15`) ficou **fora** dos commits desta rodada e permanece sem commit.
- **Ponto de partida conferido:** a sessão anterior caiu no item Repasses; a central de Conversas ainda era a tabela simples de 24/09 (abre o WhatsApp e registra o contato), sem tabelas de mensagem/atendente/ficha. Layout de referência: padrão de 3 colunas do *Chats* do shadcn Admin (indicado pelo usuário), recriado com componentes próprios do HP.
- **Migration 077 (aplicada no Dev):** `crm_conversations`, `crm_conversation_participants`, `crm_conversation_reads`, `crm_messages` (imutáveis), `crm_scheduled_messages`, `opportunities.profile`; funções de abrir/postar/entrar/sair/adicionar/transferir/estado/lida, caixa de entrada (`crm_conversations_inbox`, invoker/RLS), agendar/remarcar/cancelar/registrar envio e `crm_lead_profile_save`.
- **Tela:** lista · mensagens · ficha do lead (recolhível; gaveta abaixo de 1280 px; uma coluna por vez no celular); **ficha por nicho** (Fisioterapia, Academy, Parceiros, Empresas); **multiatendimento** (responsável + colaboradores, fila, entrar/sair/transferir, não lida por usuário); **Mensagens agendadas** agora está **ligada na v1** (lembrete + registro; *Disparo* continua fora).
- **Honestidade de envio:** sem provedor, “enviar” abre o `wa.me` e registra “WhatsApp aberto · sem confirmação de entrega”; respostas são registradas à mão; mensagem agendada **não é enviada sozinha** (vira lembrete e “pronta para enviar”). Nada na interface promete entrega ou leitura.
- **Integração:** só a mensagem enviada entra no histórico do lead (último contato/primeira resposta); lembretes aparecem em Tarefas; a transferência leva oportunidade, agendadas e lembretes; botão “Abrir conversa” na oportunidade.
- **Testes (Dev, 01/10):** SQL **S19 = 96 OK** (permissões por unidade/papel, multiatendimento, imutabilidade, não lidas, histórico do lead, agendadas, ficha por nicho); S15/S16/S17 seguem OK (251 OK no conjunto S15+S16+S17+S19). E2E **R19 (9)** + regressão **R02 (13), R06, R18 (7)** = 29 verdes; `tsc` e `eslint` (arquivos tocados) limpos. **R02 ajustado por mudança intencional:** “Mensagens agendadas” agora aparece na v1. Capturas em `docs/screenshots/conversas/`.
- **Defeito encontrado e corrigido no caminho:** com a barra lateral aberta a ficha de 21 rem espremia o centro e o botão da ficha ficava coberto pela coluna (clique interceptado); colunas reduzidas, rótulos do cabeçalho só em telas largas e o estado da conversa foi para o diálogo “Atendimento”.
- **Dependências externas NÃO comprovadas:** envio/recebimento reais no WhatsApp (o teste intercepta `wa.me`; nenhuma mensagem real saiu), provedor de WhatsApp, atualização em tempo real (hoje consulta periódica).
- **Migrations:** Dev = **78 registros** (última 077); repositório = 72 arquivos (a 077 e as 075/076 de Repasses; para produção, quando autorizado, entram 075→077 além das 33 já listadas — contagem final a recalcular quando o Repasses for commitado).
- **Segurança:** o token do Supabase do chat de 30/09 continua nas transcrições locais — **revogar e gerar novo** (https://supabase.com/dashboard/account/tokens).

## Sessão anterior (2026-10-01, 13ª rodada, concluída) — jornadas Fisioterapeuta, Paciente e CRM; Hub sem “Seus aplicativos”

> `release/v1`, PR #3 em rascunho; Dev apenas; produção, DNS e merge intocados. Auditoria item a item (implementado/parcial/ausente, com o teste de cada item e as dependências externas): [`docs/jornadas-fisioterapeuta-paciente-crm.md`](jornadas-fisioterapeuta-paciente-crm.md). Histórico e continuidade: [`docs/transferencia-claude.md`](transferencia-claude.md).
- **Hub:** o bloco “Seus aplicativos” saiu do dashboard (os acessos já estão na sidebar); indicadores, alertas e gráficos preservados.
- **Fisioterapeuta (068, 071, 072):** cadastro pela tela (pessoa do cadastro central ou nova, registro no conselho, unidades), disponibilidade editável sem sobreposição, liberação de acesso (convite com vínculo ou vínculo imediato), “Meu resumo” (`/admin/meu-resumo`) com agendados/realizados/cancelamentos/faltas/pacientes atendidos e repasses só com regra e dados reais.
- **Paciente (068, 070, 072, 073):** portal com sessões **separadas** (contratadas, realizadas, consumidas por falta/cancelamento tardio, devolvidas, ajustes, saldo); plano de sessões **sempre definido pelo profissional** (fim do “10 por padrão”); renovação só após orientação (continuidade/manutenção); convite ou vínculo imediato do portal (`person_portal_access`).
- **CRM (069):** importação CSV em 4 passos (modelo, mapeamento, prévia com erros por linha, relatório), deduplicação no servidor, reimportação idempotente, conflitos só com decisão explícita (nunca sobrescreve sozinho); KPIs do CRM conferidos por recálculo independente (`S17`).
- **Defeitos reais encontrados e corrigidos nesta rodada:** (e) **segurança:** paciente, parceiro e fisioterapeuta conseguiam criar listas do CRM direto pela API (as políticas só checavam `in_org`; só a interface barrava) → 074, com testes no `S16` e no `R18`; (a) “Agendados” do resumo nunca mostrava consultas futuras (só contava dentro do período) → 071; (b) conta já confirmada **sem** `user_accounts` nunca receberia o convite (o gatilho só roda na criação/confirmação) → 072; (c) “última decisão” da reavaliação dependia de desempate por uuid quando duas decisões tinham o mesmo `now()`: o `S07` só passava por sorte → 073 (`clock_timestamp()`); (d) portal tinha texto “modelo inicial de 10 sessões” → removido.
- **Testes (Dev, 01/10):** SQL **S01–S17 todos OK** (S15 78, S16 55, S17 22, S07 63 estável em 5 execuções); E2E novos **R15 (10), R16 (10), R17 (9), R18 (7: listas, oportunidade com histórico e tarefa, Tarefas, metas, permissões no servidor sobre 7 tabelas do CRM)** e regressão **R01–R14, N10–N11 e 01–09 verdes** (R13 adaptado ao Hub sem lançador); `tsc` e `vite build` limpos. Capturas desktop e celular em `docs/screenshots/jornadas/` (sem rolagem lateral nem erros de console).
- **Migrations:** Dev = **75 registros** (última 074); repositório = 70 arquivos; produção (pelos documentos, não consultada hoje) = 37. Para produção, quando autorizado: 038→047 e 052→074 = **33**, `list_migrations` final **70**. Corrigidas as contagens antigas (26/63) em `docs/release-v1.md`.
- **Dependências externas NÃO comprovadas:** entrega do e-mail de convite/recuperação (Resend: os E2E criam a conta já confirmada no Auth do Dev e a tela de nova senha usa uma sessão por API), clique no link do e-mail, reprodução real do vídeo no Bunny (segredo e biblioteca não cadastrados; a tela mostra a mensagem honesta), autorização real no Google Calendar, DNS e produção.
- **Sem diagnóstico:** nenhuma falha nova sem causa; as duas antigas (07/08 da bateria longa de 01/10 e o `fill` de 150 s do R04) não reapareceram.
- **Publicação:** commit `ce5d4d7`, preview (rascunho) deploy `6abed1f6a20ecff377beff7e`, `version.json` = perfil `v1`, ambiente `preview`, backend Dev; a URL exige login da equipe Netlify (401), então as telas foram validadas servindo o mesmo `dist` contra o Dev. PR #3 segue em rascunho.
- **Segurança:** tokens do Supabase colados no chat em 30/09 ficaram nas transcrições locais — revogar e gerar novo.

## Sessão anterior (2026-10-01, 12ª rodada) — filtro único nos seis módulos, edição de cartão e diagnóstico do `57014`

> `release/v1`, PR #3 em rascunho; Dev apenas; produção, DNS e merge intocados. Sem integração com bancos emissores e sem parcelamento (fora do escopo). Detalhes: `docs/aplicativos.md` §4, `docs/cartoes-corporativos.md` §6, `docs/diagnosticos/04-agenda-concurrency/README.md`.
- **Filtro único (item 1):** Agenda (unidade e dia à vista; profissional e estado no botão Filtros), Academy (cursos e trilhas), Parceiros (por aba), Contas a pagar (estado, linha, origem, vencimento), Conciliação (+ relatório por linha com período do filtro único) e Planilha administrativa
  migrados para `PeriodFilter`/`ListFilterBar`, com contador, chips e “Limpar filtros”; os filtros e parâmetros de URL que já existiam foram preservados e nenhuma permissão mudou (`R14`, `R02`).
- **Edição de cartão (item 2, migration 066):** limite, fechamento e vencimento, com motivo e auditoria; **faturas e despesas existentes não mudam**; os novos dias valem só para faturas que ainda não existem (documentado com exemplo em `docs/cartoes-corporativos.md` §6). Limite não pode ficar abaixo do em aberto.
- **`57014` do `04-agenda-concurrency` (item 3) — causa determinada:** deadlock no banco entre reservas simultâneas do mesmo horário (exclusion constraints), com reexecução automática até o timeout de 8 s — **não é o ambiente nem o valor do timeout (não foi aumentado)**. Provado com 2 reproduções
  (1/30 e 1/40 iterações travadas, `pg_stat_database.deadlocks` +154, grafo de bloqueio em ciclo) e **direto no banco** (27 deadlocks em 33 tentativas sem a trava; 0 em 970 com ela). Correção: migration 067 (trava transacional por profissional e pessoa). Depois dela: 100 iterações × 6 requisições sem deadlock
  (pior 214 ms) e o teste real 10/10. Artefatos das falhas preservados em `docs/diagnosticos/04-agenda-concurrency/`. **Sem diagnóstico:** qual camada reexecuta (PostgREST x gateway) e a linha de log do deadlock (API de logs indisponível).
- **Testes:** SQL S01–S14 todos OK (S14 novo, 43); E2E: `R14` novo (15), R01–R13, N10/N11 e os gerais 01–09 verdes; `04` ×10. Ajustes por mudança **intencional** de interface: `#au/#ad` → `#pf-unit/#pf-day` (R01/R04/R05), “Estado” do Diretório e “Conta bancária” do relatório agora no popover (R12/R08).
  Falhas encontradas e tratadas: (a) **R04** — o paciente QA compartilhado acumulou 127 atendimentos e `my_appointments` mostra só 100 (`limit 100`): o “ontem” da execução ficava fora da lista; o teste agora remove atendimentos de execuções anteriores (`R0x`, outro runId) antes de começar;
  (b) **07** — sobra de um recebimento de R$ 150,00 não conciliado de rodada antiga gerava duas sugestões; o teste passou a conferir e confirmar a da própria pessoa; (c) **R12** — chaves React duplicadas na busca global (`CommandMenu`: a mesma rota aparecia no Hub e no app); corrigido (defeito real, de rodada anterior).
- **Sem diagnóstico:** uma única ocorrência, no **R04**, em que `#pf-day.fill()` ficou 150 s “aguardando o elemento” — não se repetiu (4 execuções seguintes passaram; o `fill` isolado leva ~60 ms) e o artefato foi sobrescrito pela execução seguinte; não sei se foi o navegador com ~0,7 GB livres ou outra causa.
  O `vitest` tem 1 suíte que falha há tempos (`supabase/tests/functions/google-sync-plan.test.mjs` chama `process.exit`; não foi tocada) e o `eslint` tem 23 erros em arquivos que não mudaram (funções do Supabase, `R06`).
- **Migrations para produção:** 26 (038→047, 052→067); `list_migrations` final = **63**; o Dev tem **68**.

## Sessão anterior (2026-10-01, 11ª rodada) — aplicativos contextuais, filtros, Cartões corporativos e Calendário

> `release/v1` (a indicação `feature/hp-group-hub` do pedido foi corrigida pelo usuário: essa branch é antiga, já mesclada, e o PR em rascunho é o #3); Dev apenas; produção, DNS e merge intocados.
> Documentos novos: `docs/aplicativos.md` (rotas, menus, filtros, referências), `docs/cartoes-corporativos.md` (modelo, regras, testes). Capturas: `docs/screenshots/apps-cartoes-calendario/`.
- **Aplicativos:** Gestão, Financeiro, CRM, Pages, Operação, Academy (administração), Parceiros e Produtividade, cada um com sidebar exclusiva, identidade própria, “Voltar ao Hub” e seletor; o Hub tem o lançador
  “Seus aplicativos” (só os permitidos). O app ativo vem da URL (link direto, recarregar e voltar/avançar). Rotas antigas preservadas; atalhos `/admin/gestao`, `/admin/operacao`, `/admin/pages`, `/admin/produtividade`,
  `/admin/administrativo`. “Contas a receber” e “Unidades/Produtos e serviços” ganharam entrada de menu própria apontando para as telas que já existiam (aba/seção na URL). O app **Administrativo** passou a se chamar **Gestão**.
- **Filtro único:** linha de negócio (Geral/Fisioterapia/Academy) dentro do popover no Financeiro; Recorrência (mês), Fluxo de caixa e Pessoas migrados; trocar o período não apaga mais a linha na URL. Agenda, Academy, Parceiros,
  Contas a pagar, Conciliação e Planilha administrativa **não** foram migrados (documentado).
- **Cartões corporativos (migration 065):** cartão visual seguro (sem número completo/CVV), compra = uma despesa em `payables` (uma vez na DRE, no fluxo e na linha de negócio), ciclo/fechamento/vencimento, limite e disponível,
  bloqueio com motivo, fatura paga baixa as despesas, **conciliação da fatura agregada sem criar despesa nem alterar o extrato**; RLS, escopo por unidade, auditoria; SQL `S13` (80 verificações).
- **Calendário (Meu dia):** barra com ‹ Hoje ›, título do mês, Dia/Semana/Mês, data, agenda de outro profissional (quando permitido) e **categorias** (atendimentos, CRM, pessoais, Google Calendar) como filtros; grade mensal
  legível (hoje destacado, eventos coloridos com “+N mais”; pontos no celular). Só Google Calendar (OAuth individual, status, sincronizar, desconectar) — sem iPhone/Apple/`.ics`.
- **Testes:** SQL S01–S13 e N01–N02 OK; E2E: `R02` reescrito (menus por papel e por aplicativo), novo `R13` (14), ajustes por mudança intencional em `R08` (linha de negócio no filtro) e `R12`; correções de fragilidade que dependiam de
  data/dados acumulados em `R01` (parcela “1/2” exata), `R03` (contagem na seção certa e dia livre para o paciente QA compartilhado) e do isolamento do `S13` (auditoria só das próprias compras).
  `04-agenda-concurrency` era **intermitente** (`57014` em vez de `P0409`); **investigado e corrigido na 12ª rodada** (deadlock entre reservas simultâneas; migration 067) — ver a seção acima.
- **Falhas da bateria longa (`07` DRE e `08` quizzes), investigadas — causa NÃO determinada:** numa bateria de 35 testes (01:32–01:37, horário de Brasília) falharam, em sequência, `07 › DRE` (a linha da categoria
  “Custo E2E …” não apareceu em 10 s) e dois testes do `08` (a próxima pergunta do quiz não apareceu / timeout). O que foi **descartado com evidência**: (a) *dados*: a despesa estava paga no banco (04:33:50 UTC), com categoria
  classificada e competência de outubro, e a `dre_report` devolve a categoria para a janela da tela; (b) *janela de datas/fuso*: o intervalo calculado pela tela cobre o pagamento; (c) *latência do RPC*: `dre_report`,
  `finance_by_line` e `efficiency_report` respondem em ~60–450 ms; (d) *limitador de quiz*: em `private.rate_limits` a janela 04:30 tem só 3 de 8 inícios de “atendimento” e nenhum de “parceria”, e **não há nenhuma chamada de
  consentimento/progresso do quiz** nessa janela — o fluxo travou logo depois do início, antes de qualquer limite; (e) *código desta etapa*: o `07` passou 6/6 isolado e a mesma sequência (com e sem `02`) passou 3 vezes; o `08` passou
  3/3 isolado. O padrão (duas especificações diferentes falhando no mesmo intervalo de poucos minutos, com o Dev já tendo dado `57014` em `04-agenda-concurrency` e o computador com ~0,3–0,9 GB livres) é compatível com uma
  interrupção momentânea do ambiente, mas **isso é uma hipótese, não uma prova**: os artefatos da falha foram apagados pela execução seguinte e a API de logs do Supabase não respondeu de forma utilizável. Para que uma
  recorrência explique a si mesma, o `07` agora espera a tabela OU o alerta de erro e confere que a DRE não carregou com erro antes de procurar a linha.
- **Migrations para produção:** 24 (038→047, 052→065); `list_migrations` final = **61**; o Dev tem **66**.

## Sessão anterior (2026-09-30, 10ª rodada) — reformulação visual de verdade

> `release/v1`, Dev apenas; produção, DNS e merge intocados; PR #3 segue em rascunho; nenhuma migration nova (a 064 é da rodada anterior). Detalhes, tabela antes × agora e capturas: `docs/interface-v2.md`.
- A 9ª rodada tinha mudado só tokens, filtros e responsividade (visual quase igual). Esta mudou a **composição**: cabeçalho em largura total, **sidebar contextual clara por aplicativo** (Hub, Administrativo, CRM e **Financeiro, agora com shell próprio**), cor de identidade por app, cartões em quatro pesos (faixa prioritária com minigráfico só com série real, painel de Atenção, resumo, compacto), gráficos redesenhados (áreas, rosca, ranking), tabelas e estados vazios novos, tipografia e espaçamento novos, mapa maior com estado sem dado hachurado.
- Telas reorganizadas: Hub, Administrativo, CRM (painel e relatórios), Financeiro (visão geral e relatórios). As demais herdam header, sidebar, tipografia, tabelas e filtros, sem reorganização. `/admin/administrativo` → `/admin/adm`.
- **Testes:** SQL S01–S12 OK (Dev, somente leitura); E2E release 65, novos 4 e gerais 32 passando ao final; ajustes de teste: `R11` (`Limpar` exato, 9ª rodada), `07` (`h1` virou breadcrumb → locator exato), `R04` (espera pelo estado real no banco em vez de lê-lo antes da hora). Intermitentes sob pouca memória/limitador de quiz registrados em `docs/interface-v2.md` §8.
- **Limitação real:** “Linha de negócio” ainda não está dentro do componente único de filtros; o tema escuro foi conferido só nas telas principais.

## Sessão anterior (2026-09-30, 9ª rodada) — nova interface (Hub, Administrativo, CRM, Financeiro)

> `release/v1`, Dev apenas; produção, DNS e merge intocados; PR #3 segue em rascunho. Detalhes, decisões e capturas: `docs/interface-v2.md`; atribuições: `docs/creditos.md`.
- **Tokens próprios do HP** (`src/styles/app.css`): paleta de gráficos, escala do mapa, níveis dos cartões e **tema escuro** (escolha da pessoa, guardada no navegador).
- **Cabeçalho único** (`HeaderBar`) nos três shells: logo + aplicativo e seção atuais, busca discreta (Ctrl K), troca de app, **notificações com dados reais** (tarefas comerciais e pendências administrativas atrasadas *do próprio usuário*), tema e perfil; selo de ambiente no cabeçalho (não sobrepõe mais a barra lateral). Busca global ganhou título acessível.
- **Filtro único** (`PeriodFilter`): período e unidade visíveis, contador de filtros ativos, “Limpar filtros”, resumo dos ativos; no celular, gaveta com Aplicar/Limpar sempre à vista e chips dos filtros ativos.
- **Cartões em três níveis** (`StatCard` + `LevelSection`): Atenção, Resumo e Análise, com nome, número, unidade, período, comparação **só com base real** (`makeDelta`) e descrição curta; aplicado em Hub, Administrativo, CRM e Financeiro (que agora também compara de verdade com o período anterior).
- **Mapa do Brasil** (`BrazilMap`, geometria `@svg-maps/brazil`, CC BY 4.0 — atribuição só na documentação): Administrativo (“Cadastros por estado”, migration **064** `adm_geo`) e Hub; balão com nome/quantidade/percentual, estado sem dado neutro, clique lista os cadastros do estado e abre o Diretório já filtrado (`uf`). A migration 064 também fez a listagem do Diretório respeitar o escopo de unidade do gestor de unidade.
- **Estouro horizontal** no celular corrigido (Administrativo 151 px e CRM 188 px → 0); botões do cabeçalho voltaram a esconder/mostrar por tamanho de tela.
- **Testado:** SQL S01–S12 (S12 novo: 26), N02; E2E da release inteiro + `R12` (10 novos: cabeçalho/tema/ambiente, filtro, níveis, comparação, mapa com dado real, Diretório por UF, permissões, celular).
- **Migrations para produção:** 23 (038→047, 052→064); `list_migrations` final = **60**; o Dev tem **65**.

## Sessão anterior (2026-09-30, 8ª rodada) — Google Calendar concluído até a autorização

> `release/v1`, Dev apenas; produção, DNS e merge intocados; PR #3 segue em rascunho.
- **Configurado no Dev (sem exibir valores):** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (seus), `GOOGLE_TOKEN_ENC_KEY` (gerada: 32 bytes aleatórios, não substituiu nada), `GOOGLE_RETURN_URL` = `https://release-v1--hp-group-hub.netlify.app` (**só do calendário**; `PUBLIC_SITE_URL` dos e-mails intocado), `CALENDAR_SYNC_SECRET` e os itens `calendar_sync_url`/`calendar_sync_secret` do Vault. O `GOOGLE_CLIENT_ID` tinha uma quebra de linha no meio (vinda da colagem): a função agora ignora espaços nas credenciais (o Google já o aceitava).
- **Só Google na interface:** removidos iPhone/Apple e a assinatura `.ics` (tela e função `calendar-feed`, despublicada e removida do repositório). Existia **1 link ativo** (do seu usuário, criado hoje, nunca lido): foi revogado antes de retirar o endpoint. Migrations históricas e tabelas da 059 preservadas.
- **Sincronização automática** (migration 063): criação, remarcação e cancelamento de atendimento chamam a sincronização do usuário conectado na hora; job de 5 em 5 minutos como rede de segurança; primeira sincronização logo ao conectar. Planejador testado isolado (nada de dado clínico no evento; id determinístico; sem duplicar).
- **Testado:** planejador 22 OK · `S11` 19 OK · função publicada: 401 sem sessão, `state` de uso único, escopos exatos, **o Google aceita o cliente e o callback** (abre a escolha de conta), retorno vai para a URL configurada · cadeia real Vault → pg_net → função respondeu 200 · `R10` (Meu dia, só Google, navegação ao Google inspecionada, status/erro/desconexão). Bug meu achado e corrigido pelo E2E: a tela tratava a resposta do status como objeto em vez de lista.
- **Falta (depende de você):** escolher a conta e autorizar no Google. URL: `https://release-v1--hp-group-hub.netlify.app/admin/meu-dia` (login da equipe Netlify + login no app) → “Conectar Google Calendar”. Conferir no Google Cloud a tela de consentimento com os escopos `calendar.app.created`, `calendar.events.readonly`, `openid`, `userinfo.email` e seu e-mail nos usuários de teste. Em modo Teste o acesso expira em 7 dias.
- **Migrations para produção:** 22 (038→047, 052→063); `list_migrations` final = **59**; o Dev tem **64**.

## Sessão anterior (2026-09-30, 7ª rodada) — Administrativo: central de pendências administrativas

> `release/v1`, Dev apenas; produção, DNS e merge intocados; PR #3 segue em rascunho.
- **Implementado:** cartões prioritários (pendências vencidas, cadastros incompletos, documentos vencendo, contratos aguardando assinatura, pacientes aguardando agendamento, profissionais com integração incompleta), indicadores complementares, gráficos (evolução, tempo de resolução por tipo, responsável e unidade), lista de prioridades e o fluxo mínimo de pendências (criar, atribuir, prazo, concluir, reabrir, cancelar, histórico), documentos, contratos administrativos (assinatura registrada manualmente — não é assinatura eletrônica), verificação de contato e requisitos/prazos configuráveis. Reaproveitados: `waitlist` (solicitação de agendamento), `invitations`, `client_packages`, `professionals`, `legal_entity_documents`, `person_contacts`, `role_assignments`. Fórmulas, fontes, períodos e critérios: `docs/indicadores-administrativo.md`.
- **Aplicado no Dev:** migration `062` (registrada; Dev = 63 registros, produção prevista = 58 com 21 migrations a aplicar).
- **Testado:** `S10` = 127 OK (cada cartão × lista, limites de vencimento, ausência de dados com motivo, permissões, isolamento por unidade, privacidade, superfície pública); suíte SQL S01–S10 = **565 OK, 0 FALHA**; E2E `R11` (desktop: cartões = servidor, detalhes reconciliados, filtros, ciclo da pendência, prioridades, documentos/contratos/contatos, permissões; **celular 390×844**: sem rolagem lateral, filtro em gaveta, abas); regressão `R02`, `R07`, `N10`, `N11` verdes; typecheck, lint (0 erros) e build.
- **Achados corrigidos nesta etapa:** (1) o popover de filtros compartilhado (`PeriodFilter`) ficava mais alto que a janela e escondia Limpar/Aplicar — agora rola por dentro; (2) o diálogo de seleção exigia valor, então “sem responsável/sem prazo” não seriam aceitos — corrigido; (3) contato fora do padrão `x@y` não era mascarado — corrigido com função de máscara; (4) desempate de eventos no mesmo instante na evolução semanal.
- **Preview:** deploy `6abd7eb3784e286f70c75e93` (branch-deploy `release-v1`, `ready`, não publicado na URL principal), commit `e45716da5466`, `version.json` do bundle: perfil `v1`, ambiente `preview`, backend `Dev`. **Bloqueio de acesso:** a URL `https://release-v1--hp-group-hub.netlify.app` exige login da equipe Netlify (401 sem sessão), então não foi aberta por HTTP; o mesmo `dist/` foi servido localmente e 20 E2E (R02, R07, R11) passaram. Para conferir no endereço publicado: abrir logado na Netlify e ver `/version.json`.
- **Depende de você (configuração):** definir em `Pendências › Requisitos e prazos` quais documentos e contratos cada tipo/vínculo exige e os prazos; designar responsáveis. Sem isso, “documentos ausentes” fica em 0 por falta de requisito (a tela avisa).

## Sessão anterior (2026-09-30, 6ª rodada) — Validação pelas telas, `google-calendar` endurecido e preview publicado

> `release/v1`, Dev apenas; produção, DNS e merge intocados; PR #3 segue em rascunho.
- **E2E (um worker, sem servidores duplicados):** novos `R07` indicadores/detalhamentos, `R08` financeiro por linha (inclui conciliação com extrato intacto), `R09` jornada do paciente (vídeo privado → “indisponível por configuração”), `R10` calendários (.ics baixado de verdade e revogação) + regressão `R01`, `R02`, `R04`, `R05`, `R06`: **tudo verde** (rodada completa de `e2e/release`: 39 OK + o R09 reexecutado após ajuste de asserção = 5 OK). Ajustes só em testes (locators ambíguos no portal, horário livre na remarcação, asserção de “Sem permissão”).
- **`cash_flow_monthly`** reexecutada com os parâmetros corretos (`p_from`, `p_to`, `p_unit`): 200.
- **`google-calendar` (publicada sem JWT na plataforma):** `start`, `sync` e `disconnect` exigem sessão de usuário validada dentro da função (sem token, só a chave pública ou JWT inválido → 401). Achado: o `state` era assinado e expirava em 10 min, mas **não era de uso único**. Corrigido com a migration **061** (`google_oauth_state`, nonce guardado e consumido no callback). 25 verificações com segredos **fictícios temporários** (já removidos do Dev): state adulterado/forjado/vencido/de outro usuário/repetido → `google=estado`; só o 1º uso do state legítimo segue. Script: `supabase/tests/functions/google-calendar-auth.mjs`.
- **Preview:** `https://release-v1--hp-group-hub.netlify.app` (deploy `6abd3c27ec571eb924ec12b2`, branch-deploy, `ready`, sem `--prod`). **Bloqueio de acesso:** o endereço exige login da equipe Netlify (401 sem sessão), então o `version.json` servido e as telas não puderam ser abertos por HTTP. Verificação alternativa: o `dist/` gerado pelo próprio build do deploy foi servido localmente e 32 E2E (R01, R02, R07–R10) passaram; o `version.json` desse bundle diz commit `bcc6db8f649f`, perfil `v1`, ambiente `preview`, backend `Dev` (`fsvtzowcwhvwtluwrhnb`). Para conferir no endereço publicado: abrir a URL **logado na Netlify** e ver `/version.json`.
- **Contagem de migrations:** Dev 75 × produção prevista 70 — ver `docs/release-v1.md` §4 (diferença de 5 = 048–051 só do Dev + a 045 registrada em duas partes).
- **Ainda pendente (não declarado concluído):** Bunny e Google em **configuração e teste reais**; `.ics` num iPhone/Google Agenda de verdade.

## Sessão anterior (2026-09-30, 5ª rodada) — Escopo ampliado aplicado no Dev e testado no banco

> `release/v1`, Dev apenas; sem merge, produção ou DNS. Com a credencial do Dev disponível: **migrations 056–060 aplicadas e registradas** (`list_migrations` = 61 registros na época; hoje 62 com a 061), **suíte SQL de release S01–S09 = 438 OK, 0 FALHA**, e as Edge Functions `calendar-feed` (sem JWT), `bunny-playback` (JWT) e `google-calendar` (sem JWT) **publicadas no Dev**.
- **O que os testes acharam e foi corrigido**: (1) o relatório de eficiência consolidado (`efficiency_report`, migration 020) **falhava sempre** — função de janela dentro de agregado; corrigido na 060 (mesma assinatura); (2) auxiliares internos do schema `private` (`journey_payload` — dado clínico —, `bank_line_split`, divisões de vendas/despesas, escopo de indicadores) estavam executáveis por `anon`/`authenticated` dentro do banco (o schema não é exposto pela API); revogado nas próprias migrations 056–060; (3) expectativas erradas de fixtures nos testes S05/S06/S07/S09.
- **Assinatura .ics testada de verdade** contra a função publicada (criação, download, unicidade de UID, UTC, conteúdo mínimo, novo link derruba o antigo, revogação, token inválido, método, anônimo).
- **Ainda NÃO feito**: (a) **E2E das telas novas e regressão das jornadas afetadas** — não executado porque a máquina está com ~0,7 GB de RAM livre e o navegador do Playwright + servidor de desenvolvimento não cabem (o sistema já encerrou o servidor local por falta de memória); (b) preview do `hp-group-hub` não republicado por (a); (c) Bunny e Google: **pendentes de configuração e de teste real**; (d) teste manual do `.ics` num iPhone/Google Agenda.
- **Migrations para produção:** 22 (038→047, 052→063); `list_migrations` final = **59**. O Dev tem **64** registros: a diferença de 5 são as 4 migrations 048–051 (só do Dev) e a 045, registrada no Dev em duas partes — detalhes em `docs/release-v1.md` §4.

## Sessão anterior (2026-09-30, 3ª rodada) — Cancelamento pelo paciente, horário passado, agendas por permissão, Administrativo

> Branch `release/v1`, Dev apenas — sem merge e sem produção/DNS. Detalhes em **`docs/release-v1.md` §10.1**.

- **Implementado (código + migration `055`)**: paciente cancela pelo portal respeitando prazo e consumo do produto (avisado antes); agendar/remarcar no passado bloqueado no servidor (removida a exceção de `p_rescheduled_from`) e na Agenda; "Meu dia" com a própria agenda + seletor de agendas de outros profissionais só para gestor/administrador operacional (e gestor de unidade nas suas unidades); rótulo "ADM" → "Administrativo".
- **Verificado no Dev (migrations 054 e 055 aplicadas)**: SQL `test:sql:release` **151/151** (S01–S04); aceite E2E `R01` 8/8, `R04` 4/4, `R05` 4/4; regressão E2E 01–09 + R02 + R03 + N10/N11 **45/45**; unit 25/25; typecheck, eslint e build ok. O token de gestão do Dev foi usado só em variável de ambiente por comando, sem gravar em arquivo — **revogar** em supabase.com/dashboard/account/tokens.
- **Defeito real achado e corrigido**: a coluna *Sessão do pacote* da Agenda não atualizava após marcar falta.
- **Preview (Netlify, site Dev oficial `hp-group-hub`)**: variáveis `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` do Dev configuradas no site (o plano gratuito não permite escopo por contexto, então valem para todos os contextos **deste** site Dev, onde `VITE_APP_ENV=preview` em todos; a salvaguarda de build recusa o banco de produção). Preview publicado como **rascunho** (sem `--prod`) em `https://release-v1--hp-group-hub.netlify.app`, commit `86f50f4`, `version.json`: `profile v1 · environment preview · backend Dev (fsvtz…)`. O site publicado do Dev e o de produção **não foram alterados**. O preview do PR #3 no site duplicado `leafy-cascaron-325147` **não foi usado** e segue sem backend.
- **Migrations para produção**: agora 14 (038→047, 052, 053, 054, 055); `list_migrations` final = 51.

## Sessão anterior (2026-09-30, continuação) — Confirmação de paciente/profissional, presença e consumo (release v1)

> Branch `release/v1`, Dev apenas — sem merge, publicação em produção, DNS ou push. Detalhes e regras em **`docs/release-v1.md` §10**.

- **Implementado** (migration `054`, telas e testes): confirmação antecipada **independente** do paciente (portal) e do fisioterapeuta ("Meu dia"), registro pela recepção do que o paciente confirmou por telefone, falta do profissional (`professional_no_show`, nunca consome e devolve sessão descontada por engano), e leitura de "sessão consumida" no portal e na Agenda. Confirmar não muda status, não consome e não prova presença; presença e consumo seguem separados. Permissões no servidor e auditoria do autor.
- **Testado**: verificação interina pela API (38/39; a falha era do script), telas conferidas com dados reais, regressão E2E 33/33. **Pendentes por falta do token do Dev**: `S03` (SQL), `R04` e `R01` (E2E) — escritos e compilando, não executados.
- **Migrations para produção**: agora 13 (038→047, 052, 053, **054**); `list_migrations` final = 50. Nada foi aplicado em produção.
- **Observação aberta**: o gestor consegue remarcar um atendimento para um horário **passado** (`reschedule_appointment` dispensa a checagem de "horário no passado"); usado na verificação interina. Não alterado — decidir se deve ser restringido.

## Sessão anterior (mesmo dia) (2026-09-30) — Mudança de prioridade: release v1 (primeira versão operacional)

> Expansão de Contábil (já pronto), Marketing, Jurídico, RH e provisionamento white label **pausada**; nada foi apagado. Prioridade: operação real do
> HP Group, com jornada de aceite completa, separação entrega × desenvolvimento e plano de publicação. **Nada foi publicado, nem em produção, DNS ou dados reais.**

- **Separação**: `release/v1` (a partir de `93ac116`, sem Contábil) é a versão de entrega; `feature/lead-quizzes` segue para desenvolvimento e já recebeu a release de volta
  (merge sem perder o Contábil). Documento de entrega completo: **`docs/release-v1.md`**; guia da equipe: **`docs/guia-operacao-v1.md`**.
- **Jornada de aceite** (`e2e/release/R01`): lead pelo quiz → 1 pessoa + 1 oportunidade (repetir não duplica) → responsável automático e troca com histórico → tarefa e contato →
  avaliação agendada, remarcada e realizada → “Converter em venda” → venda de pacote com contrato/parcelas/pacote → recebimento parcial (duplo clique e mesma chave não duplicam,
  excedente recusado) → estorno parcial com comissão proporcional → sessões (comparecimento, falta, cancelamento tardio consomem; antecipado e da clínica não; sem consumo duplicado;
  pacote esgotado não agenda) → dashboard reconciliado com os pagamentos → histórico. **8/8**.
- **Bloqueios achados e corrigidos**: link “Converter em venda” para a tela errada; falta marcável antes do horário consumindo sessão (052); indicação de parceiro pelo quiz sem rastreio (053) —
  e o `CREATE OR REPLACE` que zerou o GRANT de `anon` em `quiz_start` (pego pelo teste).
- **Achados de ambiente (críticos)**: o site `hp-group-hub-producao` foi publicado com o **banco Dev** no bundle (build local leu `.env.local`); o site Dev `hp-group-hub` está **público**; produção não tem
  Resend/hook/URLs de autenticação e não tem backup/PITR. Salvaguarda no build (`vite.config.ts`), contextos de deploy no `netlify.toml`, `version.json` e selo “AMBIENTE DE TESTE”.
- **Permissões** (`R02`): menu, rota digitada e backend por papel (gestor, gestor de unidade, comercial, financeiro, fisioterapeuta, parceiro, paciente); decisão registrada: o Financeiro lê
  as pessoas **da própria unidade** (identificar quem paga), sem tela de Pessoas. **Portais** (`R03`): paciente vê só o próprio; parceiro vê indicações só com 1º nome + etapa.
- **Auth/Resend (Dev)**: Site URL/Redirect URLs do Dev corrigidos; 1 e-mail de recuperação ao destinatário autorizado (nível 1 verificado); função `diag-email-config` removida.
- **Testes SQL legados**: `001` e `005` ganharam cópias independentes de volume (`supabase/tests/release`); `002`, `003`, `010`, `012` falham por fixtures próprias (e-mail/slug fixos, coluna ambígua no script)
  e continuam sem correção (as jornadas equivalentes passam nos E2E).
- Quirk de teste: o limitador do quiz (8 inícios/10 min por IP/jornada) é atingido por baterias seguidas — não é defeito do produto.

## Sessão anterior (2026-09-29) — Novos apps do Hub: ADM (etapa 1 de 5) concluído

> Mesma branch `feature/lead-quizzes`, PR #2 em rascunho, mesmo escopo Dev/preview — sem DNS, produção ou merge.
> Pedido: ampliar o Hub com 5 apps (ADM, Contábil, Marketing, Jurídico, RH), seguindo a navegação contextual do
> CRM, executados em etapas com entrega funcional completa antes de avançar. Esta rodada cobre a etapa de
> inspeção e a etapa 1 (ADM). Contábil, Marketing, Jurídico, RH e a validação conjunta final ainda não foram
> construídos — ficam para as próximas rodadas, na mesma ordem pedida.

**Inspeção prévia** (antes de qualquer código): conferido o schema de `people`/`person_kinds`/`person_contacts`,
o modelo de papéis (`app_role`, sem papéis dedicados a contábil/jurídico/RH ainda), `corporate_accounts`
(contas corporativas de bem-estar — propósito mais estreito que "empresa genérica") e a infraestrutura de
dedup/mesclagem/importação já existente (`create_person`, `merge_preview`/`merge_people`,
`import_people_check`/`import_people_commit`) para reutilizar em vez de duplicar.

**ADM** (`/admin/adm`): consolida a área de Gestão existente numa planilha PF/PJ sobre o cadastro central —
nunca uma base paralela. Sidebar exclusiva via um shell genérico novo (`ContextualAppShell`, também usado pelo
CRM a partir de agora — os próximos apps reaproveitam o mesmo componente). PF = `people` (estendida com CEP/
endereço/status cadastral/origem/responsável interno/unidades extras via `person_units`); PJ = tabela nova
`legal_entities` (razão social, CNPJ, inscrições estadual/municipal, CNAE, regime tributário, endereço,
representantes sempre vinculados a `people` existentes via `legal_entity_representatives`, documentos em bucket
privado `legal-documents`). `corporate_accounts` não virou "empresa genérica" — ganhou um link opcional
(`corporate_account_id`) para quando uma PJ do ADM também for uma conta corporativa.

Backend: `private.is_valid_cpf`/`is_valid_cnpj` (dígito verificador — formato, não identidade);
`adm_directory` (busca/filtro/ordenação/paginação no servidor, união PF+PJ, documento mascarado por padrão,
completo só para manager/ops_admin); `adm_directory_indicators` (total/PF/PJ/novos/incompletos);
`legal_entity_upsert` (valida CNPJ e duplicidade). Dois bugs reais encontrados e corrigidos durante os próprios
testes: `can_adm(unit)` usava `has_unit_role(roles, null)`, que só bate com atribuição SEM unidade — um
comercial ou gestor de unidade com papel POR unidade ficava bloqueado (mesma armadilha já documentada em
`private.dash_units`/`crm_units`); e o filtro de busca por documento virava `%%` (batendo com qualquer
documento não nulo) quando o termo buscado não tinha nenhum dígito, misturando resultados de PF e PJ sem
relação com a busca.

**Pendências explícitas desta etapa**: importação CSV de PJ (PF já reutiliza `import_people_check`/
`import_people_commit` existentes; PJ não foi construído); seleção/reordenação de colunas e preferências de
visualização por usuário (a tabela tem um conjunto fixo de colunas, sem customização); papéis dedicados de
contábil/jurídico/RH/marketing (ainda não existem no `app_role` — entram junto com os apps correspondentes).

**Testes**: verificação manual completa no navegador com sessão real de QA (busca, filtros, indicadores,
criar/editar PF e PJ, vincular representante, máscara de documento por permissão, todos confirmados via banco
depois). Suíte E2E completa revalidada, 32/32 (uma falha de concorrência de agenda, não relacionada, confirmada
como flaky ao rodar isolada). `tsc`/`eslint`/`vite build` sem erros novos.

## Sessão anterior (2026-09-24) — App HP CRM: dashboard, sidebar exclusiva, pipeline preservado

> Mesma branch `feature/lead-quizzes`, PR #2 em rascunho, mesmo escopo Dev/preview — sem DNS, produção ou merge.

Substitui a entrada direta em Oportunidades por um app CRM próprio dentro do Hub. Clicar em "CRM" na sidebar
geral abre `/admin/crm` (dashboard comercial) com **sidebar exclusiva** (`CrmShell`/`crmNav.ts`) — a sidebar
geral do Hub nunca aparece junto; "Voltar ao Hub" e "Trocar de app" no cabeçalho trocam de contexto. Baseado
numa inspeção funcional de um CRM de referência (relatório completo de 12 áreas obtido via agente de
exploração antes de qualquer código — rotas, dashboard, leads vs. pipeline, contatos, listas, tarefas, metas,
time/"view as", comunicação, relatórios, configurações, comissão), adaptado ao modelo de dados do HP — nunca
copiou dados, credenciais, infraestrutura ou identidade visual da referência.

**Backend novo:**
- `crm_dashboard_metrics`/`crm_card_detail` (migration 042) — dashboard comercial com escopo próprio
  (`private.crm_units`/`private.crm_effective_owner`): inclui o papel `sales` vendo os próprios negócios,
  diferente de `dashboard_metrics` (só quem gerencia). 8 indicadores: novos leads (fluxo, por `created_at` —
  propositalmente diferente de "na primeira etapa", que é a fila de Gestão de leads), total de negócios,
  em aberto, valor em negociação, ganhos, conversão, sem retorno, comissão potencial (estimativa sobre negócios
  abertos usando `commission_rules` já existente — nunca confundida com `commission_entries`, que só nasce de
  pagamento real).
- `crm_goal_progress`/`crm_team_snapshot` (migration 043, tabela `crm_goals` nova) — metas mensais por usuário,
  progresso, ticket médio, negócios necessários, ritmo diário (R$/dia útil). O CRM de referência mede ritmo por
  contagem de mensagens de WhatsApp — o HP não rastreia isso (ver Comunicação abaixo), então o ritmo aqui é
  sobre negócios/valor reais, não uma métrica inventada.
- `crm_lead_lists`/`crm_lead_list_members` (migration 044) — listas estáticas de pessoas (não filtro salvo),
  nunca duplica o cadastro central.

**Páginas novas** (`src/pages/admin/crm/`): Dashboard (8 cards clicáveis + gráficos + tarefas + atividades
recentes), Gestão de leads (fila da primeira etapa — diferente do Pipeline), Contatos (lente comercial sobre
Pessoas, sem duplicar cadastro), Listas, Pipeline (Kanban existente, movido de `/admin/crm` para
`/admin/crm/oportunidades`, comportamento preservado), Tarefas, Minha meta/Ritmo do dia/Time, Relatórios
(Análises: funil + motivos de perda; Desempenho comercial: por responsável). Conversas usa WhatsApp real
(`wa.me` com mensagem pronta + registro automático de interação) — funcionalidade real, não um link decorativo.
Mensagens agendadas e Disparo de mensagens mostram bloqueio explícito com o motivo real (exigem um provedor de
envio automático — Evolution API/Chatwoot ou similar — que a organização não tem conectado hoje); nenhuma tela
finge enviar mensagem. "Configurações do CRM" abre a mesma seção "Comercial e CRM" da central de Configurações
já construída na sessão anterior (mesma implementação, mesma fonte de dados).

**Testes novos:** `supabase/tests/022_crm_dashboard.sql` (5/5) — comercial só vê os próprios negócios mesmo
tentando forçar o filtro de responsável; gestor de unidade vê o time inteiro e filtra por responsável
específico. `supabase/tests/023_crm_goals_permissoes.sql` (3/3) — só quem gerencia cadastra meta; um comercial
comum não cria a própria meta nem lê a meta de outra pessoa.

**Regressão:** suíte E2E completa revalidada, 32/32 passando (um teste precisou de correção — a jornada
Checkup verificava o Kanban em `/admin/crm`, endereço que virou o dashboard; corrigido para
`/admin/crm/oportunidades`). `tsc`/`eslint`/`vite build` sem erros novos.

**Pendências explícitas desta rodada:** matriz de equivalência formal (o relatório de 12 áreas foi produzido
e usado para guiar a implementação, mas não foi entregue como documento separado); "Ritmo do dia" mede negócios
reais em vez de contagem de conversas (dependência de log de mensagens ainda não existente); "view as"
(visualizar como outro vendedor) não foi construído — a referência implementa isso só no frontend
(`sessionStorage`, sem verificação real no servidor), incompatível com o padrão de segurança do HP; o filtro
"Responsável" no dashboard e relatórios já é reforçado no banco (um comercial não vê dados de outra pessoa
mesmo tentando forçar o parâmetro), então a ausência de "view as" não é uma lacuna de segurança, só de
conveniência de gestor.

## Sessão anterior (2026-09-23, continuação) — Lacunas do relatório do Mosaic: preview Netlify, cards restantes, Configurações reais, testes novos

> Mesma branch `feature/lead-quizzes`, PR #2 em rascunho, mesmo escopo Dev/preview — sem DNS, produção ou merge.
> Esta seção fecha 4 lacunas apontadas no relatório da rodada anterior (a seção "Redesign Mosaic" abaixo).

**1. Preview HTTPS da Netlify (Dev).** Deploy publicado em `https://hp-group-hub.netlify.app`, site `hp-group-hub`
(id `2c2d11bc-f62c-42b7-bae6-4cf3b6f35756`), conectado exclusivamente às env vars do Supabase Dev, com a
proteção de SSO de equipe já existente preservada (`requiresSSOTeamLogin: all`, inalterada). O site de produção
(`hp-group-hub-producao`, `hpfisioterapia.com.br`, sem SSO) não foi tocado.

**2. Detalhamento dos demais cards (migration `20260924000041_dashboard_card_detail_expand.sql`).** Inventário
completo dos ~40 `StatCard` do admin. `dashboard_card_detail(p_kind, ...)` ampliado de 6 para 23 tipos, todos
reconciliando com a mesma tabela/filtro/escopo de unidade da métrica original (`dashboard_metrics`/
`dashboard_alerts`/`mrr_report`). **Bug real corrigido**: nos 6 tipos originais (migration 039), `total_items`
vinha de um `count(*)` sobre a subconsulta já limitada a 20 — subestimava o total real quando havia mais de 20
registros. Corrigido em todos os ~23 tipos (agregado exato reaproveitado ou uma segunda consulta sem `LIMIT`).
Cartões agora com detalhamento: Início (Recebimentos, Contas vencidas, Novos pacientes, Avaliações agendadas,
Atendimentos realizados, Conversão comercial, Tarefas atrasadas, Alunos ativos no Academy, Ticket médio,
Comparecimento, Pacientes com pacote ativo, Parceiros ativos, e os 6 alertas); Financeiro › Visão geral
(+ Vendas confirmadas, Contas a receber/pagar 30 dias, Resultado de caixa); Financeiro › Recorrência (MRR do
mês, Clientes recorrentes, Churn de clientes — mês de referência passou a ser o mês selecionado na tela, não
mais fixo no mês corrente, pra respeitar o filtro de mês da própria tela).
**Indisponíveis com motivo real documentado (não uma mensagem genérica de pendência):**
- NPS (Início): sem detalhamento próprio — a pesquisa de satisfação já tem seu próprio painel com k-anonimato
  em Pesquisas; abrir a lista de respondentes individuais aqui contradiria essa proteção de privacidade.
- ARR, Receita média por cliente, Retenções bruta/líquida, Churn de receita (Recorrência): derivados da mesma
  ponte de movimentação (`bridge`) de `mrr_report()`, que ainda não tem detalhamento por registro próprio —
  precisaria de uma consulta nova sobre expansão/contração/cancelamento em R$, não construída nesta rodada.
- Estornos, Resultado de caixa (DRE): usam `v_despesas`/`v_estornos` de `dre_report()`, que não é a mesma base
  de `cash_result` do Financeiro › Visão geral (inclui despesas classificadas por categoria) — reaproveitar o
  cartão existente mostraria um total incoerente; precisaria de uma branch própria, não construída nesta rodada.
- Receita por paciente pagante, Receita por sessão, Taxa de recompra, CAC, LTV, Prazo de recuperação do CAC
  (Relatórios): CAC/LTV/payback já eram honestamente `unavailable` desde antes (`efficiency_report()` — sem
  fonte de custo de aquisição no sistema); os outros três são métricas de cohort sem uma lista de registros
  única por trás — não construídas nesta rodada.
- Contas corporativas / Pesquisas: os `StatCard` dessas telas são relatórios por conta/pesquisa individual
  (já com k-anonimato próprio), não indicadores do painel geral — fora do escopo de `dashboard_card_detail`.

**3. Configurações — reinvestigação das 6 categorias pendentes.** Duas tinham suporte real de backend não
utilizado e ganharam telas funcionais nesta rodada:
- **Operação**: `services` (nome/duração/preço) e `products` (nome/tipo/preço/sessões/validade) já tinham RLS
  de escrita pra manager/ops_admin desde a migration 004, mas nenhuma tela em todo o app gravava nessas
  tabelas — confirmado por busca no código. Tela nova em `SettingsHub.tsx` (`OperationSettings`).
- **Comercial e CRM**: `pipelines`/`pipeline_stages`/`loss_reasons`, mesma situação (RLS pronta desde a
  migration 004, zero tela de escrita). Tela nova (`CrmSettings`): criar funil, adicionar etapas, motivos de
  perda.
- **Academy**: achado um campo real sem UI (`courses.certificate_min_progress`, criador do certificado) —
  exposto como campo editável na própria tela do curso (`AcademyAdmin.tsx`), já que é uma configuração por
  curso, não uma configuração central. `SettingsHub` passou a linkar pra lá em vez de "pendente".
- **Parceiros, Comunicação e integrações, Aparência**: reconfirmadas como pendências reais (não apenas
  copiadas do relatório anterior) — não há coluna nem tabela de suporte no schema (ex.: nenhum campo de
  percentual padrão de repasse em `partner_payouts`; `organizations` só tem `name`/`slug`, sem logo/remetente).
  Continuam exibindo o motivo específico, nunca uma mensagem genérica.

**4. Testes novos desta rodada** (nenhum reaproveita a suíte anterior como prova de cobertura nova):
- `supabase/tests/020_dashboard_card_detail.sql` (novo, 9/9) — `total_items` sobe exatamente o esperado mesmo
  acima de 20 (regressão do bug corrigido); lista trunca em 20; recebimentos reconciliam por delta; indicador
  indisponível traz o motivo real; snapshot marcado corretamente; comercial (sales) bloqueado do painel inteiro;
  gestor de unidade acessa cartão comum mas não `eventos_falhos` (exige manager); tipo desconhecido gera erro
  explícito.
- `supabase/tests/021_settings_operacao_crm.sql` (novo, 11/11) — manager cria/edita serviço, produto/pacote
  (com `service_id` obrigatório pra pacote — constraint real do banco, corrigido na tela depois de o teste
  pegar o erro), funil, etapa e motivo de perda; comercial (sales) e gestor de unidade bloqueados de escrever
  em qualquer uma das 5 tabelas (`42501`), mas continuam lendo o catálogo normalmente.
- Persistência de filtros: não existia (nem em Início, nem em Financeiro) — implementada nesta rodada
  (`usePeriodFilterState` em `src/lib/period.ts`, período/unidade/comparação na URL) em vez de documentada como
  pendência, já que era um ajuste pequeno e bem contido.
- Regressão: `020`/`021` são adição pura (nenhum teste antigo foi alterado); `008_dashboard.sql` reexecutado
  numa unidade nova isolada para confirmar que a expansão da migration 041 não quebrou `dashboard_metrics`/
  `dashboard_alerts` (7/7 OK) — a suíte antiga passar sozinha não prova cobertura dos recursos novos, por isso
  020/021 existem.

## Sessão anterior (2026-09-23) — Redesign Mosaic: filtros, cards com detalhe, header financeiro, Configurações

> Mesma branch `feature/lead-quizzes`, mesmo escopo Dev/preview — sem DNS, produção ou merge. Ordem de
> implementação seguida à risca: filtros compactos → cards com detalhe → header financeiro → Configurações.

**1. Filtros compactos** (`src/lib/PeriodFilter.tsx`, reescrito mantendo a mesma assinatura de props):
pílula de período ("Mês atual") + seletor de unidade + botão "Filtros" com contador, todos abrindo o mesmo
popover (drawer no celular) com atalhos de período, intervalo personalizado (só aplica em "Aplicar" — estado
de rascunho local, não dispara consulta a cada tecla), comparação com período anterior e os filtros
específicos da tela (`extra`). Período/unidade ficam ocultos quando a tela não tem essa dimensão (CRM).
Aplicado a **Início, Financeiro (Visão geral/DRE/Relatórios), CRM e Captação de leads** — e de graça em
Pesquisas/Contas corporativas, que já usavam o mesmo componente compartilhado.

**2. Cards clicáveis com painel de detalhe**: nova função `dashboard_card_detail(p_kind,...)` (migration
039) — reconcilia sempre com o mesmo escopo (tabelas/data/unidade/permissão) do cartão que abriu, via
`private.dash_units()` (mesmo guard de `dashboard_metrics`/`dashboard_alerts`). Implementado para os 6
cartões pedidos como exemplo: **Recebimentos, Contas vencidas, Novos pacientes, Avaliações agendadas,
Conversão comercial, Tarefas atrasadas** (esta última via o alerta "Tarefas atrasadas"). Indisponível mostra
"Indisponível: <motivo>" (nunca lista vazia como resultado); "Contas vencidas"/"Tarefas atrasadas" são
sinalizadas como **situação atual** (não mudam com o período, e nunca calculam comparação — decidido
estaticamente, sem esperar a resposta do servidor). `StatCard` ganhou `onClick` opcional (vira `<button>`,
hover/foco visíveis, "Ver detalhes"). `CardDetailSheet` (`src/lib/CardDetailSheet.tsx`) é o painel lateral —
Escape fecha e devolve o foco automaticamente (Radix). Aplicado ao **Início** (6 cartões de indicador + 2
alertas) e ao **Financeiro › Visão geral** (Recebimentos, Vencidos). CRM e Captação de leads não ganharam
esse painel nesta etapa — não têm uma função de detalhamento própria ainda (documentado como pendência).

**3. Header financeiro sem "Mais"**: `AppShell` não separa mais os filhos de uma seção em "primeiros N" +
dropdown — todos os 10 destinos do Financeiro aparecem direto, na ordem pedida (Visão geral, Vendas, Contas
a pagar, Fluxo de caixa, Recorrência, DRE, Conciliação, Comissões e repasses, Relatórios, Configurações).
"Contas a receber" não entrou como item próprio — não existe como destino/rota hoje (só como cartão de
indicador dentro de Visão geral); criar uma tela dedicada ficou fora do escopo desta etapa. No celular a
faixa rola horizontalmente sozinha (nunca a página — confirmado via `scrollWidth`/`clientWidth`), com
degradê de continuidade e o item ativo sempre scrollado à vista; a partir de 768px, quebra para uma segunda
linha organizada em vez de rolar. Estado ativo continua vindo só da URL (recarregar/voltar mantém o item).

**4. Central de Configurações** (`/admin/configuracoes`, sidebar › Sistema, ícone de engrenagem): 10
categorias. Só o que já tem suporte real no backend virou tela **gerenciável** agora:
- **Organização e unidades**: lista/cria/edita unidades (nome, cidade, UF) — tabela `units` já existente, já
  com trigger de auditoria (`private.audit_row`, migration 001). Dados institucionais gerais (contatos,
  endereço, horários) não têm coluna no banco — documentado como pendência, não inventado.
- **Captação**: números de WhatsApp por jornada/unidade (`quiz_whatsapp_numbers`, migration 038) — a mesma
  tabela que `quiz_whatsapp_number()` já lê nos quizzes publicados; editar aqui muda o número real usado no
  botão "Continuar pelo WhatsApp". Novo trigger de auditoria (migration 040).
- **Equipe e acessos** e **Financeiro** linkam para as telas já existentes (`/admin/equipe`,
  `/admin/financeiro/config`) — mesma implementação, mesma fonte de dados, nunca duplicada. O
  "Configurações" do header financeiro já apontava para essa mesma rota — satisfeito automaticamente.
- **Operação, Comercial e CRM, Academy, Parceiros, Comunicação e integrações, Aparência**: card
  "Pendente" com o motivo real e específico de cada uma (ex.: segredos do Resend nunca são expostos ao
  frontend por desenho; funis/etapas só existem via migration, sem tela de admin; logo é asset estático no
  código) — nunca um switch ou formulário decorativo.

**Testes**: suíte E2E completa **32/32**, sem regressão (inclui `07-finance-behaviors` — prova que
`FinanceSettings` continua funcionando idêntico depois de virar destino também da central). `tsc`/`eslint`/
`vite build` ok. Validado ao vivo no navegador: abrir cada painel de detalhe, abrir/aplicar/limpar os
filtros no desktop e no celular (viewport emulado), navegar o header financeiro sem "Mais", editar uma
unidade e um número de WhatsApp na central e confirmar o registro real em `audit_log` (valores antes/depois).

**Preview para revisão**: `npm run dev -- --port 5181 --host 127.0.0.1` → `http://127.0.0.1:5181/admin`
(login necessário — conta de gestor).

**Pendências reais desta etapa** (nenhuma tela finge funcionar; tudo abaixo está documentado, não implementado):
- CRM e Captação de leads sem painel de detalhamento de cartão (só Início e Financeiro › Visão geral).
- "Contas a receber" sem rota própria no header financeiro.
- Operação, Comercial/CRM, Academy, Parceiros, Comunicação/integrações e Aparência sem tela de configuração
  centralizada — motivo específico documentado em cada card de `/admin/configuracoes`.

---

## Sessão anterior (2026-09-23) — Quizzes de captação (atendimento/parceria)

> **Trabalho feito inteiramente no Dev e no preview**, por instrução explícita — produção
> (`HP Group Core`, DNS, domínio oficial) **não foi tocada**. Branch `feature/lead-quizzes`
> a partir da `main` (que já contém o cutover de produção executado em sessão anterior — ver
> `docs/go-live-plan.md`/`docs/deployment.md`, ainda não refletido no restante deste arquivo).

- **Duas jornadas de quiz** (`/avaliacao` — atendimento, `/seja-parceiro` — parceria), 10 perguntas
  cada, texto e opções seguindo exatamente o que foi especificado. Nome/e-mail/WhatsApp juntos na
  etapa 1 (com autorização de contato); cidade/UF na etapa 2; gate de consentimento específico de
  dados de saúde antes das perguntas 5–7 do quiz de atendimento (a jornada de parceria não tem
  pergunta de saúde); consentimento de marketing opcional e **desmarcado por padrão** no fim.
- **Integração automática ao CRM**: reaproveita a mesma lógica de deduplicação de
  `submit_public_form` (contato igual + nome semelhante reaproveita a pessoa; nome bem diferente
  cria pessoa nova e sinaliza revisão via `crm_tasks` `dedupe_review` — nunca mescla sozinho).
  Atendimento → funil "Pacientes"; parceria → funil "Parceiros" (ambos já semeados). "Quiz iniciado"
  e "Quiz concluído — aguardando contato" registrados em `interactions`; tarefa `first_contact`
  criada com `dedupe_key` (idempotente). Segmento **"Potencial Academy"**: toda captação de
  parceria ganha a tag `Potencial Academy` (reaproveitando `tags`/`person_tags` já existentes) —
  nunca matrícula, nunca acesso a curso, nunca uma segunda oportunidade.
- **Schema novo** (migration `20260924000038_lead_quizzes.sql`, aplicada e testada só no Dev
  `fsvtzowcwhvwtluwrhnb`): tabelas `quiz_leads` (sem GRANT direto a nenhum papel — acesso só pelas
  funções abaixo, RLS habilitado como reforço) e `quiz_whatsapp_numbers` (seedada com os números já
  reais em uso no site, `src/lib/contact.ts` — nunca inventados). Funções públicas (`anon`):
  `quiz_start`, `quiz_save_progress`, `quiz_set_health_consent`, `quiz_complete`,
  `quiz_log_whatsapp_click`, `quiz_whatsapp_number`. Funções administrativas (`authenticated`):
  `list_quiz_leads`, `get_quiz_lead_detail` (mascara as 3 respostas de saúde para quem não tem papel
  de gestão — `sales` nunca vê, `manager`/`ops_admin`/`unit_manager` veem), `quiz_lead_metrics`.
- **Identificador da submissão = `id` (uuid aleatório)**: o navegador nunca informa
  `person_id`/`opportunity_id` — só pode agir sobre a própria submissão. Idempotência por
  `dedupe_key` (contato + jornada + dia): reenvio no mesmo dia retoma a mesma submissão, nunca
  duplica. Validação de resposta é um allowlist rígido por jornada+chave
  (`private.quiz_validate_answer`), igual ao padrão de `forms_validate`/`validate_blocks`.
  Abandono/inatividade: **não há status "abandonado" gravado** — é calculado na leitura por
  `quiz_lead_metrics` (>24h sem `last_activity_at` e status ≠ completed), documentado aqui como a
  regra escolhida em vez de marcar abandono ao fechar a aba.
- **WhatsApp obrigatório ao final**: mensagem gerada a partir das respostas, com prévia
  editável, opção desmarcada por padrão para incluir dor/qualidade de vida (só atendimento) e
  outra para incluir a faixa de investimento; "Copiar mensagem"; número vem de
  `quiz_whatsapp_number()` (admin-configurável por jornada/unidade em `quiz_whatsapp_numbers`,
  nunca inventado); clique registrado separadamente da conclusão (`whatsapp_clicked_at`).
- **Admin "Gestão → Captação de leads"** (`/admin/captacao-leads`, mesmos papéis do CRM/Pessoas):
  busca/filtros (jornada, status, revisão)/paginação, detalhe da submissão, indicadores reais
  (capturados por jornada, taxa de conclusão, aguardando contato, tempo até 1º contato, conversão
  em avaliação agendada/parceiro aprovado, segmento Academy, interesse por tema, origem/UF, cliques
  no WhatsApp) com período explícito — nunca confunde clique com envio real.
- **CTAs**: "Quero cuidar da minha dor" (home, bloco logo após o método + rodapé) e "Quero ser
  fisioterapeuta parceiro" (`/trabalhe-conosco`, destacado + rodapé), componentes reutilizáveis
  (`QuizCta`/`QuizFloatButton`), botão fixo discreto só no mobile, chamadas específicas existentes
  preservadas.
- **Testes**: `supabase/tests/019_lead_quizzes.sql` (21/21, transação sempre desfeita) + E2E novo
  `e2e/08-lead-quizzes.spec.ts` (3/3 — as duas jornadas completas com WhatsApp interceptado via
  `route.fulfill` nunca chegando ao servidor real, e reenvio same-day sem duplicar) — suíte E2E
  completa **30/30**, sem regressão. `tsc`/`eslint`/`vite build` ok. Dados sintéticos de QA
  removidos do Dev ao final de cada rodada de teste.
- PR **#2 aberto em rascunho**, branch `feature/lead-quizzes`, sem merge na `main`.

## Sessão seguinte (2026-09-23) — Destino do CTA no editor de páginas (finaliza a pendência acima)

> Mesma branch `feature/lead-quizzes`, mesmo escopo Dev/preview — sem DNS, produção ou merge.

- **Bloco `cta` do editor** (`src/features/pages/blocks.ts`/`BlockEditor.tsx`) ganhou o campo
  **"Destino do botão"**: *Avaliação de paciente* (`/avaliacao`), *Parceria profissional*
  (`/seja-parceiro`) ou *Link personalizado* (comportamento anterior, inalterado). O texto do botão
  (`label`) continua independente do destino. Blocos já existentes **não têm a chave `target`** —
  tratados como `custom` automaticamente (`ctaTargetOf()`), então nenhum CTA/página antiga muda de
  destino sozinha; testado publicando de propósito um bloco sem `target` e confirmando que o link
  personalizado antigo continua intacto (`e2e/09-cta-block-quiz-target.spec.ts`, 2º teste).
- **Mesma função resolve preview e publicada**: `resolveCtaHref()` (`blocks.ts`) é chamada pelo
  `PageRenderer`/`BlockView` tanto na pré-visualização do editor quanto na página `/:slug` real —
  nunca podem divergir. Link para link personalizado continua validado por `safeUrl()` (mesmos
  protocolos seguros de sempre); link para jornada de quiz é sempre a rota interna confiável, sem
  validação de URL externa (não é entrada do usuário).
- **Origem registrada + campanha preservada, sem PII na URL**: `resolveCtaHref()` monta
  `/avaliacao?from=/<slug-da-página>&utm_*` (só as 5 chaves `utm_` já usadas em `submit_public_form`
  — nunca um parâmetro arbitrário, nunca dado pessoal). `QuizRunner` lê `from` e usa como
  `origin_path`/`page_slug` no `quiz_start` (antes disto, esses campos só continham a própria rota
  do quiz, "/avaliacao"/"/seja-parceiro" — agora registram de fato a landing page de origem). Os
  CTAs fixos (`QuizCta`/`QuizFloatButton` — home, rodapé, `/trabalhe-conosco`) foram atualizados do
  mesmo jeito, por consistência.
- **Persistência**: como o destino é só mais uma chave dentro do JSON do bloco (`draft_content`/
  `published_content`), salvar rascunho, reabrir, criar versão e publicar já funcionam de graça pelo
  mecanismo existente (`page_save_draft`/`page_publish`/`add_version`) — nenhuma migration nova foi
  necessária (`validate_blocks` já valida só o `type`, não os campos internos de cada bloco).
- **Validado ao vivo no Dev** (não só em teste automatizado): criada e publicada uma landing page
  com CTA → `/avaliacao` (clicado, quiz concluído, `origin_path`/`page_slug` corretos, oportunidade
  no funil Pacientes) e outra com CTA → `/seja-parceiro` (mesma checagem, funil Parceiros); uma
  terceira página com um bloco `cta` deliberadamente **sem** `target` (simulando dado legado)
  confirmada apontando para o link personalizado original, sem alteração. As 3 páginas de teste e os
  cadastros/oportunidades sintéticos foram removidos do Dev ao final.
- **Testes**: `e2e/09-cta-block-quiz-target.spec.ts` (2/2) + suíte completa **32/32** (o
  `04-agenda-concurrency` falhou uma vez em lote, como já documentado — passou isolado, flake de
  timing conhecido, não é regressão desta mudança). `tsc`/`eslint`/`vite build` ok.
- **Preview para revisão**: `npm run dev -- --port 5181 --host 127.0.0.1` → `http://127.0.0.1:5181/`
  (editor em `/admin/paginas`, quizzes em `/avaliacao` e `/seja-parceiro`).

---

Atualizado: 2026-09-22 (sessão 7) · Branch `feature/hp-group-hub` · [PR #1](https://github.com/Alexandrepavao/hugo-pavao-fisio-home/pull/1) em rascunho (sem merge na `main`)

> Todo o trabalho abaixo foi implementado e validado no ambiente **Dev** (banco + servidor local apontando para o Supabase Dev) e por **27 testes E2E automatizados** (Playwright, suíte anterior preservada) + **3 arquivos de teste SQL novos** (016–018, 32/32 asserções). O deploy publicado na Netlify **ainda não foi validado ao vivo** — segue atrás da proteção de equipe (bloqueio externo inalterado). Produção (`HP Group Core`) segue vazia e não foi tocada.

## Ambiente
| Recurso | Destino | Observação |
|---|---|---|
| Repositório | `Alexandrepavao/hugo-pavao-fisio-home` | branch `feature/hp-group-hub`, PR #1 em rascunho |
| Supabase Dev/Preview | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`) | migrations 001–036 aplicadas e testadas; `pg_cron` habilitado (job `domain-events-retry`, a cada minuto) |
| Supabase Produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | **vazio**, não tocado |
| Netlify | site `hp-group-hub`, time "Hp Group" | **protegido por SSO de equipe** — validação externa do deploy publicado continua bloqueada (ver seção própria abaixo) |

## O que mudou nesta sessão (7) — as 4 pendências de item 7 da sessão anterior, revisão visual, roadmap de white label
Preservado integralmente o que a sessão 6 entregou (contratos recorrentes/MRR, DRE classificada, mapa, autoatendimento do paciente, trilhas e correções financeiras) — nada foi refeito, só estendido.

1. **Pesquisas** (`/admin/pesquisas` + `/pesquisas` no portal, migration 032): criar/editar/publicar/encerrar, perguntas de escolha única/múltipla/texto livre com opções, público-alvo (pacientes/parceiros/alunos), identificada **ou** anônima de verdade (pesquisa anônima nunca grava `person_id` — estruturalmente ausente do dado, não só escondido no relatório), dashboard com k-anonimato (quebra por pergunta só com 5+ respostas no recorte de período/unidade), lista de respostas individuais separada do dashboard agregado (só existe para pesquisa identificada). **Versionamento imutável**: editar uma pergunta depois de publicada congela automaticamente uma nova versão (snapshot) — respostas já registradas continuam lendo o texto original de quando foram enviadas, nunca o atual. Envio por e-mail explicitamente fora do escopo (depende do SMTP, ainda bloqueado). Testado: `supabase/tests/016_research_surveys.sql` (15/15) — permissão de administrar vs. responder, público-alvo errado rejeitado, k-anonimato, pergunta obrigatória em branco, reenvio duplicado rejeitado, versionamento (prompt reformulada não muda resposta antiga), anonimato real, pesquisa encerrada não aceita resposta.
2. **Contas corporativas** (`/admin/contas-corporativas`, migration 033/034 — estende o schema já existente de `corporate_accounts`/`corporate_members`/`corporate_indicators` da sessão anterior, não recria): contatos da empresa com um responsável financeiro identificado (só um por conta), contratos corporativos com produtos/condições negociadas, pessoas atendidas vinculadas **sem duplicar** o cadastro (a mesma pessoa que já existe só é ligada à conta), relatório de utilização e valores (atendimentos + valor recebido) filtrável por período, com o mesmo piso de k-anonimato (5+ vínculos) já usado desde a sessão anterior. Separação clara: a empresa é sempre um **cliente do HP** dentro da mesma organização — nunca uma organização nova. Testado: `supabase/tests/017_corporate_accounts.sql` (8/8) — só um responsável financeiro por conta, vincular pessoa não duplica cadastro, k-anonimato no relatório, papel comercial (`sales`) não lê contas corporativas nem o relatório.
3. **Retentativa de eventos — processamento real, não só manual** (migration 035): reaproveita a infraestrutura já existente (`domain_events`/`event_handlers`/`automation_runs`/`dispatch_event`) e adiciona a camada de fila que faltava — reserva por evento com `FOR UPDATE SKIP LOCKED` (dois workers nunca pegam o mesmo evento), recuperação automática de reserva órfã (>5min sem conclusão = worker presumivelmente caiu, evento volta pra fila), intervalo progressivo entre tentativas (2^tentativas minutos, teto de 60), limite de 8 tentativas, distinção entre falha temporária (retentativa) e definitiva (`errcode 'P0002'`, vai direto pra `dead`). **`pg_cron` habilitado e agendado de verdade** (job `domain-events-retry`, a cada minuto) — não é só "testado, falta ativar": já está rodando em Dev. Reprocessamento manual (`retry_failed_events()`, só gestor) passou a reservar também e a ficar auditado (`audit_log`). Tela nova em Auditoria → aba "Automações (eventos)": fila com estado/tentativas/próxima tentativa/erro, botão de reprocessar. Testado com um adaptador controlado (criado e desfeito na própria transação do teste — nunca dispara e-mail/webhook real): `supabase/tests/018_event_retry_engine.sql` (9/9) — backoff progressivo, reserva exclusiva, recuperação de worker interrompido, idempotência (reprocessar um handler já confirmado nunca duplica a "confirmação externa"), falha definitiva vs. tentativas esgotadas, reprocessamento manual auditado.
4. **Metadados sociais no HTML cru** (Netlify Edge Function `netlify/edge-functions/social-meta.ts`, novo): título, descrição, URL canônica, Open Graph, twitter:card e imagem (sempre absoluta, resolvida contra a origem da requisição) injetados no HTML **antes** de qualquer JavaScript rodar — o app é uma SPA, e sem isto os metadados só apareciam depois do React montar, o que a maioria dos crawlers de rede social nunca executa. Página rascunho/desativada/endereço inexistente nunca expõe conteúdo — em vez disso ganha `noindex, nofollow` explícito. Todo texto do editor passa por escape de HTML. **Validado ao vivo com `netlify dev` local** (não só simulado): `curl` direto (sem JS) confirmou título/descrição/OG/canonical corretos numa página publicada real, `noindex` numa página rascunho e numa desativada, e um título/descrição deliberadamente maliciosos (`</title><script>…`) saindo escapados no HTML, nunca como tag ativa. Achado e corrigido no processo: as tags `og:*`/`twitter:*` padrão do `index.html` não estavam sendo removidas, então ficavam **duplicadas** — a maioria dos crawlers usa a primeira ocorrência de cada propriedade, então a genérica do site venceria mesmo com a da página presente. Validação contra a Netlify publicada **não foi possível** — segue atrás da proteção de equipe (bloqueio externo, não removido).
5. **Revisão visual em 1440px e 390px**: Financeiro (visão geral + children/header), Recorrência (MRR/ARR), DRE, Conciliação, Início + mapa, Área do paciente (com o formulário de autoatendimento), Academy, e as três telas novas desta sessão (Pesquisas, Contas corporativas, Automações) — nenhum problema visual encontrado (sem corte de texto, sobreposição ou overflow) nos dois tamanhos. Conflito de porta local resolvido sem encerrar processo de outro projeto: identifiquei o processo real ocupando a porta padrão e usei uma porta dedicada para este projeto (`netlify.toml` ganhou `[dev].targetPort = 8080` — sem isso `netlify dev` nunca encontrava o Vite, que roda nessa porta por configuração do projeto, não na porta 5173 padrão do Vite).
6. **Atribuição da licença do mapa**: o `@svg-maps/brazil` (CC BY 4.0) não tinha nenhum aviso de atribuição visível no produto — a licença exige. Adicionado um crédito discreto abaixo do mapa, com link para a fonte (MapSVG) e para os termos da licença.
7. **`docs/white-label-roadmap.md`** (novo): registra a direção futura de SaaS white label sem iniciar nenhuma reconstrução — o que já ajuda por reutilização (isolamento por organização/unidade, utilitários de período promovidos para `src/lib/`), o que é hoje deliberadamente específico do HP Group (marca espalhada em ~16 arquivos, papel `physio`), e os próximos passos concretos só quando isso for priorizado.
8. **1 regressão real encontrada e corrigida durante a bateria de testes final**: `e2e/07-finance-behaviors.spec.ts` reaproveitava a conta QA compartilhada ("Aluna QA Teste") para criar vendas/recebimentos — isso quebrou `03-academy-and-isolation.spec.ts`, que verifica que uma aluna não enxerga `receivables` nenhum via API direta (a suíte financeira tinha deixado recebíveis reais na conta dela). Corrigido: a suíte financeira agora cria sua própria pessoa isolada a cada execução via `create_person()` (o mesmo RPC que a tela Pessoas usa — inserir direto na tabela esbarra numa policy de RLS que não reproduzimos fora do fluxo real da aplicação).

## Estado por módulo
| Módulo | Estado | Evidência |
|---|---|---|
| Fundação, bootstrap de gestores, autenticação | ✅ Dev | testes SQL 001–002; E2E `01-auth-and-routes` |
| HP Pages + formulários públicos | ✅ Dev | teste SQL 003 (30/30); E2E `02-checkup-journey`; metadados sociais no HTML cru (edge function) |
| CRM | ✅ Dev | testes SQL 003/004; E2E |
| Pessoas — mesclagem e importação | ✅ Dev | teste SQL 009 (21/21) |
| Agenda, pacotes, sessões | ✅ Dev | teste SQL 004 (26/26); concorrência real (E2E `04-agenda-concurrency`) |
| Financeiro — vendas, recebíveis, contas a pagar, comissões | ✅ Dev | teste SQL 005 (33/33); E2E comportamental `07-finance-behaviors` |
| Financeiro — MRR/ARR (contratual), DRE classificada, conciliação, geografia com mapa | ✅ Dev | testes SQL 013/014 + E2E (sessão 6, preservado) |
| Academy + Acompanhamento + trilhas | ✅ Dev | teste SQL 006 (42/42); E2E `03-academy-and-isolation` + `06-academy-tracks` |
| Área do paciente — autoatendimento | ✅ Dev | teste SQL 015 (10/10) |
| **Pesquisas** | ✅ Dev | teste SQL 016 (15/15) — nova nesta sessão |
| **Contas corporativas** | ✅ Dev | teste SQL 017 (8/8) — nova nesta sessão |
| **Retentativa de eventos** | ✅ Dev | teste SQL 018 (9/9); `pg_cron` ativo e rodando — nova nesta sessão |
| **Metadados sociais** | ✅ Dev (validado com `netlify dev` local) | ver seção própria — nova nesta sessão |
| Parceiros | 🟡 | teste SQL 007 (16/16) |
| Dashboard / Início | ✅ Dev | teste SQL 008 (12/12) |
| Produtividade/foco ("Meu dia") | ✅ Dev | teste SQL 010 (13/13); E2E `05-productivity` |
| E-mail (Resend + SMTP Auth) | 🔒 | função pronta, não validada — bloqueio externo, inalterado |
| Deploy publicado na Netlify | 🔒 | protegido por SSO de equipe — validação externa (inclusive dos metadados sociais publicados) segue bloqueada |

## Testes desta sessão
**Banco (SQL, Dev, transação sempre desfeita):**
- `016_research_surveys.sql` (novo, 15/15) — permissão de administrar vs. responder; público-alvo errado rejeitado; k-anonimato (4 respostas indisponível, 5 libera com contagem certa); pergunta obrigatória em branco rejeitada; reenvio da mesma pessoa rejeitado; editar pergunta pós-publicação cria nova versão sem alterar resposta antiga (snapshot preserva o texto original); pesquisa anônima nunca grava `person_id` e não tem lista de respostas individuais; pesquisa encerrada não aceita nova resposta; lista de respostas individuais só existe pra pesquisa identificada.
- `017_corporate_accounts.sql` (novo, 8/8) — papel comercial não enxerga conta corporativa; só um contato responsável financeiro por conta; contrato + item (produto/condição); vincular pessoa não duplica cadastro; relatório indisponível com <5 vínculos, libera com 5; papel comercial não acessa o relatório.
- `018_event_retry_engine.sql` (novo, 9/9) — backoff progressivo; reserva exclusiva entre workers; recuperação de reserva de worker que caiu (>5min); idempotência (reprocessar handler já confirmado nunca duplica confirmação externa); falha definitiva (`P0002`) vs. tentativas esgotadas (8x); reprocessamento manual auditado.

**E2E (Playwright, Edge do sistema, contra o Supabase Dev real):** `npx playwright test` — **27/27 passando**, ~1min30s (suíte da sessão anterior preservada e revalidada; nenhum teste novo de item 7 é E2E, ficaram cobertos por SQL + verificação manual ao vivo no navegador para as telas administrativas).

**Front:** `tsc` (0 erros), `eslint` (0 erros, 19 avisos pré-existentes não relacionados), `vite build` (ok), `vitest` (15/15).

**Distinção implementação vs. teste local vs. teste em Dev vs. validação de deploy** (pedido explicitamente):
- **Implementado e testado localmente + contra o Dev real**: Pesquisas, Contas corporativas, retentativa de eventos (SQL + telas verificadas ao vivo no navegador via `netlify dev`/Vite local).
- **Testado com `netlify dev` local contra o Dev real, incluindo `curl` no HTML cru**: metadados sociais — este é o único item desta sessão validado através da MESMA camada (Netlify Edge Function) que roda em produção, só que localmente.
- **Não validado em nenhum nível**: nada do deploy publicado na Netlify — a proteção de equipe continua de pé, como pedido, e não tentei contorná-la.

## O que ficou fora do escopo desta sessão (registrado, não implementado)
`docs/white-label-roadmap.md` registra a direção de SaaS white label sem construir nada disso agora: reconstrução multiempresa, provisionador de novas organizações, questionário de onboarding por segmento.

## Bloqueios que dependem de você
1. **Proteção de equipe da Netlify** (não é o login do app): abra `https://hp-group-hub.netlify.app` no navegador — entre com sua conta Netlify do time "Hp Group" quando quiser retomar a validação do deploy publicado, incluindo os metadados sociais desta sessão (implementados e testados localmente, mas nunca confirmados contra a URL pública real).
2. **Resend + SMTP do Supabase Auth**: conta, domínio verificado do HP Group, `RESEND_API_KEY`/`EMAIL_FROM` — sem isso não valido o fluxo real de e-mail nem o envio de pesquisas por e-mail (passo a passo em `docs/integrations.md`).
3. **Go-live**: destino de hospedagem definitivo e aplicação das migrations em produção — decisão sua, nada foi feito na `HP Group Core`.

## Próximo passo exato
1. Você conclui o login no navegador embutido → eu valido o deploy publicado, incluindo os metadados sociais (título/OG/canonical) direto na URL pública com uma ferramenta de terceiros (ex.: debugger de compartilhamento do Facebook/LinkedIn) — hoje só testei localmente.
2. Configurar Resend/SMTP quando você tiver as credenciais; então testar recuperação de senha, primeiro acesso e envio de pesquisa por e-mail reais.
3. Quando você tiver conteúdo real (cursos gravados) para o HP Academy, publicar as trilhas e vincular os cursos — continuam todas em rascunho, de propósito.
4. Criar a primeira pesquisa e a primeira conta corporativa reais quando você tiver conteúdo/dados de verdade — as telas estão prontas, sem nenhum dado de exemplo inventado.
