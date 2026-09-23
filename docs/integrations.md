# Integrações

Regra: nada é apresentado como "conectado" sem configuração e validação reais. **Hoje nenhuma integração externa está conectada e validada.**

| Integração | Estado | Observação |
|---|---|---|
| GitHub | ✅ | Repositório com escrita; branch + PR em rascunho |
| Netlify | ✅ (infra) | Dois sites: `hp-group-hub` (Dev/preview, protegido) e `hp-group-hub-producao` (produção, público, criado em 2026-09-23) — ver `docs/deployment.md` |
| Supabase | ✅ (Dev + produção) | `HP Group Core` com as 37 migrations aplicadas em 2026-09-23 — ver `docs/go-live-plan.md` |
| **E-mail — autenticação (Supabase Edge Function → Resend)** | 🟡 Dev com as 3 credenciais confirmadas; produção aguardando as mesmas 3 + `PUBLIC_SITE_URL` (novo secret, ver abaixo) | Hook redeployado em 2026-09-23 apontando para `/confirmar` (identidade HP), não mais `supabase.co` |
| **E-mail — transacional da aplicação (Resend, backend)** | 🔒 código pronto, aguardando `RESEND_API_KEY` na Netlify (Dev e produção) | `netlify/functions/send-email.mts`. Único call-site real hoje: convite de equipe (`Team.tsx`) |
| Pagamentos (checkout/webhook) | ⬜ | Provedor a definir. Acesso pago só por evento confirmado no servidor (já é assim: `payment_record` → evento → acesso) |
| WhatsApp / e-mail no CRM | ⬜ | Registro manual de contatos por enquanto |
| Vídeo privado externo | ⬜ | Hoje: Supabase Storage privado + URL assinada (1h) com política por acesso |
| Google Analytics | ✅ preexistente | `G-CCSTPKF8GP` já estava na home |
| **Login social (Google OAuth)** | ⬜ não configurado | Confirmado via `GET /auth/v1/settings` (Dev): `"google": false`. Botão omitido da tela de login. Ação: Supabase Auth → *Providers* → *Google* |

## E-mail — arquitetura (Resend como único provedor, sem SMTP)

**Decisão de 2026-09-23**: a proposta anterior de SMTP customizado no Supabase Auth foi **descartada**. Todo envio — autenticação e transacional — sai pela **API do Resend**, com o Supabase Auth continuando dono de usuários/senhas/sessões/tokens (nada disso muda). Duas peças, sem sobreposição, em **duas hospedagens diferentes de propósito** (ver "Achado" abaixo):

1. **E-mails de autenticação** (confirmação de conta, convite de autenticação do Supabase, recuperação de senha, troca de e-mail): entregues pelo **Supabase Auth Send Email Hook**, hospedado como **Edge Function do próprio Supabase** — `supabase/functions/auth-email-hook/` (deployada em Dev E produção, status `ACTIVE`, `verify_jwt: false` — de propósito: quem chama é o Supabase Auth servidor-a-servidor, autenticado pela assinatura do webhook, não por um JWT de usuário). A função verifica a assinatura (HMAC-SHA256 conforme o padrão Standard Webhooks, implementado com a Web Crypto API nativa do Deno — sem dependência externa) e monta o link de confirmação para **`{PUBLIC_SITE_URL}/confirmar?token_hash=...&type=...`** — uma página HP própria (`src/pages/auth/Confirmar.tsx`), não mais um link `supabase.co` ou `localhost` (achado de 2026-09-23, corrigido — ver "Links de e-mail com identidade HP" abaixo). Cobre `signup` (primeiro acesso), `recovery` (esqueci minha senha), `invite`, `email_change`, `magiclink` e `reauthentication` — os dois últimos não são usados pela aplicação hoje (login é só por senha), mas o hook os trata para não quebrar se o Supabase algum dia os disparar.
2. **E-mails transacionais da aplicação** (hoje: convite de equipe): `POST /api/send-email` (Netlify, `netlify/functions/send-email.mts`) — só equipe autenticada, checado no banco por `can_send_transactional()`, sem HTML livre. Templates compartilham a mesma identidade visual do hook de autenticação (mesmo conteúdo em `netlify/functions/lib/email-templates.mts` e `supabase/functions/auth-email-hook/email-templates.ts` — duplicado porque cada plataforma empacota a função a partir do seu próprio diretório, sem forma de importar entre Netlify/Node e Supabase/Deno no deploy; ao mudar a marca/copy, atualizar os dois arquivos).

