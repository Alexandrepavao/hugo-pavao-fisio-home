# Deploy

## Situação atual
- **Produção do site institucional**: GitHub Pages (`hpfisioterapia.com.br`, CNAME + workflow em push na `main`). **Não alterado.** Não há mesclagem na `main`, nem mudança de DNS.
- **Netlify** (time "Hp Group", plano Free): site `hp-group-hub` → `https://hp-group-hub.netlify.app`. Recebeu o deploy de **preview** da branch `feature/hp-group-hub`, ligado **exclusivamente** ao Supabase Dev (`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` no contexto `all`; nenhuma chave privilegiada).
- O site tem **controle de acesso por login de equipe Netlify** (anônimos recebem 401). Isto protege o ambiente de desenvolvimento; a verificação pública do deploy só é possível após login ou após você liberar o acesso. As validações ao vivo foram feitas localmente contra o Dev (ver `test-report.md`).

## Como publicar um novo preview
```bash
npm run build && npx -y @netlify/mcp@latest --site-id 2c2d11bc-f62c-42b7-bae6-4cf3b6f35756 --proxy-path "<URL fornecida pelo MCP da Netlify>"
```
(ou `netlify login` + `netlify deploy --build` com o CLI instalado em `D:\Tools\npm-global`). A URL do proxy é gerada pelo MCP a cada uso e **não deve ser commitada**.

## Ambientes
| Ambiente | Supabase | Netlify | Observação |
|---|---|---|---|
| Dev | `HP Group Dev` | local (`npm run dev`, porta 5180) | dados de teste permitidos |
| Preview | `HP Group Dev` | deploy do site `hp-group-hub` | **nunca** escreve em produção |
| Produção | `HP Group Core` | a definir | **vazio**; migrations e go-live pendentes de aprovação |

## Migrations
Ordem 001→014. Aplicar no Dev → testes SQL → advisors → só então produção. Nunca `reset` em remoto. Antes do go-live de produção: (1) aplicar 001–014; (2) o seed de configuração (organização, unidade-sede, funis, categorias, pesquisa) já está nas migrations; (3) rodar advisors; (4) criar as variáveis `production` na Netlify **apontando para o Core**; (5) os dois gestores concluem o primeiro acesso (nenhuma senha padrão).

## Antes de mesclar em `main`
`main` republica o site atual via GitHub Pages **e** o site atual é SPA sem as novas rotas. Decidir com o responsável: (a) manter GitHub Pages para a home até o cutover; (b) mover para Netlify (exige DNS). Nenhuma das opções foi executada.

## Pendências de deploy
Fallback SPA e a rota `/api/send-email` (Function) precisam ser conferidos no deploy publicado; variáveis `RESEND_API_KEY`/`EMAIL_FROM`; URLs de redirecionamento no Supabase Auth; SEO/OG por página exige renderização no servidor (não implementado).
