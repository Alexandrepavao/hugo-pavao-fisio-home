# Integrações

Regra: nada é apresentado como "conectado" sem configuração e validação reais. **Hoje nenhuma integração externa está conectada e validada.**

| Integração | Estado | Observação |
|---|---|---|
| GitHub | ✅ | Repositório com escrita; branch + PR em rascunho |
| Netlify | ✅ (infra) | Site `hp-group-hub`, deploy republicado a partir de `6cb26c1`, variáveis do Dev corrigidas (ver `docs/deployment.md`) |
| Supabase | ✅ (Dev) | Produção vazia até o go-live |
| **E-mail — autenticação (Supabase Edge Function → Resend)** | 🔒 código deployado no Dev (`auth-email-hook`, ACTIVE), aguardando as 3 credenciais/config abaixo | Hospedado como Edge Function do Supabase, não Netlify — ver "Achado" abaixo. Ver seção "E-mail — arquitetura" |
| **E-mail — transacional da aplicação (Resend, backend)** | 🔒 código pronto, aguardando `RESEND_API_KEY` | `netlify/functions/send-email.mts`. Único call-site real hoje: convite de equipe (`Team.tsx`) |
| Pagamentos (checkout/webhook) | ⬜ | Provedor a definir. Acesso pago só por evento confirmado no servidor (já é assim: `payment_record` → evento → acesso) |
| WhatsApp / e-mail no CRM | ⬜ | Registro manual de contatos por enquanto |
| Vídeo privado externo | ⬜ | Hoje: Supabase Storage privado + URL assinada (1h) com política por acesso |
| Google Analytics | ✅ preexistente | `G-CCSTPKF8GP` já estava na home |
| **Login social (Google OAuth)** | ⬜ não configurado | Confirmado via `GET /auth/v1/settings` (Dev): `"google": false`. Botão omitido da tela de login. Ação: Supabase Auth → *Providers* → *Google* |

## E-mail — arquitetura (Resend como único provedor, sem SMTP)

**Decisão de 2026-09-23**: a proposta anterior de SMTP customizado no Supabase Auth foi **descartada**. Todo envio — autenticação e transacional — sai pela **API do Resend**, com o Supabase Auth continuando dono de usuários/senhas/sessões/tokens (nada disso muda). Duas peças, sem sobreposição, em **duas hospedagens diferentes de propósito** (ver "Achado" abaixo):

1. **E-mails de autenticação** (confirmação de conta, convite de autenticação do Supabase, recuperação de senha, troca de e-mail): entregues pelo **Supabase Auth Send Email Hook**, hospedado como **Edge Function do próprio Supabase** — `supabase/functions/auth-email-hook/` (deployada no Dev, status `ACTIVE`, `verify_jwt: false` — de propósito: quem chama é o Supabase Auth servidor-a-servidor, autenticado pela assinatura do webhook, não por um JWT de usuário). A função verifica a assinatura (HMAC-SHA256 conforme o padrão Standard Webhooks, implementado com a Web Crypto API nativa do Deno — sem dependência externa), monta o link oficial de verificação do próprio Supabase (`{SUPABASE_URL}/auth/v1/verify?token=...&type=...&redirect_to=...` — o mesmo token/validade/expiração/uso único que o Supabase sempre gerou, **não é um mecanismo paralelo**) e envia via Resend com a identidade HP. Cobre `signup` (primeiro acesso), `recovery` (esqueci minha senha), `invite`, `email_change`, `magiclink` e `reauthentication` — os dois últimos não são usados pela aplicação hoje (login é só por senha), mas o hook os trata para não quebrar se o Supabase algum dia os disparar.
2. **E-mails transacionais da aplicação** (hoje: convite de equipe): `POST /api/send-email` (Netlify, `netlify/functions/send-email.mts`) — só equipe autenticada, checado no banco por `can_send_transactional()`, sem HTML livre. Templates compartilham a mesma identidade visual do hook de autenticação (mesmo conteúdo em `netlify/functions/lib/email-templates.mts` e `supabase/functions/auth-email-hook/email-templates.ts` — duplicado porque cada plataforma empacota a função a partir do seu próprio diretório, sem forma de importar entre Netlify/Node e Supabase/Deno no deploy; ao mudar a marca/copy, atualizar os dois arquivos).

**Nenhuma mudança foi necessária em `Login.tsx`, `FirstAccess.tsx` ou `ResetPassword.tsx`** — o hook substitui o remetente no lado do Supabase, de forma transparente; o front-end continua chamando `signUp`/`resetPasswordForEmail`/`updateUser` exatamente como antes.

**Sem SMTP em nenhum lugar. Sem fallback silencioso para outro provedor**: se o Resend falhar, a função retorna erro (o hook retorna um erro no formato que o Supabase reconhece e propaga como falha real ao usuário — nunca um "200" falso; a função `send-email` retorna 502).

