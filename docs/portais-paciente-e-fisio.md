# Portais do paciente e do fisioterapeuta — estado implementado (F1–F8)

> 2026-11-05/06 · branch `feat/portais-paciente-fisio` · **Somente Dev.** Nada foi para produção. Plano e decisões do proprietário: [`plano-portais-paciente-e-fisio.md`](plano-portais-paciente-e-fisio.md).
> Migrations **096 → 103** (aplicadas no Dev, uma a uma) · testes SQL **S33–S40** (323 itens) · E2E **R35–R41** · E2E existentes ajustados às novas rotas (R03, R04, R05, R09, R15, R16, R29, 06).
> Legenda: ✅ implementado e comprovado por teste · 🟡 implementado, com limite descrito · 🔒 depende de serviço/decisão externa e **não** está provado.

## 1. Rotas e telas

| Portal | Rotas | Telas |
|---|---|---|
| **Paciente** (`member`) | `/paciente` (Início) · `/evolucao` · `/treinos` · `/agenda` · `/mais` · `/chamados` | Início com cartões (próxima consulta, plano, dor início→agora, treino de hoje/sequência, meta, saldo, check-in, “Próximo passo para você”) · Evolução (check-in semanal, gráficos início×agora por medida, linha do tempo por consulta, “o que quero voltar a fazer”, jornada existente) · Treinos (treino de hoje, marcar exercícios, esforço/dor, pular) · Agenda (existente) · Mais (ofertas, pacote, dados, canal de dúvidas, pessoas que represento, quem tem acesso, notificações, consentimentos, quem acessou o prontuário) · Chamados |
| **Fisio** (`physio`) | `/fisio` · `/pacientes` · `/agenda` · `/dia` · `/desempenho` · `/treinos` · `/chamados` | Início (hoje, alertas, números) · Pacientes (jornada, **evolução e registro rápido pós-sessão**, **prescrição de treinos**) · Agenda e Meu dia (existentes) · Desempenho (KPIs, extrato de repasse sem nome de paciente + resumo existente) · Biblioteca de exercícios · Chamados clínicos |
| **Admin** (Gestão/Financeiro) | `/admin/responsaveis` · `/admin/chamados` · `/admin/programas` · `/admin/financeiro/precos-repasses` | Responsáveis e cuidadores · Fila de chamados · Programas e ofertas (+ indicadores de retenção) · Preços e repasses (preço final, repasse por sessão, lançamentos, fisio responsável) |

Celular: barra inferior de 5 abas · computador: barra lateral. PWA instalável (manifest, ícones, service worker que **não** guarda dado de API). Login: fisio sem papel de gestão cai em `/fisio`.
Rotas antigas (`/admin/meu-dia`, `/admin/meu-resumo`, `/admin/acompanhamento`) continuam valendo.

## 2. O que cada fase entrega

| Fase | Migration | Conteúdo | Situação |
|---|---|---|---|
| F1 | 096 | `my_home()` e `prof_home()` (Início), shells, PWA | ✅ S33 · R35 |
| F2 | 097 | Responsável legal/tutor/curador/procurador/cuidador/delegado; criança <12 sem login; adolescente 12–17 só com autorização; responsável legal cessa aos 18; verificação só pelo admin; suspensão (disputa); consentimentos versionados e append-only; senha recente para ações sensíveis; leitura clínica do admin **registrada**; cabeçalho `x-acting-as` validado pelo banco | ✅ S34 · R36 |
| F3 | 098 | 6 especialidades, catálogo de 19 medidas sem licença (com fonte), medidas e notas de sessão imutáveis, evolução (séries, linha do tempo), registro rápido idempotente | ✅ S35 · R37 |
| F4 | 099 | Chamados internos (elegibilidade derivada dos pagamentos, clínico x administrativo, SLA 24 h corridas/úteis, notas internas, reabertura 7 dias, escalada 12 h, KPIs) | ✅ S36 · R38 |
| F5 | 100 | Repasse **por sessão atendida**: regra do admin por produto, lançamento no livro de sessões, troca de fisio, resíduo ao responsável, cobertura do parcelado, estados, devolução, retroativo explícito, ajuste manual; `prof_kpis`; extrato do fisio | ✅ S37 · R39 |
| F6 | 101 | Biblioteca de exercícios (texto), prescrição, registro do paciente, sequência/adesão derivadas, alertas de dor ≥7 e adesão baixa, adesão real em `prof_kpis` | ✅ S38 · R40 |
| F7 | 102 | Check-in semanal, programas e ofertas decididos pelo admin (consentimento comercial), “Tenho interesse” sem venda, indicadores de gestão | ✅ S39 · R41 |
| F8 | 103 | Fila de lembretes (e-mail e push), preferências, aparelhos, destinatário correto para menores, WhatsApp reservado | ✅ fila/regras (S40) · 🔒 **envio real** |

