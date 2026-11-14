# Área do paciente — jornada visual e demonstração para a consulta

> Pedido do proprietário (14/11/2026), com a referência visual aprovada: reformular a área do paciente (composição, hierarquia, gráficos, jornada) e criar uma **demonstração interativa** para o fisioterapeuta apresentar o acompanhamento durante a consulta. **Somente Dev** (sem merge, produção ou DNS). Capturas em `docs/screenshots/paciente-jornada/` (`antes-*` e as novas).

## O que mudou no portal real (`/paciente`)
O Início passou a responder a três perguntas — **Como estou?** (dor e atividades), **O que faço agora?** (próxima ação, exercícios, semana) e **Qual é meu próximo passo?** (jornada, consulta, reavaliação) — com cards compactos em azul-marinho, azul suave, lilás e âmbar (sem verde), claro e escuro:
- **Saudação + objetivo + “O que fazer agora”**: o objetivo é a meta ativa registrada pelo fisioterapeuta; a próxima ação vem só do que está registrado (check-in da semana → treino de hoje → confirmar presença → decisão da reavaliação → próxima consulta). Não prescreve, não cobra, não culpa.
- **Minha jornada de recuperação**: etapas **definidas pelo fisioterapeuta** (ex.: Avaliação, Cuidado inicial, Movimento, Atividades, Reavaliação) e **etapa atual registrada por ele**. Nada avança por número de sessões. Sem etapas definidas: estado honesto.
- **Como minha dor mudou**: gráfico (escala 0–10, datas, valores) só com registros reais; **um único registro não vira tendência**; linha reta entre registros (sem suavização); texto “não é previsão de recuperação”.
- **Atividades que quero retomar**: só as atividades cadastradas e avaliadas (escala 0–10 registrada), com início → agora e marcador do ponto de partida; **sem percentual de recuperação**.
- **Exercícios em casa**: cards com orientação prescrita; “Assistir” × “Registrar que fiz” são coisas diferentes; “Vídeo indisponível” enquanto não houver vídeo.
- **Minha semana**: segunda a domingo (fuso de São Paulo) com consultas **agendadas / realizadas / canceladas ou falta** separadas dos **treinos informados pelo paciente**, e a meta semanal combinada.
- **Próxima consulta** (com Confirmar presença/Cancelar pelas **mesmas regras** de antes — a consequência é avisada antes), **Sessões e pacote** (plano clínico, realizadas, consumidas sem atendimento e saldo do pacote: **quatro coisas separadas**; “—” quando não há plano/pacote), **Para entender seu acompanhamento** (conteúdos aprovados pelo fisioterapeuta), **Última reavaliação** e **Próximo passo para você** (ofertas do administrador, só com consentimento comercial).
- **Sem dados**: “Seu acompanhamento está começando” (o que a avaliação vai preencher + ações realmente disponíveis) com placeholders honestos; **nenhum gráfico, meta, etapa ou zero clínico inventado**. A data de nascimento virou um “Primeiro passo” claro; as regras de idade, responsável e acesso continuam as do servidor.
- As abas **Evolução** e **Agenda** reaproveitam os mesmos componentes (jornada, dor, atividades, semana) acima dos formulários existentes (check-in, registrar dor/atividade, confirmar/cancelar).
- Layout por **largura do próprio container** (container queries): desktop em grade de 12 colunas, tablet em 2 colunas, celular empilhado com barra inferior; sem rolagem lateral; foco visível; movimento reduzido respeitado.

## O que o fisioterapeuta ganhou (Acompanhamento › Meus pacientes › paciente)
- **Jornada e conteúdos do paciente**: define as etapas (3 a 7, com sugestão padrão) e a **etapa atual** (histórico de mudanças); publica/revoga **conteúdos educativos** por tema (objetivos, papel da rotina, preparação para reavaliações, autonomia e alta) — texto escrito e aprovado por ele; o sistema não gera conteúdo, prescrição nem prazo de cura.
- **Apresentar acompanhamento**: abre a demonstração.

## Demonstração interativa (`/fisio/apresentar`, só fisioterapeuta)
- Usa os **mesmos componentes** do portal real, alimentados por **exemplos ilustrativos** (Início, Acompanhamento e Reavaliação) — nunca dados de ninguém. Faixa permanente **“DEMONSTRAÇÃO — Dados ilustrativos”** (também dentro do app).
- Abas Início, Evolução, Exercícios, Agenda e Mais; tour guiado de 8 passos com **Avançar, Voltar e Sair** (destaca o bloco explicado) ou navegação livre; no computador, **moldura de celular** (ou tela cheia); no tablet e no celular, a tela inteira com os controles recolhidos.
- **Isolamento total**: não chama o banco, não grava nada (nem no navegador), não envia mensagem. Confirmar/cancelar/“Registrar que fiz”/“Assistir” são simulações locais (o teste confere que **nenhuma chamada de gravação** sai e que o banco não muda). Nome e objetivo digitados ficam **só na memória** da tela e somem ao sair ou trocar de paciente; o primeiro nome vem do estado da navegação (nunca da URL).
- “**Preparar acompanhamento real**” volta à ficha do paciente (fluxo existente, revisão do fisioterapeuta); **nada** dos dados fictícios é copiado e nenhuma cobrança é gerada.

## Banco (migration 129, aditiva)
`patient_plans.journey_stages / journey_stage / journey_stage_at`, `plan_stage_events` (histórico), `patient_education`; funções `plan_journey_set`, `prof_journey_plan`, `my_journey_plan`, `education_publish`, `education_revoke`, `my_education`, `prof_education`. Mesma privacidade da jornada: só o próprio paciente (ou representante com escopo de evolução) e o fisioterapeuta **com vínculo**; gestor, comercial e financeiro não escrevem; tabelas sem acesso direto (RLS, sem GRANT).

## Testes
SQL `N16` (29), unitário `model.test.ts` (11), E2E `N34` (8: portal com dados e sem dados, atualização após registro do fisioterapeuta, isolamento, demonstração isolada, tablet/celular, tema escuro e contraste ≥ 4,5, movimento reduzido, teclado, permissões) + regressão de portais (R03–R05, R09, R16, R30, R35–R38, R40, R41, 01, 06). Um teste antigo mudou por **mudança intencional**: R40 (o resumo do treino de hoje agora diz “Registrado hoje: N de M”).

## O que NÃO foi provado / limites
- **Vídeos de exercício**: o campo existe, mas não há vínculo entre exercício e vídeo Bunny e nenhum vídeo real foi gravado; os cards mostram “Vídeo indisponível”. Os vídeos privados já atribuídos pelo fisioterapeuta (Bunny) aparecem como “Vídeos do seu fisioterapeuta” e dependem da chave/biblioteca do Bunny (pendente, ver `jornada-do-paciente.md`). Os “vídeos de demonstração aprovados” da apresentação são um **marcador ilustrativo** até existirem vídeos aprovados.
- **Envio real de e-mail/push** (lembretes) e a **revisão jurídica** dos textos continuam pendentes (ver `portais-paciente-e-fisio.md`).
- Não é app nativo: é a mesma web (PWA). Os componentes recebem um modelo e não consultam o banco, o que prepara a evolução para app.
- Sem **produção**: nada foi mesclado nem promovido.
