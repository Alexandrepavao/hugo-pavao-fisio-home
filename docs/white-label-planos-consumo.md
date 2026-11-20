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

## 6. Atualização de 20/11/2026 — migration 147 (planos, assinatura, limites e histórico)

Testes: SQL **N25** (27 verificações) e E2E **N41** (plano QA pela interface + 8 requisições simultâneas). Continua **sem preço inventado e sem cobrança**.

**O administrador da plataforma consegue** (`/plataforma ▸ Planos e consumo` e `Organizações ▸ Detalhes ▸ Plano e assinatura`):
1. **Criar um plano** (chave `[a-z][a-z0-9_]`, ex.: `qa_teste`; nasce em *rascunho*, sem valores).
2. **Definir módulos** incluídos (validados contra o catálogo) e **limites suportados**.
3. **Associar uma organização** ao plano (`platform_subscription_set`): plano, estado (teste/ativa/suspensa/cancelada), imposição (*só avisar* × *bloquear novas*) e **exceções de limite** da própria organização.
4. **Consultar consumo** (contagens atuais × limites) e o **histórico** de alterações de plano e de assinatura, com **valor anterior → novo** (`platform_history`).

Plano incluir um módulo **não** habilita o módulo na organização (módulos continuam sendo escolhidos pela plataforma, com dependências).

### Zero × ilimitado × não configurado

| Em `limits` / `limits_override` | Significa | Estado exibido | Com imposição "bloquear novas" |
|---|---|---|---|
| chave **ausente** | **não configurado** (ninguém definiu) | `nao_configurado` | não bloqueia |
| `null` explícito (campo "ilimitado") | **ilimitado** (definido de propósito) | `ilimitado` | não bloqueia |
| número `0` | **zero** (nenhum) | `zero` (uso 0) / `acima` (uso > 0) | bloqueia **toda** criação nova |
| número `n ≥ 1` | teto `n` | `ok` / `perto` (≥ 80 %) / `acima` | bloqueia a criação nova quando uso ≥ `n` |

Exceção da organização **sobrepõe** o plano chave a chave (inclusive `null` = ilimitado). Valores aceitos: inteiros ≥ 0 ou `null`; chaves conhecidas (`max_staff_users`, `max_professionals`, `max_units`, `max_active_patients`, `storage_mb`, `external`). Decimal, negativo, texto e chave desconhecida são **recusados no servidor**.

### Como cada consumo é contado (e o que é imposto)

| Métrica | Contagem | Imposto? |
|---|---|---|
| `units` | unidades da organização com `active` verdadeiro/nulo | **sim** (trigger em `units`) |
| `professionals` | linhas ativas em `professionals` | **sim** (trigger em `professionals`) |
| `staff_users` | usuários **distintos** com vínculo ativo e ao menos um papel ativo de equipe (gestor, administrativo, gestor de unidade, comercial, financeiro, fisioterapeuta, professor, contador) | só **medido e avisado** |
| `active_patients` | pessoas distintas com matrícula `active` | só medido e avisado |
| `storage_bytes` | objetos dos buckets `accounting-private`, `org-brand`, `org-exports` na pasta da organização (outros buckets ainda **não** entram) | só medido |
| `route_requests_month` | soma de `route_usage.calls` no mês (America/Sao_Paulo) | só medido |

### Limite sob requisições simultâneas

A contagem e a inserção são **serializadas por organização + métrica** (trava consultiva na transação): com limite de profissionais = 1 e **8 requisições simultâneas**, **1 passou e 7 receberam `P0011`** ("limite do plano atingido…"), 288 ms (N41, Dev). O bloqueio vale **só para criações novas**: dados existentes, **leitura, consumo, histórico e exportação continuam disponíveis**, e nada é apagado.

### Plataforma × financeiro da clínica

O plano/assinatura é cobrança do **produto**; vendas, recebíveis, DRE, comissões e repasses são da **clínica** (módulo financeiro). Associar plano não cria venda nem recebível (testado em N25/N41). Nenhuma integração de cobrança existe nem foi contratada.

### Pendências (decisão humana)
Valores e limites **reais** dos planos comerciais (continuam rascunho); decidir a imposição padrão de planos pagos; franquias de serviços externos; bloqueio de **usuários da equipe**/pacientes ativos (hoje só medidos); incluir os demais buckets na métrica de armazenamento.
