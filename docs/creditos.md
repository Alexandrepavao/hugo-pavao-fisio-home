# Créditos e licenças de terceiros (interface)

Este arquivo registra as atribuições exigidas por licenças de materiais de terceiros usados na interface. Por decisão do produto, **a interface não exibe marca, logotipo ou
crédito visual de modelo externo** (sem “Powered by”); a atribuição exigida pela licença fica aqui, na documentação técnica.

## Mapa do Brasil (`BrazilMap`)
- **Geometria dos estados:** pacote npm [`@svg-maps/brazil`](https://www.npmjs.com/package/@svg-maps/brazil) 2.0.0, de Victor Cazanave — mapa SVG do Brasil com os 26 estados e o Distrito Federal,
  derivado do mapa do Brasil da **MapSVG** (<https://mapsvg.com/maps/brazil>).
- **Licença:** [Creative Commons Atribuição 4.0 Internacional (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). A licença permite uso, adaptação e distribuição, inclusive comercial,
  desde que haja atribuição ao autor original, link da licença e indicação de alterações.
- **Atribuição:** “Mapa do Brasil © MapSVG (<https://mapsvg.com/maps/brazil>), via `@svg-maps/brazil`, licenciado sob CC BY 4.0.”
- **Alterações já feitas pelo pacote sobre o original:** remoção de atributos desnecessários, troca de `title` por `name`, inclusão de `viewBox`, renomeação dos ids e ordenação alfabética dos `path`.
- **O que o HP alterou (adaptação):** as formas dos estados são usadas como vieram; o HP apenas pinta cada estado com a própria escala de cores (tokens `--map-*` em `src/styles/app.css`),
  adiciona contorno, balão de informação (nome, quantidade e percentual), foco de teclado e rótulos de acessibilidade. Nenhum código do plugin comercial da MapSVG é usado: o componente
  (`src/components/hp/BrazilMap.tsx`) é próprio e só lê as formas (`path`) do pacote.
- **Privacidade:** a geometria é estática e vai dentro do pacote da aplicação — nenhuma chamada a serviço externo e nenhum dado de pessoa sai da página.
- **Onde aparece:** Hub (Distribuição geográfica) e Administrativo (Cadastros por estado).

## Fontes
- **Manrope** e **Inter** — [SIL Open Font License 1.1](https://openfontlicense.org/), carregadas do Google Fonts (`index.html`).

## Ícones
- [Lucide](https://lucide.dev/) — licença ISC (pacote `lucide-react`).

## Componentes de base
- [shadcn/ui](https://ui.shadcn.com/) (MIT) sobre [Radix UI](https://www.radix-ui.com/) (MIT) e [Recharts](https://recharts.org/) (MIT) — usados como bibliotecas; a aparência é definida pelos
  tokens próprios do HP (`src/styles/app.css`).

## Referências visuais
A nova interface tomou como **referência de organização** (estrutura, hierarquia de cartões e posição dos filtros) painéis administrativos de mercado. Nenhum código, logotipo, texto, marca
ou componente proprietário foi copiado: tudo foi recriado com os componentes e tokens do HP.

## Repositórios de referência (organização dos aplicativos)
`brightercore-4d41cb1d` (Gestão/Financeiro), `brighter-flow-20722354` (CRM), `engage-nest-space-71c70a06` (Academy) e `focussphere-51789` (Produtividade) estavam acessíveis e foram **lidos só para entender a organização**
(pastas, páginas e agrupamento dos menus laterais). Nenhum código, credencial, dado, infraestrutura, texto ou marca foi copiado; nada deles vai para o repositório ou para a interface.
