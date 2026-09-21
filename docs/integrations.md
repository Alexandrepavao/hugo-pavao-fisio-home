# Integrações

Regra: nada é apresentado como "conectado" sem configuração e validação reais.

| Integração | Estado | Observação |
|---|---|---|
| Supabase Auth (e-mail) | 🟡 disponível | O envio usa o SMTP padrão do Supabase (limitado a poucos e-mails/hora e só para membros da organização). Para produção é necessário configurar SMTP próprio (provedor a definir pelo responsável) |
| GitHub | ✅ | Repositório com permissão de escrita |
| Netlify | 🟡 | Time "Hp Group" existe; nenhum site criado ainda |
| Pagamentos (checkout/webhook) | ⬜ pendente de definição | Provedor a escolher. Acesso pago só será liberado por evento confirmado no servidor, nunca pelo retorno do checkout |
| WhatsApp / e-mail transacional (CRM) | ⬜ pendente | Será via adaptadores; enquanto não houver credenciais, registro manual de contatos |
| Vídeo privado (Academy) | ⬜ pendente de definição | URL pública "difícil de adivinhar" não é controle de acesso; usar Supabase Storage com URLs assinadas ou provedor com token/assinatura |
| Assinatura de contratos | ⬜ pendente | Fluxo manual autorizado no início |
| Google Analytics | ✅ já presente na home (`G-CCSTPKF8GP`) | Preexistente no repositório; não altera |

## Convites (arquitetura)
Front chama Netlify Function `invite-user` com o JWT do chamador → a função valida no banco que ele é gestor/ops_admin (mesma regra da RLS), grava `invitations` e chama `auth.admin.inviteUserByEmail`. Implementação pendente.
