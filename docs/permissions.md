# Permissões

## Modelo
- **Conta** (`auth.users`) ≠ **Pessoa** (`people`). `user_accounts` liga conta → organização (+ pessoa).
- **Papéis** em `role_assignments(user_id, role, unit_id, valid_from, valid_until, revoked_at)`; `unit_id` nulo = todas as unidades. Papéis combináveis; cada um vale no seu escopo. `manager`, `ops_admin`, `member`, `partner` só existem em escopo de organização (CHECK).
- Autoridade vem **sempre das tabelas** via funções `private.has_org_role/has_unit_role/has_any_role` — nunca de metadados do JWT. Revogação/expiração tem efeito imediato (reavaliadas em cada consulta).
- Sem convite/bootstrap, um usuário autenticado **não tem conta nem papel** e enxerga 0 linhas.
- Toda escrita com regra de negócio passa por função `SECURITY DEFINER` que checa papel e escopo; `anon` só executa `get_public_page`, `track_page_visit`, `submit_public_form`.

## Bootstrap dos gestores (sem senha padrão)
`private.manager_bootstrap_emails` lista os e-mails autorizados (`contato@hpfisioterapia.com.br`, `jan.darioush@yahoo.com.br`). O trigger em `auth.users` só concede `manager` quando `email_confirmed_at` está preenchido (e-mail **verificado**), uma única vez por e-mail, registrando `bootstrap_manager` na auditoria. Não há promoção no front-end nem por metadados. A senha é criada pela própria pessoa (link do Supabase Auth). Testado (7/7) com e-mail não verificado, e-mail fora da lista, e metadados forjados.

## Matriz (resumo do que está implementado)
| Área | manager | ops_admin | unit_manager | sales | finance | physio | teacher | partner | member |
|---|---|---|---|---|---|---|---|---|---|
| Pessoas | org | org | unidade | unidade | **unidade (leitura, para identificar quem paga; sem tela de Pessoas)** | — | — | — | própria |
| Páginas/CRM/oportunidades | org | org | unidade | unidade | — | — | — | — | — |
| Agenda (agendar) | org | org | unidade | unidade | ler | própria agenda | — | — | ver as suas |
| Vendas / recebíveis (ler) | org | org | unidade | unidade | unidade | — | — | — | próprias parcelas |
| Recebimentos, estornos, a pagar, comissões | org | org | unidade | — | unidade | — | — | — | — |
| Cursos (gestão) / acessos | org | org | — | — | — | — | cursos (acessos: gestor/ops) | — | — |
| Cursos (consumo) | ✔ | ✔ | — | — | — | — | ✔ | — | só com direito ativo |
| Acompanhamento clínico | **não** | **não** | **não** (só cria vínculos) | — | — | **só com vínculo ativo** | — | — | próprio |
| Dashboard | org | org | suas unidades | — | — | — | — | — | — |
| Equipe/convites/papéis | tudo | tudo exceto manager/ops_admin | — | — | — | — | — | — | — |
| Auditoria | ✔ | — | — | — | — | — | — | — | — |
| Parceiro: indicações/repasses autorizados | org | org | unidade | unidade | unidade | — | — | os seus | — |

**Acesso clínico individual** exige vínculo assistencial (`care_relationships`) ativo e papel `physio` na unidade. Gestor cria/revoga vínculos, mas não lê conteúdo clínico. Revogar o vínculo revoga os conteúdos liberados por aquele profissional. O canal de dúvidas e os registros de atividade só são visíveis ao paciente e aos profissionais vinculados.

**Tarefas pessoais (`staff_tasks`)** não seguem a matriz de papéis por unidade: são **privadas por padrão** — só o dono lê/escreve, sempre, independente de papel (nem `manager` lê a tarefa privada de outra pessoa). Marcar `visibility = 'team'` na criação as torna visíveis a **qualquer papel de equipe da mesma unidade** (não só gestor) — é uma escolha explícita de quem cria a tarefa, nunca automática. `my_day()` combina essas tarefas com `crm_tasks` atribuídas e `appointments` do profissional só por leitura; nada é duplicado nem escrito de volta nessas tabelas de origem.

