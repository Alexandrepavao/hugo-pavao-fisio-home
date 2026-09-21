# Arquitetura — HP Group Hub

## Decisões
| Tema | Decisão | Motivo |
|---|---|---|
| Front-end | Manter Vite + React 18 + TS + Tailwind + shadcn (stack já existente) | Preserva a home e a identidade; sem migração desnecessária |
| Roteamento | react-router (SPA). Rotas reservadas primeiro, depois `/:slug` dinâmico (HP Pages) | Landing pages no domínio oficial |
| Banco/Auth/Storage | Supabase (PostgreSQL + Auth + Storage) | Definido no escopo |
| Autorização | **RLS + funções `private.*`** que leem tabelas (`role_assignments`), nunca metadados do JWT | Metadados editáveis não podem ser autoridade |
| Código privilegiado | Netlify Functions (TypeScript), único lugar com `SUPABASE_SERVICE_ROLE_KEY` | Convites, webhooks, formulários públicos, processamento de eventos |
| Hospedagem | Netlify (previews por PR) | Definido no escopo |
| Módulos | Aplicação modular única; módulos ligados por FKs no banco | Sem microserviços |

## Ambientes
| Ambiente | Supabase | Netlify context | Observação |
|---|---|---|---|
| Desenvolvimento | `HP Group Dev` (`fsvtzowcwhvwtluwrhnb`) | local (`npm run dev`) | Dados sintéticos permitidos |
| Preview | `HP Group Dev` | `deploy-preview`, `branch-deploy` | **Nunca** escreve em produção |
| Produção | `HP Group Core` (`wfqkjrpqkaarpavjheoj`) | `production` | Apenas dados reais; migrations só após validação no Dev |

Não há Docker na máquina, portanto não existe Supabase local; o projeto Dev remoto cumpre esse papel.

## Publicação atual do site (atenção)
`hpfisioterapia.com.br` é servido por **GitHub Pages** via workflow que roda em push na `main`. Enquanto o trabalho estiver na branch `feature/hp-group-hub` nada disso é afetado. Antes de mesclar em `main` (o que republica a produção) e antes de qualquer mudança de DNS é necessária decisão do responsável (ver `docs/deployment.md`).

## Camadas do banco
- `public`: tabelas expostas via API, todas com RLS habilitado. `anon` sem privilégios em tabelas internas.
- `private`: funções de autorização e triggers (`SECURITY DEFINER`, `search_path` vazio), não exposta pela API.
- Escritas multi-tabela ou com regra de negócio passam por funções (`create_person`, futuras `book_appointment`, `confirm_payment`…), transacionais e idempotentes.

## Fluxo de eventos (planejado — Etapa 5)
`domain_events` (outbox) com `idempotency_key` única, consumido por Netlify Function agendada; `event_deliveries` registra tentativas, erros e retentativas com backoff.

## Segredos
Front-end recebe somente `VITE_SUPABASE_URL` e a chave *publishable*. A chave *service role* fica apenas nas variáveis da Netlify (contexto de funções) e no `.env.local` do servidor de desenvolvimento; nunca é commitada.