### ⚠️ Achado: por que o hook não podia ficar na Netlify
Tentei inicialmente hospedar o hook como Netlify Function (mesmo padrão do `send-email`). Ao testar com `curl` direto (sem sessão de navegador — exatamente como o Supabase chamaria), descobri que **a proteção de login de equipe da Netlify intercepta TODAS as rotas do site `hp-group-hub`, inclusive Functions**, antes mesmo do código rodar — confirmado: qualquer `POST` para `hp-group-hub.netlify.app/api/*` sem uma sessão de navegador já autenticada retorna a página de login da Netlify, nunca chega à função. O `send-email` "funciona" apesar disso só porque é chamado de dentro do navegador de alguém já logado na equipe (o cookie de sessão da Netlify acompanha a chamada, já que é a mesma origem). O hook de autenticação é chamado pelos **servidores do Supabase**, sem navegador e sem esse cookie — nunca passaria. Por decisão sua, a solução foi mover só o hook para uma Edge Function do Supabase (infraestrutura própria do Supabase, fora do alcance da proteção da Netlify) — a proteção da Netlify **não foi tocada** e continua ativa normalmente para o resto do site.

### O que falta para ativar (ação sua — 3 itens)
1. **Criar conta no Resend** (se ainda não existir) e **adicionar o domínio `hpfisioterapia.com.br`** no painel do Resend. Isso gera os registros DNS exatos (SPF/DKIM) — **me envie esses registros antes de alterar o DNS**; eu confirmo se colidem com o que já existe (ver "DNS — o que já existe" abaixo) antes de qualquer alteração. Não tenho acesso ao painel do Resend nem ao provedor de DNS — não consigo gerar nem aplicar esses registros sozinho.
2. **Criar uma API key de envio** no Resend, restrita a esse domínio.
3. **Configurar o Send Email Hook no Supabase** (Dashboard do projeto Dev `fsvtzowcwhvwtluwrhnb` → *Authentication* → *Hooks* → *Send Email hook* → tipo **Supabase Edge Functions** → selecionar a função `auth-email-hook`, já deployada). Ao salvar, o Supabase gera um segredo no formato `v1,whsec_...` — copie-o.

Depois, **secrets do projeto Supabase** (Project Settings → *Edge Functions* → *Secrets*, ou `supabase secrets set` — não são variáveis da Netlify, é um cadastro separado):
- `RESEND_API_KEY` — a API key criada no passo 2.
- `SEND_EMAIL_HOOK_SECRET` — o segredo gerado no passo 3.
- `EMAIL_FROM` — `HP Group <contato@hpfisioterapia.com.br>` (mesmo valor de referência já usado na Netlify).

E, separadamente, no **Netlify** (site `hp-group-hub`, variáveis com escopo **Functions**, para o `/api/send-email` continuar funcionando):
- `RESEND_API_KEY` — pode ser a mesma key do passo 2.
- `EMAIL_FROM` — **já configurei**: `HP Group <contato@hpfisioterapia.com.br>` (não é segredo, é o remetente visível).

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

### Teste de API feito em 2026-09-22 (sessão anterior, antes desta decisão)
Chamei `POST /auth/v1/recover` diretamente na API do Supabase Auth (Dev): endereço de domínio inválido rejeitado corretamente (`email_address_invalid`); endereço autorizado (`jan.darioush@yahoo.com.br`) respondeu `200 OK` sem erro síncrono — isso usava o remetente padrão/SMTP não configurado do Supabase, **não** a arquitetura desta seção. Com o Send Email Hook ativo, esse remetente padrão deixa de ser usado (o Supabase chama o hook em vez de enviar ele mesmo).

## Convites e outras comunicações por e-mail
Criar convite (tela *Equipe e acessos*) grava em `invitations` **e agora também chama `/api/send-email`** com o template `invite` (identidade HP, mesmo botão de ação) — se o envio falhar (Resend ainda não configurado, por exemplo), a tela mostra explicitamente que o e-mail não foi enviado automaticamente e orienta o convite manual; a criação do convite em si nunca falha por causa do e-mail. O papel só é concedido no banco quando o e-mail **verificado** coincide com um convite aberto (ou com a lista de bootstrap dos gestores) — nada disso mudou.

**Eventos que ainda NÃO disparam e-mail (documentado, não implementado — não confundir com "concluído")**: avisos de agenda (confirmação/lembrete de atendimento — o template `appointment_confirmation` existe em código mas nenhuma tela o chama), mensagens financeiras, notificações do Academy, notificações de parceiros. Adicionar esses envios é trabalho futuro de integração (call-site em cada tela), não uma configuração pendente.
