# Calendários: Meu dia (Dia/Semana/Mês) e Google Calendar

> Migrations `059` (tabelas e funções), `061` (state de uso único) e `063` (sincronização automática); Edge Function `google-calendar`; telas do “Meu dia”; testes `S08`, `S11`, `R10`, `google-calendar-auth.mjs` e `google-sync-plan.test.mjs`.
> **Google Calendar é a única integração de calendário.** A assinatura `.ics` (Apple/iPhone e “Google por URL”) foi **aposentada**: saiu da interface, a função `calendar-feed` foi despublicada e o código dela removido. Nada foi apagado do banco (as tabelas/funções da 059 ficam como histórico e nada as serve).

## O que o usuário vê (Meu dia → Google Calendar)
- **Conectar Google Calendar**: leva ao Google, onde a pessoa **escolhe a própria conta e autoriza individualmente**; volta ao “Meu dia” já conectada. Cada usuário conecta a sua — não existe conta compartilhada.
- **Status**: “Conectado” (com o e-mail da conta e a última sincronização), “Conectado com erro na última sincronização” (com o motivo) ou “Acesso revogado — conecte novamente”.
- **Sincronizar agora**, **nível de detalhe** do evento e **Desconectar** (remove o calendário “HP Group Hub” criado pelo app, revoga o acesso no Google e apaga os compromissos externos importados; os eventos do Google da pessoa **não** são tocados).

## O que é sincronizado
| Direção | O quê | Como |
|---|---|---|
| **HP → Google** | atendimentos **da agenda do próprio profissional**: **criação, remarcação e cancelamento** | num calendário secundário **“HP Group Hub” criado pelo app** (o app só escreve nele, nunca no calendário principal). Evento com **id determinístico por atendimento** (impossível duplicar); remarcar atualiza o mesmo evento (ou remove o antigo e cria o novo, quando o atendimento é remarcado para outro horário); cancelamento, falta e ausência do profissional removem o evento |
| **Google → HP** | eventos do calendário principal, só leitura | aparecem no Meu dia como **“compromisso externo”**, só para quem os tem. **Nunca** viram atendimento, cobrança, venda ou consumo de sessão |

**Privacidade**: por padrão o evento diz só **“Atendimento HP” + unidade**. Nunca vai nota, motivo de cancelamento, avaliação, objetivo ou qualquer dado clínico; tarefas pessoais privadas nunca saem do HP. Só se a **própria pessoa** escolher “com primeiro nome e serviço” saem o primeiro nome do paciente e o nome do serviço (a tela avisa que ficam guardados no Google).

## Sincronização automática (migration 063)
- **Na hora**: toda criação, mudança de horário, mudança de status ou troca de profissional de um atendimento de quem **tem conexão** chama a sincronização **só daquele usuário** (e do profissional anterior, se mudou). Assíncrono, depois do commit; só o identificador do usuário viaja (nada de paciente, horário ou nota).
- **Rede de segurança a cada 5 minutos** (`pg_cron`): para todas as conexões ativas ou com erro — repete o que falhou e lê os compromissos externos do Google.
- **Logo ao conectar**, a função já faz a primeira sincronização.
- A chamada é servidor-a-servidor: `pg_net` → `google-calendar/sync` com o cabeçalho `x-cron-secret` (comparação em tempo constante). **A URL da função e o segredo ficam no Vault** (`calendar_sync_url`, `calendar_sync_secret`) e no segredo `CALENDAR_SYNC_SECRET` da função (mesmo valor). **Sem eles no Vault, tudo é no-op**; e **a agenda nunca falha por causa do calendário** (o gatilho engole qualquer erro).

## Segurança
- **Tokens**: o refresh token é guardado **criptografado** (AES-GCM, chave de 32 bytes em `GOOGLE_TOKEN_ENC_KEY`); as tabelas de conexão não são legíveis pelo navegador (só o status, sem token). Client ID/Secret só no servidor.
- **`google-calendar` é publicada sem `verify_jwt`** (o retorno do Google não traz JWT): `start`, `sync` e `disconnect` exigem a **sessão do usuário, validada dentro da função**; o `callback` é autenticado pelo **`state` assinado (HMAC) de uso único** (nonce guardado e consumido; repetir, forjar, vencer ou usar o de outro usuário volta com `google=estado`). `sync` com `x-cron-secret` errado → 401.
- Escopos pedidos (exatamente): `https://www.googleapis.com/auth/calendar.app.created` (escreve só no calendário que o app cria), `https://www.googleapis.com/auth/calendar.events.readonly` (lê eventos; **sensível**), `openid` e `email`. Nunca o escopo amplo de calendário.
- Client ID/Secret colados com espaço ou quebra de linha no meio são aceitos (a função remove espaços antes de usar); o segredo guardado não muda.

