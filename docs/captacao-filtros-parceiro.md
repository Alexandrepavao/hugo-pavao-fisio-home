# Captação de leads — filtros do lead de parceiro e isolamento dos formulários

> Pedido do usuário (13/11/2026): (1) no filtro do lead de parceiro, filtrar por **experiência profissional** e pela **área específica**; (2) conferir se quem preenche o formulário de **parceiro** também é salvo como **paciente** — um formulário não pode ser preenchido no outro.

## 1. Filtros (Comercial › Captação de leads)
- Aparecem em **Filtros** só quando o segmento é **Parceiros** ou **HP Academy** (as duas são a jornada de parceria). Em Todos/Pacientes não existem e, ao sair de Parceiros, são limpos.
- **Experiência profissional** = pergunta “Qual é seu momento profissional?”: Estudante · Formado iniciando atuação · Fisioterapeuta em atuação · Gestor ou proprietário de clínica.
- **Área de atuação** = pergunta “Qual é sua principal área de atuação ou interesse?”: Ortopedia · Esportiva · Neurológica · Geriátrica · Outra (a lista mostra o que a pessoa escreveu em “Outra”, ex.: “Outra — Fisioterapia pélvica”).
- Os dois se combinam entre si e com status, revisão, busca e estado; **o mapa do Brasil acompanha os mesmos filtros**. A tabela ganha a coluna “Experiência · Área” nos segmentos de parceiros e o resumo dos filtros ativos mostra o que está ligado.
- As opções vêm de `PARCERIA_QUESTIONS` (`src/lib/quiz.ts`), a mesma lista que o formulário e o servidor usam: se uma opção mudar lá, muda aqui.
- Banco (migration 125): funções **novas** `search_quiz_leads_v2` e `quiz_lead_geo_v2` (as da migration 087 ficam como estavam; nada foi removido). O filtro só enxerga captações da jornada de parceria, então paciente nunca aparece quando um dos dois está ligado. Mesmas permissões de antes (gestor, administrativo, gestor de unidade e comercial; fisioterapeuta e anônimo não).

## 2. Parceiro não vira paciente (verificação)
**Conclusão: o formulário de parceria não salva ninguém como paciente, e o de paciente não salva ninguém como parceiro.** Verificado no código, no Dev (teste N11 e E2E N31) e nos dados reais de produção (só leitura, 13/11/2026):
- **Código:** `quiz_start` escolhe o funil pela jornada (parceria → funil de Parceiros; atendimento → funil de Pacientes); `quiz_complete` só cria uma segunda oportunidade (HP Academy) quando o parceiro pede o programa de clínica própria; a pessoa recebe a marca “lead”, nunca “paciente”.
- **O servidor recusa a resposta de um formulário no outro:** `private.quiz_validate_answer` valida a chave da pergunta pela jornada (parceria não aceita `dor_intensidade`; paciente não aceita `area_atuacao`).
- **Produção:** 85 captações de parceria e 6 de paciente; **nenhuma** pessoa tem a marca “paciente”; só **4 pessoas** têm oportunidade nos dois funis, e as quatro **preencheram os dois formulários** (cada uma tem uma captação de parceria e uma de paciente). A mesma pessoa pode estar nos dois funis porque o CRM junta pelo contato (e-mail/telefone) — é a regra do CRM, não um vazamento entre formulários.
- Formulários de páginas do site (`submit_public_form`) usam o funil que o administrador escolheu para cada formulário; não há padrão “paciente”.

## Limitações
- O filtro de **estado/cidade** continua sendo o que a pessoa informou; “Experiência” e “Área” são as respostas do formulário (autodeclaradas, sem conferência de CREFITO).
- Quem iniciou o formulário e parou antes dessas perguntas **não tem** experiência/área e some quando um dos filtros está ligado.
- O mesmo filtro **ainda não existe** na “Gestão de leads” do CRM (lista de oportunidades por funil); as respostas estão na captação ligada a cada oportunidade.