**Nenhuma mudança foi necessária em `Login.tsx`, `FirstAccess.tsx` ou `ResetPassword.tsx`** — o hook substitui o remetente no lado do Supabase, de forma transparente; o front-end continua chamando `signUp`/`resetPasswordForEmail`/`updateUser` exatamente como antes.

**Sem SMTP em nenhum lugar. Sem fallback silencioso para outro provedor**: se o Resend falhar, a função retorna erro (o hook retorna um erro no formato que o Supabase reconhece e propaga como falha real ao usuário — nunca um "200" falso; a função `send-email` retorna 502).

### ⚠️ Achado: por que o hook não podia ficar na Netlify
Tentei inicialmente hospedar o hook como Netlify Function (mesmo padrão do `send-email`). Ao testar com `curl` direto (sem sessão de navegador — exatamente como o Supabase chamaria), descobri que **a proteção de login de equipe da Netlify intercepta TODAS as rotas do site `hp-group-hub`, inclusive Functions**, antes mesmo do código rodar — confirmado: qualquer `POST` para `hp-group-hub.netlify.app/api/*` sem uma sessão de navegador já autenticada retorna a página de login da Netlify, nunca chega à função. O `send-email` "funciona" apesar disso só porque é chamado de dentro do navegador de alguém já logado na equipe (o cookie de sessão da Netlify acompanha a chamada, já que é a mesma origem). O hook de autenticação é chamado pelos **servidores do Supabase**, sem navegador e sem esse cookie — nunca passaria. Por decisão sua, a solução foi mover só o hook para uma Edge Function do Supabase (infraestrutura própria do Supabase, fora do alcance da proteção da Netlify) — a proteção da Netlify **não foi tocada** e continua ativa normalmente para o resto do site.

### ⚠️ Links de e-mail com identidade HP (corrigido em 2026-09-23)
O e-mail recebido nesta sessão mostrou o link de confirmação apontando para `supabase.co/auth/v1/verify`
(e, em Dev, `localhost:3000`) — nem o domínio nem a marca eram da HP. Corrigido de verdade, não só o texto:
o hook agora constrói o link para `{PUBLIC_SITE_URL}/confirmar?token_hash=...&type=...`, uma página própria
(`src/pages/auth/Confirmar.tsx`) que valida o token com o **`verifyOtp()` oficial do `supabase-js`**,
client-side — o Supabase continua dono da validade/expiração/uso único do token, isto só troca quem mostra
a página que recebe o link. A página exige um clique explícito antes de consumir o token (evita que
pré-visualizadores automáticos de e-mail queimem um link de uso único), limpa o `token_hash` da URL logo
após processar e nunca o expõe em log — e o pageview automático do Google Analytics foi desligado
(`send_page_view: false`) e substituído por um manual sem querystring, para o token nunca vazar para o
Analytics. Isso exige um secret novo: `PUBLIC_SITE_URL` (ver abaixo).

### O que falta para ativar (ação sua — Dev já tem quase tudo; produção precisa de tudo)
1. **Criar conta no Resend** (se ainda não existir) e **adicionar o domínio `hpfisioterapia.com.br`** no painel do Resend. Isso gera os registros DNS exatos (SPF/DKIM) — **me envie esses registros antes de alterar o DNS**; eu confirmo se colidem com o que já existe (ver "DNS — o que já existe" abaixo) antes de qualquer alteração. Não tenho acesso ao painel do Resend nem ao provedor de DNS — não consigo gerar nem aplicar esses registros sozinho.
2. **Criar uma API key de envio** no Resend, restrita a esse domínio.
3. **Configurar o Send Email Hook no Supabase** — em **cada** projeto (Dashboard → *Authentication* → *Hooks* → *Send Email hook* → tipo **Supabase Edge Functions** → selecionar a função `auth-email-hook`, já deployada nos dois). Ao salvar, o Supabase gera um segredo no formato `v1,whsec_...` **diferente por projeto** — nunca reaproveitar entre Dev e produção.

