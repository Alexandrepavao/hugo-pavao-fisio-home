# Plano de lançamento (go-live) — HP Group Hub

> Documento de preparação para uma decisão final. **Nada aqui foi executado.** Confirmado nesta sessão
> (2026-09-22, leitura direta via MCP): o banco de produção `HP Group Core` (`wfqkjrpqkaarpavjheoj`) tem
> **zero tabelas em `public`** e **zero migrations aplicadas** — segue vazio. A validação no Dev não
> substitui os testes posteriores em produção.

## 1. Destino de hospedagem proposto e suas dependências

**Proposta**: mover o domínio principal (`hpfisioterapia.com.br`) de GitHub Pages para Netlify, no mesmo
site `hp-group-hub` (ou um site novo dedicado a produção — decisão aberta, ver seção 9).

Dependências dessa escolha:
- Mudança de DNS (CNAME/A record apontando para Netlify) — **não executada, exige sua aprovação explícita**.
- Decisão sobre manter GitHub Pages como está até o cutover, ou desligar antes — hoje GitHub Pages continua
  servindo o site institucional atual sem nenhuma rota nova.
- Decisão sobre desativar a proteção de equipe do Netlify no site de produção (hoje ativa no site de
  preview `hp-group-hub` — correta para preview, mas produção pública não pode ficar atrás de login de
  equipe).
- Resolver o site Netlify não documentado (`leafy-cascaron-325147`, achado desta sessão em
  `docs/deployment.md`) antes de qualquer decisão de DNS, para não confundir qual site é o de produção.

## 2. Commit candidato ao lançamento

`52cac0e` (branch `feature/hp-group-hub`) — inclui Pesquisas, Contas corporativas, retentativa de eventos
real, metadados sociais, revisão visual 1440px/390px, atribuição de mapa CC BY 4.0. Qualquer commit adicional
feito após este documento deve ser revalidado antes de ser considerado candidato.

## 3. Ordem de migração

1. Rodar `supabase/migrations/` na ordem 001→036 (36 arquivos, do bootstrap de gestores até
   `20260924000036_reserved_slug_pesquisas.sql`) no projeto `HP Group Core` (`wfqkjrpqkaarpavjheoj`).
   Usar `apply_migration` uma a uma, nunca `db reset` em remoto.
2. O seed de configuração inicial (organização `hp-group`, unidade-sede, funis padrão, categorias
   financeiras, pesquisa padrão) já está embutido nas próprias migrations — não há script de seed separado
   para rodar.
3. Rodar `get_advisors` (tipos `security` e `performance`) no projeto de produção logo após aplicar todas as
   migrations, antes de qualquer dado real entrar.
4. Confirmar `cron.job` — a extensão `pg_cron` precisa ser habilitada e o job `domain-events-retry`
   **recriado explicitamente** no banco de produção (não é copiado automaticamente do Dev — ver
   `docs/release-readiness.md`, item 14).

## 4. Configuração de autenticação e storage

- **Supabase Auth (produção)**: configurar *Site URL* para o domínio final; *Redirect URLs* incluindo a URL
  de produção (e removendo URLs de Dev/preview, se o projeto de produção for realmente separado); SMTP
  customizado (Resend, domínio verificado) — não usar o remetente padrão/limitado do Supabase em produção.
- **Storage**: os buckets privados `academy-private` e `care-private` são criados pela própria migration
  `20260921000008_academy_care.sql` — nenhuma ação manual de storage além de aplicar as migrations. Arquivos
  de teste do Dev **não** são copiados (Storage não migra por SQL); qualquer conteúdo real do Academy precisa
  ser reenviado em produção.

## 5. Variáveis de ambiente necessárias (nomes apenas — nenhum valor aqui)

**Netlify, contexto `production` (site de produção, a criar/decidir):**
- `VITE_SUPABASE_URL` — apontando para `HP Group Core`, não para o Dev.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — chave publicável do Core.

**Netlify, escopo Functions (produção):**
- `RESEND_API_KEY`
- `EMAIL_FROM`

**Supabase Auth (produção, via painel, não são env vars da Netlify):**
- SMTP host/porta/usuário/senha (Resend) — ver `docs/integrations.md`.

## 6. Functions, Edge Functions e schedulers a publicar

