# White label multiempresa — arquitetura e modelo de isolamento

> Estado: **Dev apenas** (branch `feat/white-label-plataforma`, empilhada sobre `feat/apresentacao-jornada`). Nada foi para produção, nenhum DNS público foi alterado, nenhum serviço foi contratado.
> Documentos irmãos: [provisionamento](white-label-provisionamento.md) · [modelos e módulos](white-label-modelos.md) · [planos e consumo](white-label-planos-consumo.md) · [portabilidade](white-label-portabilidade.md).

## 1. O que é, em uma frase

Uma única base de código e **um único projeto Supabase** atendem várias empresas clientes. Cada empresa é uma **organização** com dados separados, marca, módulos e configurações próprias. A HP é apenas **uma organização** configurada na plataforma; novos clientes nascem de um **modelo versionado de segmento** (hoje: Fisioterapia) por meio de um **questionário**, sem clonar repositório, sem editar código, sem SQL manual e sem novo projeto Supabase.

## 2. Vocabulário (cinco conceitos que nunca se misturam)

| Conceito | O que é | Onde vive |
|---|---|---|
| **Plataforma** | Quem opera o produto (nós). Administra organizações, modelos, planos. **Não** lê dados de pacientes, finanças ou prontuários das organizações. | `platform_admins` (+ funções `platform_*`/`provisioning_*`, todas com `require_platform_admin()`) |
| **Organização (tenant)** | A empresa cliente. Fronteira de isolamento de dados. | `organizations` + coluna **`org_id`** (a mesma já usada em 201 tabelas — **não** foi criado `tenant_id` concorrente) |
| **Unidade** | Filial/sede dentro de uma organização. | `units` (sempre da organização; guarda de FK impede unidade de outra organização) |
| **Usuário** | Conta de login (Supabase Auth). Pode participar de várias organizações. | `auth.users` |
| **Vínculo (membership)** | Usuário ⇄ organização, com papéis **por organização**. | `org_memberships` + `role_assignments(org_id, …)` |

Regras: administrador da plataforma ≠ gestor de clínica (um não herda o outro); papel de uma organização **não vale** em outra; **nenhuma** fusão de contatos/prontuários entre empresas independentes por CPF/telefone/e-mail (cada organização tem as suas `people`).

## 3. Organização ativa (o ponto mais sensível)

1. A interface guarda a **escolha** da organização ativa (aba do navegador: `sessionStorage` `hp.activeOrg`) e a envia no cabeçalho `x-org` das chamadas à API.
2. O pré-request da API (`public.hp_pre_request`, configurado no papel `authenticator`) **revalida no banco**: o usuário autenticado precisa ter vínculo **ativo** com aquela organização; senão a chamada falha com `42501` ("organização inválida para este usuário"). Só então grava `app.active_org` (local à transação).
3. `private.current_org()` devolve: organização validada do cabeçalho → senão o vínculo padrão (`is_default`). Todas as funções de papel (`has_org_role`, `has_unit_role`, `has_any_role`, `is_manager`, …) e todas as políticas RLS usam `current_org()` — **nunca** um valor recebido do front.
4. **O que o cabeçalho/domínio/tema NÃO fazem:** não concedem acesso. Um `x-org` forjado, de outra empresa, ou que não seja UUID, é recusado pelo banco (testado em N38/N21).
5. Troca de organização na interface = recarga completa da aplicação (`switchOrganization`): nenhum cache de consulta, estado de tela ou dado da organização anterior permanece em memória. Se o vínculo escolhido deixar de valer, a interface volta sozinha ao vínculo padrão (sem tela quebrada).
6. Papéis exibidos na interface (`AuthProvider`) são lidos **filtrando pela organização ativa confirmada pelo banco** (`my_memberships().active`).
7. "Ver como" (somente leitura) continua funcionando como antes e tem prioridade sobre `x-org`.

> O papel `anon` precisa de `EXECUTE` em `hp_pre_request`, pois o pré-request roda em **toda** chamada, inclusive sem login. A migration 142 restaura essa concessão (o Dev estava sem ela, o que derrubava qualquer chamada pública). **Conferir o mesmo na produção antes de qualquer promoção.** Teste: N22.

## 4. Camadas de isolamento (o que foi auditado e como cada coisa é protegida)

Auditoria do schema `public`: **258 tabelas**; **201** têm `org_id`. Classificação usada pelo inventário de exportação (`platform_export_tables`): **178 por organização**, **31 filhas** (isoladas pela tabela mãe), **49 excluídas** do escopo da organização (catálogos globais, filas/caches/logs técnicos, dados pessoais do usuário `pf_*`, a própria `organizations`).

