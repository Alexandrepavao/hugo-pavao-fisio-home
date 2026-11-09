# Marketing — guia de conexão com Meta Ads e Google Ads

> **Sem segredos aqui e nenhum segredo no chat.** Os valores vão em **Supabase → Edge Functions → Secrets** do projeto (Dev: `fsvtzowcwhvwtluwrhnb`). Requisitos conferidos na documentação oficial vigente em **09/11/2026** (links ao final). O que eu não consegui confirmar está marcado **(confirmar)**.

## URLs exatas (extraídas do ambiente — Dev)

| Uso | URL |
|---|---|
| **Meta** — URI de redirecionamento OAuth válido | `https://fsvtzowcwhvwtluwrhnb.supabase.co/functions/v1/marketing-ads/callback/meta` |
| **Google** — URI de redirecionamento autorizado | `https://fsvtzowcwhvwtluwrhnb.supabase.co/functions/v1/marketing-ads/callback/google` |
| Retorno ao app depois do OAuth (`MKT_RETURN_URL`) | `https://preview--hp-group-hub.netlify.app` (preview; vai para `/admin/marketing/integracoes`) |

A tela **Marketing › Integrações** mostra as mesmas URLs (vindas da função `/status`, calculadas do `SUPABASE_URL`) com botão de copiar. Em produção a URL muda (`wfqkjrpqkaarpavjheoj`); o guia vale igual com os valores de produção, e só depois da promoção decidida.

## Segredos (nomes) e o que já está feito

| Segredo | Quem fornece | Estado no Dev |
|---|---|---|
| `MKT_TOKEN_ENC_KEY` (32 bytes base64) | gerado pelo projeto (`marketing-configurar-dev.mjs`) | ✅ definido (não rotacionar: invalida tokens guardados) |
| `MKT_SYNC_SECRET` + Vault `marketing_sync_url/secret` | gerado pelo projeto | ✅ |
| `MKT_RETURN_URL`, `MKT_ALLOWED_ORIGINS` | projeto | ✅ |
| `META_APP_ID`, `META_APP_SECRET` | **painel da Meta** | ❌ faltam |
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` | **Google Cloud** | ❌ faltam |
| `MKT_META_API_VERSION` (padrão `v26.0`), `MKT_GOOGLE_ADS_API_VERSION` (padrão `v26`) | opcional | padrão |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | **opcional** | não é exigido (ver abaixo) |

## Meta Ads (Marketing API)

**Versão**: a página de versões indica **v27.0** como atual (introduzida em 04/11/2026); **v26.0** (29/07/2026) e **v25.0** (até 23/02/2027) seguem ativas. O código usa **v26.0** por padrão e a versão fica registrada em cada sincronização.

1. Em *Meta for Developers*, crie (ou use) um **app do tipo Business**, com o produto **Login do Facebook para Empresas** (ou Login do Facebook) e **Marketing API**.
2. Em *Login do Facebook › Configurações*, cadastre a URI de redirecionamento acima em **URIs de redirecionamento OAuth válidos**.
3. **Permissão pedida: apenas `ads_read`** (ler insights e listar as contas de anúncios que a pessoa autorizar). Nada de `ads_management`.
4. **Contas próprias × de clientes**: para as contas de anúncios da **própria empresa dona do app**, o acesso **Standard** a `ads_read` basta e **não** exige App Review (a pessoa que conecta precisa ser admin/desenvolvedor/testador do app). Para ler contas **de clientes**, é preciso acesso **Advanced** a `ads_read` via **App Review** (e verificação de empresa quando a Meta exigir). O código é o mesmo.
5. **Nível de acesso da Marketing API** (renomeado em 04/05/2026): *Limited access* (padrão, só desenvolvimento, limites baixos) e *Full access* (via App Review; exige ≥ 500 chamadas bem-sucedidas em 15 dias e erro < 15%). Para uso contínuo, planeje o *Full access* **(confirmar necessidade para o volume da HP)**.
6. Cadastre `META_APP_ID` e `META_APP_SECRET` nos Secrets. Em **Marketing › Integrações**: habilite “Usar esta plataforma”, clique **Conectar**, aceite a permissão e **selecione as contas**. O token de longa duração dura ~60 dias; ao vencer a conexão mostra **“Precisa reconectar”**.
7. **Se o app exigir “segredo do app” nas chamadas** (Configurações do app › Avançado), já enviamos `appsecret_proof` em todas.

## Google Ads

**Versão**: **v26** (lançada em 14/10/2026) é a atual; v23–v25 têm datas de encerramento em 2027. Padrão do código: **v26**.

1. No **Google Cloud**, crie/escolha um **projeto** e **ative a Google Ads API**. Ativar concede o nível **Teste** (só contas de teste, 15.000 operações/dia).
2. **Acesso a contas reais (mudança recente — não use o fluxo antigo)**: os **developer tokens foram encerrados em 09/09/2026**; o acesso é **por projeto do Google Cloud**. Na página *Visão geral da API Google Ads* do projeto, **solicite o acesso Explorer** (análise automática; até 2.880 operações/dia em contas reais; consultas `search` são permitidas) ou **Basic** (15.000/dia; **exige verificação da marca do projeto**). O cabeçalho `developer-token` é **opcional e ignorado**; o código só o envia se `GOOGLE_ADS_DEVELOPER_TOKEN` existir. Problemas conhecidos relatados pelo Google: projetos recém-promovidos podem receber `AUTHORIZATION_ERROR` — o código mostra a mensagem e o caminho. Erro `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` = projeto ainda só com acesso de teste.
3. **Tela de consentimento OAuth** e **cliente OAuth “Aplicativo da Web”**: cadastre a URI de redirecionamento acima. Escopo: `https://www.googleapis.com/auth/adwords` (o Google **não oferece escopo só de leitura**; a leitura é imposta pelo servidor). Esse OAuth é **separado** do Google Calendar — a autorização do Calendar **não** concede o Ads. Se a tela de consentimento estiver em *Teste*, o refresh token pode expirar em poucos dias **(confirmar política vigente)** — publique o app quando for operar de verdade.
4. **Conta administradora (MCC)**: se a pessoa que conecta acessa clientes por uma MCC, a descoberta lista as contas-cliente e usa a MCC como `login-customer-id`. Contas diretas funcionam sem isso.
5. Cadastre `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET`; em **Integrações**: habilite, **Conectar**, escolha a conta Google com acesso ao Ads e **selecione as contas**.