Depois, **secrets do projeto Supabase** (Project Settings → *Edge Functions* → *Secrets*, ou `supabase secrets set` — não são variáveis da Netlify, é um cadastro separado, e é por projeto — Dev e produção precisam do seu próprio conjunto):
- `RESEND_API_KEY` — a API key criada no passo 2 (pode ser a mesma nos dois projetos).
- `SEND_EMAIL_HOOK_SECRET` — o segredo gerado no passo 3 (diferente por projeto).
- `EMAIL_FROM` — `HP Group <contato@hpfisioterapia.com.br>` (mesmo valor nos dois).
- `PUBLIC_SITE_URL` — **novo**: em Dev, a URL do site Netlify de preview (`https://hp-group-hub.netlify.app`); em produção, `https://hpfisioterapia.com.br` (só funciona depois do DNS apontar para lá — ver `docs/go-live-plan.md`).

E, separadamente, no **Netlify** (site `hp-group-hub` para Dev, `hp-group-hub-producao` para produção — variáveis com escopo **Functions**, para o `/api/send-email` continuar funcionando):
- `RESEND_API_KEY` — pode ser a mesma key do passo 2.
- `EMAIL_FROM` — **já configurei nos dois sites**: `HP Group <contato@hpfisioterapia.com.br>` (não é segredo, é o remetente visível).

Nenhuma dessas chaves foi exibida ou solicitada aqui no chat — cadastre-as diretamente nos painéis do Supabase e da Netlify.

### DNS — o que já existe (não alterar sem revisar antes)
Consultei o DNS atual de `hpfisioterapia.com.br` antes de escrever isto (nenhuma alteração foi feita):
- **SPF (TXT)**: `v=spf1 include:_spf.mail.hostinger.com ~all` — a caixa `contato@hpfisioterapia.com.br` já recebe e-mail de verdade via Hostinger.
- **MX**: `mx1.hostinger.com` (prioridade 5), `mx2.hostinger.com` (prioridade 10).
- **DKIM do Resend**: ainda não existe (`resend._domainkey` não resolve) — domínio não verificado no Resend.

**Importante**: só pode existir **um** registro SPF por domínio. O registro que o Resend vai pedir **não pode ser um segundo `v=spf1`** — precisa ser **mesclado** no registro existente, assim: `v=spf1 include:_spf.mail.hostinger.com include:<o que o Resend indicar> ~all`. Um segundo TXT `v=spf1` separado quebra a validação de SPF (RFC exige exatamente um). Os registros DKIM do Resend (CNAME, geralmente 3) são aditivos e não colidem com o Hostinger. Vou revisar os valores exatos que o Resend gerar antes de qualquer alteração — nada será mudado sem sua aprovação explícita linha a linha.

### Redirect URLs (Supabase Auth → URL Configuration)
Confirmar que estão na lista de *Redirect URLs* do projeto Dev: a origem do Netlify (`https://hp-group-hub.netlify.app`) e `http://127.0.0.1:5190` (porta atual do `npm run dev`). Não tenho uma ferramenta que leia essa configuração — confira e ajuste diretamente no painel se faltar alguma.

### O link tem dois saltos — a proteção da Netlify continua exigindo login no segundo
O e-mail enviado pelo hook leva ao endpoint `/auth/v1/verify` do **Supabase** (não protegido pela Netlify — é outro domínio). O Supabase valida o token ali e só **depois** redireciona para `redirect_to` (`.../redefinir-senha` ou `.../app`, no site da Netlify). Esse segundo salto **continua atrás da proteção de equipe** — por decisão sua, isso não muda: quem for abrir o link precisa estar numa sessão de navegador já autenticada na equipe Netlify. Isso não afeta a validade do token em si (o Supabase já validou antes de redirecionar); é só a página final que pede login de equipe, como qualquer outra página do site.

