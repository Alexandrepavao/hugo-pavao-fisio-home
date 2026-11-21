# White label — questionário e provisionamento automático

Arquitetura geral: [white-label-arquitetura.md](white-label-arquitetura.md). Estado: **Dev apenas**.

## 1. Como criar um cliente (passo a passo, sem código)

Pré-requisito: ser **administrador da plataforma** (linha em `platform_admins`; hoje concedida pelo operador do projeto no Dev).

1. Abra **`/plataforma ▸ Criar aplicativo`** (rascunho salvo a cada etapa; `?rascunho=<chave>` retoma).
2. Responda às etapas **A–I**:
   - **A Empresa** (nome, segmento, responsável + e-mail, cidade/UF, unidades) — segmentos *planejados* aparecem desabilitados.
   - **B Operação** (serviços, modalidades, modelos de venda, fluxo).
   - **C Equipe** (quantidade e funções **do modelo do segmento**).
   - **D Clientes** (CRM, captação, formulários, propostas, portal, importação).
   - **E Módulos** (o modelo já inclui a base; opcionais com **sugestões** a partir das respostas — nunca ativadas sozinhas — e dependências explicadas).
   - **F Marca** (nome do aplicativo, cores, subdomínio, domínio próprio *opcional*; o logotipo o próprio cliente envia depois em *Organização ▸ Marca*).
   - **G Integrações** (marcar = **interesse**; nada é conectado, nenhuma credencial é copiada).
   - **H Plano** (valores **a definir**; nenhuma cobrança é gerada) e implantação padrão/assistida.
   - **I Revisão**: o **servidor valida tudo**; erros levam à etapa certa; avisos explicam o que fica pendente.
3. Clique em **Criar aplicativo**. A solicitação vira uma organização em estado *preparando*, o motor roda as etapas e a tela mostra o progresso, o **tempo por etapa** e as **pendências**.
4. Em **Provisionamento ▸ (solicitação)**: **Enviar convite ao administrador**. (No Dev isso exige o secret `PUBLIC_SITE_URL`; sem ele a tela diz claramente que o envio não está configurado e **nada é desfeito** — o convite pode ser reenviado depois.)
5. O administrador do cliente confirma o e-mail, define a senha e entra pelo endereço da organização. A confirmação **vincula** a pessoa à organização do convite (papel de gestor). Quem **já tem conta** recebe o vínculo como **convite pendente** e aceita ao entrar (sem duplicar conta e sem tocar na senha).

## 2. Estados e etapas

Estados da solicitação: **Rascunho → Na fila → Preparando → Verificando → Disponível / Disponível com pendências**, ou **Falha recuperável** (e *Falhou* depois de 6 tentativas).

Etapas (cada uma **idempotente** e registrada em `provisioning_steps` com tentativas, tempo e erro):

| Etapa | O que faz |
|---|---|
| `template` | Aplica o **modelo versionado** do segmento (funis, motivos de perda, categorias financeiras, configurações) — só configuração aprovada. |
| `units` | Cria as unidades e as configurações iniciais. |
| `modules` | Habilita módulos (modelo + escolhas), com dependências. |
| `brand` | Grava marca (`org_settings`: nome, cores, fuso/idioma do modelo) e cria a **assinatura** da organização (plano escolhido, estado `trial`, implantação pendente/em andamento — sem cobrança). |
| `admin` | **Prepara** o administrador, sem enviar e-mail: e-mail **novo** → registro em `manager_bootstrap_emails` (o gestor nasce quando o Auth confirmar o e-mail); e-mail de quem **já tem conta confirmada** → linha em `invitations` (papel gestor, 30 dias) para aceite ao entrar. |
| `domain` | Cadastra o endereço de acesso: sem `base_domain` configurado (Dev) → `<subdomínio>.localhost`, ativado por verificação de desenvolvimento; com `base_domain` → `<subdomínio>.<base_domain>` **pendente** de verificação. Domínio próprio (se pedido) sempre fica **pendente**. |
| `verify` | 8 verificações: modelo aplicado, ≥ 1 unidade, marca, assinatura, endereço de acesso, funil de pacientes, dependências de módulos e administrador preparado. Qualquer falha → *Falha recuperável*. |

Garantias:
- **Idempotência**: a chave da solicitação é única; repetir "Criar aplicativo" devolve a mesma solicitação (`reused: true`) e **nunca** duplica organização, unidades, módulos, papéis, configurações ou convites.
- **Retomável**: etapas concluídas não se repetem; **Tentar de novo** (`provisioning_retry`) e um job `pg_cron` (`provisioning-retry`, a cada minuto, recuo e no máximo 6 tentativas) retomam de onde parou.
- **O handler nunca levanta exceção** (um erro desfaria o registro do próprio erro); a falha é gravada na etapa e a solicitação vai para *Falha recuperável*.
- **Falha externa não desfaz o que foi criado**: o e-mail do convite fica **fora** da transação SQL, na Edge Function `provisioning-invite`.
- **Nada da HP é copiado**: nenhum dado, paciente, credencial, token ou registro. Só o modelo (configuração aprovada).

