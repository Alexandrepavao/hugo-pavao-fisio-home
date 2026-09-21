# Permissões

## Modelo
- **Conta** (`auth.users`) ≠ **Pessoa** (`people`). `user_accounts` liga conta → organização (+ pessoa opcional).
- **Papéis** em `role_assignments(user_id, role, unit_id, valid_from, valid_until, revoked_at)`. `unit_id` nulo = todas as unidades. Um usuário pode ter vários papéis; cada um vale no seu escopo, sem herdar privilégios dos demais.
- Papéis `manager`, `ops_admin`, `member`, `partner` só podem ser org-wide (CHECK no banco).
- Revogação (`revoked_at`) ou expiração (`valid_until`) tem efeito imediato: as funções `private.has_*_role` são reavaliadas em cada consulta.
- Sem convite/bootstrap, um usuário autenticado **não tem conta nem papel** e enxerga 0 linhas (signup aberto é inofensivo).

## Matriz atual (o que já está implementado e testado)
| Recurso | manager | ops_admin | unit_manager | sales | finance | physio | teacher | partner | member |
|---|---|---|---|---|---|---|---|---|---|
| Pessoas (ler) | org | org | unidade | unidade | unidade | — | — | — | só a própria |
| Pessoas (criar/editar) | org | org | unidade | unidade | — | — | — | — | — |
| Contatos/tipos/tags de pessoa | idem pessoas | | | | | | | | |
| Unidades (ler) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Unidades (editar) | ✔ | ✔ | — | — | — | — | — | — | — |
| Papéis / convites | tudo | tudo exceto manager/ops_admin | — | — | — | — | — | — | — |
| Auditoria | ✔ | — | — | — | — | — | — | — | — |

Acesso **clínico individual** não é concedido a nenhum papel administrativo (nem ao gestor). Será uma permissão assistencial específica ligada a um vínculo profissional↔paciente com validade e revogação (Etapa 4, ainda não implementada).

## Primeiro acesso do gestor (sem senha padrão)
`private.bootstrap_config` guarda **um e-mail** autorizado a virar gestor. Quando esse e-mail confirma sua conta no Supabase Auth (convite ou recuperação de senha) e ainda não existe gestor ativo, o trigger cria `user_accounts` + papel `manager` e consome a configuração. Nenhuma senha é definida por nós: o usuário cria a sua pelo link enviado por e-mail (`/redefinir-senha`).

## Testes
`supabase/tests/001_rls_isolation.sql` — transação desfeita; cobre isolamento por unidade, escalada de privilégio, revogação e `anon`.