### O que será validado (depois que as 3 credenciais estiverem configuradas)
Primeiro acesso → e-mail recebido → confirmação → sessão no destino certo por perfil; recuperação → e-mail recebido → `/redefinir-senha` → nova senha → login; links inválidos/expirados/reutilizados; falha do Resend tratada sem falso sucesso. Três níveis, sem confundir um com o outro:
1. **Envio aceito**: nossa função respondeu 200 (só prova que o Resend aceitou processar — não prova entrega).
2. **Entrega registrada**: confirmada no painel do Resend (Logs → status `delivered`, não apenas `sent`).
3. **Confirmação de recebimento**: você abre o e-mail de verdade e clica no link.
Só o nível 3, com você concluindo a jornada no navegador (onde já tem login de equipe), fecha a validação de ponta a ponta.

### 🔎 Investigação: "Esqueci minha senha" sem e-mail nem confirmação (2026-09-23)

Você configurou o Send Email Hook e os secrets, testou "Esqueci minha senha" no site publicado e não recebeu e-mail nem viu confirmação na tela. Investigado com evidência de log antes de mudar qualquer coisa:

1. **A requisição foi disparada e chegou ao Supabase.** Confirmado nos logs de Auth (`auth_logs`): dois eventos `user_recovery_requested` para `jan.darioush@yahoo.com.br`, às `2026-09-23T01:39:22Z` e `01:40:09Z`.
2. **O hook está habilitado e o Supabase o chamou de verdade** (prova de que a configuração do hook em si está correta): `"hook":"https://fsvtzowcwhvwtluwrhnb.supabase.co/functions/v1/auth-email-hook"`, `"msg":"Hook errored out"`.
3. **Causa raiz encontrada**: o hook respondeu **HTTP 500** — `"error":"500: Unexpected status code returned from hook: 500"` — e o Supabase corretamente propagou isso como falha real da chamada `/recover` (`"path":"/recover","status":500`). Chamando a função diretamente (`curl`) para reproduzir, a resposta exata foi:
   ```
   {"error":{"http_code":500,"message":"email_not_configured: RESEND_API_KEY/EMAIL_FROM ausentes"}}
   ```
   Ou seja: `SEND_EMAIL_HOOK_SECRET` **está** configurado corretamente (passou dessa checagem), mas `RESEND_API_KEY` e/ou `EMAIL_FROM` **não estão** salvos como *secrets do projeto Supabase* — só documentei que precisavam estar lá, mas você provavelmente configurou `RESEND_API_KEY` só na Netlify (onde também é necessária, para o `/api/send-email`) sem duplicar no Supabase, que é um cadastro totalmente separado. A função nunca chegou a chamar o Resend — a checagem de configuração barra antes disso, exatamente como projetado (sem tentativa de envio, sem falso sucesso).
4. **Deploy publicado confere**: o hook chamado pelo Supabase é o mesmo `auth-email-hook` que deployei nesta sessão, no projeto Dev correto (`fsvtzowcwhvwtluwrhnb`) — confirmado pela própria URL do hook nos logs.
5. **Endpoint sem JWT, com assinatura obrigatória — confirmado por teste, não só por leitura de código**: `curl` sem nenhum header de assinatura → `401 missing_signature_headers`; `curl` com headers de webhook bem-formados mas assinatura forjada → `401 invalid_signature` (a verificação HMAC realmente roda e rejeita). Nenhum JWT de usuário é exigido (`verify_jwt: false` no deploy), exatamente como pedido.
6. **Resend**: como a função nunca chegou a chamar a API do Resend (barrada antes, no passo 3), não há resposta do Resend para conferir ainda — só será possível depois que `RESEND_API_KEY`/`EMAIL_FROM` estiverem salvos como secrets do projeto Supabase.

