# HP Group Hub — Status do Projeto

Atualizado: 2026-09-22 (sessão 5) · Branch `feature/hp-group-hub` · [PR #1](https://github.com/Alexandrepavao/hugo-pavao-fisio-home/pull/1) em rascunho (sem merge na `main`)

> Todo o trabalho abaixo foi implementado e validado no ambiente **Dev** (banco + servidor local apontando para o Supabase Dev) e por **16 testes E2E automatizados** (Playwright). O deploy publicado na Netlify **ainda não foi validado ao vivo** — está atrás da proteção de equipe da Netlify (ver bloqueio 1 abaixo), distinta do login do app. Produção (`HP Group Core`) segue vazia.

## Ambiente
| Recurso | Destino | Observação |
|---|---|---|
| Repositório | `Alexandrepavao/hugo-pavao-fisio-home` | branch `feature/hp-group-hub`, PR #1 em rascunho |
| Supabase Dev/Preview | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`) | migrations 001–023 aplicadas e testadas |
| Supabase Produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | **vazio** |
| Netlify | site `hp-group-hub`, time "Hp Group" | preview publicado (commit mais recente), **protegido por SSO de equipe** (não confundir com `/login` do app) |
| Referências auditadas | `D:\Claude\hp-refs\*` (Brighter Core, Brighter Flow, Engage Nest, FocusSphere) | somente leitura; ver `docs/reference-audit.md` |

## O que mudou nesta sessão
- **Financeiro reestruturado** (`/admin/financeiro/*`): navegação por *children* sincronizada entre sidebar, header e URL (6 destinos principais + "Mais"). Telas: Visão geral (KPIs + envelhecimento de vencidos + gráficos), Vendas e recebimentos, Contas a pagar, **Fluxo de caixa** (nova, antes só embutida no dashboard), **Recorrência e forecast** (nova — MRR/ARR), **Rentabilidade e DRE** (nova, honesta), Comissões e repasses (+ tela de regras, não existia), **Conciliação bancária** (nova), **Relatórios** (nova — eficiência do negócio), **Configurações** (nova — contas/categorias/centros de custo).
- **MRR/ARR com ponte de movimentação** (migration 020): reaproveita o único sinal real de recorrência já existente (`products.recurrence` + `receivables.competence_month`, o mesmo par que alimenta `subscription_forecast`) — sem inventar um motor de cobrança automática que não existe. Ponte (novo/expansão/reativação/contração/cancelamento) fecha matematicamente **por construção**; retenção e churn ficam "Indisponível" sem base anterior, nunca dividem por zero. Testado com 6 cenários sintéticos cobrindo cada tipo de movimentação (`supabase/tests/011`, todas as asserções passando).
- **DRE honesta** (migration 020): deduções, custo direto, margem de contribuição e resultado operacional ficam **sempre** "Indisponível" — não há custo direto por produto/serviço cadastrado nesta versão, e mostrar um número aqui seria inventado. "Resultado de caixa" é rotulado como caixa, nunca chamado de lucro.
- **Conciliação bancária** (migration 021, nova): importa extrato (CSV) e **casa** cada linha com um pagamento/conta a pagar já lançado — nunca cria lançamento novo (índice único impede conciliar o mesmo lançamento duas vezes). Testado (`supabase/tests/012`, 11 asserções): importação com linha inválida descartada, sugestão por valor+data, confirmação sem duplicar, dupla-conciliação rejeitada, desfazer, ignorar com motivo obrigatório, isolamento por papel financeiro.
- **Início (Dashboard) reorganizado**: saudação por horário **local do dispositivo** com o primeiro nome do perfil autenticado (nunca nome fixo), filtros com atalhos (hoje/7 dias/mês atual/mês anterior/ano/personalizado) + comparação com período anterior, cartões executivos reorganizados, gráficos de evolução financeira e funil comercial.
- **Distribuição geográfica** (migration 020 — `people.city`/`state_uf`/`country` + `geo_distribution()`): 3 segmentos (pacientes, parceiros, alunos) via `person_kinds`, deduplicados por pessoa dentro de cada segmento; ranking por estado/cidade + contagem de "sem localização" com link para completar cadastro. Sem biblioteca de mapa instalada nesta sessão (pediria aprovação antes de adicionar uma dependência nova) — a tabela/ranking cobre a alternativa acessível pedida.
- **Área do paciente**: item da navegação geral renomeado de "Área do aluno" (apontava para `/academy`) para "Área do paciente" (aponta para `/paciente`, só visível a quem tem o papel `member`). Academy mantém sua própria navegação separada, com "alunos" intacto. Nova seção "Dados pessoais" (somente leitura).
- **HP Academy — trilhas** (migration 023, nova aba "Trilhas"): agrupam cursos já existentes em sequência recomendada, sem duplicar `courses`/`lessons`. As 8 trilhas sugeridas foram semeadas como **rascunho e sem curso vinculado** — proposta editorial, não conteúdo inventado. Portal do aluno mostra "Trilhas recomendadas" só quando publicadas e com cursos publicados de fato vinculados (testado manualmente: publicar + vincular curso real → aparece corretamente no catálogo; revertido ao estado limpo depois).
- **Bugs reais encontrados na verificação ao vivo e corrigidos**: `mrr_history()` devolvia timestamp completo do `generate_series` (não *date* puro), virando "Invalid Date" no gráfico (migration 022); abas de segmento da geografia mostravam a chave interna em vez do rótulo; ponte do MRR mostrava "+R$ 0,00" em linhas de contração/cancelamento zeradas; eixo de gráficos formatava valores pequenos como "0.001k".

## Estado por módulo
| Módulo | Estado | Evidência |
|---|---|---|
| Fundação, bootstrap de gestores, autenticação | ✅ Dev | testes SQL 001–002; E2E `01-auth-and-routes` |
| HP Pages + formulários públicos | ✅ Dev | teste SQL 003 (30/30); E2E `02-checkup-journey` |
| CRM | ✅ Dev | testes SQL 003/004; E2E |
| Pessoas — mesclagem e importação | ✅ Dev | teste SQL 009 (21/21) |
| Agenda, pacotes, sessões | ✅ Dev | teste SQL 004 (26/26); concorrência real (E2E `04-agenda-concurrency`) |
| Financeiro — vendas, recebíveis, contas a pagar, comissões | ✅ Dev | teste SQL 005 (33/33) |
| Financeiro — MRR/ARR, DRE, conciliação, eficiência, geografia | ✅ Dev | testes SQL 011 (10/10) e 012 (11/11) novos; verificado ao vivo no navegador |
| Academy + Acompanhamento | ✅ Dev | teste SQL 006 (42/42); E2E `03-academy-and-isolation` |
| Academy — trilhas | 🟡 Dev | schema + RLS + admin + portal implementados e verificados manualmente; sem teste SQL/E2E dedicado ainda |
| Parceiros | 🟡 | teste SQL 007 (16/16) |
| Dashboard / Início | ✅ Dev | teste SQL 008 (12/12); reorganizado nesta sessão (saudação, filtros, geografia) |
| E-mail (Resend + SMTP Auth) | 🔒 | função pronta, não validada — bloqueio externo |
| Deploy publicado na Netlify | 🔒 | preview atualizado, atrás da proteção de equipe — ação sua necessária |
| Produtividade/foco ("Meu dia") | ✅ Dev | teste SQL 010 (13/13); E2E `05-productivity` |
| Pesquisas (tela), contas corporativas (tela), agendador de retentativa de eventos, metadados sociais verificados no crawler | ⬜ | não implementados nesta sessão — ver "Próximo passo exato" |

## Testes desta sessão
**Banco (SQL, Dev, transação sempre desfeita):**
- `011_finance_reports_geo.sql` (novo) — 10 asserções: MRR final/inicial exatos, ARR = MRR×12, ponte fecha matematicamente, cada tipo de movimentação (novo/expansão/reativação/contração/cancelamento) com valor certo, churn de clientes, retenção bruta/líquida, "indisponível" sem base anterior (não divide por zero), DRE nunca inventa margem, distribuição geográfica com dedup correto.
- `012_bank_reconciliation.sql` (novo) — 11 asserções: importação filtra linha inválida, sugestão encontra o lançamento certo, confirmar concilia sem duplicar pagamento, dupla-conciliação rejeitada (linha já conciliada e mesmo pagamento via índice único), desfazer, ignorar exige motivo, isolamento por papel (`sales` não lê o extrato).
- Isolamento das tabelas novas (`bank_statement_*`, `learning_tracks`) verificado diretamente: aluno/membro não lê nenhuma.

**E2E (Playwright, Edge do sistema, contra o Supabase Dev real):** `npm run test:e2e` com `HP_QA_PASSWORD` — **16/16 passando**, ~40s. Suíte existente ajustada ao novo H2 da saudação (antes verificava o H1 "Dashboard", que não existe mais — o título agora é a saudação por horário local).

**Front:** `tsc`, `eslint` (0 erros), `vite build`, `vitest` (15/15).

**Não feito nesta sessão** (declarado explicitamente, não afirmado como testado): E2E dedicado para as telas novas do Financeiro/Início/trilhas — a cobertura ficou nos testes SQL (a lógica de negócio) e em verificação manual ao vivo no navegador (a interface).

## Bloqueios que dependem de você
1. **Proteção de equipe da Netlify** (não é o login do app): abra `https://hp-group-hub.netlify.app` no navegador — entre com sua conta Netlify do time "Hp Group" quando quiser retomar a validação do deploy publicado.
2. **Resend + SMTP do Supabase Auth**: conta, domínio verificado do HP Group, `RESEND_API_KEY`/`EMAIL_FROM` — sem isso não valido o fluxo real de e-mail (passo a passo em `docs/integrations.md`).
3. **Go-live**: destino de hospedagem definitivo e aplicação das migrations em produção — decisão sua, nada foi feito na `HP Group Core`.

## Próximo passo exato
1. Telas de pesquisas e contas corporativas (Parceiros) — bancos já prontos e testados desde sessão anterior, telas ainda pendentes.
2. Agendador de retentativa de eventos (hoje é manual, via `retry_failed_events()`); metadados de pré-visualização social verificados de fato contra um crawler (não só a tag mudando no cliente).
3. E2E dedicado para Financeiro (Recorrência, Conciliação, DRE) e para o fluxo de trilhas do Academy.
4. Quando você tiver conteúdo real (cursos gravados) para o HP Academy, publicar as trilhas e vincular os cursos — hoje estão todas em rascunho, de propósito.
5. Configurar Resend/SMTP quando você tiver as credenciais; então testar recuperação de senha e primeiro acesso reais.
6. Você conclui o login no navegador embutido → eu valido o deploy publicado (rotas diretas, login, formulários, CRM, Academy, Financeiro, Productivity, Functions, ausência de referência a produção).
