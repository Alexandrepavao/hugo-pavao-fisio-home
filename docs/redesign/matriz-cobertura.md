# Matriz de cobertura do redesign (rotas internas do /admin)

Gerada por `e2e/novos/N50-redesign-cobertura.spec.ts` (varredura real, gestor QA, banco Dev) + leitura de `src/App.tsx`. **Implementação**: *Recomposta* = layout específico refeito; *Padrão compartilhado* = banner único, toolbar, tokens, filtros e tabelas compartilhados aplicados pela moldura/`PageHead`, com o conteúdo interno ainda no desenho anterior onde não listado como recomposto. **Validação** (automatizada, por rota): carrega, um banner e um `h1`, aplicativo e menu contextual corretos, sem rolagem horizontal em 1440 e 390 px, sem erro de console novo.

| # | Aplicativo | Rota (real) | Título no banner | Componente | Layout | Tipo de tela | Implementação | Validação | Observações |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Início (Hub) | `/admin` | Hub: saudação + marca | Dashboard (AdminHome) | AdminLayout › AppFrame | Dashboard | Recomposta | OK (banner/h1/menu/1440/390) | revisada em 1440/1280/768/360, escuro e zoom 200% |
| 2 | Gestão | `/admin/adm` | Gestão → Visão geral | AdmDashboard | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 3 | Gestão | `/admin/adm/pendencias` | Gestão → Pendências administrativas | AdmPendencias | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 4 | Gestão | `/admin/adm/pendencias?aba=contratos` | Gestão → Contratos | AdmPendencias (aba Contratos) | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 5 | Gestão | `/admin/adm/diretorio` | Gestão → Planilha administrativa | Diretorio (Planilha administrativa) | AdminLayout › AppFrame | Listagem/planilha | Recomposta | OK (banner/h1/menu/1440/390) | revisada em 1440/1280/768/360, escuro e zoom 200% |
| 6 | Gestão | `/admin/adm/diretorio?tipo=pj` | Gestão → Empresas | Diretorio (tipo=pj) | AdminLayout › AppFrame | Listagem/planilha | Recomposta | OK (banner/h1/menu/1440/390) | revisada em 1440/1280/768/360, escuro e zoom 200% |
| 7 | Gestão | `/admin/pessoas` | Gestão → Pessoas | People | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 8 | Gestão | `/admin/programas` | Gestão → Programas e ofertas | Programs | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 9 | Gestão | `/admin/chamados` | Gestão → Chamados de pacientes | SupportAdmin | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 10 | Gestão | `/admin/responsaveis` | Gestão → Responsáveis e cuidadores | Representations | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 11 | Gestão | `/admin/configuracoes?secao=org` | Gestão → Unidades | SettingsHub (Unidades) | AdminLayout › AppFrame | Configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 12 | Gestão | `/admin/equipe` | Gestão → Equipe e convites | Team | AdminLayout › AppFrame | Listagem/configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 13 | Gestão | `/admin/configuracoes?secao=operacao` | Gestão → Produtos e serviços | SettingsHub (Produtos e serviços) | AdminLayout › AppFrame | Configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 14 | Gestão | `/admin/configuracoes` | Gestão → Configurações | SettingsHub | AdminLayout › AppFrame | Configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 15 | Gestão | `/admin/ver-como` | Gestão → Ver como | ViewAs | AdminLayout › AppFrame | Formulário/ferramenta | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 16 | Gestão | `/admin/auditoria` | Gestão → Auditoria | Audit | AdminLayout › AppFrame | Listagem/relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 17 | Financeiro | `/admin/financeiro` | Financeiro → Visão geral | FinanceOverview | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 18 | Financeiro | `/admin/financeiro/relatorios` | Financeiro → Relatórios | FinanceReports | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 19 | Financeiro | `/admin/financeiro/vendas?aba=vendas` | Financeiro → Vendas | FinanceSales (aba Vendas) | AdminLayout › AppFrame | Listagem/formulário | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 20 | Financeiro | `/admin/financeiro/vendas?aba=recebiveis` | Financeiro → Contas a receber | FinanceSales (aba Contas a receber) | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 21 | Financeiro | `/admin/financeiro/pagar` | Financeiro → Contas a pagar | FinancePayables | AdminLayout › AppFrame | Listagem/formulário | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 22 | Financeiro | `/admin/financeiro/cartoes` | Financeiro → Cartões | FinanceCards | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 23 | Financeiro | `/admin/financeiro/fluxo-caixa` | Financeiro → Fluxo de caixa | FinanceCashFlow | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 24 | Financeiro | `/admin/financeiro/conciliacao` | Financeiro → Conciliação | FinanceReconciliation | AdminLayout › AppFrame | Listagem/ferramenta | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 25 | Financeiro | `/admin/financeiro/recorrencia` | Financeiro → Recorrência e forecast | FinanceRecurrence | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 26 | Financeiro | `/admin/financeiro/dre` | Financeiro → Rentabilidade e DRE | FinanceDre | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 27 | Financeiro | `/admin/financeiro/comissoes` | Financeiro → Comissões e repasses | FinanceCommissions | AdminLayout › AppFrame | Listagem/configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 28 | Financeiro | `/admin/financeiro/precos-repasses` | Financeiro → Preços e repasses | PhysioPricing | AdminLayout › AppFrame | Configurações/listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 29 | Financeiro | `/admin/contas-corporativas` | Financeiro → Contas corporativas | CorporateAccounts | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 30 | Financeiro | `/admin/financeiro/config` | Financeiro → Configurações | FinanceSettings | AdminLayout › AppFrame | Configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 31 | CRM | `/admin/crm` | CRM → Painel comercial | CrmDashboard | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) | aviso de chave duplicada já existente no CRM (R27/R32) |
| 32 | CRM | `/admin/crm/leads` | CRM → Gestão de leads | CrmLeads | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 33 | CRM | `/admin/crm/contatos` | CRM → Contatos | CrmContacts | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 34 | CRM | `/admin/crm/listas` | CRM → Listas | CrmLists | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 35 | CRM | `/admin/crm/oportunidades` | CRM → Pipeline | CrmPipeline | AdminLayout › AppFrame | Kanban | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 36 | CRM | `/admin/crm/tarefas` | CRM → Tarefas | CrmTasks | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 37 | CRM | `/admin/crm/metas` | CRM → Minha meta | CrmMinhaMeta | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 38 | CRM | `/admin/crm/metas/ritmo` | CRM → Ritmo do dia | CrmRitmo | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 39 | CRM | `/admin/crm/metas/time` | CRM → Time | CrmTeam | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 40 | CRM | `/admin/crm/conversas` | CRM → Conversas | CrmConversas | AdminLayout › AppFrame | Detalhe/mensagens | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 41 | CRM | `/admin/crm/relatorios` | CRM → Relatórios | CrmReports | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 42 | Pages | `/admin/paginas` | Pages → Páginas | Pages | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 43 | Pages | `/admin/captacao-leads` | Pages → Captação de leads | LeadCapture | AdminLayout › AppFrame | Relatório/configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 44 | Pages | `/admin/pesquisas` | Pages → Pesquisas | Research | AdminLayout › AppFrame | Relatório/formulário | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 45 | Marketing | `/admin/marketing` | Marketing → Visão geral | MarketingOverview | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 46 | Marketing | `/admin/marketing/analises` | Marketing → Análises | MarketingAnalytics | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 47 | Marketing | `/admin/marketing/campanhas` | Marketing → Campanhas | MarketingCampaigns | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 48 | Marketing | `/admin/marketing/anuncios` | Marketing → Anúncios e criativos | MarketingAds | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 49 | Marketing | `/admin/marketing/funil` | Marketing → Funil e atribuição | MarketingFunnel | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 50 | Marketing | `/admin/marketing/leads` | Marketing → Leads e pontuação | MarketingLeads | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 51 | Marketing | `/admin/marketing/paineis` | Marketing → Painéis | MarketingDashboards | AdminLayout › AppFrame | Dashboard | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 52 | Marketing | `/admin/marketing/integracoes` | Marketing → Integrações | MarketingIntegrations | AdminLayout › AppFrame | Configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) | chamada à Edge Function bloqueada por CORS na origem local do teste (ambiente, não do redesign) |
| 53 | Marketing | `/admin/marketing/configuracoes` | Marketing → Configurações | MarketingSettings | AdminLayout › AppFrame | Configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 54 | Operação | `/admin/agenda` | Operação → Agenda | Agenda | AdminLayout › AppFrame | Calendário/agenda | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 55 | Operação | `/admin/acompanhamento` | Operação → Acompanhamento de pacientes | Care | AdminLayout › AppFrame | Listagem/detalhe | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 56 | Academy | `/admin/academy` | Academy → Cursos e mentorias | AcademyAdmin | AdminLayout › AppFrame | Listagem/configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 57 | Parceiros | `/admin/parceiros` | Parceiros → Parceiros | Partners | AdminLayout › AppFrame | Listagem | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 58 | Produtividade | `/admin/meu-dia` | Produtividade → Meu dia | Productivity | AdminLayout › AppFrame | Calendário/tarefas | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 59 | Produtividade | `/admin/meu-resumo` | Produtividade → Meu resumo | MySummary | AdminLayout › AppFrame | Relatório | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |
| 60 | Início (Hub) | `/admin/conta` | Início (Hub) → Configurações | Account | AdminLayout › AppFrame | Formulário/configurações | Padrão compartilhado | OK (banner/h1/menu/1440/390) |  |

