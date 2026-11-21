# HP Fisio — jornada comercial de ponta a ponta (lead → pagamento → paciente ativo)

Só **Dev**. Teste: `e2e/novos/N42-hp-jornada-comercial-ponta-a-ponta.spec.ts` (9 passos, organização HP, contas QA). Telas em [`docs/jornada-comercial/`](jornada-comercial/) (desktop e celular); resumo por etapa em `jornada-comercial/etapas.json`; **e-book em PDF**: `jornada-comercial/ebook-acompanhamento-N42.pdf`.
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
| 5 | **Fisio** | Escolhe o pacote e **gera o e-book** (valores + plano + como pagar + acesso ao app); baixa o PDF | Auditoria `ebook_generated` | Aba "6. E-book", versões, PDF | 19–20 |
| 6 | **Paciente** | Recebe o acesso (convite), entra no app (celular), lê apresentação e e-book | Conta vinculada com papel de paciente | Acesso do paciente: "aceito pelo serviço de e-mail" | 21–24 |
| 7 | **Admin/Financeiro** | Converte em venda, confirma; recebe parcial; quita a 1ª parcela | Venda, recebíveis, pagamentos, **comissão** do fisio; paciente **ATIVO** + pacote de 8 sessões | Ficha passa a ativa; "Meu resumo" | 25–30 |
| 8 | — | Estado final nas áreas | Financeiro (vendas, visão geral, comissões), agenda, funil, pessoas, acompanhamento, hub | Início, agenda, ficha ativa, Meu dia, Meu resumo | 31–44 |

Regras provadas no caminho: "Venda feita" **não** ativa; pagamento **parcial** não ativa; só a **1ª parcela quitada** ativa e libera o pacote; lead/pessoa/oportunidade não duplicam; o paciente só enxerga a própria pessoa; o e-book não traz a anotação interna; outra organização e outro paciente não leem o e-book.

## E-book da apresentação (migration 150)
- **Quando:** só depois de publicar a apresentação. **Quem gera:** a fisioterapeuta com vínculo (ou gestão). **Onde o paciente lê:** `/paciente/ebook` (link na apresentação).
- **Conteúdo (versão imutável, `presentation_ebooks`):** objetivo, ponto de partida (relatado × avaliado), plano, ciência escolhida, **oferta** (pacote ativo escolhido: nome, valor, nº de sessões, validade, regras de falta/cancelamento — tudo do cadastro de produtos da organização, nada fixo no código), **como finalizar o pagamento** (regra existente), **acesso ao aplicativo** (endereço de entrada montado pela tela; marca da organização).
- **Valor:** o do dia da geração (o paciente vê a data). **Parcelas:** não são inventadas; quando a venda existe, o paciente vê as parcelas reais, a situação do pagamento (aguardando → confirmado) e o status do acompanhamento.
- **Idempotência/versão:** gerar de novo sem mudança devolve a mesma versão; mudança gera a próxima. **Sem leitura direta da tabela:** só funções (`presentation_ebook_options/generate/get`, `my_ebook`).
- **Limites:** o e-book é uma proposta informativa; não é contrato nem cobrança. PDF = impressão do navegador (CSS de impressão A4). Revisão jurídica dos textos de consentimento/valores continua pendente.

## Observações
- A fisioterapeuta de QA usa um profissional de testes antigo ("Fisio E2E …"), por isso o nome aparece assim no e-book; em produção é o nome do profissional.
- Para qualquer outra organização o e-book usa a marca dela (nome/logotipo/cor) e o endereço `/empresa/<slug>/login`.
