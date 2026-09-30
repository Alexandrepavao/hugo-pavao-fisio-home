# Calendários: Meu dia (dia/semana/mês), assinatura Apple/iPhone e Google Calendar

> Migration `059`, Edge Functions `calendar-feed` e `google-calendar`, telas do “Meu dia” e teste `S08`. Cada opção tem um **alcance diferente** — não confundir.

## Quadro de alcance
| Opção | Direção | Status hoje |
|---|---|---|
| **Meu dia: visões Dia / Semana / Mês** | interna | Implementada (precisa da migration 059). Agenda própria por padrão; outra agenda só por permissão e por unidade; nenhuma confirmação em nome de outro profissional; tarefas pessoais privadas só na própria agenda. |
| **Assinatura de calendário (.ics) — Apple/iPhone e Google “por URL”** | **somente leitura** (HP → calendário do aparelho) | Implementada (precisa da 059 + publicar `calendar-feed`). **Não** é sincronização bidirecional: o que for alterado no calendário do aparelho não volta ao HP. Link secreto e **revogável**. |
| **Google Calendar (OAuth)** | HP → Google (calendário “HP Group Hub” criado pelo app) **e** Google → HP (somente como compromissos externos) | **Código preparado, NÃO testado contra o Google** e **bloqueado por credenciais** (abaixo). A assinatura .ics **não** substitui nem conclui esta integração. |

## Regras que valem para tudo
- **Compromisso externo nunca vira atendimento, cobrança, venda ou consumo de sessão**: os eventos do Google só entram em `external_calendar_events` (só leitura, só do próprio usuário) e aparecem no “Meu dia” como “Compromisso externo”.
- **Tarefas pessoais privadas nunca saem do HP** (nem para o .ics nem para o Google).
- **Conteúdo mínimo por padrão**: o evento externo diz “Atendimento HP” + unidade, sem nome de paciente nem serviço. O usuário pode escolher incluir o primeiro nome e o serviço, com aviso de que isso fica guardado no provedor do calendário.
- **Fusos horários**: o .ics usa UTC (o aparelho converte); o Google recebe `dateTime` em UTC com fuso do calendário `America/Sao_Paulo`; a tela mostra no fuso do navegador.
- **Duplicidade**: UID estável por atendimento no .ics (`appt-<id>@hp-group-hub`); no Google, id de evento **determinístico** por atendimento (impossível criar dois), com `PUT` quando já existe.
- **Criação, alteração, cancelamento**: remarcar muda a hora do MESMO evento; cancelar/remarcar/ausência do profissional saem como `STATUS:CANCELLED` (.ics) ou removem o evento (Google).
- **Desconexão**: o link .ics é revogado em um clique (o antigo para de funcionar na hora); desconectar o Google remove o calendário “HP Group Hub” criado pelo app, revoga o acesso e apaga os compromissos externos importados — os eventos do Google do usuário **não** são tocados.
- **Credenciais e tokens só no servidor**: o token do .ics é mostrado uma vez e guardado só como hash; o refresh token do Google é guardado **criptografado** (AES-GCM) e as tabelas não têm acesso do navegador.

## Assinatura (.ics) — como usar
1. Meu dia › *Conectar calendários* › escolha o conteúdo (mínimo recomendado) › **Gerar link de assinatura** (aparece **uma única vez**).
2. iPhone: Ajustes › Calendário › Contas › Adicionar conta › Outra › *Adicionar calendário assinado* › cole o link **webcal**. Mac: Calendário › Arquivo › Nova assinatura. Google Agenda (web): Outras agendas › Por URL › cole o link **https** (o Google atualiza assinaturas em várias horas; não é tempo real).
3. Vazou? **Revogar link**. Gerar outro revoga o anterior.
- Publicação da função (sem JWT, porque clientes de calendário não o enviam): `supabase functions deploy calendar-feed --no-verify-jwt --project-ref fsvtzowcwhvwtluwrhnb`. Não há secret extra.

## Google Calendar — o que preciso que você cadastre e onde
**No Google Cloud Console** (conta Google do HP Group):
1. Criar um projeto (ex.: “HP Group Hub”) e ativar a **Google Calendar API**.
2. **OAuth consent screen**: tipo *External* (ou *Internal*, se o HP usa Google Workspace), nome do app, e-mail de suporte, domínios autorizados. **Escopos** a adicionar: `.../auth/calendar.app.created` (escreve só no calendário que o app cria), `.../auth/calendar.events.readonly` (lê os eventos — escopo **sensível**), `openid`, `email`.
   - Enquanto o app estiver em modo **Testing**, só usuários de teste cadastrados conseguem conectar (até 100) e o **refresh token expira em 7 dias** (precisa reconectar). Para uso contínuo, publicar o app e passar pela verificação do Google do escopo sensível.
3. **Credentials › Create credentials › OAuth client ID › Web application**. **Authorized redirect URI**: `https://fsvtzowcwhvwtluwrhnb.supabase.co/functions/v1/google-calendar/callback` (Dev; a produção terá o endereço do projeto de produção). Copiar **Client ID** e **Client Secret**.

**No Supabase** (Project Settings › Edge Functions › Secrets, ou `supabase secrets set`) — **nunca no chat, no repositório ou em `VITE_*`**:
| Secret | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | do passo 3 |
| `GOOGLE_TOKEN_ENC_KEY` | 32 bytes aleatórios em base64 (`openssl rand -base64 32`); criptografa o refresh token e assina o `state` do OAuth. Se trocar, todos precisam reconectar. |
| `PUBLIC_SITE_URL` | origem do app para voltar do Google (ex.: `https://hp-group-hub.netlify.app`, ou `http://127.0.0.1:5181` para testar localmente) |
| `CALENDAR_SYNC_SECRET` (opcional) | habilita sincronização agendada por chamada servidor-a-servidor (`POST .../google-calendar/sync` com o cabeçalho `x-cron-secret`) |

**Publicar**: `supabase functions deploy google-calendar --no-verify-jwt --project-ref fsvtzowcwhvwtluwrhnb` (o retorno do Google não traz JWT; as ações do usuário são autenticadas dentro da função).

**Como funciona (alcance informado na tela)**: *HP → Google* publica os atendimentos **da sua agenda** no calendário secundário “HP Group Hub” (o app só escreve nele, nunca no principal) e reflete remarcações e cancelamentos; editar esses eventos no Google **não** altera o atendimento (o HP é a fonte). *Google → HP* lê o **calendário principal** e mostra os eventos no Meu dia como compromissos externos (leitura incremental por `syncToken`; evento cancelado no Google some do HP). A sincronização é sob demanda (“Sincronizar agora”) e, se configurado o cron, periódica.

## Verificação
- SQL: `supabase/tests/release/S08_calendarios.sql` (visão por intervalo, permissões, privacidade, token só como hash, revogação, conteúdo mínimo, isolamento, anon).
- **Não testado**: o OAuth e a API do Google (sem credenciais), a entrega real do .ics a um iPhone/Google e a função `calendar-feed` publicada. Até publicar/configurar, a tela mostra “indisponível por configuração” nos pontos que dependem disso.

## Limitações conhecidas
- Eventos recorrentes do Google são lidos expandidos (`singleEvents`); o HP não cria recorrências.
- Sem notificações push do Google: a leitura é por sincronização.
- Atendimentos com mais de 180 dias à frente ou 30 dias atrás ficam fora da janela.
- A assinatura .ics de paciente mostra só as consultas dele (“Consulta HP”); o portal do paciente ainda não tem a tela para gerar esse link (só o “Meu dia” da equipe).
