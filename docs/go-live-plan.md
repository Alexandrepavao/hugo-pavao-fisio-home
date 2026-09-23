# Plano de lançamento (go-live) — HP Group Hub

> **Atualizado em 2026-09-23 — cutover de produção EXECUTADO** (banco, deploy, merge). O que falta é
> **DNS** (fora do meu acesso — só eu não consigo terminar isto) e **3 itens de painel** (Supabase Auth
> Site URL/Redirect URLs/Send Email Hook + secrets) — ambos exigem sua ação, detalhados nas seções 4 e 3.

## 1. O que foi executado

- **Migrations 001→037** aplicadas em `HP Group Core` (`wfqkjrpqkaarpavjheoj`), uma a uma, na ordem, com
  `apply_migration` (nunca `db reset`). `pg_cron` foi habilitado antes da 035 (não vinha por padrão no
  projeto). Confirmado via `list_migrations`: 37/37 registradas. Advisors de segurança/performance
  revisados — nenhum achado novo além dos padrões já esperados do desenho do projeto (RPCs
  `SECURITY DEFINER` com checagem de papel interna é o padrão usado em toda a base, igual ao Dev).
- **Job `domain-events-retry`** recriado em produção (`cron.schedule`, a cada minuto) — confirmado ativo.
- **Banco de produção não tinha dados antes das migrations** (`list_tables` vazio) — não houve necessidade
  de backup de dados existentes; a "cópia de segurança" aqui é o próprio Postgres do Supabase (PITR do
  plano do projeto — não verifiquei o plano/retenção exata, ver seção 6).
- **Edge Function `auth-email-hook`** deployada no projeto de produção (`wfqkjrpqkaarpavjheoj`), código
  idêntico ao Dev, `verify_jwt: false` de propósito (ver `docs/integrations.md`).
- **Site Netlify de produção criado**: `hp-group-hub-producao` (id `324307d8-7697-4f3a-907f-95e572b5b77d`,
  time "Hp Group") — **separado** do site `hp-group-hub` (que continua sendo só Dev/preview, protegido por
  login de equipe, intocado). Protegido por login de equipe **desligado** (`requiresSSOTeamLogin: false`)
  — confirmado publicamente acessível (`200 OK` sem login) via `https://hp-group-hub-producao.netlify.app`.
  Decisão de criar um site novo em vez de reaproveitar `hp-group-hub`: evita qualquer risco de um erro de
  configuração de acesso vazar o site de Dev (que precisa continuar protegido) — total isolamento entre os
  dois ambientes.
- **Env vars do site de produção** (Netlify): `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` apontando
  para o Core; `EMAIL_FROM` = `HP Group <contato@hpfisioterapia.com.br>`. `RESEND_API_KEY` **pendente**
  (não tenho o valor — ver seção 3).
- **Deploy publicado**: commit `5fcc175` (branch `feature/hp-group-hub`, antes do merge), build "ready", 1
  Function (`send-email`) + 1 Edge Function (`social-meta`) publicadas. Login, primeiro acesso, recuperação
  e a nova página `/confirmar` testados visualmente e funcionando no endereço `hp-group-hub-producao.netlify.app`.
- **Workflow do GitHub Pages desativado** (`on: workflow_dispatch` em vez de `push: main`) — commitado
  ANTES do merge, especificamente para não competir com a publicação real quando `main` mudasse. Confirmado
  depois do merge: nenhuma nova execução do workflow foi disparada; `hpfisioterapia.com.br` continua sendo
  servido normalmente pelo GitHub Pages, sem nenhuma mudança visível ainda.
- **PR #1 mesclado em `main`**: commit de merge `436dabe`, branch `feature/hp-group-hub` não excluída.
- **Correção real dos links de e-mail**: o hook agora aponta para `{PUBLIC_SITE_URL}/confirmar?token_hash=...&type=...`
  — uma página HP própria que valida com `verifyOtp()` oficial do Supabase Auth (não é link para
  `supabase.co`, não é `localhost`). Ver `docs/integrations.md` para o novo secret `PUBLIC_SITE_URL`
  (pendente, seção 3).

## 2. O que NÃO foi tocado (deliberadamente)

- **DNS de `hpfisioterapia.com.br`** — nenhum registro alterado. O domínio continua resolvendo para o
  GitHub Pages (4 IPs `185.199.10{8,9}.153`/`185.199.11{0,1}.153` no apex, `CNAME` para
  `Alexandrepavao.github.io` no `www`).
- **Registros de e-mail Hostinger** (SPF `v=spf1 include:_spf.mail.hostinger.com ~all`, MX
  `mx1`/`mx2.hostinger.com`, DMARC `v=DMARC1; p=none`) — confirmados intactos, não tocados.
- **Site `hp-group-hub`** (Dev/preview) — env vars e proteção de equipe inalterados.
- **Banco `HP Group Core`** — só migrations aplicadas; nenhum dado real inserido, nenhuma conta de gestor
  criada (o bootstrap só ativa quando o e-mail real da pessoa confirma — ninguém fez isso ainda).

## 3. Bloqueio real: 3 credenciais que só você pode cadastrar

Confirmei tecnicamente que não tenho ferramenta para gravar segredos/secrets do Supabase (Edge Functions) —
isto é sempre um passo de painel, em qualquer ambiente, não uma limitação só desta sessão. Faltam, **no
projeto de produção** (`wfqkjrpqkaarpavjheoj`, Project Settings → Edge Functions → Secrets):

