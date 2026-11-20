# Padrão de usabilidade e arquitetura da informação

Complemento do [redesign](README.md). Responde, em toda tela: **o que faço aqui? o que exige atenção? onde clico? o que significa cada número? como isto se liga às outras áreas?** Sem remover funcionalidade, dado ou permissão.

## Regras do padrão

1. **Uma responsabilidade por área.** Onde duas telas faziam a mesma coisa, há **uma tela principal** e links contextuais nas demais (ver quadro da Gestão).
2. **Título = nome do item do menu aberto** (Visão geral, Pendências, Contratos, Documentos…); o aplicativo fica acima, pequeno. Menu, breadcrumb, banner, ajuda e ações usam o mesmo nome.
3. **Cartão de indicador**: nome, valor e unidade, período, *no máximo* um aviso curto indispensável (`caveat`) e uma **ação concreta** (“Acompanhar contratos”). Fórmula, origem e critérios saem do corpo do cartão e ficam em **“Sobre este indicador”** (ícone *i*, abre por clique/Enter, não depende de hover). Indisponível mostra “—” pequeno e o **motivo**, nunca um número gigante. Cartões **não têm a altura do mais longo**.
4. **Zero não é alerta**: cartão zerado fica discreto (“Hoje”, sem tom de atenção) e continua clicável; categorias vazias não somem.
5. **Conexões só por vínculo real** (`subject_id`), nunca por nome: pendência → *Abrir origem*; contrato → *Ver cadastro*; ficha → *Ver contratos vinculados / pendências / documentos* (filtro por cadastro visível e removível); documento → *Ver pendências*. O destino mostra “**Voltar para …**” (parâmetro `voltar`, só caminhos internos do `/admin`) e preserva busca, aba e filtros. Os filtros da Visão geral vivem na URL para o retorno restaurar o mesmo recorte.
6. **Explicação em camadas**: na tela (essencial e próxima ação) → Ajuda (significado, interpretação) → detalhamento/“Sobre este indicador” (fórmula, origem, limites).
7. **Ajuda e tour por tela** (`Ajuda ▸ Conhecer esta tela`): conteúdo em **uma fonte única** (`src/content/ajuda.ts`); o tour destaca elementos **reais**, um por vez, passo a passo (Próximo, Voltar, Pular, progresso, teclado ←/→/Esc, foco preso no cartão, movimento reduzido); passos sem elemento (sem permissão, módulo desligado, carregando) são pulados; **não executa ações** (camada transparente bloqueia cliques). Convite **discreto** no primeiro acesso (nunca abre sozinho); conclusão/dispensa é guardada **por usuário, organização, tela e versão** (mesmo mecanismo local do tutorial já existente) e a tela continua compreensível sem o tour.

## Gestão: quem faz o quê

| Tela | Responsabilidade | Não é |
|---|---|---|
| **Visão geral** | Priorizar: cartões de atenção (cada um leva à tela filha **já filtrada**), gráficos de evolução e o que falta nos cadastros, detalhes por assunto recolhíveis (com a situação na linha de cada assunto). | Cópia de todas as telas filhas. |
| **Pendências** | Central de trabalho: origem, responsável, prazo, próxima ação; Abertas / Atrasadas / Concluídas (30 dias) como recortes clicáveis; *Abrir origem* **não** conclui (concluir exige nota). | — |
| **Contratos** | Contratos **administrativos** (rascunho → aguardando assinatura → assinado: vigente/a vencer/vencido). **Assinatura é registro manual — não há assinatura eletrônica.** | Vendas nem receita recorrente (Financeiro). |
| **Documentos** | **Único** lugar para registrar e acompanhar documentos de cadastro e sua validade (menu próprio; antes só aba de Pendências). Não há segundo repositório. | Armazenamento de arquivos (o arquivo é opcional nesta etapa). |
| **Pessoas** / **Empresas** | Cadastro central e vínculos; empresa = pessoa jurídica **do diretório** (não a organização/tenant). | Agenda, financeiro ou prontuário. |
| **Planilha administrativa** | **Outra visão dos mesmos cadastros** de Pessoas e Empresas (colunas, filtros, importar/exportar). A ajuda diz isso. | Segunda base de dados. |

## Como cada indicador é lido

`StatCard` (`src/lib/ui.tsx`) recebe `basis` (a base de cálculo vinda do backend) e a mostra **só** em “Sobre este indicador”; `caveat` mantém visível apenas o aviso indispensável (ex.: “Clique não é mensagem enviada.”). Definições vêm do próprio backend (campo `basis` das funções `dashboard_metrics`, `adm_central`, `adm_dashboard`…): nenhuma explicação foi inventada no front.

## Onde estão os tutoriais

Botão **“?” (Ajuda desta tela)** no cabeçalho de toda tela do `/admin` → painel (*Tarefa principal, O que fazer primeiro, Números a observar, Como ler os gráficos, Telas relacionadas*) → **Conhecer esta tela**. Conteúdo e passos: `src/content/ajuda.ts`; mecanismo: `src/components/hp/ajuda/ajuda.tsx`.

## O que NÃO foi feito (limitações)

- **Não houve teste com usuários leigos.** A validação foi automatizada (jornadas N51, varreduras N50/N52) e revisão técnica.
- A **composição interna** foi reorganizada na Hub e na Gestão (Visão geral, Pendências, Contratos/Documentos, Planilha). Nas demais áreas valem banner, cartões novos, nomes, Ajuda e tour, mas **a organização interna de cada tela continua a anterior** — ver `matriz-usabilidade.md`.
- Ajuda/tour de **detalhes, gavetas, finanças pessoais, rotas sob flag, portais e área pública**: fora da varredura (`matriz-cobertura.md`).
- Persistência do tour é **local ao navegador** (como o tutorial existente): não acompanha o usuário entre dispositivos.
- O conteúdo de ajuda das áreas fora da Gestão descreve o que a tela faz **conforme o texto da própria tela e do menu**; precisa de revisão pelo responsável de cada módulo.