- Function `send-email` (`netlify/functions/send-email.mts`) — publica junto do build normal.
- Edge Function `social-meta` (`netlify/edge-functions/social-meta.ts`) — idem; confirmado nesta sessão que
  o deploy process a detecta automaticamente (sem configuração extra no `netlify.toml`).
- `pg_cron` job `domain-events-retry` — **recriar manualmente** no banco de produção (ver seção 3.4); não
  existe hoje nenhuma migration que crie o job automaticamente (por design, para não rodar cron em todo
  ambiente que aplica as migrations).

## 7. Dados de seed inicial

Já incluídos nas migrations (organização, unidade-sede, funis, categorias financeiras, pesquisa padrão) —
nada além disso. Nenhum dado de teste/sintético deve ser copiado do Dev para produção.

## 8. Bootstrap dos gestores

A allowlist de bootstrap (`contato@hpfisioterapia.com.br`, `jan.darioush@yahoo.com.br`) já está na migration
`20260921000003_bootstrap_managers.sql` — aplica junto das demais. Após aplicar as migrations em produção,
os dois gestores completam "Primeiro acesso" com esses e-mails (nenhuma senha padrão é criada pelo sistema).

## 9. Testes pós-publicação

Repetir, contra o endereço de produção real (não o Dev/preview):
- Login/logout dos dois gestores via Primeiro acesso.
- Recarregar e acessar diretamente rotas internas (`/admin`, `/checkup`, `/academy`...).
- Troca de contexto da sidebar.
- Formulário de captura → oportunidade no CRM.
- Agenda e pacote.
- Venda manual e recebimento.
- Academy e progresso.
- Área do paciente (jornada completa — ver pendência no item 9 de `docs/release-readiness.md`).
- Produtividade.
- Pesquisas e contas corporativas.
- Acesso negado para um papel sem permissão.
- Metadados sociais validados por um crawler real (sem proteção de equipe em produção).

## 10. Backup e recuperação

Backups automáticos do Supabase (point-in-time recovery, conforme o plano do projeto `HP Group Core`) são a
linha de defesa principal — confirmar o plano/retenção do projeto antes do go-live (não verificado nesta
sessão, não é uma ação de leitura simples via as ferramentas disponíveis). Nenhum backup adicional foi
configurado por esta sessão.

## 11. Plano de rollback do frontend

Como o Netlify mantém todo deploy anterior, o rollback do frontend é: reativar o deploy anterior pelo painel
Netlify (ou publicar de novo a partir do commit anterior). Isso **não desfaz migrations de banco** — ver
próximo item.

## 12. Estratégia para falha de migration (sem presumir rollback destrutivo)

Migrations do Supabase não têm rollback automático nesta configuração. Se uma migration falhar no meio da
sequência 001→036:
1. **Parar imediatamente** — não continuar aplicando as próximas.
2. Diagnosticar a migration específica que falhou (mensagem de erro do `apply_migration`).
3. Corrigir o problema (ex.: dependência faltando, dado incompatível) numa migration **nova e corretiva**, em
   vez de editar a já aplicada.
4. Só reaplicar a partir do ponto de falha depois da correção validada no Dev.
5. Nunca usar `reset_branch`/`reset` em produção para "recomeçar" — isso apaga dados reais que possam já
   existir (ex.: se gestores já completaram o bootstrap antes de uma falha tardia).

## 13. Efeito de um merge na `main` sobre o site atual do GitHub Pages

Confirmado nesta sessão (leitura do workflow, sem alteração): `main` publica automaticamente o site
institucional atual via GitHub Pages a cada push. O código em `feature/hp-group-hub` é uma SPA com rotas
novas que **substituiria** esse site — sem as rotas do Hub configuradas no `hpfisioterapia.com.br`, um merge
direto quebraria a experiência atual do site institucional até que o cutover completo (DNS + Netlify) fosse
feito. **Decisão necessária antes de qualquer merge**: manter GitHub Pages até o cutover estar 100% pronto,
ou mover para Netlify primeiro e só então mesclar.

## O que este documento não é
Não é uma autorização para aplicar migrations, alterar DNS, substituir o site atual ou mesclar em `main`.
Nenhuma dessas ações foi executada nesta sessão. É a preparação para uma decisão final sobre o lançamento.
