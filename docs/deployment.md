# Deploy

## Situação atual
- **Produção do site institucional**: GitHub Pages (`hpfisioterapia.com.br`, CNAME + workflow em push na `main`). **Não alterado.** Não há mesclagem na `main`, nem mudança de DNS.
- **Netlify** (time "Hp Group", plano Free): site `hp-group-hub` (id `2c2d11bc-f62c-42b7-bae6-4cf3b6f35756`) → `https://hp-group-hub.netlify.app`. **Não está ligado ao GitHub por CI** — os deploys são publicados manualmente por upload (`netlify deploy --build` ou o proxy do `@netlify/mcp`, ver abaixo). Push na branch **não** publica automaticamente neste site.
- Publicado a partir do commit `6cb26c1` (branch `feature/hp-group-hub`). Build "ready", 2 Functions (`send-email`, `auth-email-hook`) e 1 Edge Function (`social-meta`) publicadas.
- Env vars `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` configuradas nos contextos `branch-deploy` e `deploy-preview` deste site, apontando **exclusivamente** ao Supabase Dev (`fsvtzowcwhvwtluwrhnb`). `EMAIL_FROM` (escopo Functions) configurada como `HP Group <contato@hpfisioterapia.com.br>`. Nenhuma chave privilegiada. Pendentes (segredos que não posso definir sozinho): `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET` — ver `docs/integrations.md`.
- O site tem **controle de acesso por login de equipe Netlify** (anônimos recebem 401 — confirmado após o novo deploy, proteção intacta). A verificação pública das jornadas autenticadas só é possível após login de equipe ou sessão já autenticada; não foi contornada nesta sessão.

## ⚠️ Achado: segundo site Netlify não documentado, público, fora do time "Hp Group"
O GitHub App oficial da Netlify (app id 13473) está conectado a este repositório e publica automaticamente, a cada push/PR, um site **diferente e não relacionado** — `leafy-cascaron-325147` (nome auto-gerado). Confirmado que:
- **Não aparece na lista de projetos do time "Hp Group"** consultada via MCP — está em outra conta/time Netlify, fora do meu acesso.
- **É publicamente acessível sem login** (`https://deploy-preview-1--leafy-cascaron-325147.netlify.app` → `200 OK`, sem proteção de equipe), diferente do site documentado.
- É provavelmente resultado de uma conexão "Deploy to Netlify"/GitHub-App feita em algum momento anterior por uma conta pessoal (possivelmente a mesma do dono do repositório GitHub), separada da conta/time "Hp Group" usada para o site oficial.
- Hoje ele não expõe dados (build sem backend configurado), mas é uma superfície pública não intencional que replica o código da aplicação a cada push. **Não consigo corrigir isto** — não tenho acesso a essa conta/site.
- **Ação necessária do usuário**: acessar a conta Netlify dona de `leafy-cascaron-325147` (verificar em https://app.netlify.com em cada conta Netlify que você usa) e decidir: desconectar a integração GitHub App dessa conta, ou mover o site para o time "Hp Group" e aplicar a mesma proteção, ou confirmar que é intencional e documentar.

## Como publicar um novo deploy manual
```bash
npm run build && npx -y @netlify/mcp@latest --site-id 2c2d11bc-f62c-42b7-bae6-4cf3b6f35756 --proxy-path "<URL fornecida pelo MCP da Netlify>"
```
(ou `netlify login` + `netlify deploy --build` com o CLI instalado em `D:\Tools\npm-global`). A URL do proxy é gerada pelo MCP a cada uso e **não deve ser commitada**. Como não há CI automático, **é preciso repetir este passo após cada commit** que deva ser refletido no ambiente publicado — inclusive antes de qualquer validação ao vivo (um deploy desatualizado gera falsos negativos).

## Ambientes
| Ambiente | Supabase | Netlify | Observação |
|---|---|---|---|
| Dev | `HP Group Dev` | local (`npm run dev`, porta 5180) | dados de teste permitidos |
| Preview | `HP Group Dev` | deploy manual do site `hp-group-hub` | **nunca** escreve em produção; publicar de novo a cada commit relevante |
| Produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | a definir | **vazio**; migrations e go-live pendentes de aprovação |

## Migrations
Ordem 001→036 (última: `20260924000036_reserved_slug_pesquisas.sql`). Aplicar no Dev → testes SQL → advisors → só então produção. Nunca `reset` em remoto. Antes do go-live de produção: (1) aplicar 001–036; (2) o seed de configuração (organização, unidade-sede, funis, categorias, pesquisa) já está nas migrations; (3) rodar advisors; (4) criar as variáveis `production` na Netlify **apontando para o Core**; (5) os dois gestores concluem o primeiro acesso (nenhuma senha padrão).

## Antes de mesclar em `main`
`main` republica o site atual via GitHub Pages **e** o site atual é SPA sem as novas rotas. Decidir com o responsável: (a) manter GitHub Pages para a home até o cutover; (b) mover para Netlify (exige DNS). Nenhuma das opções foi executada.

## Pendências de deploy
Variáveis `RESEND_API_KEY` e `SEND_EMAIL_HOOK_SECRET` (function-scope, segredos — ver `docs/integrations.md` para onde cadastrar); configurar o Send Email Hook no painel do Supabase Auth apontando para `/api/auth-email-hook`; URLs de redirecionamento no Supabase Auth; resolver o site Netlify não documentado (`leafy-cascaron-325147`, ver acima). SEO/OG por página **já está implementado** via Edge Function (`netlify/edge-functions/social-meta.ts`, publicada neste deploy) — pendente apenas validação por crawler externo real, bloqueada pela proteção de equipe (ver `docs/release-readiness.md`).