## 3. Regras de negócio decididas (e onde estão no código)

- **Comissão**: valor cadastrado = valor **final**; repasse **por sessão**, **igual para todos**, definido pelo admin por produto e **congelado** em cada lançamento; cada fisio recebe 100% das sessões que **atendeu**; o que foi pago e não atendido vai ao **fisio responsável** (ou ao último que atendeu); lançamento nasce **pendente** a cada sessão atendida e o admin autoriza/paga. `private.payout_on_ledger` (gatilho em `session_ledger`), `private.payout_residual`, `physio_payout_*`.
- **Privacidade**: o **gestor (dono)** lê dado clínico **só em leitura e com registro** (`admin_patient_journey`, `admin_patient_evolution`, `admin_patient_training`, chamados clínicos). Adm. operacional, gestor de unidade, comercial e financeiro **não** leem clínico. As tabelas clínicas seguem sem leitura direta. O paciente vê **quem acessou** o prontuário (`my_access_log`).
- **Menores/idosos**: ver plano §4.6. Aos 18 anos o acesso do responsável legal cessa **sozinho** (derivado da data de nascimento).
- **Ofertas**: o admin cria o programa, define o preço (produto ligado) e escolhe a quem oferecer; o fisio **não** indica. Só com consentimento de comunicação comercial. A oferta guarda o critério usado.
- **Prazos**: chamado clínico 24 h **corridas**; administrativo 24 h **úteis** (sábado/domingo não contam; fuso de São Paulo).
- **Datas**: vigências, períodos e “hoje” usam o fuso de **São Paulo** (`private.today_sp()`), nunca a data UTC do servidor.

## 4. Contrato de RPC (web hoje, app amanhã)
`my_home` · `my_evolution` · `my_training` · `my_workout_log` · `my_checkins` · `my_checkin_submit` · `my_measurement_add` · `my_tickets` · `my_ticket(_open/_reply/_eligibility)` · `my_offers` · `my_offer_respond` · `my_representations` · `my_representatives` · `my_representation_accept` · `my_consents` · `consent_set` · `my_access_log` · `my_notification_prefs` · `my_notification_pref_set` · `push_subscribe/unsubscribe` ·
`prof_home` · `prof_patient_evolution` · `prof_session_record` · `prof_measurement_add` · `prof_training` · `prescription_save/_set_status` · `exercise_save/_archive/_list` · `prof_kpis` · `prof_commission_statement` · `support_queue/_ticket/_reply/_set_status/_reclassify/_kpis` ·
`physio_pricing_list` · `product_share_set` · `product_price_set` · `physio_payouts_list/_authorize/_pay/_void/_reassign/_adjust/_missing/_backfill` · `physio_packages_open` · `package_responsible_set` · `physio_package_close` · `representation_save/_verify/_suspend/_unsuspend/_suspend_patient/_revoke/_document_add` · `representations_admin_list` · `admin_patient_journey/_evolution/_training` · `clinical_access_report` · `program_save/_list/_candidates` · `program_offer_create/_set_status` · `offers_admin_list` · `retention_kpis` · `notifications_enqueue_due/_pending` / `notification_mark` (**só service role**).
As telas novas não consultam tabelas diretamente (exceto listas de apoio: unidades, produtos, especialidades, profissionais, `people` na busca do admin). Um app nativo reaproveita as mesmas funções; “agir em nome de” é o cabeçalho HTTP `x-acting-as`.

