# White label — acesso, convite e autenticação por organização

Arquitetura geral: [white-label-arquitetura.md](white-label-arquitetura.md) · Provisionamento: [white-label-provisionamento.md](white-label-provisionamento.md). Estado: **Dev apenas**.

Princípio: o Supabase Auth continua dono de identidade, senha e sessão; **todo e-mail sai pelo Resend** (Send Email Hook → função `auth-email-hook`, ou aviso direto da função `provisioning-invite`). Domínio, slug e cabeçalho `x-org` **escolhem** a organização que a tela mostra; **nunca autorizam** nada — o banco revalida vínculo, papel e módulo a cada chamada.

## 1. Endereço por organização (`/empresa/<slug>`)

| Rota | O que faz |
|---|---|
| `/empresa/<slug>` | Logado com vínculo → `/admin`; logado sem vínculo → tela "Sem acesso a esta organização" (com o convite pendente, se houver); sem login → login da organização. |
| `/empresa/<slug>/login` · `/primeiro-acesso` · `/redefinir-senha` · `/confirmar` | Fluxos de acesso com a **marca da organização desde o primeiro quadro** (enquanto o servidor resolve o slug não aparece nenhuma marca, nunca a da HP). |
| `/empresa/<slug>/avaliacao` · `/onboarding-paciente` · `/<página>` | Captação pública da organização — ver [white-label-captacao-publica.md](white-label-captacao-publica.md). |

- O slug é resolvido no servidor por `org_public_by_slug` (anon): devolve **só a marca pública** (sem `org_id`, sem telefone). Slug desconhecido, malformado, suspenso, arquivado ou em preparação respondem **igual** ("Endereço indisponível") — sem enumeração.
- O slug da organização é o **subdomínio escolhido no questionário** (ex.: `delta-fisio`). `empresa` é rota fixa e está nos slugs reservados (banco e `src/lib/reserved-slugs.ts`).
- Com vínculo ativo, a organização do endereço vira a **organização ativa da aba** (uma recarga); o cache de consultas é descartado ao trocar de organização. Sem vínculo, nada da organização é carregado.
- Sem redirecionamento externo: todo destino interno passa por `withOrgBase`, que só aceita caminhos próprios (`/…`, nunca `//…` nem URL).
- **Domínio próprio continua "pendente de verificação"**: não existe verificação de posse por DNS; só `*.localhost` (Dev) é ativado manualmente. Nenhum DNS foi alterado.

## 2. Convite do administrador (provisionamento)

`Plataforma ▸ Provisionamento ▸ (solicitação)`: **Enviar / Reenviar convite**, **Revogar convite**, **Conferir entrega no provedor**.

| Situação do e-mail | Caminho | Resultado |
|---|---|---|
| Novo (sem conta) | `inviteUserByEmail` → hook → Resend; link `…/empresa/<slug>/confirmar?token_hash=…&type=invite` → define a senha → login da organização | Ao confirmar o e-mail, **todos** os convites válidos do endereço são consumidos (um vínculo por organização), com papel **gestor**; a solicitação registra "aceito". |
| Já tem conta confirmada | Vínculo **pendente** (`invitations`) + aviso simples pelo Resend; a pessoa entra em `/empresa/<slug>/login`, vê "Convites para você" e **aceita** | Mesma identidade, **senha intocada**, vínculos anteriores mantidos, papel só na organização do convite. |
| Cadastro antigo **não confirmado** e sem vínculos | O reenvio recria o cadastro com segurança (`stale_user_id`) e envia link novo | Sem "email_exists" sem saída. Com vínculos, **não** recria. |

Validade e estados: convite de administrador novo vale **30 dias** no banco (renovável pelo reenvio); o **link do e-mail** vale o `mailer_otp_exp` do Auth (**1 h** no Dev — para ampliar é uma decisão de segurança compartilhada, não alterada aqui). **Revogado, vencido ou já usado** não concede papel: `invitation_accept` e o gatilho de confirmação recusam (testes N24).

### Evidência em 5 níveis (painel da plataforma)

| Nível | Significado | Fonte |
|---|---|---|
| 1 | Pedido registrado | `private.email_events` (`admin_invite`, `requested`) |
| 2 | **Resend aceitou** (aceitar ≠ entregar) | evento `accepted` com o id do provedor (gravado pelo hook/função) |
| 3 | **Entrega confirmada pelo provedor** | webhook `resend-webhook` (assinatura verificada) **ou** consulta pelo id com `RESEND_READ_API_KEY` |
| 4 | Link utilizado | e-mail confirmado (conta nova) / convite aceito (conta existente) |
| 5 | Senha cadastrada e acesso à organização correta | senha definida + vínculo ativo + papel gestor |