**Correções aplicadas nesta investigação:**
- **Endurecimento de segurança no hook**: a ordem de verificação foi invertida — antes, um `curl` sem assinatura nenhuma já revelava *qual* secret estava faltando (`email_not_configured: ...`); agora a assinatura é validada **primeiro**, e um chamador sem assinatura válida só recebe `401 invalid_signature`, sem nenhuma pista sobre a configuração interna. Redeployado e reconfirmado com os testes do item 5 acima.
- **Bug real na interface, corrigido**: `Login.tsx` tratava *qualquer* erro que não fosse 429 como sucesso — inclusive um 500 de verdade como este. Ou seja, mesmo com o hook devolvendo erro, a tela deveria (a depender de como o `supabase-js` expôs esse erro específico) mostrar a mensagem genérica de sucesso, escondendo a falha real. Corrigido: agora `error === null` → sucesso; `status === 429` → mensagem de limite de tentativas; qualquer outro erro → mensagem de falha técnica, sem revelar se a conta existe. Ver "Feedback da interface" abaixo.

**Ação sua para destravar**: cadastrar `RESEND_API_KEY` e `EMAIL_FROM` (`HP Group <contato@hpfisioterapia.com.br>`) como *secrets do projeto Supabase* (Project Settings → Edge Functions → Secrets, ou `supabase secrets set RESEND_API_KEY=... EMAIL_FROM="HP Group <contato@hpfisioterapia.com.br>"` — **não** são as variáveis da Netlify, são um cadastro separado no Supabase). Depois disso, um novo teste deve chegar até a chamada real ao Resend.

### Feedback da interface (corrigido em 2026-09-23)
`Login.tsx`, modo "Esqueci minha senha": loading já existia (spinner + botão desabilitado durante o envio); mensagens agora seguem exatamente:
- Sucesso (sem erro do backend): "Se houver uma conta com este e-mail, você receberá as instruções para redefinir sua senha."
- Limite de tentativas (429): "Muitas tentativas. Aguarde alguns minutos e tente novamente."
- Qualquer outra falha do backend (ex.: o 500 encontrado nesta investigação): "Não foi possível processar sua solicitação agora. Tente novamente em instantes." — nunca mais mostrada como se fosse sucesso.
- Falha de rede/conexão (exceção antes de chegar ao backend): "Não foi possível conectar agora. Verifique sua internet e tente novamente."

### 🔎 Investigação: HTTP 429 na recuperação de senha (2026-09-23, ~02:08 UTC)

**Qual limite é**: `error_code: "over_email_send_rate_limit"` (`error: "429: email rate limit exceeded"`) — este é o limite `GOTRUE_RATE_LIMIT_EMAIL_SENT` do Supabase Auth: um **balde único, por projeto, compartilhado por TODOS os tipos de e-mail de autenticação** (confirmação de conta, recuperação de senha, convite, etc. juntos). Confirmado com evidência, não suposição: o mesmo `error_code` apareceu tanto em `/recover` (para `jan.darioush@yahoo.com.br`, 01:45:41Z/01:55:19Z/01:58:46Z) quanto em `/signup` (para `novo.convite@hp-test.dev`, 21:07:12Z do dia anterior) — dois usuários, dois endpoints diferentes, mesmo balde.

**Não é** limite por IP nem intervalo mínimo entre solicitações do mesmo usuário — não há evidência de nenhum outro `error_code` (`over_request_rate_limit`, etc.) em nenhuma das tentativas; o único mecanismo disparado, em todas as ocorrências, foi este balde de e-mail.

**Valor atual**: os logs mostram um recarregamento de configuração às `2026-09-23T01:37:50Z`:
```
"msg":"env GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating Email limiter from 2/1h to 2"
"rate_limit_old":"2/1h", "rate_limit_new":"2"
```
Valor anterior: `2/1h` (padrão do Supabase — 2 e-mails de autenticação por hora, para o projeto inteiro). Valor atual: `2` (mesma ordem de grandeza — 2 por janela). **Eu não fiz essa alteração** — o log é de antes desta investigação, provavelmente um recarregamento automático de configuração disparado quando o Send Email Hook foi habilitado. Essa cota de 2/hora foi consumida quase imediatamente pelos testes reais desta sessão (as duas tentativas de recuperação de `jan.darioush@yahoo.com.br` às 01:39/01:40Z, que chegaram a acionar o hook antes de falhar).

