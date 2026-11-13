# Busca global (Ctrl+K) — pessoas e leads por nome, tipo e lugar

> Pedido do usuário (12–13/11/2026): a barra de pesquisa tinha virou uma lista de páginas do painel; o objetivo dela é **buscar uma palavra, uma pessoa, um lead** — e o administrador precisa poder **perguntar direto na barra** se existe fisioterapeuta em um **bairro, cidade ou zona**.

## Como funciona
- **Foco em pessoas e leads.** Ao abrir, a barra mostra como buscar (exemplos clicáveis) e as buscas recentes — **sem lista de páginas**.
- **Uma frase só, com tipo e lugar:** `fisioterapeuta zona sul` · `fisioterapeuta Copacabana` · `fisioterapeuta zona sul Rio de Janeiro` · `paciente Moema` · `lead Campinas` · `Maria Silva` · e-mail ou trecho do telefone. Sem acento nem caixa; todas as partes digitadas precisam combinar.
- **O que a busca entendeu aparece acima dos resultados** (“Buscando: Fisioterapeutas e parceiros · Zona Sul · ‘rio’”), para o administrador saber o que está sendo filtrado.
- **Tipos reconhecidos:** fisioterapeuta/fisio/profissional (perfil de fisioterapeuta **ou** parceiro), paciente, aluno, lead, equipe, fornecedor, contato.
- **Lugar:** bairro, cidade, UF e **zona** (“zona sul”, “zona norte”, “zona leste”, “zona oeste”, “zona centro”). Para fisioterapeuta, a zona vale para **onde mora e para as zonas que ele diz atender**, e as “cidades/regiões em que atende” entram na busca de cidade.
- **Resultado:** nome, tipo, bairro e cidade/UF com a zona, telefone, e-mail e “Atende: Zona Sul, Zona Oeste”. Clicar abre a pessoa em **Pessoas**; “Ver todos os N em Pessoas” quando há mais de 20.
- **Páginas do painel:** digite `/` (ex.: `/agenda`). Quem não tem acesso a pessoas (perfis sem permissão) vê só a busca de páginas.

## Por dentro
- Função de leitura `public.search_people(frase, limite)` (migration 123) — **SECURITY INVOKER**: roda com as permissões de quem pesquisa (RLS de pessoas, contatos e perfis), então nunca mostra mais do que o usuário já poderia ver. Busca vazia, de 1 letra ou só de palavras vazias não devolve ninguém; nunca lista todo mundo.
- Front: `src/components/hp/CommandMenu.tsx`.

## Testes
SQL `novos/N09` (24) · E2E `N29` (5: sem lista de páginas, tipo + bairro/cidade/zona, recentes, “/”, 390 px) · R12 ajustado ao novo texto da barra.

## Limitações
- A zona só existe para as capitais liberadas (São Paulo e Rio de Janeiro); cidade e bairro funcionam para todas.
- “Fisioterapeuta” inclui quem tem perfil de fisioterapeuta ou é parceiro; quem só preencheu o quiz de parceria aparece como **Parceiro**.
- Perfis cuja permissão não enxerga os perfis de fisioterapeuta não veem as zonas que ele atende nos resultados.