## 5. O que NÃO está provado / limites (leia antes de decidir produção)
1. 🔒 **Envio real de e-mail e push** (`supabase/functions/notify-dispatch`): escrita, **não publicada nem testada**. Precisa de `RESEND_API_KEY`, `NOTIFY_FROM`, chaves VAPID (`VITE_VAPID_PUBLIC_KEY` no front), `NOTIFY_SECRET` e um agendador (a cada ~15 min). Sem isso a fila fica em `queued`. A tela de Notificações avisa quando o push não está disponível.
2. 🔒 **Vídeo dos exercícios / Bunny**: o campo `video_ref` está reservado; nenhum vídeo é usado. Reprodução real continua não provada (ver `jornada-do-paciente.md`).
3. 🔒 **Jurídico (bloqueia produção com dado real)**: textos de consentimento são **minutas** (`consent_texts.is_draft`); guarda/exportação do prontuário; publicidade em saúde; uso de dado de saúde para direcionar oferta; prazo de guarda dos documentos do responsável.
4. 🟡 **Repasse**: separado da comissão percentual existente; “marcar pago” **não** gera despesa no contas a pagar nem paga o banco; sessão avulsa/protocolo sem pacote entram por **ajuste manual**; estorno em dinheiro do pacote não reescreve repasses já pagos (usar ajuste); sessões anteriores à vigência da regra só entram pelo botão “Gerar lançamentos”.
5. 🟡 **Documentos do responsável**: o admin anexa (bucket privado `representation-docs`); o responsável não envia pelo app ainda.
6. 🟡 **Idade**: `people.birth_date` é opcional; sem data o cadastro é tratado como adulto (o portal pede a data no primeiro acesso). Exigir data de nascimento no cadastro quebraria fluxos existentes.
7. 🟡 **Instrumentos clínicos**: só medidas por teste/procedimento e escalas numéricas de uso livre; questionários licenciados (DASH, WOMAC, Berg, Barthel etc.) **não** entram sem conferir a licença.
8. 🟡 **Notificações de chamado e ofertas** não saem por e-mail/push (só aparecem nas telas). Anexos em chamados não foram implementados.
9. 🟡 **App de loja (Capacitor)**: não feito; o PWA é a entrega. Para loja: exclusão de conta dentro do app, política de privacidade e tela de consentimento são pré-requisitos.
10. Dados de QA do Dev foram tocados pelos E2E (plano/especialidade do paciente de QA, vínculo do fisio de QA). Os testes limpam o que criam; o que é mutação de plano permanece.

## 6. Como rodar os testes
```bash
node supabase/tests/run-sql.mjs supabase/tests/release/S33_portais_inicio.sql supabase/tests/release/S34_responsaveis_consentimentos_acesso.sql supabase/tests/release/S35_evolucao_medidas.sql \
  supabase/tests/release/S36_chamados.sql supabase/tests/release/S37_repasses_por_sessao.sql supabase/tests/release/S38_treinos_em_casa.sql supabase/tests/release/S39_retencao_ofertas.sql supabase/tests/release/S40_lembretes.sql
npx playwright test e2e/release/R35-portais-paciente-e-fisio.spec.ts e2e/release/R36-responsaveis-e-consentimentos.spec.ts e2e/release/R37-evolucao-do-paciente.spec.ts \
  e2e/release/R38-chamados.spec.ts e2e/release/R39-repasses-por-sessao.spec.ts e2e/release/R40-treinos-em-casa.spec.ts e2e/release/R41-retencao-e-ofertas.spec.ts --workers=1
```
(`SUPABASE_ACCESS_TOKEN` e `HP_QA_PASSWORD` nas variáveis do usuário; sempre `--workers=1`.)

## 7. Roteiro para levar à produção (somente com a autorização do proprietário)
1. Resolver o item 3 acima (jurídico) — **antes de qualquer dado real**.
2. `node supabase/tools/promover.mjs --pr=<n>`: as migrations 096–103 serão aplicadas na ordem. **Contêm `delete from` dentro de funções** (`prescription_save` apaga os itens antigos da própria prescrição) — o gate de DELETE do `promover` vai exigir `--aceito-destrutivo` e a **confirmação explícita** do proprietário.
3. A migration 097 **muda `private.current_person()`** (agora honra o cabeçalho `x-acting-as`, validado) e a regra de leitura clínica do admin: conferir após o deploy que paciente e fisio entram normalmente e que o gestor lê pelo caminho registrado.
4. Cadastrar a regra de repasse por produto em **Financeiro › Preços e repasses** (sem regra, nenhum lançamento é criado) e atribuir o **fisio responsável** dos pacotes ativos.
5. Backup antes (`npm run backup:producao`); depois, publicar a Edge Function de lembretes só quando as chaves existirem.
