# Marketing — campanhas, funil e atribuição

> Módulo **Marketing** do HP Group Hub (app contextual em `/admin/marketing`). Branch `feat/marketing-campanhas` (parte da `feat/portais-paciente-fisio`), **só no Dev** (`fsvtzowcwhvwtluwrhnb`): migrations 104–113, Edge Function `marketing-ads`, testes SQL/unitários/E2E.
> Guia de conexão com Meta e Google: [`marketing-conexao-meta-google.md`](marketing-conexao-meta-google.md). Status geral: [`project-status.md`](project-status.md).

## 1. O que o módulo faz

Acompanha a jornada **anúncio → lead → qualificação → agendamento → comparecimento → venda → recebimento** cruzando, **sem criar CRM ou financeiro paralelo**: mídia das plataformas (ou lançamento manual) + captação (formulários/quizzes) + CRM (oportunidades) + Agenda + Vendas/Recebimentos + Repasses.

Páginas: **Visão geral · Campanhas · Anúncios e criativos · Funil e atribuição · Integrações · Configurações** (sidebar própria; item no seletor de apps, respeitando papel; escondido no build de **produção** por `featureOn("marketing")` até a promoção ser decidida).

Somente **leitura** das plataformas. Nenhuma criação, pausa ou alteração de anúncio existe no código (lista de operações permitidas aplicada no servidor, com teste). **Nada é enviado às plataformas** (sem conversões, listas ou pixel).

## 2. Auditoria do que existia (lacunas e decisões)

| Tema | Achado | Decisão |
|---|---|---|
| Origem nos formulários/quizzes | `utm` (5 chaves + `ref`) em `form_submissions`, `quiz_leads`, `opportunities`, `page_visits`; `referrer` e `origin_path` brutos; `left(utm::text,1500)::jsonb` podia truncar JSON | Gatilhos **BEFORE INSERT** higienizam utm/referrer/origin_path (sem URL completa, e-mail, token, query, fragmento). Chaves novas: `utm_id`, `hp_campaign_id`, `hp_adset_id`, `hp_ad_id`; `fbclid/gclid/wbraid/gbraid` **só com consentimento**. |
| Campanha/anúncio | Só `opportunities.campaign` (texto de `utm_campaign`) — sem ids, sem conjunto/anúncio, sem primeiro toque | Tabelas `mkt_touches` (um toque por formulário/quiz) e `mkt_person_origin` (só-inserção). |
| Vínculos | `sales.opportunity_id` (nulo possível), `appointments.opportunity_id` (nulo possível), `payments`→`receivables`→`sales`, `physio_payouts.sale_id` | Atribuição por oportunidade e por venda; vínculo da venda sem oportunidade pela mais recente da pessoa (base **registrada** e exibida no painel de qualidade). |
| Avaliação | `services` não diz o que é “avaliação” | Config: serviços que contam como avaliação (vazio ⇒ indicador indisponível). |
| Qualificação | Etapas por funil; nenhuma marcada como “qualificado” | Config: etapas que significam qualificação (vazio ⇒ indisponível). |
| Parceiro ativo | `partner_profiles.status/approved_at`, `referrals` | Config: “indicou nos últimos N dias” (vazio ⇒ indisponível). |
| Indicadores existentes | `capture_analytics` (funil por pessoa), `dashboard_metrics`, `private.metric()` | Reaproveitado o padrão (`private.metric`, `crm_units`, `IndicatorSheet`, `StatCard`, `PeriodFilter`). Marketing tem funil **atribuído a campanha**. |
| Escopo/permissões | `private.current_org()`, `crm_units()` (org-wide × unidades), RLS + funções `security definer` | Leitura: manager, ops_admin, unit_manager, sales. Configuração: manager e ops_admin. Painéis só por funções (escopo de unidade). |
| Integrações | Google Calendar: OAuth com state de uso único, AES-GCM, pg_cron+pg_net+Vault | Reaproveitado o **padrão** (não as credenciais). Chave própria `MKT_TOKEN_ENC_KEY`; autorização do Calendar **não** vale para o Ads. |
| Linha de negócio | `products.business_line` é enum fechado (physio/academy/unclassified) | **Frentes** configuráveis (`mkt_fronts`) com ligação opcional à linha; sem enum específico da HP (white label). |
| Consentimento de rastreamento | Não existe UI de consentimento no site | Identificadores de clique **não são guardados por padrão**; ficam prontos para quando houver consentimento (`localStorage hp_consent_tracking = "1"`). |

## 3. Arquitetura

