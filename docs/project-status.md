# HP Group Hub — Status do Projeto

Atualizado: 2026-09-21 (sessão 2) · Branch `feature/hp-group-hub` · PR em rascunho (sem merge na `main`)

> **Não declarar o sistema concluído.** Tudo abaixo foi implementado e validado no ambiente **Dev**. Nada foi aplicado no banco de **produção**, nenhuma integração externa foi conectada, e o fluxo real de e-mail (confirmação/recuperação de senha) **ainda não foi validado**.

## Ambiente
| Recurso | Destino | Observação |
|---|---|---|
| Repositório | `Alexandrepavao/hugo-pavao-fisio-home` | trabalho na branch `feature/hp-group-hub` |
| Diretório local | `D:\Claude\hugo-pavao-fisio-home` | cache npm em `D:\Tools\npm-cache`; Netlify CLI em `D:\Tools\npm-global` |
| Supabase **Dev/Preview** | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`, sa-east-1) | migrations 001–014 aplicadas; usado pelo preview |
| Supabase **Produção** | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | **vazio** (nenhuma migration aplicada) — decisão de go-live pendente |
| Netlify | time "Hp Group" (`contato-e5bg89q`), site `hp-group-hub` (`2c2d11bc-…`) | preview publicado; variáveis `VITE_*` apontam **só** para o Dev; acesso protegido por login de equipe Netlify |
| Site atual em produção | GitHub Pages → `hpfisioterapia.com.br` | **intocado** (main, DNS e Pages não foram alterados) |

O CLI do Supabase local está logado na conta da Brighter e **não** é usado; todo acesso ao Supabase é via MCP da organização HP Group.

## Estado por módulo
| Módulo | Estado | Evidência | Pendências |
|---|---|---|---|
| Fundação (org, unidades, pessoas, papéis, auditoria) | ✅ Dev | testes SQL 001–002 | — |
| Bootstrap de gestores (2 e-mails, uso único, e-mail verificado) | ✅ Dev | teste SQL 002 (7/7) | acionar de fato com e-mail real (depende de e-mail de confirmação) |
| Autenticação (login, primeiro acesso, recuperação, `/redefinir-senha`) | 🟡 | login e redirecionamento por perfil verificados no navegador | **fluxo real de e-mail não validado** (SMTP) |
| HP Pages + formulários públicos | ✅ Dev | testes SQL 003 (30/30) + jornada no navegador | preview social (SEO no servidor) |
| CRM (funis, kanban/lista, tarefas, histórico) | ✅ Dev | testes 003/004 + navegador | importação, regras avançadas de distribuição |
| Agenda, pacotes e sessões | ✅ Dev | teste SQL 004 (26/26) | concorrência real entre conexões (só constraint testada em uma sessão), lembretes |
| Financeiro (vendas→recebimentos, estornos, comissões, a pagar, projeção) | 🟡 | teste SQL 005 (33/33) | conciliação bancária, tela de regras de comissão, DRE gerencial completo |
| Academy (alunos) + acompanhamento (pacientes) | ✅ Dev | teste SQL 006 (42/42) + navegador | vídeo de provedor externo com assinatura; questionários estruturados (UI) |
| Parceiros, indicações, repasses, pesquisas, corporativo | 🟡 | teste SQL 007 (16/16, 15 OK + 1 corrigido) | telas de pesquisa e de contas corporativas |
| Dashboard | ✅ Dev | teste SQL 008 (12/12) + navegador | — |
| Automações | 🟡 | eventos idempotentes, `automation_runs`, retentativa manual | agendador de retentativas; webhooks de pagamento |
| Mesclagem de pessoas / importação com validação | ⬜ | — | implementar |
| E-mail (Resend) | 🔒 | função `send-email` pronta; **não validada** | conta Resend, domínio verificado, chaves (ver `integrations.md`) |
| Pagamentos, WhatsApp, vídeo | ⬜ | — | provedores a definir |
| Produção (banco + deploy) | ⬜ | — | aprovar go-live |

## Testes (resumo — detalhes em `test-report.md`)
Banco (SQL, transação desfeita): 002 bootstrap 7 · 003 páginas 30 · 004 agenda 26 · 005 financeiro 33 · 006 academy/acompanhamento 42 · 007 parceiros 15/16 → corrigido · 008 dashboard 12 · 001 RLS 16. Front: `vitest` 11 · `tsc` · `eslint` (0 erros) · build. API direta com token de aluna: isolamento confirmado.

## Bloqueios que dependem de você
1. **Resend**: criar conta, verificar um domínio próprio do HP Group (o remetente) e informar `RESEND_API_KEY`/`EMAIL_FROM`; configurar o SMTP do Supabase Auth (passo a passo em `integrations.md`). Sem plano pago.
2. **Supabase Auth → URL Configuration** (Dev): adicionar a URL do preview e `http://localhost:5180` às URLs de redirecionamento.
3. **Go-live**: decidir o destino (Netlify × GitHub Pages atual), aplicar as migrations em produção e só então mesclar. Nenhum DNS foi tocado.

## Próximo passo exato
1. Você configura Resend + SMTP do Auth; eu executo o teste real: pedido de recuperação → e-mail → link → `/redefinir-senha` → login (e primeiro acesso dos 2 gestores).
2. Implementar mesclagem de pessoas com decisão explícita e importação com validação.
3. Agendador de retentativas de eventos + webhook de pagamento assim que o provedor for definido.
4. Aplicar migrations em produção (com advisors) e validar deploy em produção somente após aprovação.
