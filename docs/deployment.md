# Deploy

## Situação atual
- Produção do site institucional: **GitHub Pages** (`hpfisioterapia.com.br`, CNAME + workflow em push na `main`). Não alterado.
- Netlify (time "Hp Group", plano Free): **nenhum site criado**. O primeiro deploy será de *preview* em endereço `*.netlify.app` novo.
- **Não** alterar DNS nem apontar `hpfisioterapia.com.br` para a Netlify sem aprovação do responsável, com destino e impacto apresentados.

## Configuração planejada (`netlify.toml`)
- Build: `npm run build`, publish `dist`, Node 22.
- Fallback SPA: `/* → /index.html (200)` (necessário para `/admin`, `/checkup` etc. abrirem direto).
- Variáveis por contexto: `production` → HP Group Core; `deploy-preview` e `branch-deploy` → HP Group Dev.
- `SUPABASE_SERVICE_ROLE_KEY` apenas em variáveis da Netlify, escopo *Functions*.

## Migrations
Ordem: aplicar no Dev → testar (`supabase/tests/`) → rodar advisors → só então produção. Nunca `reset` em remoto.

## Antes de mesclar em `main`
`main` republica o site atual. Decidir com o responsável: (a) manter GitHub Pages para a home até o cutover; (b) mover a hospedagem para Netlify (exige DNS).