```
site (utm, ids) ─► form_submissions / quiz_leads ─(gatilho)─► mkt_touches ─► mkt_attributions (1 por oportunidade, no COMMIT)
                                                                          └► mkt_sale_attributions (1 por venda confirmada)
Meta/Google ─► Edge Function marketing-ads ─► mkt_run_* / mkt_ingest_* ─► mkt_spend_daily (canônico campanha×dia)
lançamento manual ───────────────────────────► mkt_spend_daily (source = manual; sobreposição resolvida por conta×dia)
                   mkt_events() = registros ─► cartões, funil, comparativos e detalhamento (a mesma fonte)
```

* **Tabelas** (todas com RLS; leitura direta só do administrador; escrita só por função): `mkt_settings`, `mkt_fronts`, `mkt_purposes`, `mkt_event_types`, `mkt_connections`, `mkt_credentials` (sem política: só service role), `mkt_oauth_states`, `mkt_ad_accounts`, `mkt_campaigns/adsets/ads` (objetivo e status **originais**), `mkt_campaign_class` + `_history` (classificação **interna**), `mkt_spend_daily` (canônico), `mkt_entity_daily` (conjunto/anúncio), `mkt_breakdown_daily` (Facebook×Instagram, posicionamento, dispositivo), `mkt_sync_runs`, `mkt_day_status` (cobertura), `mkt_touches`, `mkt_person_origin`, `mkt_attributions`, `mkt_sale_attributions`, `mkt_attribution_log`.
* **Funções públicas** `mkt_*` (autenticadas): configuração, classificação, lançamento manual, indicadores (`mkt_kpis`, `mkt_funnel`, `mkt_series`, `mkt_campaign_table`, `mkt_ads_table`, `mkt_reconciliation`, `mkt_quality`, `mkt_filters`, `mkt_indicator_detail`). **Funções de ingestão** (`mkt_run_start/finish`, `mkt_ingest_*`, `mkt_accounts_upsert`, `mkt_connection_set_state`) só a **service role**.
* **Edge Function `marketing-ads`** (`verify_jwt=false`; autentica por JWT + `mkt_whoami`, ou `x-cron-secret`): `/status`, `/start`, `/callback/meta|google`, `/discover`, `/sync`, `/disconnect`. Módulos puros e testáveis: `crypto`, `http`, `meta`, `google`, `plan`, `sync`.
* **Sincronização horária**: `pg_cron` (`7 * * * *`) → `private.mkt_sync_tick()` → `pg_net` → `/sync` (URL e segredo no Vault). “Atualizar agora” respeita `manual_refresh_min_minutes`.

## 4. Segurança das conexões

* Administrador verificado **no servidor** (`mkt_whoami` → `private.mkt_admin()`); o front só reflete.
* OAuth: **state** assinado (HMAC) **e** nonce em tabela, **uso único**, 10 min, vinculado a **organização + usuário + plataforma**; **PKCE (S256)** no Google (a Meta não documenta PKCE para o fluxo manual — não foi usado); `redirect_uri` calculado pelo servidor; retorno só para `MKT_RETURN_URL`.
* Credenciais **AES-GCM** em `mkt_credentials` (só service role; nunca no front, logs ou repositório). Meta: token de longa duração (~60 dias) + `appsecret_proof` em todas as chamadas, token em cabeçalho (nunca na URL); Google: refresh token.
* Conta de anúncios só entra pela **descoberta** na API com a conexão da organização; `mkt_account_select` recusa id de outra organização/inventado; índice único impede a **mesma conta real** em duas organizações.
* Desconexão: revoga no provedor quando suportado (Meta `DELETE /me/permissions`; Google `revoke`), apaga credenciais, para de acompanhar as contas e **preserva o histórico**.
* Somente leitura: Meta só `GET` em `graph.facebook.com`; Google só `googleAds:search|searchStream` (SELECT) e `listAccessibleCustomers`. Paginação não segue host diferente (SSRF).

## 5. Sincronização e dados

* **Chave** do gasto canônico: organização + conta + campanha + **dia (na timezone da conta)** + fonte. Reexecutar não duplica.
* **Campanha × dia** é o total; **conjunto/anúncio** e **posicionamento/dispositivo** ficam em tabelas separadas e **nunca somam** ao total.
* Guarda **moeda por linha**, fuso, definição das métricas (`metric_defs`), versão da API e instante da coleta. **Moedas diferentes não são somadas** (aparecem à parte, sem conversão).
* **Alcance (reach) não é guardado nem somado** (alcance único diário não é somável); fica para fase futura com janelas exatas.
* **Cobertura** por conta×dia (`mkt_day_status`): dia coletado = `ok`; falha = `failed` e **nenhuma linha de gasto é escrita**. Sem cobertura ⇒ “Não disponível”, nunca zero; o intervalo coberto aparece na faixa de cobertura.
* **Janelas**: histórico inicial (`backfill_days`, padrão 90), reprocesso recente (`reprocess_days`, padrão 7), recuperação de dias que falharam. Blocos de 31 dias, retentativas limitadas (3) com espera/Retry-After, **trava** por conta (liberada após 20 min sem batimento).
* **Sobreposição manual × API** por **conta × dia**: com API coletada no dia, o manual fica “substituído pela API” (visível, fora da soma); o administrador pode **priorizar o manual** explicitamente (a API do dia sai da soma). Nunca somam os dois.