- `RESEND_API_KEY` — pode ser a mesma key do Resend usada no Dev (é uma API key de conta) ou uma dedicada.
- `EMAIL_FROM` — `HP Group <contato@hpfisioterapia.com.br>`.
- `PUBLIC_SITE_URL` — **`https://hpfisioterapia.com.br`** (o valor final; funciona assim que o DNS
  apontar para lá — até lá, os links de e-mail vão apontar para um domínio que ainda não resolve para o
  site novo, então **não envie e-mails reais de produção antes do DNS estar no ar**, ou avise os
  destinatários que o link só funciona depois do cutover).
- `SEND_EMAIL_HOOK_SECRET` — só existe depois do próximo passo:

**Configurar o Send Email Hook no Supabase Auth de PRODUÇÃO** (painel do projeto `wfqkjrpqkaarpavjheoj` →
Authentication → Hooks → Send Email hook → tipo **Supabase Edge Functions** → selecionar a função
`auth-email-hook`, já deployada). Ao salvar, o Supabase gera o segredo — cole-o como `SEND_EMAIL_HOOK_SECRET`
acima. **Sem isto, nenhum e-mail de autenticação sai em produção** — o Supabase continuaria usando o
remetente padrão dele (o que eu NÃO configurei e não vou configurar, por instrução explícita sua).

Também no Netlify (site `hp-group-hub-producao`, escopo Functions): `RESEND_API_KEY` (mesma key) — para o
`/api/send-email` funcionar.

## 4. Bloqueio real: DNS (não tenho acesso a nenhum provedor de DNS)

`hpfisioterapia.com.br` **não é gerenciado pela Hostinger** — os nameservers são `byte.dns-parking.com` e
`pixel.dns-parking.com` (confirmado por consulta direta). A Hostinger só aparece nos registros MX/SPF
(hospeda o e-mail); o DNS de verdade está em outro provedor — provavelmente o registrador do domínio.
Descubra onde isso é editável (painel do registrador, não da Hostinger) usando esses nomes de nameserver
como referência para confirmar que é o lugar certo.

**Registros a adicionar** (sem remover nenhum registro de e-mail existente — MX, SPF, DMARC ficam como
estão):
| Tipo | Nome | Valor |
|---|---|---|
| A | `@` (apex, `hpfisioterapia.com.br`) | `75.2.60.5` (IP padrão do load balancer da Netlify) |
| CNAME | `www` | `hp-group-hub-producao.netlify.app` |

Estes são os valores **padrão documentados** da Netlify para domínio próprio — **confirme os valores exatos
no painel da Netlify** ao adicionar o domínio customizado (Site `hp-group-hub-producao` → Domain management
→ Add a domain → `hpfisioterapia.com.br`), porque não tenho ferramenta para consultar/gravar o domínio
customizado do lado da Netlify nesta sessão — esse cadastro também precisa ser feito por você lá, e o
painel pode mostrar um valor ligeiramente diferente (ex. se a Netlify oferecer usar os nameservers dela em
vez de A/CNAME). Depois de adicionar lá, a Netlify emite HTTPS automaticamente (Let's Encrypt) — não requer
ação extra além de esperar a validação, que só acontece depois do DNS resolver.

**Depois que o DNS propagar**: confirme `curl -I https://hpfisioterapia.com.br` responde pelo site novo
(procure o cabeçalho `Server: Netlify`), then me avise para eu validar as jornadas no domínio final e
ajustar `Site URL`/`Redirect URLs` do Supabase Auth de produção para `https://hpfisioterapia.com.br` (mais
um passo de painel que só você pode fazer).

## 5. Bootstrap dos gestores

A allowlist (`contato@hpfisioterapia.com.br`, `jan.darioush@yahoo.com.br`) já está no banco (migration 003).
**Ninguém completou "Primeiro acesso" em produção ainda** — não criei conta em nome de nenhum gestor (só a
própria pessoa deve escolher sua senha). Isso só funcionará de ponta a ponta (e-mail recebido) depois que
os 3 secrets da seção 3 estiverem certos.

## 6. Pendências que ficam para depois (não bloqueiam o essencial)

- Confirmar plano/retenção de backup automático (PITR) do projeto `HP Group Core` no painel do Supabase —
  não verifiquei isto nesta sessão (não é uma leitura simples pelas ferramentas disponíveis).
- Resolver o site Netlify não documentado (`leafy-cascaron-325147`) — ainda ativo, ainda fora do meu
  acesso, ainda gerando deploy previews automáticos a cada push (visto rodando durante o merge desta
  sessão). Ver `docs/deployment.md`.
- Segundo gestor / demais convites de equipe em produção — dependem dos e-mails funcionando (seção 3).

## 7. Rollback

- **Frontend**: reativar o deploy publicado anterior pelo painel da Netlify (site `hp-group-hub-producao`),
  ou publicar de novo a partir de um commit anterior. Não desfaz nada no banco.
- **DNS**: reverter os registros A/CNAME para os valores do GitHub Pages (documentados na seção 2) — volta
  a servir o site institucional antigo imediatamente.
- **GitHub Pages**: reativar o trigger automático do workflow (`.github/workflows/deploy.yml`, trocar
  `workflow_dispatch` de volta por `push: branches: [main]`) se decidir voltar a usar GitHub Pages como
  principal.
- **Banco**: migrations não têm rollback automático. Se algo aplicado precisar ser desfeito, isso exige uma
  migration corretiva nova (nunca editar uma já aplicada, nunca `reset` em produção com dados reais).
- **Merge**: já é permanente no histórico do Git (não revertido por instrução — reverter um merge exigiria
  `git revert` explícito, não fiz isso preventivamente).
