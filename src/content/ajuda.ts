/** FONTE ÚNICA do conteúdo de ajuda por tela: finalidade, tarefa principal, o que fazer primeiro, números a observar, como ler os gráficos, telas relacionadas e os passos do tour
 *  “Conhecer esta tela”. Cards, ajuda contextual e tour leem DAQUI (não há texto de ajuda espalhado pelas telas). Os textos descrevem o que a tela FAZ hoje, conferido no código da própria tela e
 *  nas funções do banco que a alimentam; nada de funcionalidade futura. `version`: ao mudar a tela de forma relevante, suba o número — o convite discreto volta a aparecer uma vez.
 *
 *  Passos do tour: `alvo` é um nome do vocabulário abaixo (resolvido para um elemento REAL da tela); passo cujo elemento não exista (sem permissão, módulo desligado, carregando) é pulado. */
export type TourTarget = "banner" | "acoes" | "filtros" | "abas" | "cartoes" | "graficos" | "tabela" | "conteudo";
export const TARGET_SELECTOR: Record<TourTarget, string> = {
  banner: '[data-testid="page-banner"]',
  acoes: '[data-testid="page-toolbar"], [data-tour="acoes"]',
  filtros: '[data-testid="period-filter"], [data-tour="filtros"]',
  abas: 'main [role="tablist"]',
  cartoes: "main .hp-kpi-grid",
  graficos: "main .recharts-wrapper",
  tabela: "main table",
  conteudo: "#conteudo",
};
export interface HelpStep { alvo: TourTarget; titulo: string; texto: string }
export interface HelpEntry {
  titulo: string;
  finalidade: string;
  tarefa: string;
  primeiro: string[];
  numeros?: string[];
  graficos?: string[];
  relacionadas?: { rotulo: string; para: string }[];
  passos: HelpStep[];
  version: number;
}

const e = (titulo: string, finalidade: string, tarefa: string, primeiro: string[], passos: [TourTarget, string, string][], extra: Partial<Pick<HelpEntry, "numeros" | "graficos" | "relacionadas">> = {}): HelpEntry =>
  ({ titulo, finalidade, tarefa, primeiro, passos: passos.map(([alvo, titulo, texto]) => ({ alvo, titulo, texto })), version: 1, ...extra });

const OPEN: [TourTarget, string, string] = ["banner", "Onde você está", "O título e a frase abaixo dele dizem o que esta tela faz. O nome do aplicativo fica acima do título."];
const FILTERS: [TourTarget, string, string] = ["filtros", "Filtros", "Escolha o período e a unidade. Os números e a lista abaixo passam a mostrar só esse recorte; “Filtros” mostra quantos estão ativos."];

/** Chave da tela: caminho + parâmetro que a distingue (aba/tipo/seção), a mesma regra do menu lateral. */
export const helpKeyFor = (pathname: string, search: string): string => {
  const sp = new URLSearchParams(search);
  if (pathname === "/admin/adm/pendencias") return `${pathname}?aba=${["pendencias", "documentos", "contratos", "contatos", "requisitos"].includes(sp.get("aba") ?? "") ? sp.get("aba") : "pendencias"}`;
  if (pathname === "/admin/adm/diretorio") return sp.get("tipo") === "pj" ? `${pathname}?tipo=pj` : pathname;
  if (pathname === "/admin/configuracoes") return sp.get("secao") === "org" || sp.get("secao") === "operacao" ? `${pathname}?secao=${sp.get("secao")}` : pathname;
  if (pathname === "/admin/financeiro/vendas") return `${pathname}?aba=${sp.get("aba") === "recebiveis" ? "recebiveis" : "vendas"}`;
  return pathname;
};