## Configuração (Dev `fsvtzowcwhvwtluwrhnb`)
| Onde | Nome | Situação |
|---|---|---|
| Google Cloud | projeto **HPGroupCalendario**, Calendar API, cliente OAuth Web, callback `https://fsvtzowcwhvwtluwrhnb.supabase.co/functions/v1/google-calendar/callback`, usuários de teste | feito por você |
| Secrets da função | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | cadastrados por você |
| Secrets da função | `GOOGLE_TOKEN_ENC_KEY` (32 bytes aleatórios em base64) | gerada e cadastrada diretamente no Dev; nunca exibida |
| Secrets da função | `GOOGLE_RETURN_URL` = `https://release-v1--hp-group-hub.netlify.app` | **só do calendário**; o `PUBLIC_SITE_URL` (usado pelos e-mails) não foi tocado |
| Secrets da função | `CALENDAR_SYNC_SECRET` | gerado e cadastrado diretamente no Dev |
| Vault | `calendar_sync_url`, `calendar_sync_secret` (mesmo valor do segredo acima) | gravados diretamente no Dev |
| Banco | job `google-calendar-sync` (`*/5 * * * *`) e gatilho `appointments_google_kick` | migration 063 |

**Tela de consentimento (Google Cloud › APIs e serviços › Tela de permissão OAuth › Acesso a dados › Adicionar ou remover escopos)** — confira que estão listados: `.../auth/calendar.app.created`, `.../auth/calendar.events.readonly`, `openid` e `.../auth/userinfo.email`. Enquanto o app estiver em modo **Teste**: só os **usuários de teste** cadastrados conseguem conectar (até 100) e o **refresh token expira em 7 dias** (a pessoa precisa reconectar; a tela mostra “Acesso revogado — conecte novamente”). Para uso contínuo é preciso publicar o app e passar pela verificação do Google do escopo sensível.

Produção (quando for a hora): repetir os segredos no projeto `HP Group Core`, cadastrar o callback dele no cliente OAuth, gravar os dois itens no Vault e usar o domínio final em `GOOGLE_RETURN_URL`.

## Como foi verificado
- **Planejamento da sincronização** (`google-sync-plan.test.mjs`, 22 verificações, sem rede): criação, “nada mudou → nenhuma chamada”, remarcação (mesmo evento), remarcação para outro horário (antigo sai, novo entra), cancelamento/falta/ausência, atendimento repetido → uma ação só, id determinístico, horário em UTC e formatos de período do Postgres, e **nenhum dado pessoal/clínico** no evento (modo mínimo e modo com nome).
- **Gatilho e cron** (`S11`, 19 verificações): criar/remarcar/cancelar disparam a sincronização do usuário conectado e só dele; sem conexão, conexão revogada ou Vault vazio não há chamada; mudar só uma anotação não dispara; trocar de profissional sincroniza os dois; o corpo só tem o `user_id`; erros não quebram a agenda; nada executável pelo navegador. A cadeia real Vault → pg_net → função (segredo) respondeu HTTP 200.
- **Função publicada** (`google-calendar-auth.mjs`): 401 sem sessão/com chave pública/JWT inválido; `state` adulterado ou repetido → `google=estado`; escopos exatos; o Google **aceita o cliente e o callback** (abre a escolha de conta); o retorno vai para a URL do app configurada.
- **Telas** (`R10`): Meu dia (Dia/Semana/Mês), só Google na interface (nada de iPhone/Apple/.ics), navegação ao Google interceptada e inspecionada (cliente, callback, escopos, state, sem segredo na URL), mensagens de retorno, função `.ics` fora do ar (404), status/erro/desconexão (com uma linha de teste removida ao final).

## Não testado (depende de você autorizar no Google)
A autorização real (escolher a conta e conceder as permissões) e o que vem depois: o evento aparecer de fato no Google, a remarcação e o cancelamento refletirem lá, e a leitura dos seus compromissos. A lógica de planejamento e todos os gatilhos foram testados; o último elo — a API do Google aceitando as chamadas com o token da sua conta — só se prova com a sua autorização.

## Limitações conhecidas
- Eventos recorrentes do Google são lidos expandidos (`singleEvents`); o HP não cria recorrências.
- Sem notificações push do Google: a leitura dos compromissos externos é por sincronização (a cada 5 minutos).
- Atendimentos com mais de 180 dias à frente ou 30 dias atrás ficam fora da janela.
- Em modo Teste do Google o acesso expira em 7 dias.
