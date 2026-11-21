# HP Fisio — jornada comercial de ponta a ponta (lead → pagamento → paciente ativo)

Só **Dev**. Teste: `e2e/novos/N42-hp-jornada-comercial-ponta-a-ponta.spec.ts` (9 passos, organização HP, contas QA). Telas em [`docs/jornada-comercial/`](jornada-comercial/) (desktop e celular); resumo por etapa em `jornada-comercial/etapas.json`; **PDF de demonstração**: `jornada-comercial/apresentacao-demo-exemplo.pdf`.
Rodar: `E2E_BASE_URL=<vite> npx playwright test e2e/novos/N42-… --workers=1` (precisa de `SUPABASE_ACCESS_TOKEN` e `HP_QA_PASSWORD`; não rode junto com outra suíte E2E: o Dev é compartilhado).

> **Simulado (declarado):** o clique do paciente no link do convite e a definição da senha (o e-mail de teste é contido pela política de destinatários do Dev; o convite é pedido pela tela da fisioterapeuta e aceito pelo servidor). **Não existe** provedor de pagamento: o recebimento entra manualmente pelo Financeiro, com auditoria.

## O processo e o que cada área recebe

| # | Quem faz | O que acontece | Gestor / Financeiro vê | Fisioterapeuta vê | Telas |
|---|---|---|---|---|---|
| 0 | Gestão | Cadastra serviço da avaliação e **pacote com valor** (Configurações ▸ Operação) | Produtos/serviços ativos; Preços e repasses | — | 00 |
| 1 | **Lead** (site) | Preenche o quiz com origem e campanha na URL | — | — | 01–03 |
| 2 | Sistema → **Admin** | Cria 1 lead, 1 pessoa (cadastro central) e 1 oportunidade em "Novo contato", com responsável automático | CRM ▸ Gestão de leads, Pipeline, Cadastro central, Captação (indicadores), painel do CRM | — | 04–08 |
| 3 | **Admin → Fisio** | Agenda a avaliação com a fisioterapeuta vinculando a oportunidade | Funil move para "Avaliação agendada"; agenda; pessoa com matrícula **pendente** | **Agenda do dia**, ficha do paciente pendente ("não ativa o paciente"), início | 09–13 |
| 4 | **Fisio** | Atende: registra presença, captura a avaliação (queixa, condição, objetivo, plano, medida), **vê a PRÉVIA da área do paciente** e publica a apresentação (versão 1) | Meta do paciente criada a partir do objetivo | Captura, apresentação guiada (7 etapas), **prévia real do portal**, publicação | 14–18 |
| 5 | **Fisio** | Gera o rascunho da **apresentação PDF**, revisa, escolhe a oferta e **aprova a versão**; exporta o PDF | Auditoria `deck_approved`/`deck_exported` | Aba "6. Apresentação PDF", versões, slides, PDF | 19–21 + `slides/` |
| 6 | **Paciente** | Recebe o acesso (convite), entra no app (celular), lê a proposta aprovada e registra o próximo passo | Conta vinculada; tarefa no CRM ("quer iniciar") | Acesso do paciente: "aceito pelo serviço de e-mail" | 22–26 |
| 7 | **Admin/Financeiro** | Converte em venda, confirma; recebe parcial; quita a 1ª parcela | Venda, recebíveis, pagamentos, **comissão** do fisio; paciente **ATIVO** + pacote de 8 sessões | Ficha passa a ativa; "Meu resumo" | 25–30 |
| 8 | — | Estado final nas áreas | Financeiro (vendas, visão geral, comissões), agenda, funil, pessoas, acompanhamento, hub | Início, agenda, ficha ativa, Meu dia, Meu resumo | 31–44 |

Regras provadas no caminho: "Venda feita" **não** ativa; pagamento **parcial** não ativa; só a **1ª parcela quitada** ativa e libera o pacote; lead/pessoa/oportunidade não duplicam; o paciente só enxerga a própria pessoa; a apresentação não traz a anotação interna; outra organização e outro paciente não a leem.