## 6. Rastreamento e atribuição

* Registrado por envio: UTMs, `hp_campaign_id/adset/ad`, (com consentimento) identificadores de clique, caminho de entrada **sanitizado**, data/hora, plataforma inferida e se é **pago**. Parâmetros públicos **não são prova**: a ligação à campanha só vale para campanha **importada de conta autorizada** (por **id**; por **nome exato e único** com a base registrada e sinalizada na qualidade).
* **Toque pago**: Meta/Google com (identificador de clique) ou (id de campanha) ou (`utm_medium` na lista configurada de mídias pagas).
* **Modelo (padrão)**: *último toque pago elegível antes da criação da oportunidade, dentro da janela* (padrão **30 dias**; configurável). Desempate: toque registrado por último, depois id. Resultado por oportunidade: `attributed` | `organic` (há toques, nenhum pago na janela) | `no_touch` (sem origem). Calculado **uma vez**, no commit da criação (gatilho deferido) e guardando janela e versão da regra.
* **Nada recalcula sozinho**: mudar janela/regras sobe `config_version`; aplicar a um período é ação **explícita** (“Recalcular atribuição”, registrada em `mkt_attribution_log`). Há também “Preencher histórico gravado” (a partir do que já está em formulários/quizzes) e “Religar toques” (campanhas importadas depois).
* **Venda**: cada venda **confirmada** é ligada **uma vez** (`sale_opportunity` ou `person_latest_opportunity`) e classificada como **cliente novo** (sem compra confirmada anterior), **expansão** (produto ainda não comprado) ou **recompra**. Sem atribuição ⇒ explícita (“sem atribuição”); **receita nunca é distribuída proporcionalmente**.
* **Duas plataformas reivindicando a mesma venda**: o Hub atribui a **um único toque**; o que as plataformas reportam aparece à parte (A) e **não** se soma ao confirmado no Hub (B).
* **Cancelamento/estorno**: venda cancelada sai de vendido/compradores/recebido; estornos entram como linhas negativas em recebimentos; classificação “novo/recompra” é fixada na confirmação (não muda se uma venda anterior for cancelada depois). **Mesclagem de cadastros**: vínculos por `person_id` seguem a pessoa mesclada; a classificação já gravada não é refeita (limitação documentada; recálculo explícito resolve).
* **Duas visões**: *por data do evento* (cada etapa na sua data) e *por coorte de captação* (leads captados no período + tudo que aconteceu até hoje).

## 7. Indicadores (fórmula · fonte · granularidade · denominador)

Todos em `mkt_kpis`; o catálogo completo (com fórmula, fonte, granularidade, denominador e situação) aparece em **Funil e atribuição**. Taxas consolidadas pelos **totais** (nunca média de taxas). Sem fonte/denominador ⇒ “Não disponível” + motivo.

| Grupo | Indicador | Fórmula |
|---|---|---|
| Mídia | Investimento | soma do gasto efetivo (campanha×dia) na moeda de relatório |
| | Cliques | Meta `inline_link_clicks` · Google `metrics.clicks` (definição única) |
| | CTR · CPC · CPM | cliques ÷ impressões · gasto ÷ cliques · gasto ÷ impressões × 1000 (só linhas com o dado) |
| | Resultados reportados | soma do “resultado” da plataforma (**não** é conversão confirmada) |
| Captação/CRM | Leads únicos · Oportunidades | pessoas distintas · oportunidades atribuídas |
| | Qualificados | oportunidades que chegaram a etapa marcada como qualificação |
| | CPL · Custo por qualificado | investimento ÷ leads · ÷ qualificados |
| | Tempo até 1º contato humano | média de (primeira resposta registrada − criação), só quem tem registro |
| | Ganhas · Perdidas | status da oportunidade |
| Fisioterapia | Avaliações agendadas/realizadas | agendamentos / atendimentos realizados de serviço marcado como avaliação |
| | Comparecimento | realizados ÷ (realizados + faltas); **cancelamentos e faltas separados** |
| | Custo por avaliação realizada | investimento ÷ avaliações realizadas |
| Parceiros | Aprovados · Ativos · custos | aprovação em `partner_profiles` após a oportunidade · indicou nos últimos N dias (configurado) |
| Academy/Tech | Matrículas · Compradores · Ticket médio | vendas com curso/mentoria · vendas confirmadas · vendido ÷ vendas |
| | Receita recorrente | **indisponível** (precisa de contratos recorrentes ligados a vendas atribuídas; parcelamento **não** é MRR) |
| Financeiro | Vendido · Recebido líquido de estornos | soma de vendas confirmadas · pagamentos − estornos |
| | Custo de mídia por novo cliente | investimento ÷ novos compradores (**não** é CAC completo) |
| | ROAS sobre vendas · Retorno por recebimentos | vendido ÷ investimento · recebido ÷ investimento |
| | Repasses | apurado (pendente) ≠ autorizado ≠ pago — nunca misturados |
| | Resultado após mídia e repasses | **só na coorte**, com gasto totalmente coberto: recebido − investimento − repasses autorizados/pagos. **Não é lucro líquido.** |

