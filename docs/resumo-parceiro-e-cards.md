# Resumo do parceiro nos cards, tag de área e resumo da experiência no formulário

> Pedido do usuário (13/11/2026): (1) criar um **resumo** nos cards do lead de parceiro; (2) a tag `quiz:academy` passa a mostrar **“Quiz: Academy”**; (3) na tag do fisioterapeuta parceiro, mostrar a **área de atuação ou de interesse**; (4) no fim do formulário de parceria, pedir um **resumo da experiência profissional**; (5) **capturar tudo que for respondido, mesmo que a pessoa pare no meio**. A tag de área vai virar filtro depois (cruzar área × cidade × região).

## O que mudou
- **Formulário de parceria (/seja-parceiro):** nova última pergunta, **opcional**: “Conte, em poucas linhas, sua experiência profissional” (caixa de texto, até 1000 caracteres, com contador). Quem não quer escrever segue em branco.
- **Captura progressiva (só parceria):** o que a pessoa marca ou digita na pergunta atual é gravado **sozinho** (cerca de 1 s depois, e ao fechar/esconder a página), sem precisar clicar em Continuar. Nome, e-mail e WhatsApp já eram gravados na 1ª etapa, a cidade na 2ª e cada resposta ao avançar; quem para no meio fica como “Parou no meio” com tudo que respondeu. Respostas incompletas (ex.: CREFITO sem número) não são gravadas até ficarem válidas.
- **Tag da área ao lado do tipo** (“Fisioterapeuta · HP Academy” **[Neurológica]**): ficha da oportunidade, cards do Kanban, Gestão de leads, resumo do lead (modal) e “Respostas de captação”. Quando a pessoa marca “Outra” e escreve a área, a tag mostra o que ela escreveu.
- **Resumo do parceiro:** bloco na ficha da oportunidade e no modal do lead (experiência, área, registro/CREFITO, como atende, o que busca, programa de clínica, cidade/UF e o **resumo da experiência**); no Kanban, tag + experiência + 2 linhas do resumo; em “Respostas de captação”, tag + experiência + resumo, e o status em português (Iniciado, Parou no meio, Concluído).
- **Origem legível:** `quiz:academy` → “Quiz: Academy”, `quiz:parceria` → “Quiz: Parceria”, `quiz:atendimento` → “Quiz: Atendimento”, `page:slug` → “Página: slug” (ficha, Kanban, Gestão de leads, modal, conversa, Relatórios e Dashboard do CRM). O valor gravado no banco **não muda** (relatórios e filtros continuam usando `quiz:academy`).

## Por dentro
- **Migration 126 (aditiva):** `quiz_validate_answer` aceita `resumo_experiencia` (1 a 1000 caracteres; só na jornada de parceria — a de paciente continua recusando) e `quiz_profiles(p_by, p_ids)` devolve o perfil do parceiro por pessoa ou por captação (nunca resposta de saúde; mesmas permissões e escopo de unidade da Captação).
- **Site:** `src/lib/quizProfile.ts` (hook `usePartnerProfiles`, `areaTag`, `sourceLabel`), `src/components/hp/PartnerSummary.tsx`, `QuizRunner` (caixa de texto, pergunta opcional e rascunho).
- A área vem da pergunta “principal área de atuação ou interesse” (`area_atuacao`) — a mesma que alimenta o filtro da Captação de leads (migration 125). **Próximo passo previsto:** filtro de área × cidade × região (zona/regional) no CRM.

## Limitações
- Só leads de **parceiro e HP Academy** têm tag e resumo; leads de paciente não (as respostas deles são de saúde e ficam restritas).
- Quem não respondeu a pergunta de área não ganha tag; o card só mostra o que existe.
- A captura progressiva vale para o formulário de **parceria**. No de paciente, as respostas continuam gravadas ao avançar (as de saúde só depois do consentimento).
- Fechar a aba pode, raramente, perder o último rascunho se o navegador cancelar o envio.