## Apresentação PDF personalizada (16:9) — migration 151
**Substitui o e-book simples da migration 150.** Horizontal (1280×720, uma página por slide), com a identidade da marca e a foto autorizada na capa.
- **Fluxo no sistema:** avaliação registrada → apresentação publicada (`/apresentacao`) → aba **6. Apresentação PDF**: **gerar rascunho** (retrato dos dados) → **revisar** (marcar o que entra; escolher o produto, opcional) → **aprovar versão** → **visualizar** → **exportar PDF**. Nada é pedido de novo ao profissional: os dados vêm da avaliação e da apresentação.
- **Versão aprovada = retrato:** guarda a apresentação publicada, as medidas reais, os dados do portal para a simulação, as evidências e a marca. **O banco recusa UPDATE/DELETE** numa versão aprovada; um rascunho novo nunca substitui a aprovada que o paciente lê. Cada versão traz data, autor, vínculo com a avaliação e impressão digital (SHA-256). O PDF não é guardado: é sempre redesenhado do retrato (determinístico); cada exportação grava `deck_exported` na auditoria.
- **Slides (só os que têm dado):** 1 Capa · 2 Objetivos (palavras do paciente + objetivo do fisio) · 3 Ponto de partida (**uma escala por medida**: dor e atividade 0–10, com data, autor e explicação; nada é somado) · 4 Caminho (avaliar → cuidar → reavaliar → ajustar → autonomia/alta; frequência, semanas e sessões **do plano do profissional**) · 5 Como a evolução será acompanhada (só o ponto de partida; **nenhuma curva futura**; meta separada do resultado) · 6 **Simulação do aplicativo** (componentes REAIS do portal com os dados congelados, dois celulares, chamadas numeradas ancoradas nos blocos reais) · 7 Vídeos e cuidado em casa (link para Treinos; exemplos marcados como demonstrativos quando não há vídeo liberado) · 8 Continuidade com propósito (sem medo, culpa ou promessa) · 9 Evidências (**só fichas aprovadas escolhidas**; sem ficha, a página não existe) · 10 Plano proposto (recomendação clínica **separada** das condições comerciais, estas opcionais) · 11 Próximo passo.
- **Próximo passo do paciente:** "Esclarecer dúvidas" ou "Quero iniciar" só **registra o interesse** (interação + tarefa de acompanhamento no CRM, idempotente). **Não** cria venda, cobrança nem ativa o paciente. Abrir/baixar o PDF também não.
- **Links do PDF:** para `…/paciente/treinos` e `…/paciente/proposta?acao=…` — exigem login; nenhum token, senha ou chave no PDF/QR; sem link público permanente. O paciente lê a versão aprovada em `/paciente/proposta`; a equipe em `/apresentacao/proposta/:id`.
- **Demonstração no navegador:** botão "Explorar a demonstração do aplicativo" abre o portal real (Início, Evolução, Exercícios, Agenda, Mais) com os dados congelados; nada é gravado.
- **Paciente de exemplo:** nome com "(exemplo)" liga a faixa "EXEMPLO · paciente fictício, sem dados reais" em todas as páginas. O PDF de demonstração e as capturas usam só dados fictícios do Dev.
- **Testes (N42):** fluxo completo; PDF conferido com PyMuPDF (`e2e/tools/pdf_check.py`): 16:9, uma página por slide, **fontes incorporadas**, imagens, links, sem fonte minúscula; autorização (paciente, comercial, outra organização e anônimo recusados); tabela fechada à API; imutabilidade; próximo passo idempotente e sem venda/pagamento.

### Dependências ainda não configuradas (antes de finalizar o PDF da marca)
1. **Fontes oficiais da identidade (serifada de títulos + sans) — NÃO estão no projeto.** O projeto só tem as fontes do site (Manrope e Inter, via Google Fonts). Sem os arquivos originais, o PDF usa **Manrope/Inter de forma PROVISÓRIA** (nada foi "deduzido parecido" e apresentado como original). Quando os arquivos (`.woff2`/`.otf`) forem fornecidos: adicionar `@font-face` e trocar `--deck-display`/`--deck-sans` em `src/pages/deck/deck.css`.
2. **Logotipo oficial "HP FISIO GROUP" (circular) como arquivo** — só existe dentro da foto da capa (raster). O projeto tem apenas o logotipo antigo "HP FISIOTERAPIA". Para usar o logo em outros slides e em outras resoluções, precisamos do SVG/PNG original; não foi redesenhado.
3. **Fotos autorizadas adicionais** (além da capa) para ilustrar slides — usei só a capa fornecida.
4. **Texto do slide 8 (continuidade) e dos consentimentos** precisam de revisão clínica/jurídica.
5. PDF aberto no **celular em pé** fica pequeno (documento 16:9): a tela mostra rolagem lateral e a dica de girar o celular.

## Observações
- A fisioterapeuta de QA usa um profissional de testes antigo ("Fisio E2E …"), por isso o nome aparece assim na apresentação; em produção é o nome do profissional.
- Para qualquer outra organização a apresentação usa a marca dela (nome/logotipo/cor) e o endereço `/empresa/<slug>/login`.
