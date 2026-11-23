# Prospecção B2B — Relatório técnico da Fase 0 (auditoria, sem código)

> Data: 23/11/2026 · Escopo: **somente leitura** (repositório `D:\Claude\hp-mkt-dash`, branch `feat/white-label-plataforma`, projeto Supabase **Dev** `fsvtzowcwhvwtluwrhnb`). Nada foi implementado, migrado, commitado ou publicado. Produção **não** foi consultada.
> Legenda: **[CONFIRMADO]** = visto no código/banco nesta auditoria · **[PROPOSTA]** = desenho meu, a aprovar · **[INVESTIGAR]** = não sei / depende de fonte externa ou decisão.
> **Parada obrigatória:** este relatório termina na seção 16 (decisões). Nada avança sem sua aprovação.

---

## 1. Estado atual do ERP HP Group Hub

**Código** [CONFIRMADO]: Vite + React + TypeScript + Tailwind/shadcn + TanStack Query; Supabase (Postgres 17.6, RLS, RPCs `security definer` com `search_path=''`, Edge Functions Deno, `pg_cron`, `pg_net`, `pg_trgm`, `unaccent`, `pgcrypto`, `supabase_vault`, `btree_gist`); site no Netlify. **145 migrations** no repositório, 11 Edge Functions, 550 funções públicas + 359 privadas no Dev, 259 tabelas em `public`, banco Dev com **98 MB** (maior tabela: `audit_log`, ~27 mil linhas).

**Aplicativos hoje** [CONFIRMADO] (`src/components/hp/apps.ts`): Hub, Gestão, Financeiro, CRM, Pages, Marketing, Operação, Academy, Parceiros, Produtividade. Cada um tem sidebar própria (`appNav.ts`), cor própria e é decidido **pela URL** (`appForPath`). Papéis só decidem o que **aparece**; a autorização real é RLS + funções.

