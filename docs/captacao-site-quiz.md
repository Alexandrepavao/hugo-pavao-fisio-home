# Captação pelo site: botões → quiz (paciente e fisioterapeuta)

> Migrations `20260930000081_quiz_programa_clinica.sql` e `20260930000082_quiz_step_reached_limit.sql` (aplicadas no Dev) · testes: E2E `e2e/release/R25-captacao-botoes-quiz.spec.ts` (5), `e2e/08-lead-quizzes.spec.ts`, `e2e/09-cta-block-quiz-target.spec.ts`, `R03` · capturas em `docs/screenshots/quiz/`.

## Regra

**Nenhum botão do site abre o WhatsApp direto.** Todos levam ao quiz da jornada certa, cuja **1ª etapa captura nome completo, e-mail e WhatsApp** (o lead é gravado ali, em `quiz_start`, com a página de origem e a campanha). O WhatsApp só aparece no fim, depois do cadastro e das respostas, com o número configurado no banco (`quiz_whatsapp_numbers`).

| Botão | Jornada | Destino |
|---|---|---|
| Cabeçalho “Agendar Avaliação” (desktop e menu do celular), Hero “Agendar minha avaliação”, Cobertura “Consultar disponibilidade…”, botão flutuante, rodapé “Pacientes / Agendamentos” | paciente (`atendimento`) | `/avaliacao?from=<página>` |
| “Quero fazer parte” (página Trabalhe Conosco e bloco WorkWithUs), botão flutuante em Trabalhe Conosco, rodapé “Fisioterapeutas / Trabalhe Conosco” | fisioterapeuta (`parceria`) | `/seja-parceiro?from=<página>` |

- A decisão de paciente × fisioterapeuta vem do **botão** (cada botão já tem público definido); não há pergunta “quem é você?”. Se algum dia houver um botão neutro, ele precisará de uma escolha antes do quiz (o servidor exige a jornada em `quiz_start`).
- Dado pessoal **nunca** vai na URL: só `from` (rota) e os parâmetros de campanha permitidos. Os números `(11) 95907-5351` e `(11) 91363-4424` continuam no rodapé como informação de contato, mas o clique leva ao quiz.
- `src/lib/useStartJourney.ts` é o ponto único dos botões; `openPaciente`/`linkPaciente` e equivalentes foram removidos.
- **Nome completo** (nome e sobrenome) é exigido na tela (`isFullName`); e-mail válido, WhatsApp com DDD e autorização de contato continuam obrigatórios. Observação: a exigência de sobrenome é só da interface (a API pública `quiz_start` segue aceitando qualquer nome com 2+ caracteres).

## Interface do quiz

Duas colunas no desktop (apresentação e motivos para responder + formulário), uma coluna no celular; barra e “Etapa X de N”; **Voltar** (reabre a etapa anterior com a resposta já dada; a etapa de contato não volta porque o cadastro já foi gravado); respostas em cartões com seleção visível; escala 0–10 em uma linha (cabe em 390 px); multi-seleção marcável; tela final com protocolo, prévia da mensagem e “Continuar pelo WhatsApp”. Textos das perguntas já existentes foram preservados.

## Quiz do fisioterapeuta: perguntas novas (finais)

1. **`interesse_programa_clinica`** — “No futuro, se existisse um programa de ensino para você ter a sua própria clínica, você teria interesse?” Com explicação: do posicionamento de marca à implementação de um sistema de gestão 360, com potencial de faturamento mensal de 5 dígitos ou mais; tópicos (marca e proposta de valor; precificação, captação e vendas; gestão 360; implementação do sistema). Opções: *Sim, teria interesse* · *Quero entender melhor como funcionaria* · *Não neste momento*.
2. **`prazo_programa_clinica`** — “Se esse programa existisse, quando você gostaria de começar?” (*Nos próximos 3 meses* · *Entre 3 e 6 meses* · *Em mais de 6 meses* · *Ainda não sei*). **Só aparece com interesse**; “Não neste momento” a dispensa e o total de etapas diminui (11 → 10).

**Honestidade do texto:** o programa **ainda não existe** e a tela diz isso (“sua resposta nos ajuda a avaliar se faz sentido criá-lo; não há inscrição nem cobrança”). O faturamento é apresentado como **potencial**, com a ressalva de que depende de dedicação, região e execução e **não há garantia**. Nada é vendido ou cobrado por essa pergunta.

Servidor: `private.quiz_validate_answer` aceita só as chaves e valores listados; `quiz_complete` exige `interesse_programa_clinica` e, havendo interesse, `prazo_programa_clinica`. Migration 082: `quiz_leads.step_reached` passa de 1..10 para 1..20 (as 8 perguntas levam a etapa a 12 e o limite antigo recusava a resposta; achado pelo E2E). As respostas aparecem no painel de Captação de leads (`get_quiz_lead_detail`) e entram na mensagem de WhatsApp (“Interesse em programa para ter a própria clínica…”, “Quando gostaria de começar…”).

## Limites conhecidos

- A tag/segmento **“Potencial Academy”** continua sendo atribuída a **todo** lead de parceria (comportamento anterior, não alterado). A resposta nova é o sinal real de interesse; usá-lo para refinar o segmento é decisão de produto pendente.
- O `R01` teve só os rótulos dos campos do quiz atualizados e **não foi reexecutado** nesta rodada: depende do token de gestão do Dev, que hoje não tem permissão de leitura de banco.
- O quiz limita 8 inícios por 10 minutos por IP e jornada (proteção existente): baterias de teste seguidas podem esbarrar nisso.
