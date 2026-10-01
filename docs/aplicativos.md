# Aplicativos do HP Group Hub (navegação contextual, rotas e filtros)

> Implementação: `src/components/hp/apps.ts` (registro e resolução por URL), `src/components/hp/appNav.ts` (menu de cada aplicativo), `src/components/hp/AppFrame.tsx` (cabeçalho + sidebar),
> `src/pages/admin/AdminLayout.tsx` (escolhe o app pela URL), `src/components/hp/AppLauncher.tsx` (lançador do Hub). Testes: `R02` (menus por papel), `R13` (navegação, aliases, filtros).

## 1. Como funciona
- O **Hub** (`/admin`) é a entrada central: indicadores consolidados e o lançador **“Seus aplicativos”**, que lista só os aplicativos que o papel do usuário permite.
- Ao entrar num aplicativo, a **sidebar passa a ser a exclusiva dele** (nunca a de outro app), com: identidade do app (ícone e cor próprios), **“Voltar ao Hub”**, o **seletor de aplicativos**
  (no bloco do app, na sidebar, e no breadcrumb do cabeçalho), grupos de navegação, item ativo destacado, recolher no desktop e gaveta no celular.
- O **aplicativo ativo é decidido pela URL** (`appForPath`): link direto, recarregar a página e voltar/avançar caem sempre no app e no item corretos. Itens que compartilham o caminho
  (ex.: `/admin/configuracoes`, `/admin/financeiro/vendas?aba=…`) são distinguidos também pelos parâmetros.
- **Um aplicativo nunca concede permissão.** O papel só decide o que *aparece* (Hub, seletor, itens de menu). A autorização real continua na rota (`RequireAuth` com papéis), no RLS e nas
  funções do banco, por papel, unidade e vínculo. Quem digita um endereço sem permissão vê “Sem permissão” (testado em `R02`).

## 2. Aplicativos, menus e rotas (todas as rotas existentes foram preservadas)
| Aplicativo | Papéis que o veem | Itens do menu → rota |
|---|---|---|
| **Início (Hub)** | todos os staff | Início `/admin` · lista de aplicativos |
| **Gestão** | gestor, adm. operacional, gestor de unidade, comercial | Dashboard `/admin/adm` · Pendências `/admin/adm/pendencias` · Contratos `/admin/adm/pendencias?aba=contratos` · Planilha administrativa `/admin/adm/diretorio` · Pessoas `/admin/pessoas` · Unidades `/admin/configuracoes?secao=org` · Equipe e acessos `/admin/equipe` · Produtos e serviços `/admin/configuracoes?secao=operacao` · Configurações `/admin/configuracoes` · Auditoria `/admin/auditoria` (os quatro últimos conforme o papel) |
| **Financeiro** | gestor, adm. operacional, gestor de unidade, financeiro, comercial | Visão geral `/admin/financeiro` · Relatórios `…/relatorios` · Vendas `…/vendas?aba=vendas` · Contas a receber `…/vendas?aba=recebiveis` (inclui recebimentos e estornos) · Contas a pagar `…/pagar` · **Cartões `…/cartoes`** · Fluxo de caixa `…/fluxo-caixa` · Conciliação `…/conciliacao` · Recorrência `…/recorrencia` · DRE `…/dre` · Comissões e repasses `…/comissoes` · Contas corporativas `/admin/contas-corporativas` · Configurações `…/config` |
| **CRM** | gestor, adm. operacional, gestor de unidade, comercial | Dashboard · Gestão de leads · Contatos · Listas · Pipeline (Kanban) · Tarefas · Minha meta · Ritmo do dia · Time · Conversas · Análises · Desempenho comercial · Configurações do CRM (rotas `/admin/crm/*`) |
| **Pages** | gestor, adm. operacional, gestor de unidade, comercial | Páginas `/admin/paginas` (editor e templates) · Captação de leads `/admin/captacao-leads` (quizzes, formulários, resultados) · Pesquisas `/admin/pesquisas` (gestor e adm. operacional) |
| **Operação** | gestor, adm. operacional, gestor de unidade, comercial, fisioterapeuta | Agenda `/admin/agenda` (atendimentos, pacotes e sessões, lista de espera) · Acompanhamento `/admin/acompanhamento` |
| **Academy** (administração) | gestor, adm. operacional, professor | Cursos e alunos `/admin/academy` — **não** é o portal de aulas do aluno (`/academy`, `/academy/:slug`), que continua à parte |
| **Parceiros** | gestor, adm. operacional, gestor de unidade, financeiro, comercial | Parceiros `/admin/parceiros` (indicações, encaminhamentos e repasses) |
| **Produtividade** | todos os staff | Meu dia `/admin/meu-dia` (tarefas, calendário Dia/Semana/Mês, foco, Google Calendar) |

Prefixos que definem cada app: Gestão `/admin/adm`, `/admin/pessoas`, `/admin/equipe`, `/admin/configuracoes`, `/admin/auditoria`, `/admin/status` · Financeiro `/admin/financeiro`, `/admin/contas-corporativas` ·
CRM `/admin/crm` · Pages `/admin/paginas`, `/admin/captacao-leads`, `/admin/pesquisas` · Operação `/admin/agenda`, `/admin/acompanhamento` · Academy `/admin/academy` · Parceiros `/admin/parceiros` · Produtividade `/admin/meu-dia`.