## 3. Validação no servidor (`private.provisioning_validate`)

Lista **fechada** de chaves; tipos e tamanhos; texto sem `<`/`>`/controle (nada de SQL, código ou HTML executável como configuração); segmento *disponível* (planejado é recusado); funções válidas para o segmento; módulos compatíveis com o segmento e **dependências** satisfeitas (planejado é recusado; experimental gera aviso); subdomínio 3–31 caracteres, sem duplo hífen, **não reservado** (`www, app, api, admin, plataforma, login, auth, mail, status, docs, hp, hp-group, suporte, support`) e **único**; cores `#RRGGBB`; domínio próprio no formato válido; plano existente (rascunho gera aviso); respostas ≤ 60 KB.

## 4. Convite do administrador (Edge Function `provisioning-invite`)

Só administradores da plataforma (JWT + `platform_whoami`). `provisioning_invite_prepare` devolve o necessário; então:
- **E-mail novo** → Auth `inviteUserByEmail` → Send Email Hook → **Resend**, com a marca da organização; a pessoa define a própria senha por link temporário.
- **Já tem conta** → aviso simples pelo Resend; o vínculo é aceito ao entrar.
- O resultado (`sent`/`notified`/`failed`) fica em `admin_invite`; o e-mail completo nunca volta ao navegador.
- Sem `PUBLIC_SITE_URL` → `503 site_url_not_configured`, convite marcado `failed`, nada desfeito.

## 5. Medições reais (Dev, 19/11/2026)

Separando **tempo interno** (nosso código) de **esperas externas**:

| Medida | Resultado |
|---|---|
| Clínica Gama pelo questionário, clique em "Criar aplicativo" → "Disponível" na tela | **≈ 0,5 s** (ida e volta completa, 1 requisição) |
| Soma das etapas internas (Gama) | **76 ms** |
| Fila sintética: 12 pedidos, **4 simultâneos** | total **819 ms**; por pedido mín. 78 / mediana 119 / máx. 276 ms; internas mín. 11 / mediana 29 / máx. 108 ms |
| Reenvio dos 12 pedidos | todos `reused`; **0** duplicações (12 organizações, 12 unidades, 12 solicitações) |
| **Esperas externas** | **não medidas**: entrega do e-mail, o administrador abrir o convite/definir senha, DNS/domínio próprio, importação de dados, treinamento |

Leitura honesta: o ambiente fica **tecnicamente** pronto em menos de 1 segundo. O prazo real de um cliente é dominado pelas etapas **humanas/externas** — o alvo de "menos de 24 h" só vale para segmentos/módulos já construídos e testados (hoje: Fisioterapia) e **não** inclui importação de dados nem domínio próprio.
Os números vêm de `test-results/wl-medicoes.json` (N38) e `test-results/wl-gama-tempos.json` (N39). Três cadastros criados **não** provam prontidão para cem clientes: ver [limitações](white-label-arquitetura.md#9-limitações-conhecidas-honestas) e a seção "Capacidade" abaixo.

## 6. Capacidade (o que **não** foi provado)

- A fila sintética tem 12 pedidos. Não houve teste de carga com dezenas/centenas, nem medição de lock/contagem de `org_fk_guard` em organizações grandes, nem do cron de retentativa sob falhas em massa.
- O provisionamento hoje é síncrono dentro do `submit`; 100 pedidos simultâneos competiriam por conexões do banco (plano Free do Supabase). Antes de escalar: medir, mover o processamento para o cron (assíncrono) e limitar a concorrência.
- Cada organização cria dezenas de linhas de configuração — sem crescimento problemático observado, mas não medido em escala.

## 7. Retomar uma falha (receita)

1. **Provisionamento ▸ (solicitação)** mostra a etapa que falhou e o erro (≤ 400 caracteres).
2. Corrija a causa (ex.: subdomínio em uso → nova solicitação; serviço externo indisponível → aguarde).
3. **Tentar de novo**. As etapas concluídas ficam como estão; a falhada é repetida.
4. Se a solicitação ficou *Falhou* (6 tentativas), investigue `provisioning_steps.error`; `provisioning_retry` reabre.

## 8. Limpeza de organizações de teste (Dev)

`node supabase/tools/wl-limpar-orgs-teste.mjs <prefixo-> …` remove organizações **de teste** criadas por provisionamento cujo `slug` comece por um prefixo informado (nunca `hp-group`, nunca produção) e os usuários `@example.test` órfãos. As specs usam `fila-` e `gama-`.
