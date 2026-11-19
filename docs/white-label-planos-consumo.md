# White label — planos, assinaturas e consumo

Arquitetura: [white-label-arquitetura.md](white-label-arquitetura.md).

> **Cobrança da plataforma ≠ financeiro da clínica.** As tabelas/telas de vendas, recebimentos, DRE etc. são da **clínica** (módulo `financeiro`). Planos e assinaturas abaixo são do **produto** (o que a plataforma cobra do cliente). Nenhum preço foi inventado e **nenhuma cobrança automática** existe ou foi ativada.

## 1. Planos (`platform_plans`)

| Campo | Significado |
|---|---|
| `key`, `name`, `description`, `status` (`draft`/`active`/`retired`), `version` | Identificação e ciclo de vida. |
| `implementation_fee_cents` | **Taxa de implantação** (nula = "a definir"). |
| `monthly_fee_cents` | **Mensalidade** (nula = "a definir"). |
| `included_modules` | Módulos incluídos no plano. |
| `limits` (JSON) | `max_staff_users`, `max_professionals`, `max_units`, `max_active_patients`, `storage_mb`, `external` (franquias de serviços externos, ex.: consultas de rota). |

Planos semeados: `interno` (organização operadora — HP; sem cobrança; **ativo**), `essencial`, `profissional`, `rede` (todos **rascunho**, sem valores nem limites). Edição em **`/plataforma ▸ Planos e consumo`** (`platform_plan_save`, auditada, só administrador da plataforma; limites desconhecidos e módulos inexistentes são recusados).

## 2. Assinatura da organização (`org_subscriptions`)

Criada na etapa `brand` do provisionamento: plano escolhido, estado `trial`, `implementation_status` (`pending` ou `in_progress` se implantação assistida), `limits_override` (exceções por organização) e **`enforcement`**:

- `warn` (**padrão**): só avisa quando perto/acima do limite.
- `block_new`: bloqueia **novas criações** acima do limite. Hoje só há gatilho para **unidades** e **profissionais** (`limit_units`, `limit_professionals` → erro `P0011`, "histórico e exportação continuam disponíveis"); usuários da equipe e pacientes ativos são **medidos e avisados**, mas ainda não bloqueados (pendência).

Garantias de projeto: limite **nunca apaga dados**, **nunca bloqueia histórico nem exportação**, e **não gera cobrança de excedente** automática.

## 3. Métricas de consumo (definição precisa, `private.org_usage`)

Contagens de **uso**, não custo. Período mensal em `America/Sao_Paulo`.

| Métrica | Definição |
|---|---|
| `staff_users` | Usuários **distintos** com vínculo ativo na organização e ao menos um papel ativo (não vencido) entre `manager, ops_admin, unit_manager, sales, finance, physio, teacher, accountant`. Pacientes/parceiros **não** contam. |
| `professionals` | Linhas ativas em `professionals` da organização. |
| `units` | Unidades da organização com `active` verdadeiro (ou nulo). |
| `active_patients` | Pessoas **distintas** com matrícula (`patient_enrollments`) `active` na organização. |
| `storage_bytes` | Soma do tamanho dos objetos nos buckets `accounting-private`, `org-brand`, `org-exports` cuja primeira pasta é o `org_id`. (Outros buckets por organização — ex.: documentos jurídicos/academy — **ainda não** entram na soma.) |
| `route_requests_month` | Soma de `route_usage.calls` da organização no mês. |
| `external_services` | Reservado (e-mail, calendário, pagamentos, vídeos, mensagens = não medidos). |

`org_limits_status` compara cada métrica com o limite do plano (+ override): estados **`ok`**, **`perto`** (≥ 80 %), **`acima`**, **`sem_limite`**.

## 4. Onde se vê

- **Plataforma**: *Organizações ▸ Detalhes ▸ Consumo e limites* e a tabela *Consumo por organização* (`platform_org_usage`).
- **Gestor da clínica**: *Administração ▸ Organização ▸ Módulos e consumo* (`org_usage`, só gestor/administrativo da própria organização).
- Textos sempre dizem: "contagem de uso, não cobrança; excedente não é cobrado automaticamente; limites nunca apagam dados nem bloqueiam histórico/exportação".

## 5. Pendências (decisão humana)

1. Definir **valores** de implantação e mensalidade e os **limites** por plano; ativar planos.
2. Decidir se `enforcement` padrão de planos pagos passa a `block_new`.
3. Definir franquias de serviços externos (rotas, e-mails) e como medir e-mails enviados (hoje sem rastreio).
4. Integrar cobrança (provedor de pagamento) — **fora do escopo** desta etapa; nada contratado.
5. Incluir os demais buckets por organização na métrica de armazenamento.
