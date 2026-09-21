# Relatório de testes

## 2026-09-21 (sessão 1)
| Teste | Ambiente | Resultado |
|---|---|---|
| `tsc -p tsconfig.app.json --noEmit` | local | ✅ sem erros |
| `npm run build` | local | ✅ |
| ESLint nos arquivos novos | local | ✅ 0 erros (2 avisos react-refresh) |
| ESLint no repositório inteiro | local | ⚠ 3 erros **pré-existentes** (`textarea.tsx`, `command.tsx`, `tailwind.config.ts`) |
| RLS: isolamento por unidade, escalada, revogação, anon (`supabase/tests/001_rls_isolation.sql`) | Dev | ✅ 16/16 |
| Supabase advisors (segurança) | Dev | ✅ sem alertas |
| Navegador: `/admin/pessoas` sem sessão → `/login` | local | ✅ |
| Navegador: `/redefinir-senha` com link expirado / sem token → tela "Link inválido ou expirado" | local | ✅ |

## Não executado ainda
Recuperação de senha ponta a ponta (depende do e-mail do gestor + entrega de e-mail), criação de pessoa pela UI com usuário real, concorrência de agenda, financeiro, Academy, webhooks, E2E das jornadas.