const HELP_BASE: Record<string, HelpEntry> = {
  // ---------------------------------------------------------------- Início (Hub)
  "/admin": e("Início", "Resume a operação do período e aponta o que precisa de atenção, com atalho para cada aplicativo.", "Ver o que está atrasado e abrir o aplicativo certo para resolver.",
    ["Leia a faixa de atenção: ela diz quantas categorias têm pendência e quantos itens no total.", "Abra uma pendência prioritária para ir direto aos registros.", "Use os aplicativos do menu para trabalhar."],
    [OPEN, FILTERS, ["cartoes", "Indicadores do período", "Quatro números do período escolhido. Clique num cartão para ver os registros; o ícone “i” explica o cálculo."], ["graficos", "Visão da operação", "Troque entre Financeiro e Comercial para ver a evolução; o gráfico usa só dados reais do período."]],
    { numeros: ["Recebimentos, atendimentos realizados, conversão comercial e novos pacientes do período.", "Pendências prioritárias: situação de hoje, não muda com o período."], graficos: ["Evolução financeira: entradas e saídas realizadas por mês.", "Funil: leads, oportunidades, avaliações e contratos no período."] }),

  // ---------------------------------------------------------------- Gestão
  "/admin/adm": e("Visão geral da Gestão", "Mostra o que no cadastro e na rotina administrativa precisa de atenção hoje e leva você até a tela onde resolver.", "Identificar prioridades e abrir a tela certa (Pendências, Contratos, Documentos ou Planilha).",
    ["Comece pelos cartões de atenção: cada um abre os registros do número.", "Veja o gráfico de pendências: estão aumentando ou diminuindo?", "Para trabalhar, abra Pendências; esta tela só resume."],
    [OPEN, FILTERS, ["cartoes", "O que precisa de atenção", "Cada cartão é uma situação de hoje. Clique para abrir exatamente os registros contados. Quando está zerado, o cartão fica discreto: zero não é alerta."], ["graficos", "Perguntas que os gráficos respondem", "Pendências abertas e concluídas por semana, tempo de resolução por tipo e o que falta nos cadastros. Clique numa barra para abrir os registros."], ["conteudo", "Análises por assunto", "Documentos, contratos, contatos, acessos e profissionais ficam agrupados abaixo. Abra o grupo que interessa."]],
    { numeros: ["Pendências vencidas, cadastros incompletos, documentos vencendo, contratos aguardando assinatura, pacientes aguardando agendamento e profissionais com integração incompleta (situação de hoje).", "Total, pessoas físicas, pessoas jurídicas e novos no período."], graficos: ["Evolução de pendências: abertas × concluídas por semana.", "Tempo de resolução por tipo de pendência.", "Campos que mais faltam nos cadastros."], relacionadas: [{ rotulo: "Pendências", para: "/admin/adm/pendencias" }, { rotulo: "Contratos", para: "/admin/adm/pendencias?aba=contratos" }, { rotulo: "Documentos", para: "/admin/adm/pendencias?aba=documentos" }, { rotulo: "Planilha administrativa", para: "/admin/adm/diretorio" }] }),

  "/admin/adm/pendencias?aba=pendencias": e("Pendências", "Central de trabalho administrativo: o que precisa ser resolvido, quem é o responsável, até quando e qual é a próxima ação.", "Resolver, atribuir ou abrir a origem de cada pendência.",
    ["Filtre por situação, unidade ou responsável.", "Atribua um responsável e um prazo às pendências sem dono.", "Use “Abrir origem” para ver o cadastro, contrato ou documento que gerou a pendência."],
    [OPEN, ["filtros", "Filtros", "Situação, unidade, responsável e tipo de cadastro. A lista abaixo mostra só esse recorte."], ["cartoes", "Recortes importantes", "Abertas, atrasadas e concluídas nos últimos 30 dias. Clique para filtrar a lista."], ["acoes", "Registrar e exportar", "“Nova pendência” registra uma ação com responsável e prazo. Exportar CSV leva a lista filtrada."], ["tabela", "A lista de trabalho", "Cada linha mostra o registro de origem, o motivo, o responsável, o prazo e as ações. Abrir a origem não conclui a pendência: concluir exige uma nota."]],
    { numeros: ["Abertas = ainda sem conclusão. Atrasadas = prazo vencido. Concluídas = nos últimos 30 dias."], relacionadas: [{ rotulo: "Visão geral da Gestão", para: "/admin/adm" }, { rotulo: "Contratos", para: "/admin/adm/pendencias?aba=contratos" }, { rotulo: "Documentos", para: "/admin/adm/pendencias?aba=documentos" }] }),

  "/admin/adm/pendencias?aba=documentos": e("Documentos", "Acompanha os documentos de cadastro (pessoas físicas e jurídicas): o que está vigente, vencendo, vencido ou ausente. É o único lugar onde documentos são registrados e acompanhados.", "Registrar um documento com validade e acompanhar o que vence.",
    ["Filtre por situação (ausente, vencido, vencendo).", "Registre o documento do cadastro com tipo, referência e validade.", "Configure os documentos exigidos em Requisitos e prazos."],
    [OPEN, ["filtros", "Filtros", "Situação do documento (ausente, vencido, vencendo, vigente), tipo de cadastro e unidade."], ["acoes", "Registrar documento", "Escolha o cadastro, o tipo de documento e a validade. O arquivo é opcional nesta etapa: o registro é o que conta."], ["tabela", "Situação de cada documento", "Só o documento mais recente de cada tipo conta como vigente. “Ausente” é um documento exigido que ainda não foi registrado."]],
    { relacionadas: [{ rotulo: "Requisitos e prazos", para: "/admin/adm/pendencias?aba=requisitos" }, { rotulo: "Planilha administrativa", para: "/admin/adm/diretorio" }] }),

  "/admin/adm/pendencias?aba=contratos": e("Contratos", "Prepara e acompanha os contratos administrativos de cadastros (prestação de serviço, parceria, termos). Não são as vendas nem os contratos de receita recorrente do Financeiro.", "Registrar um contrato, enviá-lo para assinatura e registrar a assinatura.",
    ["Filtre por situação para ver o que aguarda assinatura.", "Crie o contrato como rascunho e envie para assinatura com um prazo.", "Registre a assinatura quando ela acontecer: é um registro manual, não há assinatura eletrônica."],
    [OPEN, ["filtros", "Filtros", "Filtre por situação, unidade ou responsável. Vindo da Visão geral, o filtro já vem aplicado."], ["acoes", "Novo contrato", "Escolha o cadastro (pessoa ou empresa), o tipo e as datas de vigência. O contrato nasce como rascunho."], ["tabela", "Estados e prazos", "Rascunho → aguardando assinatura → assinado (vigente, a vencer ou vencido). Cada linha tem as ações possíveis e o histórico. “Ver cadastro” abre a pessoa ou empresa do contrato."]],
    { relacionadas: [{ rotulo: "Pendências", para: "/admin/adm/pendencias" }, { rotulo: "Planilha administrativa", para: "/admin/adm/diretorio" }, { rotulo: "Vendas (Financeiro)", para: "/admin/financeiro/vendas?aba=vendas" }] }),

  "/admin/adm/pendencias?aba=contatos": e("Contatos", "Registro humano da verificação de contatos (e-mail e telefone) dos cadastros. Formato válido não é o mesmo que verificado.", "Marcar um contato como verificado depois de confirmá-lo com a pessoa.",
    ["Busque a pessoa pelo nome.", "Confira o contato (mascarado) e registre a verificação."],
    [OPEN, ["conteudo", "Busca e verificação", "Procure o cadastro, veja os contatos mascarados e registre quem verificou e como."]],
    { relacionadas: [{ rotulo: "Visão geral da Gestão", para: "/admin/adm" }] }),

  "/admin/adm/pendencias?aba=requisitos": e("Requisitos e prazos", "Define quais documentos são exigidos de cada tipo de cadastro e os prazos padrão das pendências e dos contratos.", "Ajustar o que a organização exige e os prazos usados nos alertas.",
    ["Veja os documentos exigidos hoje.", "Ajuste prazos de aviso com cuidado: eles mudam os números da Visão geral."],
    [OPEN, ["conteudo", "Regras da organização", "As exigências e prazos configurados aqui alimentam “ausente”, “vencendo” e “a vencer” nas outras telas."]],
    { relacionadas: [{ rotulo: "Documentos", para: "/admin/adm/pendencias?aba=documentos" }] }),

  "/admin/adm/diretorio": e("Planilha administrativa", "Outra forma de ver os MESMOS cadastros de Pessoas e Empresas: uma tabela para consultar, filtrar, organizar colunas, importar e exportar vários cadastros de uma vez.", "Localizar e organizar muitos cadastros; abrir um cadastro para editar.",
    ["Busque por nome, e-mail, telefone ou documento.", "Use as abas Todos, Pessoas físicas e Empresas.", "Abra um nome para editar o cadastro."],
    [OPEN, ["acoes", "Ações da planilha", "Novo cadastro é a ação principal. Colunas, exportar e importar ficam ao lado."], ["cartoes", "Situação dos cadastros", "Totais e cadastros incompletos. Clique para filtrar a tabela."], ["tabela", "A tabela", "Clique no cabeçalho para ordenar e no nome para abrir o cadastro. Os dados são os de Pessoas e Empresas: não há uma segunda base."]],
    { relacionadas: [{ rotulo: "Pessoas", para: "/admin/pessoas" }, { rotulo: "Empresas", para: "/admin/adm/diretorio?tipo=pj" }] }),

  "/admin/adm/diretorio?tipo=pj": e("Empresas", "Cadastro e relacionamento com pessoas jurídicas: empresas, estabelecimentos e parceiros B2B, com seus contatos, documentos, contratos e pendências.", "Cadastrar uma empresa e acompanhar o que está ligado a ela.",
    ["Busque a empresa por razão social ou CNPJ.", "Abra o cadastro para ver contatos, documentos e contratos.", "Use Nova empresa para cadastrar."],
    [OPEN, ["acoes", "Nova empresa", "Cadastra a empresa; documentos e contratos são registrados em Pendências."], ["tabela", "Empresas cadastradas", "Clique no nome para abrir o cadastro."]],
    { relacionadas: [{ rotulo: "Contratos", para: "/admin/adm/pendencias?aba=contratos" }, { rotulo: "Documentos", para: "/admin/adm/pendencias?aba=documentos" }] }),

  "/admin/pessoas": e("Pessoas", "Cadastro central de pessoas e dos vínculos de cada uma (paciente, lead, parceiro, aluno, colaborador). Todo o sistema usa este cadastro.", "Encontrar uma pessoa e ver as conexões autorizadas.",
    ["Busque pelo nome.", "Abra a pessoa para ver os vínculos.", "Use a Planilha administrativa para trabalhar com muitos cadastros."],
    [OPEN, ["conteudo", "Cadastro e vínculos", "Esta tela não é agenda, financeiro nem prontuário: ela só reúne o cadastro e leva às outras áreas."]],
    { relacionadas: [{ rotulo: "Planilha administrativa", para: "/admin/adm/diretorio" }, { rotulo: "Contratos", para: "/admin/adm/pendencias?aba=contratos" }] }),

  // ---------------------------------------------------------------- demais telas da Gestão
  "/admin/programas": e("Programas e ofertas", "Programas de manutenção, retenção e renovação oferecidos aos pacientes.", "Acompanhar quem está elegível para uma oferta.", ["Escolha o programa.", "Abra o paciente para ver o contexto."], [OPEN, ["conteudo", "Programas", "Cada programa mostra quem pode recebê-lo."]]),
  "/admin/chamados": e("Chamados de pacientes", "Atendimento dos chamados abertos pelos pacientes, com prazo.", "Responder dentro do prazo.", ["Veja os chamados em aberto.", "Responda ou atribua um responsável."], [OPEN, ["conteudo", "Chamados", "Os mais antigos e com prazo vencido aparecem primeiro."]]),
  "/admin/responsaveis": e("Responsáveis e cuidadores", "Vínculos de responsável legal, cuidador e representante de pessoas menores, idosas ou com representação.", "Conferir e manter os vínculos autorizados.", ["Busque a pessoa representada.", "Confira o vínculo e o acesso."], [OPEN, ["conteudo", "Vínculos", "Cada vínculo controla quem pode agir em nome de quem."]]),
  "/admin/configuracoes": e("Configurações", "Central de configurações por categoria. Só aparece como gerenciável o que já funciona.", "Abrir a categoria e ajustar.", ["Escolha a categoria.", "Use “Gerenciar” para editar."], [OPEN, ["conteudo", "Categorias", "Cada cartão leva à configuração correspondente."]]),
  "/admin/configuracoes?secao=org": e("Unidades", "Nome, cidade, UF e fuso das unidades da organização.", "Cadastrar ou ajustar uma unidade.", ["Confira as unidades.", "Edite o que mudou."], [OPEN, ["conteudo", "Unidades", "As unidades alimentam os filtros de todas as telas."]]),
  "/admin/configuracoes?secao=operacao": e("Produtos e serviços", "Serviços (duração e preço) e produtos/pacotes (sessões e validade).", "Cadastrar o que a organização vende e atende.", ["Cadastre o serviço.", "Crie o pacote vinculado ao serviço."], [OPEN, ["conteudo", "Serviços e produtos", "Preço e sessões definidos aqui valem para as próximas vendas."]]),
  "/admin/equipe": e("Equipe e acessos", "Convites, papéis e vínculos por unidade de quem usa o sistema.", "Convidar uma pessoa e definir o que ela pode fazer.", ["Convide pelo e-mail.", "Defina o papel e a unidade."], [OPEN, ["conteudo", "Equipe", "O papel define o que a pessoa vê e faz."]]),
  "/admin/ver-como": e("Ver como", "Permite ao gestor ver o sistema como outro perfil, somente leitura.", "Conferir o que um perfil enxerga.", ["Escolha o perfil.", "Encerre a visão quando terminar."], [OPEN, ["conteudo", "Visão de outro perfil", "Nenhuma alteração é possível durante a visão."]]),
  "/admin/auditoria": e("Auditoria", "Registro de quem fez o quê e quando: ações administrativas e eventos das automações.", "Investigar uma alteração.", ["Escolha a aba.", "Filtre pelo período."], [OPEN, ["abas", "Duas visões", "Ações administrativas e automações (eventos)."], ["tabela", "Registros", "Cada linha tem autor, data e ação."]]),
};