**Não consegui ajustar isso sozinho**: rate limits do Supabase Auth (Authentication → Rate Limits no painel, ou a API de Management) não são expostos por nenhuma das minhas ferramentas — diferente de secrets/migrations/Edge Functions, que eu consigo manipular diretamente. **Ação sua, se quiser aumentar para facilitar os testes**: Painel do projeto Dev (`fsvtzowcwhvwtluwrhnb`) → Authentication → Rate Limits → "Rate limit for sending emails" → aumentar de `2` para um valor finito maior (sugiro `30`/hora — dá folga para testes ativos sem deixar ilimitado). Registre você mesmo o valor anterior (`2`) e o novo ao trocar.

**Quando tentar de novo, sem ajustar nada**: hora atual do servidor no momento desta investigação: `2026-09-23T02:08:20Z`. As duas tentativas que provavelmente consumiram a cota foram às `01:39:22Z` e `01:40:09Z`. Se a janela for deslizante de 1 hora (comportamento padrão mais comum), o primeiro slot libera por volta de `02:39–02:40 UTC` — isto é uma estimativa baseada nos horários observados nos logs, não uma leitura direta do contador interno do GoTrue (não tenho essa introspecção). Não repeti a tentativa para não consumir mais cota nem gerar mais 429 desnecessários.

**Confirmação das 3 credenciais, feita sem gastar a tentativa autorizada**: implantei uma Edge Function de diagnóstico temporária (`diag-email-config`, exige um JWT de usuário válido — mesma barreira do resto do app — e responde só com `true`/`false` por variável, nunca o valor) e chamei com um token de login real (login não consome a cota de e-mail, é um endpoint diferente):
```
{"SEND_EMAIL_HOOK_SECRET":true,"RESEND_API_KEY":true,"EMAIL_FROM":true}
```
As 3 estão presentes. **Não enviei a tentativa de teste autorizada ainda** — com o rate limit ainda bloqueando (confirmado pelas 3 ocorrências de 429 até `01:58:46Z`), enviar agora só geraria outro 429 e gastaria a tentativa autorizada à toa. Fica pendente até a janela liberar (ou até você aumentar o limite no painel).

*Observação de limpeza*: a função `diag-email-config` não tem mais utilidade depois desta checagem; não tenho uma ferramenta de exclusão de Edge Function nesta sessão — se quiser removê-la, é no painel (Edge Functions → `diag-email-config` → excluir). Ela não expõe nenhum valor de secret, só presença (`true`/`false`), e exige login válido para responder.

### Teste de API feito em 2026-09-22 (sessão anterior, antes desta decisão)
Chamei `POST /auth/v1/recover` diretamente na API do Supabase Auth (Dev): endereço de domínio inválido rejeitado corretamente (`email_address_invalid`); endereço autorizado (`jan.darioush@yahoo.com.br`) respondeu `200 OK` sem erro síncrono — isso usava o remetente padrão/SMTP não configurado do Supabase, **não** a arquitetura desta seção. Com o Send Email Hook ativo, esse remetente padrão deixa de ser usado (o Supabase chama o hook em vez de enviar ele mesmo).

## Convites e outras comunicações por e-mail
Criar convite (tela *Equipe e acessos*) grava em `invitations` **e agora também chama `/api/send-email`** com o template `invite` (identidade HP, mesmo botão de ação) — se o envio falhar (Resend ainda não configurado, por exemplo), a tela mostra explicitamente que o e-mail não foi enviado automaticamente e orienta o convite manual; a criação do convite em si nunca falha por causa do e-mail. O papel só é concedido no banco quando o e-mail **verificado** coincide com um convite aberto (ou com a lista de bootstrap dos gestores) — nada disso mudou.

**Eventos que ainda NÃO disparam e-mail (documentado, não implementado — não confundir com "concluído")**: avisos de agenda (confirmação/lembrete de atendimento — o template `appointment_confirmation` existe em código mas nenhuma tela o chama), mensagens financeiras, notificações do Academy, notificações de parceiros. Adicionar esses envios é trabalho futuro de integração (call-site em cada tela), não uma configuração pendente.