| Camada | Proteção |
|---|---|
| **SELECT/INSERT/UPDATE/DELETE** | RLS por `org_id = private.current_org()` + papéis por organização. |
| **Chaves estrangeiras entre organizações** | Gatilho `zz_org_fk_guard` em **151 tabelas / 341 relações** (mapa `private.org_fk_map`, recalculável): uma linha da organização A **não pode** apontar para linha da organização B (ex.: criar pessoa com unidade alheia → erro). |
| **Unicidades** | Índices que impediam atuar em duas organizações foram refeitos com escopo de organização (`role_assignments`, `acc_grants`, `professionals.user_id`, etc.). |
| **RPCs / funções privilegiadas** | `security definer` com `search_path=''`; autorização **no servidor** (`current_org()` + papel). Funções `private.*` não são expostas pela API (apenas `public,graphql_public`). Funções de plataforma exigem `platform_admins`. |
| **Módulos** | Habilitação por organização (`org_modules`). Tabelas: política **restritiva** `zz_module_*` (81 políticas). RPCs/tabelas por caminho: recusa no pré-request (`request.path`) com `42501` "módulo desabilitado para esta organização (…)". Esconder menu **não** é controle de acesso — é só visual. |
| **Storage** | Políticas por pasta `"<org_id>/…"` em `academy-private`, `representation-docs`, `legal-documents`, `accounting-private`, `org-exports`; `org-brand` é **público por natureza** (logotipos aparecem antes do login), com escrita só do gestor da própria pasta. Download de exportação: URL assinada de 10 minutos, registrada em auditoria. |
| **Busca/relatórios/exportações** | Passam pelas mesmas RLS/RPCs; a exportação é construída por organização em **uma única instrução SQL** (snapshot consistente). |
| **Realtime** | A publicação `supabase_realtime` está **vazia**: nenhuma tabela é transmitida (sem exposição). Se um dia houver Realtime, tem de ser por organização. |
| **Cache** | Cliente: `x-org` + recarga na troca. Servidor: nada em memória compartilhada entre organizações. |
| **Jobs/filas/webhooks** | `domain_events` carrega `org_id`; handlers usam a organização do evento. Credenciais de integração são **por organização** (nenhuma é copiada da HP). |
| **E-mails** | Todo envio usa **Resend**. O Auth Send Email Hook identifica a marca da organização do destinatário (`email_brand_for_address`, só dados públicos de marca) e usa o **remetente verificado da plataforma** com o nome da organização ("Clínica X via HP Group Hub"). Nunca há remetente próprio não verificado. |
| **Domínio/tema** | Resolvem **apenas a marca** (`org_brand_for_host`: host verificado, organização ativa, resposta mínima; host desconhecido → `{found:false}`). Nunca autorizam. |

## 5. Plataforma ≠ gestor, sem personificação silenciosa

