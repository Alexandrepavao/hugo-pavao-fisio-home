# HP Group Hub — Status do Projeto

## Sessão mais recente (2026-09-23) — Quizzes de captação (atendimento/parceria)

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