Nunca aparecem e-mail completo, link nem senha: o evento guarda e-mail **mascarado** + hash. **Nenhum nível é inferido de outro.**

### Política de destinatários (Dev)

Secret `EMAIL_ALLOWED_RECIPIENTS` (lista de endereços ou `*@dominio`): fora da lista o e-mail **não é enviado** e fica registrado como `suppressed` (`recipient_not_allowed`). No Dev vale **só** `jan.darioush@yahoo.com.br`. Contas `@example.test` dos testes nunca disparam e-mail. Produção não define esse secret.

### Marca e link do e-mail

O hook descobre a organização do destinatário por `email_brand_for_address(email, slug)`: o slug (vindo de `redirect_to`, **somente** se a origem for a de `PUBLIC_SITE_URL` e o caminho `/empresa/<slug>`) só vale se o endereço tem **ligação real** com a organização (convite aberto, convite de administrador ou vínculo ativo) — ninguém "veste" o e-mail de outra empresa. Sem slug, a HP tem prioridade para quem é membro dela.

## 3. Recuperação de senha por organização

`/empresa/<slug>/login ▸ Esqueci minha senha` envia `redirectTo = <origem>/empresa/<slug>/redefinir-senha`; o e-mail sai com a marca da organização e o link abre `/empresa/<slug>/confirmar`. Depois da nova senha o usuário volta ao login **da mesma organização**. A HP continua em `/login`.

## 4. Configuração do ambiente Dev (verificada em 19–20/11/2026)

| Item | Estado |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, hook ativo | já existiam |
| `PUBLIC_SITE_URL` | **criado** (`https://white-label--hp-group-hub.netlify.app`; não existia — consumidores: `auth-email-hook`, `patient-invite`, `provisioning-invite`) |
| `EMAIL_ALLOWED_RECIPIENTS` | **criado** (só o endereço QA autorizado) |
| `uri_allow_list` do Auth | **acrescentada** a origem do preview (entradas anteriores preservadas) |
| `RESEND_WEBHOOK_SECRET` / `RESEND_READ_API_KEY` | **não existem** — ver bloqueio abaixo |

## 5. Proteção da equipe Netlify (roteiro de teste)

O site de preview `hp-group-hub` exige **login da equipe Netlify em todas as rotas** (inclusive `/empresa/<slug>/…` e os links dos e-mails). Para abrir o link recebido: usar um navegador onde a equipe Netlify esteja conectada (ou abrir o preview uma vez e entrar). Quem recebe o e-mail **fora** da equipe verá a tela de login da Netlify, não a do app — isso é limitação do **preview**, não da aplicação; o Supabase chama o hook servidor-a-servidor (sem navegador), por isso o hook vive no Supabase e não na Netlify.

## 6. O que foi provado de verdade × pendente

- **Real (19–20/11):** Resend **aceitou** o aviso de convite e um e-mail de recuperação (via hook, com marca/organização) para o endereço QA — níveis 1 e 2. Política de destinatários contendo e-mails de teste — testada na Delta (nível 1 + "falhou" no 2).
- **Não provado — nível 3:** a chave de envio do Resend responde **401** à consulta de entrega. **Ação:** no painel do Resend, criar Webhook → URL `https://<projeto>.supabase.co/functions/v1/resend-webhook` com os eventos `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`; copiar o *Signing secret* para o secret `RESEND_WEBHOOK_SECRET` do Supabase **ou** criar uma chave de leitura em `RESEND_READ_API_KEY`.
- **Não provado — níveis 4 e 5 com e-mail real:** exigem que a pessoa abra o e-mail. **Ação (1 minuto):** abrir `…/empresa/epsilon-qa/login` com a conta existente → "Convites para você" → **Aceitar**; depois conferir o painel (solicitação "Clínica Épsilon QA"). O fluxo de **conta nova** (link `invite` + definir senha) não pôde ser exercitado com e-mail real porque só há **um** endereço QA autorizado e ele já tem conta; em testes automatizados a confirmação do e-mail é **simulada** (declarado em cada spec).
