# Deploy

## Situação atual (2026-09-23 — cutover de produção executado, DNS pendente)

- **`main` mesclado**: PR #1, commit de merge `436dabe`. `feature/hp-group-hub` cumpriu seu papel; trabalho
  novo a partir daqui é direto em `main` (ou branches novas a partir dela).
- **Site institucional público** (`hpfisioterapia.com.br`) **ainda é o GitHub Pages atual** — DNS não foi
  alterado (fora do meu acesso, ver `docs/go-live-plan.md` seção 4). O workflow que republicava a cada push
  em `main` foi **desativado** (`on: workflow_dispatch`, não mais `push: main`) — commitado antes do merge
  para não competir com a publicação real assim que `main` mudasse. Confirmado depois do merge: nenhuma
  execução nova disparou; o site atual segue servido sem alteração.
- **Netlify — dois sites, propositalmente separados**:
  - `hp-group-hub` (id `2c2d11bc-f62c-42b7-bae6-4cf3b6f35756`) — **Dev/preview**, continua protegido por
    login de equipe (`401` confirmado). Nada mudou aqui.
  - `hp-group-hub-producao` (id `324307d8-7697-4f3a-907f-95e572b5b77d`, time "Hp Group") — **produção**,
    criado nesta sessão, **sem** proteção de login (`200 OK` público, confirmado). Env vars: `VITE_SUPABASE_URL`/
    `VITE_SUPABASE_PUBLISHABLE_KEY` apontando para `HP Group Core`, `EMAIL_FROM` configurado. `RESEND_API_KEY`
    pendente (segredo que só você tem). Publicado a partir do commit `5fcc175`, 1 Function + 1 Edge Function.
    Endereço atual: `https://hp-group-hub-producao.netlify.app` — vira o endereço final assim que o domínio
    customizado + DNS estiverem prontos (ver `docs/go-live-plan.md`).
- **Supabase produção** (`HP Group Core`, `wfqkjrpqkaarpavjheoj`): 37 migrations aplicadas, `pg_cron`
  habilitado, job `domain-events-retry` ativo, Edge Function `auth-email-hook` deployada. Banco
  estruturalmente pronto; sem dados reais ainda (nenhum gestor completou o primeiro acesso).

## ⚠️ Achado: segundo site Netlify não documentado, público, fora do time "Hp Group"
O GitHub App oficial da Netlify (app id 13473) está conectado a este repositório e publica automaticamente, a cada push/PR, um site **diferente e não relacionado** — `leafy-cascaron-325147` (nome auto-gerado). Confirmado que:
- **Não aparece na lista de projetos do time "Hp Group"** consultada via MCP — está em outra conta/time Netlify, fora do meu acesso.
- **É publicamente acessível sem login**, diferente do site documentado. Ainda ativo — visto gerando um novo deploy preview automaticamente durante o merge desta sessão (checks `leafy-cascaron-325147` no PR #1).
- É provavelmente resultado de uma conexão "Deploy to Netlify"/GitHub-App feita em algum momento anterior por uma conta pessoal (possivelmente a mesma do dono do repositório GitHub), separada da conta/time "Hp Group" usada para os sites oficiais.
- Hoje ele não expõe dados reais (build sem backend configurado), mas é uma superfície pública não intencional que replica o código da aplicação a cada push, incluindo agora a app inteira pós-merge. **Não consigo corrigir isto** — não tenho acesso a essa conta/site.
- **Ação necessária do usuário**: acessar a conta Netlify dona de `leafy-cascaron-325147` (verificar em https://app.netlify.com em cada conta Netlify que você usa) e decidir: desconectar a integração GitHub App dessa conta, ou mover o site para o time "Hp Group" e aplicar a mesma proteção, ou confirmar que é intencional e documentar.

## Como publicar um novo deploy manual
```bash
npm run build && npx -y @netlify/mcp@latest --site-id <ID_DO_SITE> --proxy-path "<URL fornecida pelo MCP da Netlify>"
```
Site Dev/preview: `2c2d11bc-f62c-42b7-bae6-4cf3b6f35756`. Site de produção: `324307d8-7697-4f3a-907f-95e572b5b77d`.
(ou `netlify login` + `netlify deploy --build` com o CLI instalado em `D:\Tools\npm-global`). A URL do proxy é gerada pelo MCP a cada uso e **não deve ser commitada**. Nenhum dos dois sites está ligado ao GitHub por CI — push não publica sozinho; é preciso repetir este passo após cada commit relevante, nos dois sites conforme o caso.

## Ambientes
| Ambiente | Supabase | Netlify | Observação |
|---|---|---|---|
| Dev | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`) | local (`npm run dev`) ou site `hp-group-hub` (protegido) | dados de teste permitidos |
| Produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | site `hp-group-hub-producao` (público) | estrutura pronta; sem dados reais; DNS do domínio final pendente |

## Migrations
Ordem 001→037 (última: `20260924000037_reserved_slug_confirmar.sql`) — **todas aplicadas em produção** nesta sessão. Aplicar sempre no Dev primeiro → testes SQL → advisors → só então produção. Nunca `reset` em remoto.

## Pendências de deploy (ver `docs/go-live-plan.md` para o passo a passo completo)
1. DNS de `hpfisioterapia.com.br` (fora do meu acesso — nameservers em `dns-parking.com`, não na Hostinger).
2. 3 secrets do Supabase de produção (`RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_SITE_URL`) + configurar o Send Email Hook lá (gera `SEND_EMAIL_HOOK_SECRET`).
3. `RESEND_API_KEY` no Netlify de produção.
4. Domínio customizado `hpfisioterapia.com.br` cadastrado no site `hp-group-hub-producao` (painel da Netlify).
5. Resolver o site Netlify não documentado (`leafy-cascaron-325147`, ver acima).

SEO/OG por página já está implementado via Edge Function (`netlify/edge-functions/social-meta.ts`) e publicado no site de produção — validação por crawler externo real só é possível depois do domínio final estar no ar (o site de produção não tem proteção de equipe, mas ainda não está no domínio oficial).