**Multiempresa (white label)** [CONFIRMADO]: existe, no **Dev**, na branch `feat/white-label-plataforma` (PR #39, **rascunho**, ainda **não está na `main`**; a `main` já contém o PR #38). Reaproveita `org_id` (201 tabelas), papéis por organização (`org_memberships`, `role_assignments`), organização ativa validada no banco (`hp_pre_request` + `x-org`), módulos por organização (`org_modules`, política restritiva `zz_module_*`), planos/assinatura/limites (`platform_plans`, `org_subscriptions`), marca (`org_settings`), provisionamento por questionário, 14 organizações no Dev. Detalhes: `docs/white-label-arquitetura.md`.

**PRs abertos que tocam as mesmas áreas** [CONFIRMADO via `gh`]: #39 (white label, rascunho), #40 (redesign do ERP — mexe em Hub/navegação), #41 (apresentação PDF). Um novo aplicativo mexe em `apps.ts`/`appNav.ts`/`App.tsx`, que o #40 também altera → **risco de conflito** (ver seção 14).

**Produção** [CONFIRMADO por documentação, não consultada]: v1 no ar desde 07/10 (Supabase "Core" no plano Free segundo meu registro — **[INVESTIGAR]** plano atual). Nada do white label está em produção.

## 2. Estruturas existentes a reaproveitar

| Necessidade do prompt | O que já existe [CONFIRMADO] | Observação |
|---|---|---|
| Login, usuários, organizações, papéis | `auth.users`, `org_memberships`, `role_assignments`, `private.current_org()`, `has_org_role` | Reusar integralmente. Nenhuma autenticação paralela. |
| Registrar um aplicativo como módulo | `platform_modules` (chave, rotas, permissões, `enforcement`, `usage_metrics`), `platform_module_deps`, `platform_module_objects` (padrões de tabelas/RPCs protegidos), `org_modules`, política `zz_module_*`, recusa no pré-request por caminho | Basta **uma nova linha de módulo** + objetos protegidos. Segue o padrão do módulo Marketing. |
| Menu/sidebar/rotas | `APPS`, `APP_MODULE`, `PREFIXES`, `appNav.ts` | Acrescenta `prospeccao` com prefixo `/admin/prospeccao`. |
| CRM B2B | `legal_entities` (**já tem** `cnpj`, `legal_name`, `trade_name`, `cnae_main`, `cnae_secondary[]`, `legal_nature`, `founded_on`, `tax_regime`, telefone, WhatsApp, e-mails, endereço, `origin`, `corporate_account_id`), funil `kind='companies'` ("Empresa · B2B"), `opportunities.legal_entity_id`, `crm_company_create`, `crm_company_link_contact`, `crm_lead_lists(kind='companies')`, `crm_lead_list_companies` | **Não criar outro CRM.** A empresa adquirida vira/vincula `legal_entities`; a oportunidade usa o funil B2B existente. Ver `docs/crm-tipos-de-lead.md`. |
| Origem/atribuição | `opportunities.source/campaign/utm`, `mkt_person_origin`, `opportunity_events` | Acrescentar origem `prospeccao:<busca>` sem tabela nova de atribuição. |
| Livro-razão | `session_ledger` (delta inteiro por evento; **[INVESTIGAR]** se é bloqueado contra UPDATE/DELETE), `payments.idempotency_key/external_ref/refund_of` | **Padrão** a copiar; **não** reutilizar `payments` (é do financeiro da clínica; a regra do projeto já separa "cobrança da plataforma ≠ financeiro da clínica"). |
| Cota/consumo | `route_usage(org_id, day, kind, calls)`, `route_leg_cache`, `org_usage`/`org_limits_status`, `limit_guard` com `pg_advisory_xact_lock` | Padrão de franquia e de limite seguro sob concorrência. |
| Planos e limites | `platform_plans.limits` (JSON), `org_subscriptions.limits_override`, `platform_plan_save`, `platform_history` | Estender com limites de B2B (ex.: máximo de exportações). |
| Jobs/filas | `domain_events` (idempotency_key, tentativas, `next_attempt_at`, `claimed_by`), `automation_runs`, `pg_cron` (4 jobs: eventos 1 min, Google 5 min, Marketing 1 h, provisionamento 1 min), `notification_queue` | Padrão "tick" no cron + fila em tabela. Serve para reservas e enriquecimento **leves**; **não** para a carga da base da Receita. |
| E-mail | Resend (hook + `provisioning-invite` + `resend-webhook` com assinatura Svix) | Reusar para recibos/avisos. |
| Exportação assíncrona | `org_exports`, Edge `org-export`, bucket `org-exports`, URL assinada de 10 min com auditoria | Reusar o padrão para "Exportações" da Prospecção. |
| Auditoria | `audit_log` (por org), `platform_audit` | Reusar; **mas** ver risco de desempenho (seção 12). |
| Consentimento/LGPD | `consents` (texto, versão, IP), `person_contacts.verified_at/verification_method` | Base para "origem e verificação" dos contatos. |
| Integração externa com cota e cache | Edge `route-planner` + `route_leg_cache` + `route_usage` (provedor externo, teto diário, cache) | Modelo para provedores de enriquecimento. |
| Marca por organização | `org_settings`, `org_brand_for_host`, tokens `--*` em `src/styles/app.css` | Interface herda a marca da organização. |

## 3. Lacunas de multiempresa e White Label (para este aplicativo)

1. **Não existe revendedor.** [CONFIRMADO] `organizations` não tem pai/revendedor (colunas: `id, name, slug, status, segment_key, template_version, features, provisioned_at, provisioning_request_id`). O modelo B2B2B do prompt (atacado → white label → cliente final) **exige uma relação organização→organização** (ex.: `reseller_org_id`) e preços por nível. Hoje todas as organizações são "planas" sob a plataforma.
2. **Carteira de créditos não existe.** [CONFIRMADO] Nenhuma tabela `wallet/ledger/credit/billing/webhook` de plataforma. Planos têm preço "a definir" e **nada é cobrado**.
3. **Nenhum provedor de pagamento integrado.** [CONFIRMADO] `docs/integrations.md`: "Pagamentos: ⬜ provedor a definir". Só há menção a gateways em `docs/release-readiness.md`. (O produto Brighter Core, que é **outro** projeto, usa InfinitePay — não faz parte deste repositório; ver pergunta 14 da seção 16.)
4. **Domínio próprio sem verificação de posse por DNS** e remetente de e-mail por organização ainda "<Marca> via HP Group Hub". [CONFIRMADO] (limitações 2 e 9 do doc de arquitetura).
5. **Funil B2B e tipos de lead são da HP.** [CONFIRMADO] O modelo "Fisioterapia v1" cria funil de pacientes; o funil `companies` e as listas tipadas nasceram na HP. Uma organização nova **não** nasce com funil B2B → o módulo precisa **semear/garantir** um funil B2B ao ser habilitado, sem impor "Parceiro/Potencial Academy" (que continuam só da HP).
6. **Rótulos "HP" remanescentes** em telas administrativas [CONFIRMADO]. Não bloqueia, mas o novo app deve nascer sem texto fixo da HP.
7. **Desempenho de RLS linha a linha.** [CONFIRMADO, corrigido hoje em 3 tabelas de log — migration 149] O padrão `private.is_manager()` por linha custa ~0,4 ms; dezenas de políticas ainda o usam. Um app que gere **milhares de linhas por tenant** (empresas adquiridas, contatos, ledger) deve usar `(select …)` nas políticas desde o início.
8. **Sem "acesso excepcional de suporte" (break-glass)** e **sem teste de carga** [CONFIRMADO]. Relevante porque a Prospecção é a primeira carga pesada.

## 4. Arquitetura proposta para o aplicativo Prospecção B2B

[PROPOSTA]

```
 Navegador (React, app "Prospecção B2B", sidebar própria)
        │  JWT do usuário + x-org (validado no banco)
        ▼
 Projeto Supabase do ERP (transacional)                 Data Platform (Receita)  — projeto/banco SEPARADO
 ├─ módulo `prospeccao_b2b` (org_modules)               ├─ stage_* (carga bruta, descartável)
 ├─ b2b_searches / b2b_acquisitions / b2b_companies     ├─ rfb_* (empresas, estabelecimentos, sócios, tabelas de apoio)
 ├─ b2b_contacts / b2b_enrichment_jobs / b2b_exports    ├─ search_establishment (tabela denormalizada, só ATIVAS)
 ├─ core_wallet* (ledger, reservas, pacotes, compras)   ├─ search_rollup (contagens pré-agregadas)
 ├─ Edge Function `b2b-search`  ──server-to-server────► └─ RPC interna (somente service role / chave dedicada)
 ├─ Edge Function `b2b-acquire` (reserva→processa→consome)
 ├─ Edge Function `b2b-enrich-*` (provedores)
 ├─ Edge Function `payments-webhook` (assinado, idempotente)
 └─ legal_entities + opportunities (CRM EXISTENTE)
```

Princípios:
- **Dados públicos e dados do cliente nunca no mesmo banco.** A base da Receita é global (sem `org_id`); o que o tenant adquire é **copiado** (snapshot com origem e data) para tabelas com `org_id` e RLS. Assim "liberar" é uma operação real do servidor, não esconder coluna na tela.
- O navegador **nunca** fala com a Data Platform. Só Edge Functions do ERP, com credencial de servidor (nunca no front-end).
- O app **não** concede permissão: usa `current_org()`, `has_org_role` e o módulo `prospeccao_b2b` (enforcement `rls_rpc`).
- Reaproveitar papéis existentes: ver pesquisa/consumir créditos = gestor/administrativo/comercial da organização; **comprar créditos e ver carteira** = gestor/financeiro. Novas permissões só se for necessário (INVESTIGAR com o PR #40).

## 5. Modelo de dados proposto (rascunho, nomes provisórios)

**No ERP (transacional, todas com `org_id` + RLS + módulo):**

| Tabela | Função |
|---|---|
| `core_wallets` | uma por organização: unidade (`credit`), moeda de referência, estado. |
| `core_wallet_ledger` | **append-only**: `id, org_id, wallet_id, entry_type (purchase/bonus/reserve/release/consume/refund/adjust/expire), amount int (com sinal), reservation_id, ref_type/ref_id, idempotency_key, created_by, created_at`; `unique(org_id, idempotency_key)`; sem UPDATE/DELETE. |
| `core_credit_reservations` | `id, org_id, app_key, amount, status (open/settled/released/expired), expires_at, request_ref`. |
| `core_credit_packages` | catálogo de pacotes **configurável**: `owner_org_id` (plataforma ou revendedor), `credits, unit_price_cents, active, effective_from`; preços **nunca** no código. |
| `core_credit_purchases` | pedido de compra: `provider, provider_ref (unique), amount_cents, credits, status, paid_at`. |
| `payment_webhook_events` | caixa de entrada: `provider, event_id (unique), payload, signature_ok, processed_at, error`. |
| `b2b_searches` | filtro estruturado salvo (JSON validado), autor, contagens do momento, `rfb_reference_date`. |
| `b2b_acquisitions` | um lote de desbloqueio: busca, quantidade pedida/entregue, reserva, estado, custo em créditos. |
| `b2b_companies` | empresa adquirida **por organização**: `cnpj (text, 14 caracteres), …campos oficiais copiados…, source='receita_federal', source_date, acquired_at, acquisition_id, legal_entity_id (vínculo ao CRM)`; `unique(org_id, cnpj)` → **não cobra de novo**. |
| `b2b_partners` (QSA adquirido) | sócios da empresa adquirida: nome, qualificação, faixa/ data de entrada, CPF **mascarado como vem da Receita**, `decision_potential` (regra transparente). |
| `b2b_contacts` | contatos com os 9 campos pedidos (tipo, valor, empresa, pessoa, **fonte**, descoberta, última verificação, método, **confiança**, **status**). |
| `b2b_enrichment_jobs` | job por empresa/provedor: estado, tentativas, custo estimado, resultado, erro. |
| `b2b_exports` | reutiliza o padrão `org_exports` (ou o estende). |
| `b2b_settings` (por org) | política de re-enriquecimento, validade da aquisição, limites. |

**Na Data Platform (global, sem dados de cliente):** `rfb_empresas`, `rfb_estabelecimentos`, `rfb_socios`, `rfb_simples`, `rfb_cnaes`, `rfb_municipios`, `rfb_naturezas`, `rfb_qualificacoes`, `rfb_motivos`, `rfb_paises`, `rfb_import_runs` (arquivo, hash, linhas lidas × carregadas, data de referência), `search_establishment` (denormalizada: CNPJ, razão/fantasia, CNAE principal, UF, município, CEP, porte, capital, situação, abertura, natureza, MEI/Simples, telefone/e-mail cadastrais, contagem de sócios), `search_rollup` (contagens por CNAE × município × porte × situação).

**CNPJ como texto de 14 caracteres alfanuméricos** [CONFIRMADO risco, ver seção 12.1].

## 6. Arquitetura da base Receita / CNAE / QSA

**Fonte** [INVESTIGAR layout vigente]: arquivos CSV zipados mensais no repositório oficial da Receita (dados abertos), divididos em Empresas, Estabelecimentos, Sócios (10 partes cada) + Simples/MEI e tabelas de apoio (CNAEs, municípios, naturezas, qualificações, motivos, países). O layout e o caminho dos arquivos **mudaram em janeiro/2026** (relato público); a cada mês, **conferir o PDF de layout** da edição.
**Volume** [estimativa a partir de relatos públicos, não da fonte oficial]: ~68–74 milhões de estabelecimentos, ~60–69 milhões de empresas, 8 GB compactados e 17–27 GB de CSV (outros relatos falam em até ~85 GB já carregado). Codificação ISO-8859-1, separador `;`.

**Comparação de onde guardar:**

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| A. No banco atual do ERP | zero infra nova | mistura dado público global com dados de cliente; estoura limite (Free = 500 MB); índices/COPY pesam no banco transacional; risco de derrubar o ERP; backups gigantes | **Rejeitar** |
| B. **Postgres dedicado** (outro projeto Supabase ou Postgres gerenciado) | mesma tecnologia (RPC, pg_trgm, unaccent já conhecidos); busca por filtros combináveis com índices; custo previsível; isola carga e falhas | precisa dimensionar disco/compute; contagens exatas sobre dezenas de milhões exigem pré-agregação | **Recomendada** para v1 |
| C. Analítico (ClickHouse/BigQuery/DuckDB+Parquet) | contagens e filtros muito rápidos; compressão | segunda tecnologia, operação nova, latência de rede, custo por consulta (BigQuery) | Reavaliar se a v1 não atingir meta de latência |
| D. Busca (Typesense/Meilisearch) em cima do B | busca textual e facetas rápidas | mais uma peça | Opcional na Fase 3 |

**Pipeline de importação** [PROPOSTA]: job **fora da requisição do front-end** (máquina de trabalho/GitHub Actions/VPS **no disco D: durante o desenvolvimento**): download → verificação de hash/tamanho → `COPY` em lotes para `stage_*` → conferência `linhas do arquivo = linhas carregadas` (relato público de parser que perdeu 20 milhões de linhas por aspas) → *swap* atômico para `rfb_*` → reconstrução de `search_establishment`/`search_rollup` → registro em `rfb_import_runs`. Atualização **mensal**; cada linha guarda `source_date`. Falha no meio **não** altera a base servida (troca só ao final).

**Pesquisa** [PROPOSTA]: `search_establishment` só com situação "ativa" para a busca padrão (inativas ficam em `rfb_*` e entram por filtro explícito); índices compostos (`uf, município, cnae_principal, porte, situação`), `pg_trgm` + `unaccent` para nomes, `cnae_secundarios` em tabela filha ou `int[]` com GIN. **Prévia gratuita** = contagem por `search_rollup` (instantânea para combinações usuais) com *fallback* a `count` indexado limitado/estimado, **sempre marcando "estimado" vs "exato"**. **Sem listar CNPJs antes da compra** (a resposta da prévia é só números; paginação de resultados completos só para adquiridos; limite de taxa por usuário/organização contra raspagem por enumeração de filtros).

**CNAE por intenção** [PROPOSTA v1 determinística]: tabela `cnae_synonyms` (termo → lista de CNAEs, curada), busca por prefixo/trigrama na descrição oficial, **o usuário confirma os CNAEs sugeridos**. IA (interpretação em linguagem natural) só na Fase 9, **gerando filtros estruturados validados por esquema — nunca SQL**.

**QSA** [CONFIRMADO conhecimento público, INVESTIGAR layout]: a Receita publica sócios com **CPF parcialmente mascarado**; o CPF completo **não** é público. O sistema não deve tentar reconstruí-lo.

## 7. Carteira de créditos (ERP Core)

[PROPOSTA] — vive no **core** do ERP (não no app), para outros aplicativos consumirem depois.

- **Saldo derivado do ledger.** `disponível = Σ(ledger) − Σ(reservas abertas)`; uma coluna de saldo pode existir **apenas como cache atualizado pelo mesmo trigger/função** dentro da transação, nunca editável pelo front-end. Escritas só por RPC `security definer`.
- **Concorrência:** cada operação bloqueia a linha da carteira (`SELECT … FOR UPDATE`) ou usa `pg_advisory_xact_lock(wallet)` (padrão já provado no `limit_guard`: 8 requisições simultâneas → 1 passa). **Saldo negativo impossível** (restrição + verificação na função).
- **Idempotência:** `unique(org_id, idempotency_key)`; webhook por `unique(provider, event_id)`; reenvio devolve o resultado anterior.
- **Reserva → processamento → consumo → devolução** (fluxo do prompt, seção 11) como máquina de estados em `core_credit_reservations`; **expiração por `pg_cron`** (mesmo padrão dos jobs existentes) devolve reservas órfãs — "operação interrompida não deixa crédito bloqueado".
- **Deduplicação de CNPJ já adquirido** por `unique(org_id, cnpj)` + política de validade configurável (decisão 6). Re-enriquecimento é cobrança **separada e explícita**, nunca automática.
- **Estornos e bônus** são lançamentos de ledger (`refund`, `bonus`) com autor e motivo; **ajuste administrativo** só super admin, auditado em `platform_audit`.
- **Pacotes/preços:** tabela `core_credit_packages`, **nada em código**. A tabela do prompt (Start 100×R$2,00 … Enterprise sob consulta) entra como **dado semente a aprovar**.
- **Regra "mínimo de 100"** [PROPOSTA]: aplicada à **compra** e ao primeiro lote; lotes menores permitidos com saldo existente (como o prompt prevê). Configurável.
- **Auditoria de consumo para o cliente:** extrato por lançamento, com a busca e o lote de origem.

## 8. Integração com o CRM existente

[PROPOSTA] — fluxo "Empresa adquirida → Adicionar ao CRM":
1. Para cada `b2b_companies` selecionada: se já existir `legal_entities` com o mesmo CNPJ **na mesma organização** → **vincular** (não duplicar; hoje `crm_company_create` já devolve a existente por CNPJ); senão criar via função existente (ou uma RPC irmã que aceite os campos oficiais).
2. Contato principal → `people` + `person_contacts` (com `verified_at/verification_method`), vinculado à empresa pela função existente `crm_company_link_contact`.
3. Oportunidade no **funil `companies`** da organização, `source='prospeccao'`, `campaign`/`utm` com o id da busca, `owner_user_id` escolhido; opcionalmente adicionar a uma `crm_lead_list` do tipo `companies`.
4. **Rastreabilidade:** `b2b_searches.id → b2b_acquisitions.id → b2b_companies.id → legal_entities.id → opportunities.id → sales` (a venda já existe no módulo financeiro).
5. Tipos de lead: **sem impor categorias da HP.** Para a HP, a empresa B2B continua usando "Empresa · B2B"; "Parceiro" e "Potencial Academy" seguem como hoje (são tipos de **pessoa/funil** da HP). Para outras organizações, o módulo garante um funil B2B padrão ao ser habilitado (lacuna 5).
6. **Não** há segundo CRM, segunda tabela de oportunidades nem segunda lista de tarefas.

## 9. Estratégia de enriquecimento de contatos

[PROPOSTA] — camada desacoplada por **provedor** (interface única `findSite / findPhone / findEmail / verifyEmail / checkWhatsapp / findSocial`), um adaptador por provedor, **cada chamada com cota, cache, custo registrado e idempotência** (padrão `route-planner`).

- Resultado grava `b2b_contacts` com **fonte, data, método, confiança, status** e nunca promove um contato a "pessoal do decisor" sem evidência.
- **Classes de contato** (obrigatório mostrar): telefone cadastral (Receita) · WhatsApp comercial **confirmado** · número *potencialmente* associado a WhatsApp · e-mail geral · e-mail profissional individual **verificado** · **não encontrado**. "Não encontrado" ≠ "não existe" (e **site não encontrado ≠ ausência de site confirmada** — estados distintos no banco).
- **Provedores candidatos** [INVESTIGAR cotação, termos de uso e conformidade de cada um]: busca web/SERP para site oficial; verificação de domínio (DNS/MX/HTTP); validação de e-mail (SMTP/provedores); verificação de WhatsApp apenas por **API oficial/permitida**; descoberta de e-mail profissional por padrões de domínio **com verificação**, não por vazamento.
- **Excluído por política:** bases vazadas, enumeração abusiva de números, qualquer coisa contra termos dos provedores ou privacidade.
- **Custo:** cada job registra `estimated_cost`/`actual_cost` para margem por tenant (seção 13).

## 10. Estrutura de telas e navegação

Aplicativo `prospeccao` em `/admin/prospeccao/*` (sidebar própria, **Voltar ao Hub**, indicador de créditos sempre visível no cabeçalho do app). Telas, nesta ordem de construção:

1. **Visão Geral** — saldo/reservas/consumo, pesquisas recentes, empresas adquiridas por período, taxa de enriquecimento (cartões compactos 168 px conforme padrão do #40, **[INVESTIGAR]** se o padrão já está no `main` ou só no PR).
2. **Nova Pesquisa** — filtros combináveis (localização, atividade com sugestão de CNAE, empresa, contatos, decisores) + painel de prévia ao vivo (**confirmado × estimado × não verificado**), botão "Liberar N empresas" com resumo **antes da confirmação** (novas × já adquiridas × indisponíveis × custo em créditos × saldo após).
3. **Minhas Pesquisas** — salvas, duplicar, reexecutar, ver variação de contagem entre meses.
4. **Empresas Adquiridas** — tabela densa (colunas do prompt), painel lateral com cinco blocos (oficial, decisores, contatos, presença digital, inteligência/CRM), ação "Adicionar ao CRM" em massa.
5. **Decisores e Contatos** — visão por pessoa, filtros por confiança/status.
6. **Oportunidades Digitais** — pesquisas prontas (sem site **confirmado**, recém-abertas, telefone sem domínio…) com os estados corretos.
7. **Créditos** — saldo, extrato (ledger), comprar pacotes, compras, estornos.
8. **Exportações** — assíncronas, histórico, expiração.
9. **Configurações do aplicativo** — política de re-enriquecimento, validade, limites, provedores habilitados.

Super admin (em `/plataforma`): painéis de tenants, créditos vendidos/consumidos, receita, custos, jobs/erros.
Responsivo (375–1920 px), números longos conferidos, sem texto fixo da HP.

## 11. Estratégia de pagamentos

[PROPOSTA] — nenhum provedor está integrado hoje.
- **Regra de ouro:** crédito só entra após **confirmação do servidor** (webhook assinado + conferência por consulta à API do provedor), nunca pelo retorno visual do checkout. Tabela `payment_webhook_events` com `unique(provider, event_id)`, verificação de assinatura **obrigatória** (registro: o webhook do Brighter Core atual não tem assinatura — não herdar esse desenho), reprocessamento seguro, **reconciliação diária** (pedidos "pendentes" vs provedor).
- **PIX primeiro** (liquidação imediata, taxa baixa); **cartão** em seguida; **boleto** depois (compensação D+1/D+2 → reserva só após confirmação).
- **Escolha do provedor** [INVESTIGAR/decisão]: precisa de (a) PIX com webhook assinado, (b) **split/subconta** para o modelo B2B2B (o white label recebe o dinheiro da revenda de créditos e repassa o atacado) — candidatos típicos: Asaas, Mercado Pago (marketplace), Pagar.me/Stripe Connect, InfinitePay (verificar se oferece split/API de checkout para terceiros). **Não** definir provedor sem sua decisão.
- Reaproveitar do ERP: Edge Function, `provisioning-invite`/Resend para recibo, `platform_audit`.
- **Fiscal** [INVESTIGAR com contador]: emissão de NFS-e sobre venda de créditos, tributação do revendedor, tratamento contábil de créditos não consumidos (passivo) e **expiração** (decisão 7).

## 12. Riscos técnicos, jurídicos e de segurança

### 12.1 Achado concreto desta auditoria — CNPJ alfanumérico
[CONFIRMADO] A Receita **já emitiu o primeiro CNPJ alfanumérico (notícia de julho/2026)**. O repositório hoje **só aceita dígitos**: `src/lib/doc.ts → isValidCnpj` usa `onlyDigits`, `fmtCnpj` idem, e `private.is_valid_cnpj` (migration 045) remove `\D`. Um CNPJ com letras seria **rejeitado/mutilado** em todo o ERP. Para a Prospecção (que lê a base oficial) isso é bloqueante: o CNPJ precisa ser **texto de 14 posições, maiúsculo, alfanumérico**, com dígito verificador pelo cálculo oficial (valor ASCII − 48). **Ação proposta:** corrigir validadores (front e banco) como pré-requisito da Fase 2, com teste.

### 12.2 Jurídico (LGPD) [INVESTIGAR com advogado — nada abaixo é parecer jurídico]
- **Dados pessoais de acesso público não são "livres":** nomes de sócios, e-mails/telefones de MEI (que são do próprio empreendedor) exigem **finalidade, necessidade, transparência e base legal** (legítimo interesse documentado por **LIA**, ou outra). Precisa de **política de privacidade, canal de titular (acesso/correção/oposição/exclusão), opt-out, registro de origem** e retenção definida.
- **Comunicação:** disparo comercial por e-mail/WhatsApp tem regras (opt-out, políticas do provedor do WhatsApp, possível bloqueio de número). O ERP **hoje não faz disparo em massa** (`crm_broadcast` desligado). Esta entrega **não** deve habilitar disparo.
- **Termos da fonte:** confirmar a **licença/termos de uso** da base aberta da Receita e dos provedores de enriquecimento (revenda de dados derivados, atribuição, vedações).
- **Papel de controlador:** a organização cliente é controladora dos dados que adquire; o operador da plataforma tem de ter contrato/termos (DPA) claros — decisão comercial/jurídica.
- **Marca/nome:** referências de mercado citadas (Econodata, Speedio, Apollo, CNPJ Biz, Leads2b, Prospek) são **referência funcional**; sem copiar marca, texto, layout ou código.

### 12.3 Segurança e isolamento
- Novas tabelas **todas** com `org_id`, RLS por `current_org()`, política `zz_module_*`, entrada no `platform_export_tables` e no mapa de FKs entre organizações (`zz_org_fk_guard`). Teste cruzado Alfa × Beta como o N21.
- Credenciais de provedores e da Data Platform **somente** em secrets das Edge Functions; nunca no front-end; **nunca** em chat/Git.
- Raspagem/enumeração: limite de taxa, cotas, prévia só com contagens, auditoria de pesquisas incomuns.
- **Idempotência financeira** e testes de concorrência (reserva simultânea, webhook duplicado, falha no meio do lote) — como o N41, porém com mutantes (padrão do projeto do Core: provar que o teste falha se a defesa for removida).
- Desempenho de RLS (lacuna 7): políticas novas com `(select …)`; `audit_log` não deve receber uma linha por empresa adquirida em lotes enormes (gravar **um evento por lote**).

### 12.4 Técnico/operacional
- **Banco atual não comporta a base da Receita** (confirmado pelo porte: 98 MB hoje vs dezenas de GB). Free = 500 MB; mesmo o Pro (8 GB incluídos) exige disco extra.
- **Latência da prévia** em ~70 milhões de linhas sem pré-agregação — risco real; mitigado por `search_rollup`.
- **Qualidade/frescor:** dado cadastral tem defasagem; telefones/e-mails da Receita costumam ser do contador; **taxa de acerto de enriquecimento é incerta** (não prometer).
- **Mudança de layout dos arquivos** pela Receita (já houve em jan/2026): pipeline com validação de esquema e alerta, não importação cega.
- **Conflitos de branch** (seção 14) e **dependência do white label** não mesclado.
- **Teste em escala nunca feito neste ERP** (só concorrência pequena).

## 13. Custos — estimativa com premissas explícitas

> **Estes números são ordens de grandeza para decidir se o negócio fecha. Nenhum preço de provedor foi cotado. Tudo marcado como premissa tem de ser validado.**

**Data Platform (infra fixa)** — premissas: banco dedicado Postgres; só estabelecimentos **ativos** denormalizados + sócios; ~50–120 GB com índices; um nó de médio porte.
- Opção B no Supabase: plano Pro (~US$25/mês) + computação média/grande (~US$60–110/mês) + disco extra (~US$0,125/GB-mês → 100 GB ≈ US$12) ⇒ **~US$100–150/mês** (valores públicos que conheço de memória; **conferir** na tela de billing). O painel de add-ons do projeto Dev lista computação "Micro ≈ US$10/mês" e domínio próprio US$10/mês.
- Alternativa VPS própria: ~US$30–80/mês, com operação manual (backup, atualização, monitoramento) — **mais barata, mais trabalho e risco**.
- **Carga mensal** (download + `COPY` + índices): horas de CPU, sem custo relevante se rodar em máquina própria; em nuvem, poucas dezenas de dólares/mês de computação temporária **[premissa]**.

**Enriquecimento (custo variável por empresa — desconhecido)** — fórmula: `custo/empresa = busca de site + validação de domínio + verificação de e-mail + verificação de WhatsApp + sobras (retentativas, falhas)`. Cada termo depende do provedor **[INVESTIGAR cotação]**.

**Margem por crédito (exemplo ilustrativo, números hipotéticos):**
| Linha | Valor |
|---|---:|
| Preço de venda (Start) | R$ 2,00 |
| Taxa de pagamento (hipótese: cartão ~4%) | − R$ 0,08 |
| Tributos (hipótese: ~10%) | − R$ 0,20 |
| Suporte/overhead rateado (hipótese) | − R$ 0,10 |
| **Sobra antes do custo de dados** | **R$ 1,62** |
| Atacado do exemplo do prompt (R$ 0,80) | − R$ 0,80 |
| **Folga para custo de enriquecimento** | **R$ 0,82 por empresa** |

Se o custo real de enriquecimento por empresa ficar acima da folga, o pacote **Scale (R$ 1,30)** ou o atacado de R$ 0,80 **dão prejuízo** — por isso a decisão de preços (seção 16) deve vir **depois** da cotação dos provedores e de um **piloto medindo a taxa real de acerto**. Pacote Pro/Scale com desconto agravam o risco.

## 14. Roadmap de implementação (sugestão, ajustável)

| Fase | Entrega | Pré-requisito | Esforço (ordem de grandeza, 1 dev + Claude) |
|---|---|---|---|
| 0 | **Este relatório + decisões** | — | feito |
| 0.5 | Corrigir CNPJ alfanumérico (front + banco) e decidir base de código (branch) | aprovação | 0,5–1 dia |
| 1 | Módulo `prospeccao_b2b` (linha em `platform_modules`, `apps.ts`, `appNav.ts`, rotas, permissões, telas vazias **sem links mortos**) | #39 mesclado ou branch empilhada | 1–2 dias |
| 2 | Data Platform: projeto/banco, pipeline de importação, `search_establishment`/`rollup`, métricas de qualidade | decisão de infra | 5–8 dias |
| 3 | Pesquisa + prévia + CNAE (determinístico) | Fase 2 | 4–6 dias |
| 4 | Carteira (ledger, reservas, pacotes, expiração, painel) **sem pagamento real** (crédito por ajuste administrativo para teste) | decisão 7/8 | 5–7 dias |
| 5 | Empresas adquiridas (desbloqueio, dedupe, histórico, exportação) | 3 + 4 | 4–6 dias |
| 6 | QSA/decisores + enriquecimento (1 provedor piloto) | cotação/decisão de provedor | 6–10 dias |
| 7 | Integração CRM (vínculo, funil B2B garantido, origem) | 5 | 3–4 dias |
| 8 | Pagamentos (PIX → cartão), webhooks, reconciliação | decisão de provedor | 5–8 dias |
| 9 | White label comercial (revendedor, markup, relatórios, `/plataforma`) | lacuna 1 resolvida | 6–10 dias |
| 10 | IA/linguagem natural, Lead Score (regras), ROI | 3–7 | 5–8 dias |

Ordem diferente do seu: **Pagamentos (8) vem depois da Carteira (4) e do piloto de custo**; **a Fase 2 pode andar em paralelo à 1**. Cada fase termina com testes (SQL + E2E + concorrência + isolamento entre organizações) e **gate de aprovação**, como no Brighter Finance.

**Branch:** o #38 já está na `main`; o #39 (white label) **não**. A Prospecção depende de `org_modules`/`platform_*` do #39. Opções: (a) esperar o #39 entrar; (b) branch empilhada sobre `feat/white-label-plataforma`. O #40 (redesign) mexe em `apps.ts`/Hub — **conflito provável**; combinar a ordem de merge.

## 15. Arquivos e migrations que serão criados ou alterados (previsão)

**Alterar:** `src/lib/doc.ts` (CNPJ alfanumérico), `src/components/hp/apps.ts`, `appNav.ts`, `src/App.tsx` (rotas), `src/lib/release.ts` (feature, se usada), registro do módulo em `platform_modules`/`platform_module_objects`/`platform_module_deps`, `platform_export_tables`, `platform_plans.limits` (novas chaves), `org_modules`, `private.is_valid_cnpj` (migration nova), documentação (`CLAUDE.md`, `docs/project-status.md`).
**Criar (migrations, no Dev; numeração a partir de 150+, a confirmar com os PRs #40/#41):** carteira/ledger/reservas/pacotes/compras/webhooks (core) · tabelas `b2b_*` com RLS e `zz_module_*` · registro do módulo · RPCs `b2b_*` e `core_wallet_*` · funções cron (expirar reservas) · CNPJ alfanumérico · seed de funil B2B por organização.
**Criar (código):** `src/pages/admin/prospeccao/*`, componentes de filtro/prévia/painel da empresa; Edge Functions `b2b-search`, `b2b-acquire`, `b2b-enrich-*`, `payments-webhook`; `supabase/tools/` scripts da importação da Receita; **testes** SQL (`N26+`) e E2E (`N42+`) incluindo isolamento, concorrência, webhook duplicado, falha no meio do lote e mutantes.
**Fora do repositório (infra):** projeto/banco da Data Platform, secrets, job de importação mensal.

## 16. Decisões que preciso da sua aprovação

1. **Base de código:** empilhar a Prospecção sobre `feat/white-label-plataforma` (#39) ou esperar o #39 entrar na `main`? Como combinar com o #40 (redesign)?
2. **Data Platform:** (B) Postgres dedicado — **novo projeto Supabase** (justificativa acima) ou Postgres gerenciado/VPS? Orçamento mensal aceitável?
3. **Escopo da base na v1:** só estabelecimentos **ativos**? Incluir inativas, histórico de QSA, MEI/Simples?
4. **Provedor de pagamento** (com split para B2B2B): qual? Aceita PIX primeiro?
5. **Provedores de enriquecimento:** autoriza eu cotar/avaliar (sem contratar nada)? Algum já preferido?
6. **Validade da aquisição** e política de re-enriquecimento (a empresa adquirida vale para sempre? re-enriquecer cobra de novo?).
7. **Créditos expiram?** (impacto contábil/jurídico). Permitir crédito de bônus separado?
8. **Preços:** manter R$ 2,00/R$ 1,80/R$ 1,60/R$ 1,30 como **semente editável** só no Dev; decisão final após cotação e piloto (seção 13).
9. **Modelo B2B2B:** criar relação revendedor→cliente (nova coluna/tabela em `organizations`) já na Fase 4 ou só na Fase 9?
10. **Jurídico:** contratar parecer LGPD (LIA, política, canal do titular, DPA) **antes** da Fase 6 (enriquecimento)?
11. **Regra do mínimo de 100:** só na compra/primeiro lote (como o prompt) — confirmar.
12. **Quem pode comprar créditos e ver carteira** (gestor/financeiro) × quem pode gastar (comercial)? Quer um papel novo?
13. **CNPJ alfanumérico:** aprova corrigir já (Fase 0.5), mesmo sendo mudança em código existente?
14. **"ERP Core":** confirmo que a carteira vive no **core do HP Group Hub** (este repositório/Supabase) e **não** no projeto Brighter Core (outro produto, já com InfinitePay)?
15. **Ambiente de trabalho:** a importação da Receita (dezenas de GB) e dependências ficam no **D:** (nada em C:); confirma uma pasta (ex.: `D:\Claude\hp-data-receita`)?
16. **Piloto:** posso, após aprovação, importar **uma UF pequena** (ex.: 1 estado) para medir tempo, tamanho e latência antes de dimensionar a base nacional?

---

### Fontes externas usadas (somente para volume/estrutura da base; **não** são fontes oficiais)
Relatos e repositórios públicos sobre a base de CNPJ (tamanho, estrutura em Empresas/Estabelecimentos/Sócios, mudança de layout em jan/2026) e a notícia da Receita sobre o **primeiro CNPJ alfanumérico** (jul/2026). Os números de volume **variam por fonte e por data** e devem ser conferidos no portal oficial antes de dimensionar.