**O que não foi criado de propósito:** nenhuma tela vazia nem link para o que ainda não existe. Por isso não há item de menu para, por exemplo, “Relatórios” da Gestão (o dashboard já os reúne),
“Templates” e “Formulários” soltos em Pages (vivem no editor de páginas e na Captação), turmas/matrículas/comunidade do Academy (a tela atual é uma só) ou “Atividades” do CRM (as atividades aparecem no painel
e em Conversas). “Contas a receber” e “Recebimentos e transações” já existiam como abas de *Vendas e recebimentos* e agora têm entrada própria no menu (a aba vai na URL).

## 3. Rotas amigáveis e compatibilidade
As rotas antigas **continuam valendo**. Foram acrescentados atalhos que redirecionam (sem laço: o destino nunca é outro atalho) preservando parâmetros e âncora:

| Atalho | Destino |
|---|---|
| `/admin/gestao`, `/admin/administrativo` | `/admin/adm` (+ `/pessoas`, `/equipe`, `/configuracoes`, `/auditoria`, `/diretorio`, `/pendencias`) |
| `/admin/operacao` | `/admin/agenda` (+ `/acompanhamento`) |
| `/admin/pages` | `/admin/paginas` (+ `/captacao`, `/pesquisas`) |
| `/admin/produtividade` | `/admin/meu-dia` |

Não foram alteradas: rotas públicas, login, recuperação de senha, portais do paciente/parceiro/aluno.

## 4. Filtro único
Um só componente (`PeriodFilter`) em todos os módulos migrados: **período e unidade visíveis** no topo da tela; o resto dentro de **um botão “Filtros”** (popover; **gaveta** no celular) com **contador** de filtros
ativos, **“Limpar filtros”** (só aparece quando há algo ativo) e **chips** dos filtros ativos. **Financeiro** inclui **Linha de negócio** (Geral, HP Fisioterapia, HP Academy) dentro do popover; a linha vai
na URL (`?linha=`) e **trocar o período/unidade não apaga a linha** (antes, apagava). Comparação com o período anterior só é mostrada com base real.
| Módulo | Situação |
|---|---|
| Hub, Gestão (dashboard), CRM (painel, leads, pipeline, relatórios), Captação, Pesquisas, Contas corporativas | já usavam o componente |
| Financeiro: Visão geral, DRE, Relatórios, **Recorrência** (mês), **Fluxo de caixa** (intervalo), **Cartões** | migrados/novos: período ou mês + unidade visíveis; linha de negócio no popover |
| Gestão: **Pessoas** | migrado: unidade visível; tipo dentro do botão Filtros; busca por nome continua à vista |
| Gestão: **Planilha administrativa** | migrado: busca (`#dir-q`) e unidade visíveis; **tipo, vínculo, status, estado e “só incompletos”** dentro do botão Filtros (contador, chips, “Limpar filtros”); mesmos parâmetros de URL (`q`, `tipo`, `vinculo`, `unidade`, `status`, `incompleto`, `uf`) e mesma consulta `adm_directory` |
| Operação: **Agenda do dia** | migrado: **unidade (obrigatória: sem “Todas”) e dia (com ‹ ›) visíveis**; **profissional e estado** da lista dentro do botão Filtros. Profissional e serviço do **formulário de agendamento** continuam no próprio formulário (são campos de preenchimento, não filtros) |
| Academy (administração) | migrado: busca por título visível; **tipo e estado** dentro do botão Filtros (Cursos); estado (Trilhas). Cursos são da organização inteira: sem unidade nem período |
| Parceiros | migrado: busca visível em todas as abas; **Repasses**: unidade visível, estado e parceiro no botão Filtros; **Parceiros**: estado; **Indicações**: só busca (não há dimensão de unidade/estado) |
| Financeiro: **Contas a pagar** | migrado: busca e unidade visíveis; **estado, linha de negócio (o mesmo filtro de antes: não classificado/Fisioterapia/Academy/compartilhado), origem (cartão/avulsa) e vencimento de/até** no botão Filtros |
| Financeiro: **Conciliação** | migrado: busca e unidade visíveis; **tipo de movimento e estado** no botão Filtros (a “Conta bancária” do envio do extrato continua um campo do formulário). O relatório “Movimentos bancários por linha de negócio” usa o período do filtro único e a **conta** no botão Filtros |
| **Fora do padrão (de propósito)** | Meu dia (Produtividade): a barra do calendário (‹ Hoje ›, Dia/Semana/Mês, categorias) é a interface de data/profissional e já fica à vista |

Todas as telas migradas **só filtram a lista já carregada ou repassam o mesmo parâmetro de antes à mesma consulta**: nenhuma permissão, RLS ou rota mudou (testado em `R14` e `R02`: quem não tem o papel continua sem a tela e sem os dados). A linha “Limpar filtros” só aparece com algo ativo;
trocar de aba de Parceiros limpa os filtros. Componentes: `src/lib/PeriodFilter.tsx` (agora com `day` e `unitRequired`) e `src/lib/ListFilterBar.tsx` (busca à esquerda + filtro único à direita).

## 5. Referências inspecionadas
Os quatro repositórios de referência estavam **acessíveis** (clonados só em área temporária, fora do projeto): `brightercore-4d41cb1d` (Gestão/Financeiro), `brighter-flow-20722354` (CRM),
`engage-nest-space-71c70a06` (Academy) e `focussphere-51789` (Produtividade). Foram lidos **apenas** a organização de pastas, as páginas existentes e o agrupamento dos menus laterais, como inspiração para
hierarquia (menus agrupados e recolhíveis por aplicativo; painel, planner, foco e relatórios na Produtividade). **Nada foi copiado**: nenhum código, credencial, dado, infraestrutura ou marca; nenhum módulo
de cartão corporativo foi encontrado neles (os “cards” de lá são cartões de produto), então o modelo de Cartões é próprio do HP. Detalhe em `docs/creditos.md`.
