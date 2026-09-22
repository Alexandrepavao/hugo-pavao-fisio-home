# HP Group Hub — Status do Projeto

Atualizado: 2026-09-22 (sessão 6) · Branch `feature/hp-group-hub` · [PR #1](https://github.com/Alexandrepavao/hugo-pavao-fisio-home/pull/1) em rascunho (sem merge na `main`)

> Todo o trabalho abaixo foi implementado e validado no ambiente **Dev** (banco + servidor local apontando para o Supabase Dev) e por **27 testes E2E automatizados** (Playwright) + **5 arquivos de teste SQL novos** (013–015 e o achado de dedup na conciliação). O deploy publicado na Netlify **ainda não foi validado ao vivo** — está atrás da proteção de equipe da Netlify (ver bloqueio 1 abaixo), distinta do login do app. Produção (`HP Group Core`) segue vazia e não foi tocada.

## Ambiente
| Recurso | Destino | Observação |
|---|---|---|
| Repositório | `Alexandrepavao/hugo-pavao-fisio-home` | branch `feature/hp-group-hub`, PR #1 em rascunho |
| Supabase Dev/Preview | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`) | migrations 001–031 aplicadas e testadas |
| Supabase Produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | **vazio**, não tocado |
| Netlify | site `hp-group-hub`, time "Hp Group" | preview publicado (commit mais recente), **protegido por SSO de equipe** (não confundir com `/login` do app) |

## O que mudou nesta sessão (6) — auditoria de MRR/ARR, evolução da DRE, mapa, autoatendimento, trilhas testadas, Financeiro testado
1. **Auditoria semântica do MRR/ARR** (pedido explícito: "a ponte fechar matematicamente é necessário, mas não comprova que os dados representam MRR"). O sinal antigo (`products.recurrence` + `receivables.competence_month`) era, na prática, uma venda avulsa parcelada marcada como mensal — não um contrato recorrente com vigência. Criado `public.recurring_contracts` + `public.recurring_contract_changes` (histórico **append-only**, nunca sobrescreve, resolve estado "as of" por data efetiva). Nova aba "Contratos recorrentes" em Financeiro → Recorrência para registrar contrato/expansão/contração/pausa/retomada/cancelamento. MRR/ARR, Recebimentos, Contas a receber e Forecast por pagamentos agora são **entidades explicitamente separadas** na tela e na documentação (`docs/metrics.md`). Testado: `supabase/tests/013_mrr_contracts.sql` (14/14) — contrato anual normalizado, avulsa excluída, inadimplência ≠ cancelamento, cancelamento futuro, expansão/contração, estorno, reativação, imutabilidade histórica.
2. **DRE evoluída de "sempre indisponível" para dado real classificável**. Categorias de despesa ganharam classificação DRE (dedução/custo direto/despesa operacional) configurável em Configurações; Contas a pagar ganhou vínculo opcional a um produto (habilita margem por produto). Deduções/custos/despesas operacionais ficam disponíveis assim que existir *qualquer* categoria classificada — nunca travadas pela ausência de dado em outro lugar; o que não tem classificação aparece separado, nunca vira zero nem despesa operacional por padrão. Limitação de reconhecimento de receita para produtos não-pacote (é por pagamento recebido, não por competência) documentada honestamente, não escondida. Testado: `supabase/tests/014_dre_classification.sql` (11/11).
3. **Mapa do Brasil por UF** na Distribuição geográfica, com `@svg-maps/brazil` (CC-BY-4.0, ~147 KB, geometria estática, zero chamada externa — autorização do usuário verificada antes de instalar). Clique no estado filtra o ranking de cidades; cadastros fora do Brasil passaram a ser corretamente separados de "sem localização" (antes eram contados juntos por engano).
4. **Área do paciente ganhou autoatendimento real**: nome de preferência, telefone e cidade/UF editáveis pelo próprio paciente via RPC com lista explícita de campos permitidos, validação no servidor e auditoria — nunca papel, unidade, identificadores internos, dados clínicos ou contratos/pagamentos. Testado: `supabase/tests/015_patient_self_edit.sql` (10/10), incluindo tentativa de escrita em cadastro de outra pessoa (continua bloqueada pela RLS).
5. **Academy — trilhas ganharam E2E dedicado** (`e2e/06-academy-tracks.spec.ts`, 6 testes): criar/editar, vincular/ordenar cursos, publicar/despublicar, visibilidade no catálogo do aluno, e o ponto central pedido — **publicar uma trilha nunca libera automaticamente um curso pago/restrito** (comprovado clicando de fato: trilha publicada com um curso sem entitlement não aparece pro aluno até o acesso ser concedido à parte); despublicar a trilha não revoga entitlement já concedido; separação Área do paciente/Academy (dados de um portal nunca aparecem no outro).
6. **Telas novas do Financeiro ganharam E2E de comportamento** (`e2e/07-finance-behaviors.spec.ts`, 5 testes, não só carregamento): MRR contratual comprovadamente não inflado por venda avulsa da mesma pessoa/mês (por delta, via API); DRE — lançamento classificado aparece por categoria e habilita margem do produto; comissão gerada automaticamente no recebimento + fluxo autorizar/pagar; conciliação — sugestão exige confirmação explícita (nunca associação silenciosa por valor coincidente), reimportar o mesmo extrato não duplica, dupla conciliação é rejeitada com erro explícito.
7. **4 bugs reais encontrados escrevendo esses testes, e corrigidos** (detalhe em `docs/metrics.md`): papel `finance` sem acesso a nenhum relatório do Financeiro (`dash_units`); reimportar extrato duplicava linhas; toda conta financeira cadastrada pela tela de Configurações ficava, sem querer, inutilizável para conciliação (mensagem de erro enganosa "sem permissão" escondia a causa real); select de beneficiário de comissão sempre em branco (lia campo errado do retorno da API).

## Estado por módulo
| Módulo | Estado | Evidência |
|---|---|---|
| Fundação, bootstrap de gestores, autenticação | ✅ Dev | testes SQL 001–002; E2E `01-auth-and-routes` |
| HP Pages + formulários públicos | ✅ Dev | teste SQL 003 (30/30); E2E `02-checkup-journey` |
| CRM | ✅ Dev | testes SQL 003/004; E2E |
| Pessoas — mesclagem e importação | ✅ Dev | teste SQL 009 (21/21) |
| Agenda, pacotes, sessões | ✅ Dev | teste SQL 004 (26/26); concorrência real (E2E `04-agenda-concurrency`) |
| Financeiro — vendas, recebíveis, contas a pagar, comissões | ✅ Dev | teste SQL 005 (33/33); E2E comportamental `07-finance-behaviors` |
| Financeiro — MRR/ARR (contratual) | ✅ Dev | teste SQL 013 (14/14); E2E |
| Financeiro — DRE classificada | ✅ Dev | teste SQL 014 (11/11); E2E |
| Financeiro — conciliação bancária | ✅ Dev | teste SQL 012 (11/11) + achados novos (dedup, conta sem unidade); E2E |
| Financeiro — geografia com mapa | ✅ Dev | verificado ao vivo no navegador |
| Academy + Acompanhamento | ✅ Dev | teste SQL 006 (42/42); E2E `03-academy-and-isolation` |
| Academy — trilhas | ✅ Dev | E2E dedicado `06-academy-tracks` (6/6) |
| Área do paciente — autoatendimento | ✅ Dev | teste SQL 015 (10/10) |
| Parceiros | 🟡 | teste SQL 007 (16/16) |
| Dashboard / Início | ✅ Dev | teste SQL 008 (12/12) |
| Produtividade/foco ("Meu dia") | ✅ Dev | teste SQL 010 (13/13); E2E `05-productivity` |
| E-mail (Resend + SMTP Auth) | 🔒 | função pronta, não validada — bloqueio externo |
| Deploy publicado na Netlify | 🔒 | preview atualizado, atrás da proteção de equipe — ação sua necessária |
| Pesquisas (admin), contas corporativas (admin), agendador de retentativa de eventos, metadados sociais verificados por crawler | ⬜ | **não implementados nesta sessão** — ver "Próximo passo exato" |

## Testes desta sessão
**Banco (SQL, Dev, transação sempre desfeita):**
- `013_mrr_contracts.sql` (novo, 14/14) — contrato anual normalizado por mês; venda avulsa parcelada excluída da base do MRR; contrato ativo com parcela em atraso continua contando (inadimplência ≠ cancelamento); cancelamento com data futura; expansão e contração; estorno; reativação; mudança lançada hoje não altera histórico de meses passados; papel `finance` (não só `manager`) consegue ler o relatório.
- `014_dre_classification.sql` (novo, 11/11) — pagamento em mês diferente da competência, cancelamento, estorno, cobertura parcial de classificação, categoria sem classificação nunca vira despesa operacional nem trava o total consolidado.
- `015_patient_self_edit.sql` (novo, 10/10) — edição legítima de nome/telefone/cidade/UF; full_name e unit_id nunca mudam (não expostos pela função); telefone inválido rejeitado; troca de telefone nunca deixa dois "principais"; conta sem pessoa vinculada rejeitada; escrita direta em cadastro de outra pessoa continua bloqueada pela RLS; auditoria registrada.

**E2E (Playwright, Edge do sistema, contra o Supabase Dev real):** `npm run test:e2e` com `HP_QA_PASSWORD` — **27/27 passando**, ~1min40s.
- `06-academy-tracks.spec.ts` (novo, 6 testes) — trilhas: rascunho invisível, criar/reordenar/publicar pela interface, curso pago não liberado automaticamente ao publicar a trilha, liberação de entitlement mostra o curso na mesma trilha sem republicar nada, despublicar não revoga acesso já concedido, separação paciente/Academy.
- `07-finance-behaviors.spec.ts` (novo, 5 testes) — configurar categoria+conta pela interface, MRR não inflado por avulsa (via delta na API, robusto a dados pré-existentes), DRE classificada por categoria + margem por produto, comissão automática + autorizar/pagar, conciliação (sugestão≠confirmação, reimportação sem duplicar, dupla conciliação rejeitada).

**Front:** `tsc` (0 erros), `eslint` (0 erros, 19 avisos pré-existentes não relacionados), `vite build` (ok), `vitest` (15/15).

**Distinção implementação vs. teste** (pedido explicitamente): todo o código acima foi (a) implementado, (b) testado localmente contra o Supabase **Dev** real (SQL + E2E via browser real, não mocks) nesta sessão. **Nada foi validado no deploy publicado** (Netlify) — segue atrás da proteção de equipe, bloqueio inalterado desde a sessão anterior.

## O que NÃO foi feito nesta sessão (declarado explicitamente)
Item 7 do pedido — quatro funcionalidades **novas** (não testes de algo existente), cada uma exigindo schema + RPCs + tela própria: Pesquisas (admin de perguntas/campanhas), Contas corporativas (empresas/contratos/indicadores separando pagador de atendido), Agendador de retentativa de eventos (hoje só manual via `retry_failed_events()`), Metadados sociais verificados de fato contra HTML cru sem JS. Dado o tamanho de cada uma, nenhuma foi iniciada nesta sessão — ver "Próximo passo exato".

## Bloqueios que dependem de você
1. **Proteção de equipe da Netlify** (não é o login do app): abra `https://hp-group-hub.netlify.app` no navegador — entre com sua conta Netlify do time "Hp Group" quando quiser retomar a validação do deploy publicado.
2. **Resend + SMTP do Supabase Auth**: conta, domínio verificado do HP Group, `RESEND_API_KEY`/`EMAIL_FROM` — sem isso não valido o fluxo real de e-mail (passo a passo em `docs/integrations.md`).
3. **Go-live**: destino de hospedagem definitivo e aplicação das migrations em produção — decisão sua, nada foi feito na `HP Group Core`.

## Próximo passo exato
1. Pesquisas (admin): perguntas/campanhas, público-alvo configurável, respostas e indicadores, permissões, canal de envio externo sinalizado como pendente (sem SMTP).
2. Contas corporativas: empresas e contatos, contratos e vínculos, indicadores agregados, separando pagador corporativo de pessoa atendida — sem expor informação clínica individual.
3. Agendador de retentativa de eventos: agendamento, idempotência, limite de tentativas, intervalos progressivos, trava contra execução concorrente duplicada, histórico, reprocessamento manual autorizado e auditado.
4. Metadados sociais: verificar o HTML cru recebido sem executar JavaScript; publicar/alterar/desativar; nunca expor rascunho. Se a proteção da Netlify bloquear um crawler externo, registrar como bloqueado — nunca afirmar validação externa sem executá-la.
5. Quando você tiver conteúdo real (cursos gravados) para o HP Academy, publicar as trilhas e vincular os cursos — hoje estão todas em rascunho, de propósito.
6. Configurar Resend/SMTP quando você tiver as credenciais; então testar recuperação de senha e primeiro acesso reais.
7. Você conclui o login no navegador embutido → eu valido o deploy publicado.