/** Telas dos demais aplicativos: finalidade, tarefa e relações descritas a partir do que a própria tela faz hoje (texto da tela e do menu). Passos do tour = elementos reais presentes (os ausentes são pulados). */
const m = (titulo: string, finalidade: string, tarefa: string, ler: string, rel: { rotulo: string; para: string }[] = [], com: TourTarget[] = ["filtros", "cartoes", "graficos", "tabela"]): HelpEntry => {
  const txt: Record<TourTarget, [string, string]> = {
    banner: ["Onde você está", "O título e a frase abaixo dele dizem o que esta tela faz."],
    acoes: ["Ação principal", "A ação mais usada desta tela fica no topo, ao lado dos filtros."],
    filtros: ["Filtros", "Período, unidade e demais filtros. Os números e a lista passam a mostrar só esse recorte."],
    abas: ["Abas", "Cada aba mostra uma parte do assunto. A aba aberta aparece no título."],
    cartoes: ["Números principais", "Clique num cartão para ver os registros; o ícone “i” explica o cálculo e o período."],
    graficos: ["Gráficos", ler],
    tabela: ["Lista", "Os registros do recorte escolhido; use as ações da linha para continuar o trabalho."],
    conteudo: ["Conteúdo", "A área principal da tela."],
  };
  return e(titulo, finalidade, tarefa, ["Leia o título e a frase de finalidade.", "Ajuste os filtros, se houver.", "Comece pela ação principal ou pelo número que chama atenção."],
    [OPEN, ...com.map((k): [TourTarget, string, string] => [k, txt[k][0], txt[k][1]])], { relacionadas: rel });
};
const MODULOS: Record<string, HelpEntry> = {
  "/admin/financeiro": m("Visão geral do Financeiro", "Resumo financeiro do período: caixa, contas a receber e a pagar, e o que está vencido.", "Ver como está o caixa e abrir a tela certa para agir.", "Entradas e saídas realizadas por período; só aparecem com dados reais.", [{ rotulo: "Contas a receber", para: "/admin/financeiro/vendas?aba=recebiveis" }, { rotulo: "Contas a pagar", para: "/admin/financeiro/pagar" }]),
  "/admin/financeiro/relatorios": m("Relatórios do Financeiro", "Relatórios de eficiência e exportações do Financeiro.", "Escolher o relatório e exportar.", "Cada gráfico traz o período e a unidade de medida.", [], ["filtros", "graficos", "tabela"]),
  "/admin/financeiro/vendas?aba=vendas": m("Vendas", "Registra e acompanha as vendas e seus contratos de receita.", "Criar uma venda e confirmar; o recebimento é registrado em Contas a receber.", "—", [{ rotulo: "Contas a receber", para: "/admin/financeiro/vendas?aba=recebiveis" }], ["filtros", "acoes", "tabela"]),
  "/admin/financeiro/vendas?aba=recebiveis": m("Contas a receber", "Parcelas das vendas: o que vence, o que foi recebido e os estornos.", "Registrar um recebimento ou estorno.", "—", [{ rotulo: "Vendas", para: "/admin/financeiro/vendas?aba=vendas" }], ["filtros", "tabela"]),
  "/admin/financeiro/pagar": m("Contas a pagar", "Despesas e fornecedores: o que vence e o que foi pago.", "Registrar uma conta e marcar o pagamento.", "—", [], ["filtros", "acoes", "tabela"]),
  "/admin/financeiro/cartoes": m("Cartões", "Cartões corporativos: faturas, limite e compras (uma compra é uma despesa).", "Acompanhar a fatura e lançar compras.", "—", [], ["filtros", "tabela"]),
  "/admin/financeiro/fluxo-caixa": m("Fluxo de caixa", "Entradas e saídas realizadas e previstas por mês.", "Ver a projeção do caixa.", "Barras realizadas × previstas por mês.", [], ["filtros", "graficos", "tabela"]),
  "/admin/financeiro/conciliacao": m("Conciliação", "Confere o extrato do banco ou a fatura com os recebimentos e contas a pagar.", "Conciliar cada linha do extrato.", "—", [], ["filtros", "tabela"]),
  "/admin/financeiro/recorrencia": m("Recorrência", "Receita recorrente (mensalidades) e projeções.", "Acompanhar a receita recorrente.", "Evolução e projeção mês a mês.", [], ["filtros", "cartoes", "graficos"]),
  "/admin/financeiro/dre": m("DRE", "Resultado por competência (diferente do caixa).", "Ler o resultado do período.", "Receitas, deduções, custos e despesas por competência.", [], ["filtros", "cartoes", "tabela"]),
  "/admin/financeiro/comissoes": m("Comissões e repasses", "Regras de comissão e os lançamentos gerados a cada recebimento.", "Autorizar e pagar comissões; criar regras.", "—", [{ rotulo: "Preços e repasses", para: "/admin/financeiro/precos-repasses" }], ["abas", "tabela"]),
  "/admin/financeiro/precos-repasses": m("Preços e repasses", "Valor das sessões e repasse ao fisioterapeuta por pacote.", "Definir preço e regra de repasse.", "—", [], ["abas", "tabela"]),
  "/admin/contas-corporativas": m("Contas corporativas", "Empresas conveniadas e seus relatórios.", "Acompanhar uma conta corporativa.", "—", [], ["filtros", "tabela", "conteudo"]),
  "/admin/financeiro/config": m("Configurações do Financeiro", "Contas financeiras, categorias de despesa (com classificação na DRE) e centros de custo.", "Cadastrar contas e categorias.", "—", [], ["conteudo"]),
  "/admin/crm": m("Visão geral do CRM", "Resumo comercial: leads, oportunidades e conversão.", "Ver o que exige retorno e abrir os leads.", "Funil e evolução comercial do período.", [{ rotulo: "Gestão de leads", para: "/admin/crm/leads" }, { rotulo: "Pipeline", para: "/admin/crm/oportunidades" }]),
  "/admin/crm/leads": m("Gestão de leads", "Fila de leads ainda na primeira etapa, por tipo de lead.", "Atribuir responsável e dar o primeiro retorno.", "—", [{ rotulo: "Pipeline", para: "/admin/crm/oportunidades" }], ["filtros", "tabela"]),
  "/admin/crm/contatos": m("Contatos", "Contatos do CRM.", "Encontrar e abrir um contato.", "—", [], ["filtros", "tabela"]),
  "/admin/crm/listas": m("Listas", "Listas de leads e contatos para ações em grupo.", "Montar e usar uma lista.", "—", [], ["tabela"]),
  "/admin/crm/oportunidades": m("Pipeline", "Um funil para cada tipo de lead; cada oportunidade anda sozinha entre as etapas.", "Arrastar cards entre etapas ou usar o menu ⋯ do card.", "—", [{ rotulo: "Gestão de leads", para: "/admin/crm/leads" }], ["filtros", "conteudo"]),
  "/admin/crm/tarefas": m("Tarefas", "Tarefas comerciais atribuídas a você e à equipe.", "Concluir as tarefas do dia.", "—", [], ["filtros", "tabela"]),
  "/admin/crm/metas": m("Minha meta", "Sua meta comercial e o quanto falta.", "Acompanhar o ritmo.", "Meta × realizado.", [], ["cartoes", "graficos", "conteudo"]),
  "/admin/crm/metas/ritmo": m("Ritmo do dia", "Quanto falta fazer hoje para atingir a meta.", "Planejar o dia.", "—", [], ["cartoes", "conteudo"]),
  "/admin/crm/metas/time": m("Time", "Metas e resultados do time comercial.", "Comparar o desempenho do time.", "—", [], ["filtros", "tabela", "conteudo"]),
  "/admin/crm/conversas": m("Conversas", "Mensagens dos leads e contatos, com a ficha do lead ao lado.", "Responder e acompanhar conversas.", "—", [], ["conteudo"]),
  "/admin/crm/relatorios": m("Relatórios do CRM", "Indicadores comerciais da sua unidade; cada cartão explica o cálculo.", "Analisar conversão e desempenho.", "Conversão entre etapas e desempenho comercial.", [], ["filtros", "cartoes", "graficos"]),
  "/admin/paginas": m("Páginas", "Páginas do site e formulários de captação.", "Criar, editar e publicar uma página.", "—", [], ["acoes", "tabela"]),
  "/admin/captacao-leads": m("Captação de leads", "Resultados do quiz de avaliação e de parceria e configuração do WhatsApp.", "Ver de onde vêm os leads.", "Respostas, pessoas e oportunidades são coisas diferentes; clique no WhatsApp não é mensagem enviada.", [], ["filtros", "cartoes", "graficos"]),
  "/admin/pesquisas": m("Pesquisas", "Pesquisas de satisfação e NPS.", "Acompanhar respostas.", "—", [], ["filtros", "cartoes", "conteudo"]),
  "/admin/marketing": m("Visão geral do Marketing", "Investimento, leads e retorno das campanhas.", "Ver o desempenho do período.", "Investimento × leads × retorno.", [], ["filtros", "cartoes", "graficos"]),
  "/admin/marketing/analises": m("Análises", "Análises de qualidade, perdas e retorno por campanha, região e horário.", "Entender o que funciona.", "—", [], ["filtros", "graficos"]),
  "/admin/marketing/campanhas": m("Campanhas", "Campanhas Meta e Google e sua classificação.", "Classificar campanhas.", "—", [], ["filtros", "tabela"]),
  "/admin/marketing/anuncios": m("Anúncios e criativos", "Anúncios, conjuntos e criativos.", "Comparar anúncios.", "—", [], ["filtros", "tabela"]),
  "/admin/marketing/funil": m("Funil e atribuição", "Funil e atribuição de leads às campanhas.", "Ver onde os leads se perdem.", "Etapas do funil por origem.", [], ["filtros", "graficos"]),
  "/admin/marketing/leads": m("Leads e pontuação", "Leads com nota de priorização.", "Priorizar os leads mais quentes.", "—", [], ["filtros", "tabela"]),
  "/admin/marketing/paineis": m("Painéis", "Painéis personalizados de indicadores.", "Montar seu painel.", "—", [], ["conteudo"]),
  "/admin/marketing/integracoes": m("Integrações", "Conexões com Meta Ads e Google Ads e gastos manuais.", "Conectar uma conta.", "—", [], ["conteudo"]),
  "/admin/marketing/configuracoes": m("Configurações do Marketing", "Janela de atribuição, frentes, finalidades e regras de UTM.", "Ajustar regras.", "—", [], ["conteudo"]),
  "/admin/agenda": m("Agenda", "Agenda de atendimentos por unidade e profissional.", "Agendar, confirmar e acompanhar atendimentos.", "—", [{ rotulo: "Acompanhamento", para: "/admin/acompanhamento" }], ["abas", "filtros", "conteudo"]),
  "/admin/acompanhamento": m("Acompanhamento de pacientes", "Pacientes com vínculo assistencial e o conteúdo liberado para eles.", "Abrir um paciente e definir a jornada.", "—", [], ["filtros", "tabela"]),
  "/admin/academy": m("Cursos e alunos", "Cursos, mentorias, turmas, matrículas e acesso dos alunos.", "Liberar ou revogar o acesso de um aluno.", "—", [], ["abas", "tabela"]),
  "/admin/parceiros": m("Parceiros", "Indicações, encaminhamentos e repasses de parceiros.", "Acompanhar os parceiros ativos.", "—", [], ["filtros", "tabela"]),
  "/admin/meu-dia": m("Meu dia", "Suas tarefas, compromissos do CRM e agenda clínica em um só lugar.", "Planejar e cumprir o dia.", "—", [], ["abas", "acoes", "conteudo"]),
  "/admin/meu-resumo": m("Meu resumo", "Seus atendimentos, faltas e repasses do período.", "Conferir o seu desempenho.", "—", [], ["filtros", "cartoes", "tabela"]),
  "/admin/conta": m("Configurações da conta", "Seus dados de acesso e preferências.", "Atualizar seus dados.", "—", [], ["conteudo"]),
};

export const HELP: Record<string, HelpEntry> = { ...HELP_BASE, ...MODULOS };

/** Telas sem entrada própria ganham uma ajuda gerada do que o sistema já sabe delas (título do banner + descrição declarada pela página), sem inventar. */
export const genericHelp = (titulo: string, descricao?: string): HelpEntry => e(titulo, descricao || `Tela “${titulo}”.`, "Use os filtros e as ações desta tela.", ["Leia o título e a frase de finalidade.", "Ajuste os filtros, se houver.", "Use a ação principal no topo da lista."], [OPEN, FILTERS, ["tabela", "Lista", "Os registros do recorte escolhido."], ["cartoes", "Números", "Clique para ver os registros que compõem cada número."]]);
