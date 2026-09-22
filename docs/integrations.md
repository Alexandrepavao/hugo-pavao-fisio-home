# Integrações

Regra: nada é apresentado como "conectado" sem configuração e validação reais. **Hoje nenhuma integração externa está conectada e validada.**

| Integração | Estado | Observação |
|---|---|---|
| GitHub | ✅ | Repositório com escrita; branch + PR em rascunho |
| Netlify | ✅ (infra) | Site `hp-group-hub`, deploy republicado hoje a partir de `52cac0e`, variáveis do Dev corrigidas (ver `docs/deployment.md`) |
| Supabase | ✅ (Dev) | Produção vazia até o go-live |
| **E-mail — Supabase Auth (SMTP)** | 🟡 resultado incerto — ver observação | Confirmação de conta, convite de autenticação, recuperação de senha. Ver abaixo |
| **E-mail — transacional (Resend, backend)** | 🔒 preparado, não validado, **sem call-site na UI** | `netlify/functions/send-email.mts` responde 501 sem `RESEND_API_KEY`/`EMAIL_FROM`. Nenhuma tela da aplicação chama `/api/send-email` hoje (confirmado por busca no código) — mesmo configurando as chaves, nenhum fluxo dispararia um envio sem integrar a chamada em alguma tela |
| Pagamentos (checkout/webhook) | ⬜ | Provedor a definir. Acesso pago só por evento confirmado no servidor (já é assim: `payment_record` → evento → acesso) |
| WhatsApp / e-mail no CRM | ⬜ | Registro manual de contatos por enquanto |
| Vídeo privado externo | ⬜ | Hoje: Supabase Storage privado + URL assinada (1h) com política por acesso |
| Google Analytics | ✅ preexistente | `G-CCSTPKF8GP` já estava na home |
| **Login social (Google OAuth)** | ⬜ não configurado | Confirmado via `GET /auth/v1/settings` (Dev): `"google": false`. Botão **omitido** da tela de login (ver `docs/deployment.md`/sessão de 2026-09-23) — não publicar um botão sem integração real. Ação necessária: em Supabase Auth → *Providers* → *Google*, criar um OAuth Client ID/Secret no Google Cloud Console e habilitar o provider; depois disso, o botão pode ser reativado no código com `supabase.auth.signInWithOAuth({ provider: "google" })` |

## Resend — separação de responsabilidades
1. **SMTP do Supabase Auth** (não passa pela nossa aplicação): usar o SMTP do Resend em *Auth → SMTP Settings* com remetente do domínio próprio do HP Group.
2. **E-mails transacionais da aplicação**: função Netlify `POST /api/send-email` (somente equipe, checado no banco por `can_send_transactional()`), templates fixos e sem HTML livre.

Não reutilizar credenciais ou remetentes da Brighter. Não contratar plano pago sem autorização.

### O que falta (ação sua)
- Criar conta no Resend (plano gratuito) e **verificar um domínio do HP Group** (registros DNS SPF/DKIM no domínio escolhido — alteração de DNS exige sua aprovação e não foi feita).
- Criar uma API key **de envio** restrita a esse domínio.
- Supabase (projeto Dev → *Authentication → SMTP Settings*): host `smtp.resend.com`, porta `465`, usuário `resend`, senha = a API key, remetente `no-reply@<domínio verificado>`. *(Passo manual: o MCP não expõe a configuração de Auth.)*
- Supabase (*Authentication → URL Configuration*): incluir a URL do preview e `http://localhost:5180` em *Redirect URLs*.
- Netlify (variáveis, escopo Functions): `RESEND_API_KEY`, `EMAIL_FROM` (ex.: `HP Fisioterapia <no-reply@dominio>`).
- Mantido: login por e-mail habilitado; nenhuma proteção foi desativada.

### Como será validado (após configurado)
Pedido de recuperação → e-mail recebido → link → `/redefinir-senha` → nova senha → login; primeiro acesso dos gestores; `send-email` com convite. Só então o status muda para "validado".

### Teste de API feito em 2026-09-22 (sessão de prontidão para lançamento)
Chamei `POST /auth/v1/recover` diretamente na API do Supabase Auth (Dev), sem alterar nenhuma senha:
- Com um e-mail de domínio inválido (`@hp-test.dev`, conta de teste sintética): rejeitado corretamente com `email_address_invalid` — confirma que o GoTrue valida o formato/domínio do e-mail.
- Com o endereço autorizado `jan.darioush@yahoo.com.br` (um dos dois gestores do bootstrap): resposta `200 OK` em 80ms, sem erro síncrono.

Isso **não prova** que um e-mail real chegou — pode ser (a) SMTP customizado já funcionando, (b) o remetente padrão/limitado do próprio Supabase (`mail.app.supabase.io`, sem necessidade de configuração, mas com limite de poucos envios por hora e não recomendado para produção), ou (c) uma falha silenciosa que a API não expõe. **Pendente**: confirmar na caixa de entrada de `jan.darioush@yahoo.com.br` se o e-mail chegou e qual o remetente. Só isso resolve a dúvida sobre se o SMTP customizado já está configurado ou se é o modo de teste padrão do Supabase (que não deve ser usado em produção).

## Convites
Criar convite (tela *Equipe e acessos* ou *Pessoas → Convidar ao portal*) grava em `invitations`. A pessoa acessa **Primeiro acesso** com o mesmo e-mail, cria a senha e confirma o e-mail; o banco concede o papel **somente** quando o e-mail verificado coincide com um convite aberto (ou com a lista de bootstrap dos gestores). O envio automático do convite por e-mail depende do item acima; até lá o convite é comunicado manualmente.
