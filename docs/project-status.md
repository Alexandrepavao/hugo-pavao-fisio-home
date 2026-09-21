# HP Group Hub — Status do Projeto

Atualizado: 2026-09-21 (sessão 1)

## Ambiente identificado
| Recurso | Destino | Observação |
|---|---|---|
| Repositório | `Alexandrepavao/hugo-pavao-fisio-home` | permissão WRITE; branch de trabalho `feature/hp-group-hub` |
| Diretório local | `D:\Claude\hugo-pavao-fisio-home` | cache npm em `D:\Tools\npm-cache` |
| Supabase produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`, sa-east-1) | org "HP Group", plano free |
| Supabase dev/preview | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`, sa-east-1) | criado nesta sessão, custo US$ 0 |
| Netlify | time "Hp Group" (`contato-e5bg89q`), Free | nenhum site criado ainda |
| Produção atual do site | GitHub Pages → `hpfisioterapia.com.br` | **NÃO tocar**: push em `main` republica o site |

> O CLI do Supabase local está logado numa conta diferente (projetos da Brighter). Ele **não** é usado. Todo acesso ao Supabase é via MCP da organização HP Group.

## Estado por etapa
| Etapa | Estado |
|---|---|
| 1 Diagnóstico e fundação | em andamento |
| 2 Captação e comercial | não iniciada |
| 3 Operação e financeiro | não iniciada |
| 4 Educação e relacionamento | não iniciada |
| 5 Consolidação | não iniciada |
| 6 Validação e publicação | não iniciada |

## Linha de base do repositório (antes das alterações)
- Vite 5 + React 18 + TypeScript + Tailwind 3 + shadcn/ui + react-router 6. SPA, sem backend, sem auth, sem banco.
- `npm run build` OK; `tsc` OK; `npm run lint` com 3 erros pré-existentes (`textarea.tsx`, `command.tsx`, `tailwind.config.ts`).
- Deploy atual: GitHub Actions → `gh-pages` com CNAME `hpfisioterapia.com.br`.