## 8. Privacidade e conversões externas

Esta fase **importa relatórios e cruza dados internamente**. **Não envia** eventos, listas de pacientes ou conversões, e **não instala pixel**. Uma etapa futura de conversões externas dependerá de: política vigente de cada plataforma, consentimento, elegibilidade dos dados e jamais incluir diagnósticos, sintomas, evolução clínica, respostas de questionários, vídeos prescritos ou nomes de protocolos que revelem condições de saúde; sem pixels em portais autenticados ou páginas clínicas.

## 9. Limitações conhecidas

* **APIs reais não verificadas**: nenhuma chamada real à Meta/Google foi feita (faltam credenciais do app). A lógica foi testada com respostas simuladas; a **verificação real** é a primeira tarefa depois de configurar (guia).
* Resultados reportados da Meta: soma de ações de lead (`lead`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`) — aproximação declarada, **não** igual ao “Resultados” do Gerenciador.
* **Lead Ads / formulários nativos**: não implementado (exige fluxo, permissões e aprovação separados). Mostrado como “Não conectado”.
* Atribuição ao **anúncio**: só ao nível da **campanha**; o anúncio/conjunto constam do toque (ids do link) mas o comparativo de criativos mostra apenas mídia (sem leads/vendas por anúncio).
* Cliques no WhatsApp não são conversas: `quiz_leads.whatsapp_clicked_at` segue separado; conversa “comprovada” não é medida aqui.
* Moeda: sem conversão cambial; só uma moeda de relatório.
* Desempenho: `mkt_events` recalcula tudo por consulta (adequado ao volume atual); materialização é evolução futura.
* Presumido e a validar com conta real: parâmetros dinâmicos de URL (`{{campaign.id}}` na Meta; `{campaignid}`, `{adgroupid}`, `{creative}` no Google) e campos de insights.

## 10. Lista única: implementado · testado · configurado · pendente

| Item | Implementado | Testado | Configurado (Dev) | Pendente |
|---|---|---|---|---|
| Banco (104–113), RLS, funções | ✅ | ✅ SQL `N03` (158) + regressão SQL `release` (1.702 OK) | ✅ aplicado no Dev | produção (não promovido) |
| Rastreamento/atribuição/vendas | ✅ | ✅ N03 + E2E N22 | ✅ | UI de consentimento (ids de clique) |
| Indicadores/funil/qualidade/reconciliação | ✅ | ✅ N03 + N22 (cartão = RPC = detalhe) | ✅ | MRR atribuído; alcance único |
| App Marketing (6 páginas, filtros) | ✅ | ✅ N22 (desktop 1280 e celular 390) | ✅ | — |
| Lançamento manual + sobreposição | ✅ | ✅ N03 + N22 | ✅ | — |
| Conector Meta/Google (Edge Function) | ✅ publicado no Dev | ✅ 32 testes **simulados**; chamadas reais só em rotas sem credencial (401, state forjado, segredo errado) | 🟡 segredos internos ok; **faltam** `META_APP_ID/SECRET`, `GOOGLE_ADS_CLIENT_ID/SECRET` | **teste real** com contas; revisão de app (Meta) e nível de acesso (Google) |
| Sincronização horária | ✅ `pg_cron` + Vault | ✅ planejador/execução (simulado) | ✅ Vault e segredo | só roda com conexão ativa |
| Lead Ads | ❌ | — | — | fluxo e permissões próprios |
| Envio de conversões | ❌ (desativado por decisão) | — | — | etapa futura com política/consentimento |
| Produção | ❌ | — | — | promoção decidida à parte |
