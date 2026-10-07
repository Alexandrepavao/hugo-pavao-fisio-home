# CLAUDE.md — HP Group Hub

Instruções para qualquer sessão do Claude Code neste repositório. **Leia antes de alterar arquivos.** Sem senhas, tokens ou chaves aqui: eles ficam nas variáveis do usuário Windows e nos painéis.

## Objetivo
**HP Group Hub** é a plataforma integrada do HP Group (fisioterapia + Academy): site institucional, HP Pages, cadastro central de pessoas, CRM, agenda, pacotes, financeiro, área do paciente, Academy, parceiros e painéis. A arquitetura é modular e multi-unidade e **vai virar um ERP white label** (`docs/white-label-roadmap.md`); a prioridade de hoje é **a primeira versão operacional do HP Group (release v1)**, depois o ERP white label e, no futuro, iOS/Android.

## Estado atual (conferir no Git antes de confiar)
- Repositório: `https://github.com/Alexandrepavao/hugo-pavao-fisio-home` · pasta de trabalho: `D:\Claude\hugo-pavao-fisio-home`.
- **Branch ativa: `release/v1` · PR #3 (RASCUNHO)**. Último commit conhecido: `bee5317` (tudo commitado e enviado; só `.claude/` não é versionado; reconferir com `git log`). **Preview publicado ainda é o de `ce5d4d7`** (deploy `6abed1f6a20ecff377beff7e`): publicar `bee5317` depende de `netlify login`/`NETLIFY_AUTH_TOKEN` do usuário. Migrations: repositório e Dev vão até a **083**.
- `feature/hp-group-hub` (PR #1) **já foi mesclada** — não voltar a ela. `feature/lead-quizzes` (PR #2, rascunho) guarda o Contábil e o redesign antigo.
- Banco **Dev**: Supabase `fsvtzowcwhvwtluwrhnb` (único ambiente em que se trabalha). Preview: Netlify `hp-group-hub` (rascunho de branch `release-v1`).

## Restrições (inegociáveis)
1. **Somente Dev.** Sem merge, **sem produção** (`HP Group Core`, `wfqkjrpqkaarpavjheoj`), **sem DNS** (`hpfisioterapia.com.br` continua no GitHub Pages), sem migrations em produção.
2. Netlify: só o site `hp-group-hub` e só com `netlify deploy --build --context branch:release/v1 --alias release-v1 --site 2c2d11bc-f62c-42b7-bae6-4cf3b6f35756` (rascunho, **nunca `--prod`**). Nunca `leafy-cascaron-325147` nem `hp-group-hub-producao`.
3. **Segredos nunca no chat, no Git ou nos documentos.** `SUPABASE_ACCESS_TOKEN` e `HP_QA_PASSWORD` vêm das variáveis do **usuário** do Windows (confira sem exibir o valor). Não peça token pelo chat nem o procure no histórico de conversas. E-mails de teste só para `jan.darioush@yahoo.com.br`.
4. Só em `D:` (nada em `C:`); nunca tocar projetos da Brighter ou de outros clientes.
5. Preserve alterações locais: nada de `reset --hard`, `clean`, checkout que descarte arquivos ou `stash` sem avisar. Commit/push só em `release/v1`; PR #3 permanece em rascunho.
6. **Honestidade:** não declare concluída uma integração só preparada (Bunny, Google, e-mail); não chame falha de “instabilidade” sem prova; registre causas não determinadas; nunca invente dados ou zeros em indicadores. Ao final de cada rodada, lembre o usuário de revogar o token do Supabase.

## Desenvolvimento
- Stack: Vite + React 18 + TypeScript + Tailwind/shadcn + React Router + TanStack Query + Supabase (Postgres, Auth, RLS, Edge Functions) + Netlify. Playwright (Edge) para E2E.
- Comandos: `npm ci` · `npm run dev` (ou `node node_modules/vite/bin/vite.js --port 5180 --host 127.0.0.1`) · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run test:e2e:release` (`npx playwright test <arquivo>`, **sempre `--workers=1`**: com 2 workers a suíte compartilha o mesmo backend Dev e falha por concorrência) · SQL de release: `supabase/tests/release/S*.sql` (transação desfeita; o relatório sai no erro `RELATORIO_…`).
- `.env.local` (não versionado) aponta **sempre para o Dev**; `vite.config.ts` recusa produção↔Dev. Perfil de entrega `VITE_RELEASE_PROFILE=v1` esconde recursos incompletos.
- Migrations: `supabase/migrations/`, numeradas por ordem (001→083; 048–051 = Contábil, só em `feature/lead-quizzes`); aplicar no Dev só se pendente e uma a uma; nunca `db reset`. Funções públicas: `security definer` com `set search_path = ''`, **repetir `GRANT`/`REVOKE`** ao redefinir e partir da definição **mais recente** (`grep` em todas as migrations). Escrita só por função; leitura por RLS; auditoria por `private.audit_row`.
- Testes: separar **novos** (`supabase/tests/novos`, `e2e/novos`) de **regressão**/release; só mudar expectativa por mudança **intencional** de interface; máquina com pouca memória → grupos pequenos de E2E, sem reiniciar servidores em segundo plano sozinho. Antes de culpar limitador ou instabilidade, confira o banco.
- Edição de arquivos: use as ferramentas de edição (heredocs grandes com aspas quebram); muitos arquivos são CRLF.
- Convenções de produto: app ativo decidido pela URL (`src/components/hp/apps.ts`, `appNav.ts`); **filtro único** (`PeriodFilter`/`ListFilterBar`); o plano de sessões do paciente é **sempre definido pelo profissional**; Google Calendar é a **única** integração de calendário; compra de cartão = 1 despesa; reservas serializadas por profissional (não aumentar timeouts para passar testes).

## Documentos de continuidade (leia nesta ordem)
1. [`docs/transferencia-claude.md`](docs/transferencia-claude.md) — histórico, estado conferido (atualizado em 01/10 ao fim das jornadas), decisões, próximos passos, **prompt de retomada**, acessos a reconectar.
2. [`docs/project-status.md`](docs/project-status.md) — status por rodada (a mais recente no topo) e tabela de acompanhamento do escopo ampliado.
3. [`docs/release-v1.md`](docs/release-v1.md) — escopo da v1, migrations para produção, variáveis, publicação/reversão, pendências.
4. Por tema: [`jornadas-fisioterapeuta-paciente-crm.md`](docs/jornadas-fisioterapeuta-paciente-crm.md) · [`aplicativos.md`](docs/aplicativos.md) · [`cartoes-corporativos.md`](docs/cartoes-corporativos.md) · [`jornada-do-paciente.md`](docs/jornada-do-paciente.md) · [`indicadores.md`](docs/indicadores.md) · [`calendarios.md`](docs/calendarios.md) · [`financeiro-linhas-de-negocio.md`](docs/financeiro-linhas-de-negocio.md) · [`diagnosticos/04-agenda-concurrency`](docs/diagnosticos/04-agenda-concurrency/README.md) · [`deployment.md`](docs/deployment.md) · [`go-live-plan.md`](docs/go-live-plan.md) · [`permissions.md`](docs/permissions.md) · [`data-model.md`](docs/data-model.md).

## Projetos de referência (só estudar organização; **nunca copiar código, dados ou marca**; clonar fora do projeto)
`jandaarioush/brightercore-4d41cb1d` (gestão/financeiro) · `jandaarioush/brighter-flow-20722354` (CRM Pro) · `jandaarioush/engage-nest-space-71c70a06` (Academy/Iaguara) · `jandaarioush/focussphere-51789` (produtividade) · `jandaarioush/brighter-vision-finance`. Inspirações visuais: Shadcn Admin, TailAdmin, Mosaic — recriar com componentes próprios do HP.

## Próxima tarefa autorizada
Nenhuma de código em aberto: as 9 jornadas operacionais estão conferidas em [`docs/integracao-ponta-a-ponta.md`](docs/integracao-ponta-a-ponta.md) (SQL S01–S21 = 1056/1056; E2E `@release` = 174/174 com 1 worker). Falta: publicar o preview de `bee5317` (login do Netlify), Bunny (chave e biblioteca) e Google (autorização real) — todos dependem do usuário — e a revogação do token do Supabase. Ver `docs/transferencia-claude.md` §5.8 e §7.