## Teste real (depois de configurar)

1. Conectar → conferir **lista de contas** e **moeda/fuso**.
2. Selecionar **uma** conta (com unidade) → **Atualizar agora** → ver a execução em *Execuções de sincronização* (janela, linhas, páginas, erro).
3. Conferir um dia conhecido: **investimento do Hub = Gerenciador/Google Ads** no mesmo dia e fuso (considerar revisões recentes: o reprocesso de 7 dias as incorpora).
4. Em **Campanhas**, classificar as campanhas novas (nenhuma é inferida pelo nome).
5. Marcar os links dos anúncios com os modelos de **Configurações › Como marcar os links** e enviar um formulário de teste → conferir o toque ligado à campanha **por id**.
6. Desconectar → conferir que as credenciais foram apagadas e o histórico ficou.

## O que ainda falta (de quem tem acesso externo)

- Criar/obter o **app Meta** e o **projeto Google** (itens acima) e cadastrar os 4 segredos.
- Solicitar **Explorer/Basic** no Google (e brand verification para Basic) e, se for ler contas de clientes ou operar em escala, **App Review/Full access** na Meta.
- Aprovações externas **não** foram obtidas nem afirmadas; a estrutura está preparada para white label (cada organização conecta as **suas** contas; o mesmo app de plataforma pode atender várias organizações, sujeito às regras de cada plataforma).

## Fontes oficiais consultadas (09/11/2026)

- Meta — versões da Marketing API / changelog: developers.facebook.com/documentation/ads-commerce/marketing-api (overview/versioning e marketing-api-changelog)
- Meta — autorização da Marketing API (níveis, `ads_read`, contas próprias × de clientes): developers.facebook.com/docs/marketing-api/overview/authorization
- Meta — fluxo manual de login e tokens de longa duração: developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow · …/access-tokens/get-long-lived
- Google — token de desenvolvedor / níveis de acesso por projeto: developers.google.com/google-ads/api/docs/api-policy/developer-token · …/access-levels
- Google — versões e encerramentos: developers.google.com/google-ads/api/docs/sunset-dates