**Resultado da varredura: 60 de 60 rotas estáticas do `/admin` com banner/h1/menu/rolagem validados.**

## Rotas e telas NÃO cobertas pela varredura (com o motivo)

| Rota / tela | Situação |
|---|---|
| `/admin/paginas/:id` (editor de páginas) | Rota dinâmica com editor próprio; o banner da moldura aparece (título pelo menu: Páginas); o modo de tela cheia do editor foi preservado. Conteúdo interno do editor **não redesenhado**. |
| `/admin/crm/relatorios/desempenho`, `/admin/crm/mensagens-agendadas`, `/admin/crm/disparo`, `/admin/status` | Dependem de feature flags/perfil de entrega (v1 esconde parte delas): não carregam no perfil testado. Usam a mesma moldura e `PageHead`. **Não validadas.** |
| `/admin/administrativo/*`, `/admin/gestao/*`, `/admin/operacao/*`, `/admin/pages/*`, `/admin/produtividade/*`, `/admin/crm/configuracoes` | Apenas redirecionamentos para as rotas acima (herdam a validação do destino). |
| `/admin/financeiro/pessoal/*` (8 telas) | Exigem acesso individual às finanças pessoais (`pfOnly`): o gestor QA não tem. Usam a moldura (banner pelo menu) mas **não foram carregadas na varredura**. |
| Detalhes, modais e gavetas (ficha de pessoa/empresa, lead, venda, contrato…) | Abrem por ação dentro das telas acima; não têm rota própria. Cabeçalhos **não padronizados** individualmente (pendência). |
| `/paciente/*`, `/fisio/*`, `/parceiro`, `/academy/*`, `/pesquisas`, `/boas-vindas`, site público, quiz, onboarding, `/plataforma/*` | Cascas próprias (portais e público), fora do ERP administrativo: **fora do escopo desta entrega** e inalteradas (`PageHead` mantém o cabeçalho de sempre fora da moldura). |

## Revisão de conteúdo interno

O banner, a toolbar, os tokens (raios 10–12 px, botões, campos, filtros 40 px, menu lateral de ~232 px) e o seletor de unidades valem para todas as rotas. A **recomposição do conteúdo** (cartões, tabelas, formulários, kanban, calendário) foi feita no Hub e na Planilha administrativa. Nas demais rotas o conteúdo mantém a composição anterior, já sob os novos tokens; cada tela individual **ainda precisa de revisão de composição** — este documento não declara 100% de redesign de conteúdo.
