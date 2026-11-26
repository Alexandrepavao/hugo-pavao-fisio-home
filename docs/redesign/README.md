# Redesign do ERP HP Group Hub

Branch `feat/redesign-erp` (worktree `D:\Claude\hp-redesign`), base **`origin/main` @ `4830397`**. Só Dev; sem merge, produção ou DNS. Independente da branch do white label (`feat/white-label-plataforma`, PR #39).

## O que mudou (e onde)

| Peça | Arquivos | Observação |
|---|---|---|
| **Banner único por página** | `src/components/hp/PageBanner.tsx`, `pageMeta.tsx`, `AppFrame.tsx`, `src/lib/ui.tsx` (`PageHead`) | A moldura (`AppFrame`) renderiza **um** banner com **um** `h1` (`#titulo-secao`). Cada página declara título/descrição pelo `PageHead` (que já existe em ~60 telas) via `useRegisterPageMeta`; sem declaração vale o nome do item ativo do menu. Item de menu que se distingue por parâmetro de URL (Vendas × Contas a receber, Contratos, Empresas, Unidades…) dá o nome ao banner. As ações do `PageHead` viram a **toolbar** logo abaixo do banner. Fora da moldura (portais) o `PageHead` continua o de sempre. |
| **Hub** | `src/pages/admin/Dashboard.tsx`, `Greeting.tsx` | Saudação pelo horário local no banner; faixa de atenção (**categorias** × **itens**); 4 indicadores (4/2/1 colunas); *Visão da operação* (abas Financeiro/Comercial) 60% + *Pendências prioritárias* 40% (críticas primeiro); demais blocos preservados. |
| **Seletor de unidades** | `src/components/hp/UnitSelect.tsx`, `src/lib/PeriodFilter.tsx` | Radix Select: teclado (setas, Enter, Esc, digitação), foco devolvido ao botão, menu em portal que se reposiciona e rola por dentro, reticências no botão e quebra de linha no menu, check no selecionado, seta que gira. "Todas as unidades" mantém o significado; unidades vêm da fonte atual; mesmos parâmetros de URL. Vale em **todas** as telas que usam o filtro compartilhado. |
| **Planilha administrativa** | `src/pages/admin/adm/Diretorio.tsx` | Descrição curta (sem nomes de tabelas); *Novo cadastro* principal, demais ações secundárias (no celular, menu *Mais ações* com todas); 5 indicadores (5 colunas ≥1280 px; 3+2 em larguras médias; 2 colunas no celular); tabela compacta com cabeçalho fixo, hover e `aria-sort`; busca, filtros, ordenação, paginação, colunas, importação e exportação inalterados. |
| **Tokens e menu** | `src/styles/app.css` | Raios 10–12 px, controles de filtro de 40 px, menu lateral de 232 px com item ativo em fundo suave e texto da cor principal (`--primary`), rótulos longos com reticências e `title`. **Tipografia do projeto mantida** (Inter/Manrope já carregadas). |
| Textos | `Agenda`, `AcademyAdmin`, `Pipeline`, `Reports`, `Partners`, `SettingsHub`, `Audit`, `Pages`, `Conversas` | Descrições do banner em linguagem de usuário (sem "banco", "servidor", tabelas). `Audit` e `Pages` passaram a usar `PageHead` (tinham `h1` próprio). |

## Decisões

- **Marca**: o banner usa `--primary` (que a marca da organização sobrescreve) e o logotipo oficial (`hp-logo.png`, exibido em branco por CSS — o mesmo arquivo, nada recriado). `PageBanner` recebe `brand`; nesta base só existe a HP (fallback). **Nada novo de banco/migration.**
- **Verde**: nenhum verde novo. As cores de identidade por aplicativo (`apps.ts`) já existiam; o item ativo do menu e o banner usam a cor principal.
- **Imagem de referência**: composição/estética apenas. Nenhum número, nome ou texto das imagens entrou na interface; "Proposta visual" não aparece (a varredura confere).
- **Testes**: `#pf-unit` deixou de ser um `<select>` nativo → R01, R04, R05 e R14 usam o helper `pickUnit` (`e2e/helpers.ts`) — mudança **intencional** de interface.

## Integração com o white label (conferida)

Arquivos alterados nas duas frentes: `AppFrame.tsx`, `HeaderBar.tsx`, `R01`, `R05`. Mesclando o tip do white label (`b431721`) numa cópia descartável: **um único conflito** (a linha de `import` de `./apps` em `AppFrame.tsx`: manter `APP_MODULE` do white label **e** os imports `PageBanner`/`pageMeta` daqui). `HeaderBar` e os testes mesclam sem conflito. Depois da mesclagem, para a marca da organização no banner, no `AppFrame`:

```tsx
const brand: BannerBrand = org.isDefaultBrand || !org.brandName ? DEFAULT_BANNER_BRAND : { name: org.brandName, logoSrc: org.logoUrl, monochrome: false };
… <PageBanner app={app} meta={bannerMeta} brand={brand} />
```

(`PageBanner` precisa aceitar `logoSrc: string | null` e mostrar o monograma quando não há logotipo — ver `docs/redesign/white-label/*.png`: Clínica Alfa (verde-azulado) e Clínica Beta (roxo), com os dados só delas e sem a marca HP.) Esse ajuste foi validado na cópia mesclada (typecheck limpo; capturas de Alfa e Beta) e **não** está nesta branch porque `OrgProvider` ainda não existe na `main`.

## Como repetir a validação

```bash
node node_modules/vite/bin/vite.js --port 5181 --host 127.0.0.1     # servidor próprio (não use a 5180 de outra conversa)
E2E_BASE_URL=http://127.0.0.1:5181 npx playwright test e2e/novos/N50-redesign-cobertura.spec.ts e2e/novos/N50b-redesign-componentes.spec.ts --workers=1
```

Matriz de rotas: [`matriz-cobertura.md`](matriz-cobertura.md) (+ `matriz-rotas.json`). Capturas: `docs/redesign/telas/`.

## Fase 2 — usabilidade e arquitetura da informação
Padrão, responsabilidades da Gestão, onde estão os tutoriais e limitações: [`usabilidade.md`](usabilidade.md). Matriz por rota (60): [`matriz-usabilidade.md`](matriz-usabilidade.md). Resultados e triagem das falhas (com comparação na `main`): [`resultados-testes.md`](resultados-testes.md). Capturas antes/depois: `docs/redesign/baseline/` × `docs/redesign/depois/`; jornadas: `docs/redesign/usabilidade/`.