## Arquivos privados
Buckets `academy-private` e `care-private` (não públicos). Política de Storage por acesso real: curso (`can_read_course`) ou conteúdo liberado (`care_assignment_active`). O navegador usa **URL assinada de 1 h**, gerada só se a política permitir. Revogação bloqueia novas assinaturas imediatamente (URLs já emitidas expiram em até 1 h — limitação conhecida).

## Contábil (`/admin/contabil`) e ADM — papéis e concessões (2026-09-29)
Novo papel **`accountant`** (Contador(a); migration 048): pode estar em escopo de organização ou de unidade. Vê e prepara a competência (classificar, anexar, dispensar, exportar) **somente nas unidades atribuídas**; não vê nome de paciente (pseudônimo `Paciente XXXXXX`); não fecha nem reabre sem concessão.

| Ação | manager | ops_admin | unit_manager | finance | accountant | sales / outros |
|---|---|---|---|---|---|---|
| Abrir o app Contábil / consultar lançamentos | org | org | unidade | unidade | unidade | **não** (RPC nega com 42501) |
| Classificar, anexar comprovante, dispensar com justificativa, exportar | ✔ | ✔ | unidade | unidade | unidade | — |
| Nome real do paciente nos lançamentos e no pacote | ✔ | ✔ | ✔ | ✔ | **pseudônimo** | — |
| Configurar (regras, classificações, mapeamento, empresa da unidade, **conceder** fechar/reabrir) | ✔ | ✔ | — | — | — | — |
| **Fechar competência** e **aceitar alteração posterior** | só com concessão `close` | só com concessão `close` | só com concessão `close` | só com concessão `close` | só com concessão `close` | — |
| **Reabrir competência** (justificativa obrigatória) | só com concessão `reopen` | idem | idem | idem | idem | — |

Regras: (1) a concessão (`acc_grants`) só vale enquanto a pessoa mantém papel contábil/financeiro na unidade — revogar o papel revoga o poder na hora; (2) toda concessão/revogação, fechamento, reabertura, aceitação de alteração, classificação, dispensa, documento e exportação vai para `audit_log`; (3) tabelas `acc_*` têm só leitura por RLS (por unidade) — toda escrita é RPC `SECURITY DEFINER` com checagem explícita; (4) arquivos no bucket privado `accounting-private`, pasta `{org}/{unidade}/{aaaa-mm}/…`: a política confere organização **e** unidade, não há UPDATE/DELETE, e abrir um arquivo passa por `acc_documents_access` (autoriza + audita) antes da URL assinada de 60 s.

**ADM — campos sensíveis (047):** regime tributário, inscrição estadual e e-mail financeiro de PJ só para manager/ops_admin; o servidor devolve `null` (listagem), descarta (exportação e preferência de colunas) e filtra na leitura pela permissão atual. Importar PJ exige manager/ops_admin (`legal_entity_import_check/commit`). Preferências de colunas (`adm_view_prefs`) são por usuário, sem escrita direta.

## Testes
`supabase/tests/001…010` (ver `test-report.md`) + teste de API direta com token de aluna + E2E (`e2e/`) contra o Dev real. Refazer a cada expansão do banco.

## Captação de leads (quizzes) — respostas de saúde
`quiz_leads` não tem `GRANT` direto para nenhum papel — toda leitura passa por `list_quiz_leads`/
`get_quiz_lead_detail`, que mascaram as 3 respostas de saúde (dor, motivação de melhora, impacto na
qualidade de vida) para quem não tem `manager`/`ops_admin`/`unit_manager`; o papel `sales` nunca as
vê, mesmo enxergando a captação em si (mesmo precedente de `corporate_accounts`). Ver
`docs/project-status.md` (sessão mais recente) e `docs/data-model.md` (migration 038).

## Decisões de privacidade que exigem validação do responsável pelo negócio
Retenção e base legal de dados de saúde; texto de consentimento nos formulários; prazo de guarda de auditoria e de mensagens do canal de dúvidas; política de exclusão a pedido do titular (hoje: arquivar/anonimizar manualmente); necessidade de DPO. Este projeto não afirma conformidade jurídica automática.
