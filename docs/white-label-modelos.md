# White label — segmentos, modelos e módulos

Arquitetura: [white-label-arquitetura.md](white-label-arquitetura.md) · Provisionamento: [white-label-provisionamento.md](white-label-provisionamento.md).

## 1. Segmentos

| Segmento | Estado | Observação |
|---|---|---|
| **Fisioterapia** | **disponível** (modelo v1 publicado) | O único provisionável hoje. |
| Clínica médica, Odontologia, Psicologia, Estética, Mentoria/consultoria, Advocacia, Imobiliária, Condomínios | **planejados** | Existem no catálogo **só como estrutura**: aparecem desabilitados no questionário ("planejado") e a validação do servidor os **recusa** para provisionamento. Nada foi simulado (sem modelos de mentira). |

## 2. Modelo (template) versionado

Um modelo é uma configuração **aprovada** de um segmento (`platform_templates`, chave `(segment_key, version)`, estados `draft`/`published`/`retired`). Conteúdo do modelo de Fisioterapia v1:

- **Vocabulário**: cliente→*paciente*, atendimento, sessão, avaliação, profissional→*fisioterapeuta*.
- **Módulos padrão** (`core, crm, agenda, financeiro, jornada_paciente, apresentacao_evidencias, repasses`) e **opcionais** (`rota_domiciliar, marketing, academy, parceiros, pesquisas, contabil, cartoes_corporativos, financas_pessoais`).
- **Funções (papéis)** do segmento (gestor, administrativo, gestor de unidade, comercial, financeiro, fisioterapeuta, paciente).
- **Funil** "Pacientes" (etapas, etapa ganha, etapa "Perdido" automática), **motivos de perda**, **categorias financeiras**, **configurações** (fuso `America/Sao_Paulo`, idioma `pt-BR`, modalidades).
- **Checklist de implantação** (administrador convidado, unidades, serviços e preços **cadastrados pela clínica**, profissionais, marca, integrações conectadas **pela clínica**, importação, treinamento).

Regras:
- **Cada organização guarda a versão aplicada** (`organizations.template_version`). Publicar a v2 **não altera** organizações existentes: não sobrescreve o que o cliente personalizou. Migrar um cliente para v2 é uma decisão **explícita**, por organização (ainda sem ferramenta própria — ver pendências).
- O modelo **nunca** contém dados, pacientes, credenciais ou registros de nenhuma organização. A HP não é "clonada": é só uma organização que usou a mesma base.
- Serviços e **preços não são inventados**: a clínica cadastra os seus (pendência registrada na solicitação).

## 3. Módulos

Catálogo em `platform_modules` (chave, nome, descrição, versão, **estado** `available`/`experimental`/`planned`, `core`, segmentos permitidos, **aplicação no servidor**) e dependências em `platform_module_deps`.

| Regra | Como é garantida |
|---|---|
| Base comum (`core`) sempre habilitada | `platform_module_set` recusa mexer no core. |
| Combinação inválida | Segmento incompatível, módulo *planejado* e dependências ausentes são recusados **no banco** (`P0012` com a lista do que habilitar/desabilitar antes). |
| Dependências visíveis | Questionário e painel mostram "Requer: …". Desabilitar um módulo que outro usa é recusado. |
| **Desabilitar não apaga dados** | Só o acesso cai (servidor). Religar restaura tudo. A resposta traz `data_preserved: true`. |
| **Habilitação vale no servidor** | Ver arquitetura §4. Tabelas: política restritiva; funções/rotas: recusa no pré-request; mensagem `módulo desabilitado para esta organização (<chave>)`. |
| Comportamento de leitura/exportação com módulo desligado | O módulo desligado **não** é lido pelas telas. **Exportação** de dados continua disponível (a exportação inclui tabelas de módulos desligados, pois são dados da organização). |
| Módulo *experimental* | Aviso no questionário/painel (ex.: Marketing — semente de funis/finalidades ainda é da HP; Apresentação — fluxo recente; Contábil). |

Módulos com `enforcement: none` (ex.: Academy, Parceiros) hoje dependem **só de papéis** — o bloqueio por módulo está na lista de pendências.

## 4. Como adicionar um segmento (receita)

1. **Segmento**: `platform_segments` (`status='planned'` até estar pronto).
2. **Módulos específicos** (se houver): linhas em `platform_modules` (com `segments`), dependências em `platform_module_deps` e, para o servidor bloquear, linhas em `platform_module_objects` (`table`, `table_like`, `rpc`, `rpc_like`) seguidas de `select private.module_guards_apply()`.
3. **Modelo**: `insert` em `platform_templates` (versão 1, `draft`) com o JSON (vocabulário, módulos, funções, funis, motivos, categorias, configurações, checklist). Se o segmento precisar de **estruturas novas** que `template_apply` ainda não conhece, estenda `private.template_apply` (cada bloco do JSON tem uma seção correspondente).
4. **Teste**: replique N21 (SQL) para o novo segmento — organização criada **pelo motor**, isolamento, módulos, verificações do `verify`.
5. **Publicar**: `status='published'` e `published_at`; só então `platform_segments.status='available'`. O questionário passa a oferecê-lo sem mudar código (as funções vêm de `platform_catalog().templates[].roles`).
6. **Documentar** o segmento neste arquivo e a lista do que ainda exige intervenção humana.

## 5. O que o modelo de Fisioterapia ainda NÃO resolve para um cliente novo

- Captação pública (quiz de avaliação, páginas do editor, formulários e onboarding) ainda é da HP — ver arquitetura §9 (limitação 3).
- Serviços, preços, profissionais e disponibilidade: cadastrados pela clínica.
- Integrações (Google Calendar, Meta/Google Ads, pagamentos, WhatsApp, rotas): **nenhuma** é copiada ou ativada; cada clínica conecta as suas.
- Documentos jurídicos/termos: os textos atuais são da HP e precisam de revisão jurídica **por cliente**.