- O administrador da plataforma **não tem papel** em nenhuma organização e as tabelas de negócio devolvem 0 linhas para ele (teste N38 #1).
- **Não existe impersonação silenciosa.** O "Ver como" existente é do gestor da própria organização, somente leitura, com registro. Acesso excepcional de suporte (com autorização específica, tempo limitado e auditoria) **não foi implementado** — está listado como pendência.
- Toda ação da plataforma vai para `platform_audit` (organização, módulo, plano, endereço, solicitação, exportação).

## 6. Mapa de objetos criados (migrations 134–142)

| Migration | Conteúdo |
|---|---|
| 134 | Fundação: `platform_admins`, `org_memberships` (+espelho de `user_accounts`), `current_org()` por vínculo/cabeçalho, helpers de papel por organização, `hp_pre_request` com `x-org`, unicidades, `on_auth_user_confirmed` reescrito, guarda de FK entre organizações. |
| 135 | Segmentos, módulos (+dependências, objetos protegidos), modelos versionados (Fisioterapia v1), planos, assinaturas, `org_modules`, `org_settings` (marca), `org_domains`, bucket `org-brand`, `org_context`, uso/limites, RPCs `platform_*`. |
| 136 | Questionário e motor: `provisioning_requests/steps`, validação no servidor, aplicação do modelo, etapas retomáveis, cron `provisioning-retry`, RPCs `provisioning_*`, convites existentes (`my_pending_invitations`/`invitation_accept`). |
| 137 | Correções de Storage por organização; exportação (`org_exports`, `platform_export_tables`, `org_export_*`). |
| 138 | `email_brand_for_address` (marca para e-mails de autenticação). |
| 139–141 | Catálogo com funções do modelo; `platform_org_modules`; slug reservado `plataforma`. |
| 142 | `EXECUTE` de `hp_pre_request` para `anon`. |

Edge Functions (Dev): `provisioning-invite` (admin da plataforma), `org-export` (gestor), `auth-email-hook` (hook do Auth, `verify_jwt=false` por desenho: autenticado pela assinatura do webhook).

## 7. Testes que provam o isolamento

- **SQL `N21`** — 77 verificações (Alfa × Beta fictícias, criadas **pelo motor do questionário**): leitura/escrita cruzada, RPCs, FKs entre organizações, papéis por organização, módulos, marca, limites, idempotência/retomada, Storage, exportação.
- **SQL `N22`** — pré-request executável por `anon`/`authenticated`/`service_role`; anônimo com `x-org`/`x-view-as` forjado não ativa organização nem troca identidade.
- **E2E `N38`** (API real, como um atacante/integração faria) — plataforma ≠ gestor; Alfa e Beta provisionadas; dados separados (mesmo telefone/e-mail em duas empresas = duas pessoas); escrita cruzada recusada; `x-org` forjado recusado; módulo desligado bloqueado **no servidor** e dados preservados; usuário em duas organizações (convite aceito sem duplicar conta); exportação íntegra; **fila sintética** (12 pedidos, 4 simultâneos).
- **E2E `N39`** (interface) — painel da plataforma, questionário A–I (erro de validação no servidor, rascunho retomável), criação da **Clínica Gama só pelo questionário**, login pelo endereço próprio com a marca da Gama, módulos não contratados ocultos e bloqueados, troca de organização Alfa ↔ Beta.

## 8. Decisões e trade-offs

- **Reaproveitar `org_id`** (já presente) em vez de introduzir `tenant_id` — evita dois conceitos para a mesma coisa.
- **Um projeto Supabase compartilhado** (menor custo e atualização central). Contrapartida: o isolamento depende de RLS/guardas bem testados — por isso a bateria N21/N38 e o gatilho de FK.
- **Vínculo padrão + escolha explícita** da organização ativa, sempre revalidada: simples para a maioria (uma organização) e seguro para quem tem várias.
- **Provisionamento síncrono, mas retomável** sobre a fila de eventos existente: sem infraestrutura nova; etapas externas (e-mail) ficam **fora** da transação SQL.
- **Exportação em uma instrução SQL**: garante consistência sem bloqueios longos; organizações muito grandes são recusadas com mensagem clara (limitação conhecida).

## 9. Limitações conhecidas (honestas)

1. **E-mails reais não foram exercitados no Dev**: falta o secret `PUBLIC_SITE_URL` (o Auth Hook e a função `provisioning-invite` se recusam sem ele). O primeiro acesso do administrador foi **simulado** criando a conta já confirmada (o gatilho de confirmação vincula o administrador à organização do convite).
2. **Domínio público/DNS**: sem verificação de posse por DNS (domínios próprios ficam `pending`); só endereços `*.localhost` são ativados no Dev. Subdomínios em produção exigem definir `base_domain` e DNS curinga — **não feito**.
3. **Páginas públicas ainda são da HP**: quiz de avaliação, páginas do editor, formulários públicos e onboarding resolvem a organização da HP. Um cliente novo ainda **não tem captação pública própria** (precisa generalizar por endereço).
4. Semente de **Marketing** é da HP (módulo marcado *experimental*).
5. Algumas funções legadas leem `user_accounts` diretamente (ex.: listagem de equipe) e podem não refletir vínculos **secundários**; módulos com `enforcement: none` dependem só de papéis.
6. **Storage** ignora `x-org` (a API do Storage não passa pelo pré-request): quem pertence a duas organizações envia arquivos de marca/documentos conforme o **vínculo padrão**.
7. Menus (busca global/paleta de comandos) ainda não filtram por módulo (só o seletor de aplicativos).
8. `index.html` (título/meta/favicon) é estático da HP até a aplicação carregar; sem SSR, rastreadores veem a marca HP.
9. Sem acesso excepcional de suporte (break-glass) e sem rastreio de entrega de e-mail.
10. Planos da plataforma estão em **rascunho** (sem preços/limites): nada é cobrado.
