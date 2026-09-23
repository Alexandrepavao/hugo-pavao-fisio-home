# HP Group Hub

Plataforma integrada do HP Group: site institucional, HP Pages (landing pages), HP Core (pessoas, unidades, equipe, produtos), HP CRM, agenda e operação, HP Finance, HP Academy, portal de parceiros e dashboard do gestor.

> **Estado:** em construção (Etapa 1 de 6). Veja [`docs/project-status.md`](docs/project-status.md) para o que está concluído, parcial, bloqueado e não iniciado.

## Stack
Vite · React 18 · TypeScript · Tailwind · shadcn/ui · react-router · Supabase (PostgreSQL, Auth, Storage) · Netlify (hospedagem e Functions).

## Rodando localmente
```bash
npm ci
cp .env.example .env.local   # preencha com URL e chave publishable do projeto Supabase de DEV
npm run dev
```
Nunca use as credenciais de produção localmente. Chaves privilegiadas (`SUPABASE_SERVICE_ROLE_KEY`) nunca vão para o front-end nem para o git.

## Estrutura
| Caminho | Conteúdo |
|---|---|
| `src/pages` | Site institucional, `auth/` (login/recuperação), `admin/` (painel) |
| `src/auth` | Sessão e guardas de rota (apenas UX — a autorização real é RLS) |
| `supabase/migrations` | Esquema versionado |
| `supabase/tests` | Testes SQL (isolamento RLS) |
| `netlify/functions` | Código privilegiado (convites, webhooks, formulários públicos) |
| `docs/` | Arquitetura, plano, modelo de dados, permissões, métricas, integrações, deploy, testes, status |

## Ambientes
Dev/Preview → projeto Supabase *HP Group Dev*. Produção → *HP Group Core*. Detalhes em [`docs/architecture.md`](docs/architecture.md) e [`docs/deployment.md`](docs/deployment.md).

## Atenção: produção atual
O site em `hpfisioterapia.com.br` é publicado por GitHub Pages a cada push na `main`. Todo trabalho novo acontece na branch `feature/hp-group-hub` via pull request.
