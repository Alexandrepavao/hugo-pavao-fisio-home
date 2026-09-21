# Integrações

Regra: nada é apresentado como "conectado" sem configuração e validação reais. **Hoje nenhuma integração externa está conectada e validada.**

| Integração | Estado | Observação |
|---|---|---|
| GitHub | ✅ | Repositório com escrita; branch + PR em rascunho |
| Netlify | ✅ (infra) | Site `hp-group-hub`, preview publicado, variáveis do Dev |
| Supabase | ✅ (Dev) | Produção vazia até o go-live |
| **E-mail — Supabase Auth (SMTP)** | 🔒 pendente | Confirmação de conta, convite de autenticação, recuperação de senha. Ver abaixo |
| **E-mail — transacional (Resend, backend)** | 🔒 preparado, não validado | `netlify/functions/send-email.mts` |
| Pagamentos (checkout/webhook) | ⬜ | Provedor a definir. Acesso pago só por evento confirmado no servidor (já é assim: `payment_record` → evento → acesso) |
| WhatsApp / e-mail no CRM | ⬜ | Registro manual de contatos por enquanto |
| Vídeo privado externo | ⬜ | Hoje: Supabase Storage privado + URL assinada (1h) com política por acesso |
| Google Analytics | ✅ preexistente | `G-CCSTPKF8GP` já estava na home |

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

## Convites
Criar convite (tela *Equipe e acessos* ou *Pessoas → Convidar ao portal*) grava em `invitations`. A pessoa acessa **Primeiro acesso** com o mesmo e-mail, cria a senha e confirma o e-mail; o banco concede o papel **somente** quando o e-mail verificado coincide com um convite aberto (ou com a lista de bootstrap dos gestores). O envio automático do convite por e-mail depende do item acima; até lá o convite é comunicado manualmente.
