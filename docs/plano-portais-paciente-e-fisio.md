# Plano — Portal do Paciente e Portal do Fisio (web hoje, app amanhã)

> Status: **PLANO para aprovação (v2, com as respostas do proprietário incorporadas).** Nada foi construído, nenhuma migration foi criada, nada foi para o Dev nem para produção.
> Data: 2026-11-05 · Autor: Claude (a pedido do proprietário).
> Legenda de estado: ✅ já existe · 🟡 existe em parte · 🆕 novo · 🔒 depende de terceiro (Bunny, Resend, push, conteúdo).

## 0. Decisões já tomadas (respostas do proprietário)

| Tema | Decisão |
|---|---|
| Entrega desta rodada | **Só o plano.** Código e banco só depois da aprovação, começando pelo Dev. |
| Base atual | **Evoluir e reorganizar**: reaproveitar dados, permissões e testes; criar dois “shells” dedicados (Portal do Paciente e Portal do Fisio). Rotas antigas continuam por redirecionamento. |
| App de celular | **PWA primeiro** (mesmo código, instalável). Loja depois, empacotando com Capacitor, sem reescrever. |
| Evolução clínica | Medir por **dor (0–10)**, **amplitude e força**, **escalas funcionais** e **adesão aos exercícios**. |
| Comissão do fisio | Por **pacote fechado** (5 a 10 sessões). O **admin** cadastra, numa aba do admin, o valor da sessão/pacote/protocolo e a **parte do fisio**; o restante é da HP (exemplo: 160 → 100 fisio / 60 HP). Detalhes e pontos a confirmar no §5.4. |
| Vídeos | O **Hugo grava depois** e o **Bunny entra em funcionamento depois**. A biblioteca de exercícios nasce com texto e foto; o vídeo é opcional e se acopla depois sem refazer nada. |
| Especialidades | Ortopédica, Neurofuncional, Geriátrica, Respiratória, Pediátrica e Desportiva (§5.5). |
| Ranking entre fisios | **Oculto** para o fisio. |
| Programas e ofertas | **O admin decide tudo**: cria o programa, define o preço e escolhe a quem oferecer. O fisio não indica nem aprova. |
| Chamados | Paciente com **pagamento confirmado** abre **chamado interno** pelo site/app (hoje não existe; §4.5). |
| Menores, idosos e responsável | Haverá. Regras completas no §4.6. |
| Lembretes | **E-mail e push** agora. Canal **WhatsApp previsto no modelo, não implementado**. |

## 1. Ponto de partida (conferido no repositório, não de memória)

**Paciente (`/paciente`, papel `member`)** — ✅ próximos atendimentos, confirmar/cancelar conforme a política, pacote com 7 contagens separadas, histórico (100 mais recentes), jornada (objetivos, plano definido pelo fisio, gráfico com avaliações 0–10 de dor/funcionalidade/bem-estar, reavaliação com decisão), pedido de renovação só após reavaliação com continuidade/manutenção, 🟡 vídeos privados (autorização, revogação e isolamento provados; **reprodução real não provada**: faltam `BUNNY_EMBED_TOKEN_KEY` e a biblioteca no Bunny).
Arquivos: `src/pages/portal/Patient.tsx`, `Journey.tsx`, `PortalShell.tsx`; RPCs `my_journey`, `my_package_breakdown`, `my_assessment_add`, `my_renewal_request`, `video_playback_authorize`.

**Fisioterapeuta (papel `physio`)** — ✅ Meu dia (tarefas, calendário, Google Calendar), Agenda própria, Acompanhamento (Meus pacientes › Jornada do paciente: objetivos, plano, avaliações, reavaliação, vídeos), **Meu resumo** (agendados/realizados/faltas/cancelamentos/pacientes atendidos e **repasses autorizados e pagos**, sem nome de paciente).
Arquivos: `MySummary.tsx`, `Productivity.tsx`, `Care.tsx`, `JourneyPanel.tsx`; RPCs `my_professional_summary`, `professional_journey`, `patient_*_save`, `professional_assessment_add`.

**Comissão** — ✅ regras por produto/beneficiário/percentual, fato gerador = **recebimento**, estados pendente → autorizada → paga (+ estorno), idempotente (`docs/repasses.md`).

**Privacidade clínica** — **hoje (código atual)**: dado clínico só o **próprio paciente** e o **fisio com vínculo assistencial ativo** leem; gestor, administrativo, comercial e financeiro **não** leem, nem por SQL (RLS), nem por função (testes S07/S15 provam isso). **Decisão do proprietário (05/11): o admin, como dono da clínica, lê dado clínico.** Isso **muda essa regra**: exige migration nas políticas e funções de leitura clínica e a revisão dos testes que hoje provam o contrário. **Desenho proposto**: a leitura clínica passa a valer para o **papel gestor (dono)**; adm. operacional, gestor de unidade, comercial e financeiro **continuam sem** (confirmar no §9); o acesso é **somente leitura** (registro clínico segue sendo escrito só pelo fisio, imutável); **todo acesso do admin a um prontuário é registrado** (quem, quando, qual paciente, qual tela) e o paciente/fisio podem ver “quem acessou” — é o que sustenta a base legal e a prestação de contas (LGPD). Toda escrita continua passando por função que valida permissão.

**O que NÃO existe e este plano cria** — biblioteca de exercícios e prescrição (“MFIT”), check-in de exercícios em casa, medidas objetivas (amplitude/força) e escalas funcionais, linha do tempo por consulta, registro rápido pós-sessão, alertas de risco, programas/ofertas (upsell), KPIs do fisio além do resumo, extrato de comissão com previsão, PWA (hoje não há manifest nem service worker), notificações.

## 2. Princípios

1. **Um backend, duas telas.** Toda leitura/escrita da área logada passa por **RPCs com contrato estável** (não por tabelas direto no componente). O app futuro usa as mesmas RPCs.
2. **Mobile-first, PC de verdade.** Cada tela é desenhada primeiro a 390 px (polegar, barra inferior) e ganha um layout próprio no PC (barra lateral, 2–3 colunas, tabelas densas), não só “esticada”.
3. **Dado real ou “sem dados”.** Nada de número inventado, extrapolado ou “promessa de resultado”. Melhora clínica é avaliação do fisio (já é regra do projeto).
4. **Não armazenar o que se deriva.** Médias, sequências, adesão %, Δ de dor e KPIs são calculados em RPC a partir dos registros; só se guarda o fato (medida, check-in, prescrição).
5. **Registros clínicos imutáveis** (corrigir = novo registro), com autoria e data.
6. **Oferta decidida pelo admin.** O admin cria o programa, define o preço e escolhe a quem oferecer, com base nos sinais administrativos e nos dados clínicos que ele pode ler (§4.4). Só recebe oferta quem deu o **consentimento de comunicação comercial**. Nada de cobrança ou consumo automático, e a linguagem nunca promete resultado clínico. *(Uso de dado de saúde para direcionar oferta: validar com o jurídico.)*
7. **Dev primeiro; produção só pelo `promover`** (regra permanente). Migrations aditivas; sem DROP/DELETE de dado existente.

## 3. Arquitetura (pensada para virar app)

### 3.1 Rotas e shells
- `/paciente/*` — **PatientShell** (papel `member`): barra inferior no celular, barra lateral no PC.
- `/fisio/*` — **PhysioShell** (papel `physio`; o admin pode “ver como” fisio para conferência, em leitura, com acesso registrado).
- Redirecionamentos: `/admin/meu-dia`, `/admin/meu-resumo` e `/admin/acompanhamento` seguem funcionando para o fisio (compatibilidade e testes atuais), e o menu do fisio passa a apontar para `/fisio/*`. O portal atual `/paciente` vira a “Início” do novo shell.
- Login único existente; após entrar, o papel decide o destino (`member` → `/paciente`, `physio` → `/fisio`). Quem tem os dois papéis escolhe.

### 3.2 Camadas (o que torna o app barato depois)
```
UI (páginas/componentes)  →  hooks por tela (usePatientHome, useEvolution, useTodayWorkout, usePhysioHome …)
                          →  camada de dados: SOMENTE supabase.rpc('…')   ← contrato versionado (docs/contrato-rpc-portais.md)
                          →  banco: RLS + funções security definer (set search_path = '')
```
- Sem regra de negócio nos componentes; sem `from('tabela')` nas telas novas.
- Tipos TS gerados/escritos uma vez e compartilhados (um app React Native ou Capacitor reaproveita os hooks).
- Todas as ações que alteram dado levam **chave de idempotência** (toque duplo/rede ruim no celular não duplica check-in nem avaliação).

### 3.3 PWA (fase 1) e caminho para a loja
- Manifest, ícones, tela de abertura, `display: standalone`, service worker (`vite-plugin-pwa`) com cache do “casco” do app e dos últimos dados; **treino do dia e agenda funcionam offline** (leitura) e o check-in fica numa fila local enviada quando voltar a rede (com idempotência).
- Botão “Instalar o app” (Android) e instrução de “Adicionar à Tela de Início” (iPhone).
- Push web: Android ok; **iPhone só com o app instalado na tela inicial (iOS 16.4+)**. Por isso o lembrete por WhatsApp/e-mail continua como alternativa.
- Loja (fase 6): Capacitor empacota o mesmo build; biometria e push nativo entram aí. Exigências a prever desde já: **exclusão de conta dentro do app**, política de privacidade e tela de consentimento (dado de saúde é sensível na LGPD).

### 3.4 Segurança e privacidade
- Travas de hoje mantidas (vínculo assistencial, RLS, sem GRANT de escrita), **com a exceção decidida pelo proprietário**: leitura clínica pelo admin (papel gestor), com registro de acesso. Cada tabela nova nasce com RLS e teste de isolamento (paciente A não vê B; fisio sem vínculo não vê; adm. operacional, comercial e financeiro não leem clínico; **gestor lê e o acesso fica registrado**).
- **Consentimentos** registrados: tratamento de dado de saúde, uso de vídeos/fotos, e **separado** o consentimento para receber ofertas/comunicação comercial (upsell).
- Vídeos de exercício: continuam privados via Bunny com link assinado de curta duração (`bunny-playback`).
- 🔒 Validar com o jurídico: guarda e acesso a prontuário/evolução (normas do COFFITO/CREFITO), publicidade em saúde e textos de consentimento.

## 4. Portal do Paciente

### 4.1 Navegação (celular: 5 abas · PC: barra lateral)
1. **Início** · 2. **Evolução** · 3. **Treinos** · 4. **Agenda** · 5. **Mais** (pacote, mensagens com a equipe, perfil, consentimentos, notificações, ajuda).

### 4.2 Telas

**Início** 🆕 (compõe dados existentes)
- Próxima consulta (com confirmar/cancelar e aviso da política) · **Treino de hoje** (1 toque para começar) · sequência de dias · dor hoje vs. início do tratamento · meta principal e % · recado do fisio · “Próximo passo” (só quando houver recomendação do fisio — ver §4.4).

**Evolução** 🆕 — “exatamente a evolução que ele terá com as consultas”
- **Linha do tempo por consulta**: nº da sessão (ex.: 4 de 10), data, fisioterapeuta, dor antes/depois, o que foi feito (resumo escrito pelo fisio para o paciente), nota ao paciente, marcos.
- **Gráficos** (um por medida, mesma escala do início ao fim): dor 0–10; amplitude de movimento (graus, lado D/E); força/teste funcional; escala funcional (valor + faixa); adesão semanal aos exercícios.
- **Início × agora** em cartões (“Dor 8 → 3”, “Flexão do joelho 90° → 120°”), sempre com data e autoria (paciente ou fisio).
- **Metas funcionais do paciente** (“voltar a subir escadas”, “correr 5 km”): nota 0–10 por atividade ao longo do tempo — é o dado mais emocional e o que melhor sustenta retenção.
- **Reavaliações** com a decisão (continuidade / manutenção / alta) e a mensagem do fisio (já existe).
- Estados vazios honestos: “Sua primeira medida aparece depois da avaliação”.

**Treinos (estilo MFIT)** 🆕 🔒 (conteúdo e Bunny)
- **Plano do fisio** organizado em treinos (A, B, C…) com exercícios: vídeo curto, séries × repetições / tempo, carga, descanso, dicas e “o que sentir / quando parar”.
- **Treino de hoje** + próximos dias; tela de execução com vídeo em loop, contador de séries, cronômetro de descanso, “fiz / pulei / senti dor”.
- Ao concluir: **esforço percebido (0–10)**, **dor durante (0–10)** e comentário opcional → vai para o fisio. Dor alta dispara alerta ao fisio (nunca ao paciente com “diagnóstico”).
- Progresso: calendário de treinos feitos, sequência, % do prescrito na semana.
- Offline: baixa o treino do dia; sincroniza depois.
- Biblioteca de exercícios **só leitura** para o paciente (os atribuídos a ele).

**Agenda** ✅ (existente, reorganizada): próximos, histórico, confirmar/cancelar, política antes de cancelar.
**Mais → Pacote** ✅: as 7 contagens separadas + “Quero renovar” (só após reavaliação) + falar com a equipe.
**Mais → Chamados** 🆕: só para paciente com pagamento confirmado (§4.5). **Mais → Quem está usando** 🆕: troca de perfil quando há responsável/cuidador (§4.6).

### 4.3 KPIs do paciente (o que ele enxerga) — todos derivados
| KPI | Cálculo | Fonte |
|---|---|---|
| Sessões realizadas / plano | realizadas ÷ planejadas pelo fisio | `my_package_breakdown`, plano ✅ |
| Dor: início → atual (Δ) | primeira × última medida de dor, e média das últimas 4 semanas | avaliações + pré/pós-sessão 🆕 |
| Amplitude / força | primeira × última medida por articulação e lado | medidas do fisio 🆕 |
| Função (escala) | pontuação × faixa do instrumento | reavaliação 🆕 |
| Progresso da meta | % entre valor inicial e valor-alvo definido pelo fisio | metas ✅ + medidas 🆕 |
| Adesão semanal | treinos feitos ÷ prescritos | check-ins 🆕 |
| Sequência (dias) | dias seguidos com treino em dia | check-ins 🆕 |
| Consistência de comparecimento | presenças ÷ consultas marcadas | agenda ✅ |
| Dias sem crise | dias desde a última dor ≥ limite definido | avaliações 🆕 |

### 4.4 Ideias de KPIs e recursos que geram diferencial, LTV e upsell
Divididas pelo efeito. **Ver sempre com o fisio no circuito**: o que vira oferta é decisão clínica.

**A) Percepção de valor (o paciente “vê” o resultado → fica e indica)**
1. **Início × agora** com data e autoria (acima).
2. **“O que eu voltei a fazer”**: metas de atividade escolhidas pelo paciente, com nota 0–10 ao longo do tempo (conceito de escala funcional específica do paciente, estilo PSFS).
3. **Mapa corporal da dor**: o paciente toca onde dói; a mancha encolhe ao longo das semanas.
4. **Marcos**: “1ª semana sem dor à noite”, “subiu escada sem dor”, “10 treinos em casa”. Calculados, nunca inventados.
5. **Relatório de evolução em PDF** (para médico, convênio ou empresa) — gera confiança e é o tipo de coisa que a concorrência não faz.
6. **Resumo do mês (“Seu mês”)** em tela privada; compartilhamento só se o paciente escolher e sem dado sensível.

**B) Retenção (reduz abandono no meio do tratamento)**
7. **Check-in semanal de 20 segundos** (2–3 perguntas): alimenta tudo e mantém o vínculo entre consultas.
8. **Sequência e metas de adesão** sem gamificação infantil (sobriedade combina com saúde).
9. **Alerta de risco de abandono** (só para o fisio e a recepção, não para o paciente): faltas, adesão caindo, dor subindo, plano acabando sem reavaliação marcada.
10. **Lembrete antes da consulta e do treino** (push/WhatsApp/e-mail), respeitando o consentimento.

**C) LTV e upsell ético (programas futuros encaixam sem reprogramar)**
11. **Catálogo de programas** (`care_programs`), **cadastrado, precificado e liberado pelo admin** (preço e parte do fisio no mesmo cadastro do §5.4): manutenção mensal, prevenção, fortalecimento, geriatria, pós-alta trimestral, protocolo que ainda será criado… cada programa com **critérios de elegibilidade administrativos** (ex.: pacote encerrado; 30 dias sem atendimento; especialidade = geriátrica).
12. Cartão **“Próximo passo para você”** no Início: aparece **somente** para programas que o **admin liberou para aquele paciente** (e se houver consentimento comercial). O fisio não indica nem aprova ofertas. Botão “Tenho interesse” cria tarefa para o admin/comercial.
13. **Janela de alta**: ao atingir a meta, o portal mostra o que foi conquistado e propõe a manutenção (momento de maior disposição para continuar).
14. **Check-up periódico** (3/6 meses após a alta): reativa o paciente com avaliação rápida e comparação com a alta.
15. **Indicação**: “convide alguém” reaproveitando o módulo de Parceiros/indicação existente.

**Como o admin decide a quem oferecer**: usa **sinais administrativos** (pacote encerrado ou perto do fim, sessões restantes, dias desde o último atendimento, especialidade, histórico de compras) **e os dados clínicos que já pode ler** (alta ou meta atingida, adesão, tempo desde a última medida). As regras de elegibilidade ficam cadastradas no programa e **cada oferta guarda o critério usado**. Limites: só com consentimento de comunicação comercial; texto descritivo, sem promessa de resultado; uso de dado de saúde para direcionar oferta vai ao jurídico.

**D) KPIs de gestão que o portal passa a alimentar** (agregados, nunca dado clínico individual)
Taxa de renovação / segundo ciclo · tempo até a recompra · sessões por paciente · adesão × retenção · LTV por origem, por fisio e por protocolo · conversão de “Tenho interesse” em venda · NPS pós-alta · abandono por etapa do plano.

### 4.5 Chamados internos (paciente com pagamento confirmado) 🆕
Hoje **não existe** módulo de chamados: a Central de Conversas do CRM é da equipe com leads, registro manual, sem entrada do paciente. Cria-se um canal próprio.

- **Quem pode abrir**: paciente (ou seu responsável, §4.6) com **ao menos um pagamento confirmado** de sessão, pacote ou protocolo. A elegibilidade é **calculada** a partir dos recebimentos (nada de flag guardada que fique desatualizada); estorno total sem outro pagamento fecha a abertura de novos chamados, mas o histórico continua visível.
- **Categorias**: Agenda/remarcação · Pagamento/pacote · Dúvida sobre treino ou orientação (clínica) · Problema técnico · Outro.
- **Privacidade**: chamado **clínico** é lido pelo paciente/responsável, pelo **fisio com vínculo** e pelo **admin (dono)**, com acesso registrado; chamado **administrativo** é lido pela equipe (recepção/adm. operacional/gestor de unidade) e pelo admin. Financeiro e comercial **não** leem texto clínico. A categoria é escolhida pelo paciente e pode ser reclassificada pela equipe, o que muda quem enxerga.
- **Fluxo**: Aberto → Em atendimento → Aguardando paciente → Resolvido (reabrir em 7 dias). Mensagens com anexos (foto, PDF) em bucket **privado**. Notas internas que o paciente não vê.
- **Aviso fixo**: “Este canal não é para urgências. Em emergência, ligue 192 (SAMU).” Chamado clínico com palavras de alerta (dor forte, falta de ar etc.) mostra o aviso de novo, sem tentar diagnosticar.
- **Notificação**: e-mail e push ao paciente em cada resposta; à equipe/fisio na abertura. WhatsApp: canal previsto, não implementado.
- **Para a gestão (agregado)**: volume por categoria, tempo até a 1ª resposta, tempo de resolução, chamados abertos por unidade/fisio. Chamado administrativo gera tarefa para o responsável (mecanismo de tarefas que já existe).
- **Atendimento e prazo**: fila **“Suporte Humanizado da HP”**; promessa de **primeira resposta em até 24 horas** (aparece para o paciente ao abrir o chamado). O sistema mede o prazo, alerta a equipe quando restar 25% e marca “fora do prazo”. Chamado clínico notifica o fisio vinculado e, sem resposta em 12 h, escala ao admin da fila (proposta). O prazo é de **24 horas corridas** para chamado clínico e **24 horas úteis** para o administrativo.
- **Abuso**: limite de chamados abertos por paciente e de mensagens por minuto; tamanho e tipo de anexo restritos.

### 4.6 Menores de idade, idosos, cuidadores e responsável legal 🆕
**Premissa**: dado de saúde é sensível (LGPD art. 11) e o de criança/adolescente exige consentimento específico de ao menos um dos pais ou responsável legal e atenção ao melhor interesse (LGPD art. 14). **Estas regras precisam passar pelo jurídico antes de produção com dado real.** Aqui está o desenho técnico e de processo.

**Quatro situações, tratadas de forma diferente**
| Situação | Quem é o titular | Quem age no app | Observação |
|---|---|---|---|
| **A. Criança (< 12 anos)** | a criança | **responsável legal** (pai, mãe, tutor) com conta própria | A criança **não tem login**. Treino é executado com o responsável (pediatria). |
| **B. Adolescente (12 a 17 anos)** | o adolescente | responsável legal; o adolescente pode ter **login restrito** (agenda e treino) **somente com autorização do responsável** | Consentimento, pagamento, cancelamento e chamado administrativo ficam com o responsável. Linguagem adequada à idade. |
| **C. Idoso capaz (60+)** | o próprio idoso | o idoso; pode **delegar** a um familiar/cuidador, com escopo e prazo, **revogável por ele a qualquer momento** | **Idade não cria representação.** Idoso é titular e decide. |
| **D. Pessoa sem capacidade de decidir** (por exemplo curatela, AVC grave, Parkinson avançado, paciente acamado) | o paciente | **representante legal** (curador/procurador/tutor) com **documento anexado e verificado**; sem documento, só **cuidador/acompanhante** com escopo operacional | Quem consente é o representante legal, nunca o cuidador. A avaliação de capacidade não é do app: é do fisio/jurídico e fica registrada como observação. |

**Tipos de vínculo e o que cada um pode fazer** (cada permissão é uma coluna do vínculo, escolhida no cadastro e editável pela equipe/pelo titular conforme o caso):
| Permissão | Responsável legal | Representante legal (curatela/procuração) | Cuidador / acompanhante | Adolescente (login restrito) |
|---|---|---|---|---|
| Ver agenda, confirmar presença | ✅ | ✅ | ✅ | ✅ |
| Cancelar/remarcar | ✅ | ✅ | ⚙️ se delegado | ❌ |
| Executar e registrar treinos | ✅ | ✅ | ✅ | ✅ |
| Ver evolução e medidas | ✅ | ✅ | ⚙️ se delegado | ✅ (sem nota restrita) |
| Pacote, pagamentos, renovação | ✅ | ✅ | ❌ | ❌ |
| Abrir chamado | ✅ | ✅ | ⚙️ administrativo | ⚙️ só com autorização |
| **Dar ou revogar consentimentos** | ✅ | ✅ | ❌ | ❌ |
| Receber notificações | ✅ | ✅ | ⚙️ | ⚙️ |

**Regras (viram validação no servidor e teste)**
1. **Data de nascimento obrigatória** para quem terá acesso (hoje `people.birth_date` é opcional). Paciente < 18 **não ativa acesso** sem pelo menos um responsável legal cadastrado e **verificado**.
2. **Cada pessoa tem login próprio.** Proibido compartilhar a senha do paciente com o responsável: o responsável entra com a **própria conta** e vê o(s) paciente(s) a quem está vinculado, com troca de perfil (“Quem está usando?”). Banner permanente “Você está agindo em nome de …”.
3. **Vínculo** (`care_representations`): paciente, representante, tipo, escopo, vigência, estado (pendente → verificado → revogado/expirado), documento (certidão, procuração, termo de curatela) em armazenamento **privado**, quem verificou e quando. **Só o admin verifica**; o acesso total só vale com o vínculo **verificado** (antes, no máximo agenda e confirmação por convite temporário, se o proprietário permitir).
4. **Consentimento em nome de outro**: registra **quem consentiu, em nome de quem, texto e versão, data/hora, IP e dispositivo**. Consentimento de dado de saúde, de uso de imagem/vídeo e de comunicação comercial são **separados** e revogáveis; sem o consentimento comercial **não há ofertas** (§4.4 C).
5. **Maioridade automática**: aos 18 anos (calculado da data de nascimento), o acesso do responsável é **suspenso** e o paciente é convidado a assumir a conta e **reconfirmar os consentimentos**; ele escolhe o que o antigo responsável continua vendo. Idoso que delega pode encerrar a delegação quando quiser.
6. **Mais de um responsável** (pai e mãe): ambos veem; basta um para consentir; revogar um não revoga o outro; divergência/disputa vai ao admin e **o acesso fica suspenso até a decisão** (sem o app escolher lado).
7. **Ressalva clínica**: o fisio pode marcar um registro como **“não exibir ao responsável”** (por exemplo, situação sensível de adolescente). A nota clínica restrita já é invisível ao paciente e continua assim.
8. **Auditoria**: toda ação registra **o ator** e **em nome de quem**; o titular (quando maior e capaz) pode ver o histórico de acessos ao seu prontuário.
9. **Notificações**: lembrete de consulta e de treino vão a quem **executa** (responsável/cuidador); cobrança e renovação só a quem tem permissão financeira.
10. **Ações sensíveis** (consentir, revogar, cancelar plano, excluir conta) exigem **reautenticação** (senha ou link por e-mail).
11. **Exclusão de conta** (exigência das lojas): o representante pode encerrar o **acesso**; o prontuário **não é apagado** (dever de guarda), apenas fica inacessível pelo app — prazo e regra de guarda a definir com o jurídico.
12. **Comissão, KPIs e financeiro não mudam**: o fisio continua vinculado ao **paciente**, e o pagador pode ser outra pessoa (responsável financeiro).

**Documentos exigidos (proposta — o admin confere, o jurídico valida)**
| Quem | Documentos | Observações |
|---|---|---|
| **Responsável legal de menor** (pai, mãe) | Documento oficial com foto e CPF do responsável · certidão de nascimento (ou RG) do menor que comprove a filiação · termo de responsabilidade e consentimento aceito no app | Se os pais forem separados e houver divergência, exigir a decisão de guarda. |
| **Tutor ou guardião legal** | Documento com foto e CPF · termo de tutela/guarda (decisão judicial) | — |
| **Familiar sem guarda** (avó, tio, babá) | Documento com foto e CPF · autorização escrita e assinada por quem tem a guarda | Acesso só como **acompanhante** (§4.6 tabela); não consente. |
| **Curador** (paciente em curatela) | Documento com foto e CPF · termo/certidão de curatela | Ler o **alcance** da curatela no termo (pode ser limitada) e registrar o escopo conforme o documento. |
| **Procurador** | Procuração com poderes expressos para saúde/dados/contratação de serviços (firma reconhecida ou pública, conforme o jurídico) · documentos com foto do outorgante e do procurador | Procuração **não substitui** curatela. |
| **Cuidador/acompanhante** | Documento com foto · **autorização do paciente** (se capaz) ou do representante legal, aceita no app | Escopo operacional apenas (agenda, treino, avisos). |
| **Idoso que delega** | Aceite eletrônico do próprio idoso, com confirmação por e-mail | Revogável a qualquer momento. |

Conferência: o admin vê o **original na primeira consulta** ou confere a **imagem enviada**; o vínculo só fica “verificado” depois disso. Os documentos ficam em armazenamento privado, só o admin lê, com **validade/revalidação anual** e exclusão ao fim do prazo de guarda definido pelo jurídico (LGPD: coletar o mínimo necessário).

**Testes obrigatórios (SQL e E2E)**: responsável A não vê paciente de B; cuidador sem permissão não consente; vínculo não verificado não abre dado clínico; revogação e expiração cortam o acesso na hora; aos 18 anos o acesso do responsável é suspenso; adm. operacional/gestor de unidade/financeiro/comercial seguem sem ler dado clínico; **gestor (dono) lê e cada leitura gera registro de acesso**; toda escrita registra “em nome de”.

## 5. Portal do Fisio

### 5.1 Navegação (celular: 5 abas · PC: barra lateral)
1. **Início** · 2. **Pacientes** · 3. **Agenda** · 4. **Treinos** (biblioteca e prescrições) · 5. **Meu desempenho** (KPIs + comissão).

### 5.2 Telas

**Início** 🆕 — “meu dia”: atendimentos de hoje, **pendências** (evolução a registrar, reavaliação vencida, plano sem treino), **alertas de pacientes** (faltou, dor subindo, adesão caindo, pacote acabando) e a semana. Reaproveita Meu dia (tarefas/Google Calendar).

**Pacientes** 🟡 — só **os dele** (vínculo assistencial). Ficha: jornada ✅ (objetivos, plano, avaliações, reavaliação), linha do tempo por consulta 🆕, gráficos 🆕, prescrição atual 🆕, adesão 🆕, mensagens/recados 🆕, vídeos atribuídos ✅. Filtros: ativos, em risco, perto da alta, sem retorno.

**Registro rápido pós-sessão** 🆕 (otimizado para celular, 30 s): dor antes/depois, medida do dia (amplitude/força/escala), o que foi feito, recado ao paciente, próxima conduta. Cria a linha do tempo do paciente. Registro imutável; correção = novo registro.

**Treinos** 🆕 — **biblioteca de exercícios** da organização (vídeo, região do corpo, nível, equipamento, instruções, contraindicações) e **montador de prescrição** (séries, repetições, carga, descanso, frequência semanal, duração), com **modelos por condição** (ex.: lombalgia, pós-LCA) que o fisio personaliza por paciente. Vê check-ins, dor e comentários do paciente.

**Meu desempenho** 🟡/🆕
- **Comissão**: extrato (pendente / autorizado / pago / estornos / líquido) ✅, detalhamento por recebimento com regra, base e percentual — **nunca o nome do paciente** ✅; 🆕 visão por mês, “a receber nos próximos dias” (somente com regra e recebimento reais; sem regra → “Indisponível”).
- **KPIs do fisio**: ver §5.3.
- **Comissão por pacote fechado, valores definidos pelo admin**: ver §5.4 (muda o modelo de hoje, que é por percentual).

### 5.3 KPIs do fisio
| Grupo | KPI |
|---|---|
| Agenda | atendimentos agendados / realizados; faltas do paciente; cancelamentos; **taxa de comparecimento**; **ocupação** (horas ocupadas ÷ horas disponíveis) ✅ parte / 🆕 ocupação |
| Carteira | pacientes ativos; novos no período; em risco; perto da alta; sem retorno |
| Continuidade | taxa de renovação / continuidade; segundo ciclo; tempo médio do plano; taxa de alta com meta atingida |
| Resultado clínico (descritivo, sem “ranking”) | variação média de dor, amplitude e função dos seus pacientes por condição; % de pacientes com melhora clinicamente relevante (só quando o instrumento tem diferença mínima publicada e validada) |
| Engajamento | adesão média aos exercícios; % de pacientes com plano de treino ativo; comentários/dúvidas sem resposta |
| Qualidade | NPS / avaliação pós-sessão ou pós-alta (🆕); pendências de registro em atraso |
| Financeiro (dele) | comissão: pendente / autorizada / paga / estornada / líquida ✅; receita gerada pelos seus atendimentos (sem dado de paciente) 🆕 |
- **Decidido pelo proprietário**: o fisio **não vê ranking com colegas**; comparativos ficam só com o gestor/admin.
- Todo KPI com **fórmula visível** e **detalhamento até os registros** (padrão do projeto), reconciliando com o número.

### 5.4 Comissão por pacote fechado (valores definidos pelo admin) 🆕
**Regra do negócio (decidida)**: o paciente fecha um **pacote de 5 a 10 sessões** (ou sessão avulsa, ou protocolo). O **admin** define, **numa aba do admin**, o valor e a **parte do fisio**; o restante é da HP. Exemplo do proprietário: valor 160 → **100 do fisio, 60 da HP**. O fisio **não** define preço.

**Como está hoje** (conferido no código): `commission_rules` guarda só **percentual** (`percent_bp`) por produto; o lançamento nasce de cada **recebimento** e vai ao `beneficiary_user_id` da regra, ou ao **responsável da oportunidade** (comercial) quando a regra não tem beneficiário. `docs/repasses.md` registra que “não há valor fixo”. `client_packages` não guarda **qual fisio** atende o pacote (existe o vínculo assistencial `care_relationships`, por paciente e unidade). Portanto a regra de hoje **não resolve** “R$ 100 ao fisio que atende”; precisa de uma extensão.

**Desenho proposto**
1. **Aba no Admin “Preços e repasses”** (em Gestão › Produtos e serviços, ou no Financeiro › Comissões; decido junto com você na F5): lista de **sessão avulsa / pacote de N sessões / protocolo**, cada um com **valor** (já existe `products.price_cents` e `sessions_count`) e **repasse do fisio** em **R$ fixo** (ou em %, opção para casos futuros), mostrando **a parte da HP calculada** (valor − repasse). Validações: repasse ≤ valor; alterações valem **dali em diante** (vigência), nunca reescrevem o passado.
2. **Quem recebe**: o fisio que **atende cada sessão** (o atendimento já guarda o profissional). O admin também atribui um **fisio responsável** ao pacote (campo novo na venda/pacote), que é o dono do que ninguém atender (item 3-d). Sem atendimento e sem responsável, o repasse fica **pendente de atribuição** em Pendências do admin, em vez de ir ao comercial por engano.
3. **Como se divide (regras decididas em 05/11)**:
   - **a)** O valor que o admin cadastra é o **valor final da venda** (sem desconto sobre ele). O **repasse do fisio também é definido pelo admin**: o R$ 100 do exemplo é só um exemplo, não um valor fixo do sistema. O admin define o repasse **por produto** (sessão avulsa, pacote, protocolo) e a regra fica **congelada em cada lançamento**.
   - **b)** O paciente **paga o pacote inteiro ao fechar**, e **tudo que foi pago é comissionado**, mesmo que ele pare no meio (fechou 10, parou na 5ª: as 10 sessões geram repasse).
   - **c)** **Cada fisio recebe 100% do repasse das sessões que atender.** Exemplo: pacote de 10 sessões (R$ 1.600; repasse R$ 1.000). O fisio Y atende 3 e sai: recebe **3 × R$ 100 = R$ 300**. Um novo fisio, designado pelo admin, atende as 7 restantes e recebe **R$ 700**. Total do fisio no pacote: R$ 1.000; HP: R$ 600.
   - **d)** **Sessão paga que ninguém atendeu** (paciente parou ou o pacote venceu): o repasse dela vai ao **último fisio responsável** do pacote, porque já foi paga; o admin pode redirecionar ao autorizar. *(Interpretação minha de “tudo que já pagou já é comissionado” — confirmar no §9.)*
   - **e)** Sessão **consumida por falta ou cancelamento tardio** (regra do produto) conta como entregue ao fisio escalado.
   - **f)** Pagamento **parcelado**: o repasse só é liberado até o limite do que foi recebido. **Estorno** gera lançamento negativo proporcional (já existe hoje).
   - **g)** O lançamento nasce **pendente** quando a fatia é atribuída (sessão realizada ou encerramento do pacote), com o **valor guardado**; o admin autoriza e marca como pago (estados e idempotência de hoje).
4. **O que o fisio vê**: no “Meu desempenho”: pendente / autorizado / pago / estornado / líquido e, por pacote, **“Pacote de N sessões — seu repasse R$ X”**, sem nome de paciente e sem a parte da HP.
5. **O que o admin vê**: conferência (valor, repasse, parte da HP, fisio), pacotes sem fisio atribuído, e reconciliação com a linha “Comissões” da Visão geral (como já existe).
6. **Compatibilidade**: regras percentuais atuais continuam funcionando (ex.: comissão comercial); a regra “repasse fixo do fisio” é um **novo tipo**, sem migrar nem apagar nada.

**Confirmado pelo proprietário (05/11)**: o valor do exemplo é **por sessão** (160 → 100 do fisio e 60 da HP); o **pacote é a multiplicação** (5 sessões = R$ 800, fisio R$ 500, HP R$ 300; 10 sessões = R$ 1.600, R$ 1.000 e R$ 600). O valor cadastrado pelo admin é o **valor final**, sem desconto. Cada fisio recebe pelas sessões que atende; o que já foi pago e não foi atendido vai ao último responsável.

**Confirmado (05/11)**: resíduo pago e não atendido vai ao último fisio responsável e o lançamento nasce por sessão atendida. **Confirmado também**: o repasse é igual para todos os fisios, definido pelo admin por produto.

### 5.5 Especialidades e medidas de evolução 🆕
O registro rápido pós-sessão e o gráfico de evolução mudam os campos conforme a **especialidade** do plano do paciente (a mesma pessoa pode ter mais de uma). Lista de especialidades do Hugo: **Ortopédica, Neurofuncional, Geriátrica, Respiratória, Pediátrica e Desportiva**.

Proposta inicial de medidas por especialidade. **Medidas por teste ou procedimento** (tempo, graus, distância, repetições, saturação) não têm direito autoral; **questionários/escalas** podem ter licença e só entram depois que eu conferir a fonte de cada um e você aprovar (coluna “a conferir”). O **Hugo escolhe o que usar**; o catálogo é editável pelo admin.

| Especialidade | Medidas sem licença (entram primeiro) | Escalas e questionários (a conferir licença/uso) |
|---|---|---|
| **Ortopédica** (pós-cirúrgico, joelho, quadril, coluna, ombro, lesões) | dor 0–10; goniometria (graus, lado D/E); força (dinamometria ou teste manual); perímetro/edema; teste funcional (degrau, agachamento) | escala funcional do paciente (“o que não consigo fazer”, PSFS); escalas específicas por região (membro inferior, ombro/braço, coluna) |
| **Neurofuncional** (AVC, Parkinson, esclerose múltipla) | Timed Up and Go; velocidade de marcha (10 m); equilíbrio (apoio unipodal); passos/quedas no período; adesão | Berg; Barthel; Hoehn & Yahr (Parkinson); escala de espasticidade; EDSS (esclerose múltipla) — vários são aplicados **pelo profissional** |
| **Geriátrica** (força, equilíbrio, mobilidade, prevenção de quedas) | Timed Up and Go; sentar-e-levantar em 30 s; preensão manual; equilíbrio; quedas no período | SPPB; Tinetti; escala de medo de cair (FES-I) |
| **Respiratória** (DPOC, asma, pós-COVID, pneumonia, acamados) | SpO₂; frequência respiratória e cardíaca; teste de caminhada de 6 min; pico de fluxo; dispneia 0–10 | escalas de dispneia e de sintomas (mMRC, Borg, CAT) |
| **Pediátrica** (atraso motor, doenças congênitas e respiratórias) | marcos do desenvolvimento observados; tempo/qualidade de uma tarefa motora; registro do responsável (sono, crises, adesão) | escalas de função motora e desenvolvimento (em geral licenciadas e aplicadas pelo profissional) |
| **Desportiva** (entorses, distensões, tendinites, retorno ao esporte) | dor 0–10; goniometria; força; testes de salto/equilíbrio e **simetria entre lados**; checklist de retorno ao esporte | escalas específicas por região/tendão |

Regras: instrumento **aplicado pelo profissional** não aparece para o paciente preencher; todo instrumento mostra **fonte e licença**; “melhora clinicamente relevante” só aparece onde existe diferença mínima publicada e validada pelo Hugo.

## 6. Modelo de dados (proposta — tudo novo, aditivo, só no Dev até aprovar)

Regras comuns: RLS ligada; **sem GRANT de escrita**; escrita só por RPC com `security definer`, `set search_path = ''`; chave de idempotência; auditoria; dado clínico lido por paciente-dono (e seus representantes verificados), fisio com vínculo e **admin (gestor) em leitura com registro de acesso**.

| Tabela (proposta) | Para quê |
|---|---|
| `exercise_library` | exercício da organização: título, id do vídeo (Bunny), região, nível, equipamento, instruções, contraindicações, ativo |
| `exercise_prescriptions` + `prescription_items` | prescrição por paciente/fisio: treinos A/B/C, itens com séries, reps, carga, tempo, descanso, ordem, frequência semanal, vigência |
| `exercise_logs` | cada execução: item, quando, feito/pulou, esforço percebido, dor durante, comentário, chave de idempotência |
| `assessment_instruments` | catálogo de medidas: código, nome, tipo (dor / amplitude / força / funcional / específica do paciente), unidade, faixa, “melhor é maior/menor”, diferença mínima relevante (quando publicada), **licença/fonte** |
| `patient_measurements` | medida registrada: paciente, instrumento, valor, lado, região, data, autoria, vínculo opcional com o atendimento (dor pré/pós) — **imutável** |
| `patient_activity_goals` | metas de atividade do paciente (“subir escadas”) com notas 0–10 ao longo do tempo (pode reutilizar `patient_assessments` com tipo novo; decidir na F2) |
| `weekly_checkins` | check-in semanal (2–3 perguntas) |
| `session_notes` | resumo da sessão para o paciente + nota clínica restrita ao fisio (padrão da reavaliação) |
| `care_programs`, `program_offers`, `program_interests` | catálogo de protocolos, recomendação pelo fisio e “tenho interesse” (gera tarefa no CRM) |
| `consents` | consentimentos versionados (saúde, mídia, comunicação comercial) |
| `notification_prefs`, `push_subscriptions`, `notification_queue` | preferências, dispositivos e fila de lembretes. Coluna `channel` aceita `email`, `push` e **`whatsapp` (reservado, sem provedor; nada é enviado)** |
| `care_representations` (+ `representation_documents`) | vínculo responsável/representante/cuidador ↔ paciente: tipo, escopo, vigência, estado de verificação, documento privado, quem verificou (§4.6) |
| `support_tickets`, `support_ticket_messages`, `support_ticket_attachments` | chamados internos, mensagens (com nota interna), anexos privados; visibilidade por categoria (§4.5) |
| `product_physio_share` | **repasse do fisio por produto** (sessão/pacote/protocolo): valor fixo ou %, vigência, quem definiu; valor aplicado **guardado no lançamento** (§5.4) |
| `sales.responsible_professional` (coluna nova, a definir na F5) | fisio responsável pelo pacote, alvo do repasse |
| `specialties`, `patient_specialties` | especialidades e quais o paciente tem; define os campos do registro rápido e das medidas (§5.5) |

**Não se armazena** (calculado em RPC): adesão %, sequência, Δ de dor, progresso de meta, marcos, KPIs, risco.

**RPCs de leitura (contrato estável)**: `my_home`, `my_evolution`, `my_timeline`, `my_workout_today`, `my_workout_log` (escrita), `my_checkin` (escrita), `prof_home`, `prof_patients`, `prof_patient_detail`, `prof_session_record` (escrita), `prof_prescription_save`, `prof_kpis(p_from, p_to)`, `prof_commission_statement(p_from, p_to)`. Reutilizam `my_journey`, `professional_journey`, `my_professional_summary` e as regras de comissão existentes.

## 7. Telas no PC (não só “celular esticado”)
- **Paciente no PC**: barra lateral; Início em 2 colunas (agenda + treino à esquerda, evolução à direita); Evolução com gráficos grandes lado a lado e a linha do tempo na lateral; Treinos com vídeo grande e lista de exercícios ao lado.
- **Fisio no PC**: barra lateral; Início com agenda do dia + painel de alertas; Pacientes em **tabela densa com painel lateral** (ficha sem trocar de página); montador de prescrição arrastar-e-soltar; Meu desempenho com KPIs em grade e extrato em tabela com exportação CSV.
- Padrões do projeto mantidos: `StatCard/KpiGrid/Tabs/Table` de `src/lib/ui.tsx`, gráficos em `IndicatorCharts.tsx`, filtro único (`PeriodFilter`), Sheet/Dialog/Popover do shadcn, cores/tokens do HP Hub. Alvos de toque ≥ 44 px, foco visível, contraste AA, sem rolagem lateral a 390 px.

## 8. Fases (cada uma com portão de aprovação; Dev → `promover` só com o seu “sim” para o que for destrutivo ou dado real)

Ordem recomendada. A **F2 (responsável legal e consentimentos) vem antes de qualquer dado clínico no portal**, porque há menores e idosos. As demais podem ser reordenadas por prioridade do negócio (pergunta no §9).

| Fase | Entrega | Depende de | Testes |
|---|---|---|---|
| **F0** | Este plano aprovado + respostas do §9 + (opcional) protótipo clicável com dados de exemplo | você | — |
| **F1** | Shells `/paciente` e `/fisio`, navegação por papel, **Início** dos dois com dados que já existem, redirects, **PWA básico** (instalável) | F0 | E2E de rotas/papéis (390 px e PC), isolamento |
| **F2** | **Responsável legal, cuidador e consentimentos** (§4.6): data de nascimento obrigatória para acesso, vínculo verificado pelo admin, troca de perfil, “em nome de”, maioridade automática | F1; jurídico nos termos | SQL (isolamento, revogação, expiração, 18 anos) + E2E |
| **F3** | **Evolução do paciente**: especialidades e medidas (§5.5), linha do tempo por consulta, registro rápido pós-sessão do fisio, gráficos | F1–F2; Hugo aprova as medidas | SQL (isolamento, imutabilidade, derivados) + E2E |
| **F4** | **Chamados internos** (§4.5) para paciente com pagamento confirmado, com categorias clínica/administrativa e privacidade por categoria | F2 | SQL (elegibilidade, visibilidade) + E2E |
| **F5** | **Preços e repasses do admin + comissão por pacote** (§5.4) e **KPIs do fisio** (extrato, previsão com regra real, detalhamento) | F1; respostas do §9 | SQL (reconciliação, vigência, idempotência) + E2E |
| **F6** | **Treinos em casa**: biblioteca (texto e foto; **vídeo opcional**, entra quando o Bunny estiver pronto), prescrição, execução, check-in, offline | F3 | SQL + E2E; reprodução real só depois do Bunny |
| **F7** | **Retenção, LTV e upsell**: check-in semanal, alertas de risco, programas (catálogo e aprovação pelo admin), “próximo passo”, KPIs de gestão | F3–F6 | SQL + E2E |
| **F8** | **Lembretes por e-mail e push** (fila e preferências); canal WhatsApp apenas reservado; depois **app de loja** (Capacitor) | F1–F7; contas de loja | testes em aparelho |

Estimativa relativa (não é prazo): F1 média · F2 grande · F3 grande · F4 média · F5 média/grande · F6 grande (código; o conteúdo em vídeo vem depois) · F7 grande · F8 média.

## 9. Decisões registradas e perguntas em aberto

**Já decididas pelo proprietário (05/11)**
1. Comissão do fisio por **pacote fechado** (5 a 10 sessões), valores definidos pelo **admin** (exemplo 160 → 100 fisio / 60 HP).
2. Vídeos: **Hugo grava depois**; **Bunny depois**. Biblioteca nasce sem vídeo obrigatório.
3. Especialidades: Ortopédica, Neurofuncional, Geriátrica, Respiratória, Pediátrica, Desportiva.
4. Ranking entre fisios: **oculto**.
5. Programas e ofertas: catálogo e aprovação pelo **admin**.
6. Chamados internos para quem já pagou: **criar**.
7. Menores/idosos/responsável: **criar todas as regras** (§4.6).
8. Lembretes: **e-mail e push** agora; WhatsApp **reservado, não implementado**.
9. O valor de **R$ 160 é por sessão**; o pacote é a multiplicação (5 sessões = R$ 800; fisio R$ 500).
10. O repasse nasce **a cada recebimento**, proporcional ao pago, pendente até o admin autorizar.
11. **Adolescente de 12 a 17 anos** pode ter login próprio restrito, com autorização do responsável; criança < 12 nunca tem login.
12. **Ordem das fases** do §8 mantida.
13. O valor cadastrado pelo admin é o **valor final da venda** (sem desconto sobre ele).
14. Paciente que **parar o pacote** no meio: o que já foi pago continua comissionado.
15. **Troca de fisio**: cada fisio recebe 100% das sessões que atendeu; as restantes vão a quem o admin designar.
16. **Chamados administrativos**: fila “Suporte Humanizado da HP”, **primeira resposta em até 24 h**.
17. **Ofertas**: o **admin decide tudo** (programa, preço e a quem oferecer).
18. **Admin lê dado clínico** (dono da clínica), em leitura e com registro de acesso — muda a regra atual do sistema.
19. **Repasse do fisio é definido pelo admin**, não é fixo em R$ 100.
20. Resíduo pago e não atendido vai ao **último fisio responsável**; o lançamento nasce **a cada sessão atendida** (e o resíduo, no encerramento do pacote).
21. Prazo de 24 h: **corrido** para chamado clínico e **útil** para o administrativo.
22. Lista de **documentos** do §4.6 **aprovada**.
23. **Só o gestor (dono)** lê dado clínico (leitura, com registro de acesso); os demais papéis seguem sem.
24. **Repasse igual para todos os fisios**, definido pelo admin por produto.

**Em aberto**
1. *(jurídico)* Guarda do prontuário e exportação do histórico; textos de consentimento; publicidade em saúde; uso de dado de saúde para direcionar oferta. É a única pendência e **não bloqueia a F1**; bloqueia produção com dado real (F2 em diante).

## 10. Riscos e limites
- 🔒 **Bunny** continua sem chave/biblioteca (reprodução real não provada) e o **custo de armazenamento/banda** será medido quando entrar. O plano **não depende dele** até a F6.
- 🔒 **Conteúdo** (gravação do Hugo, edição, revisão clínica) é trabalho humano e fica para depois.
- 🔒 **Push no iPhone** só com o app instalado; e-mail (Resend, ainda não provado em produção) é o reforço. WhatsApp: nada é enviado.
- **Dado de saúde (LGPD)**: base legal, consentimentos separados, direitos do titular, retenção e dado de menor/incapaz precisam do jurídico antes de produção com dado real.
- **Responsável legal**: o app **não decide capacidade nem guarda judicial**; ele registra documentos e consentimentos e **suspende** o acesso em caso de disputa até a decisão do admin.
- **Publicidade em saúde**: ofertas e “resultados” devem seguir as regras do conselho; por isso a linguagem do portal é descritiva e a indicação clínica é sempre do fisio.
- **Escalas clínicas**: não incluir instrumento sem fonte/licença; “melhora clinicamente relevante” só onde há diferença mínima publicada.
- **Comissão**: muda o modelo de hoje (percentual) para repasse fixo por pacote; por isso é feita em **fase própria**, com vigência, conferência contra a Visão geral e **sem reescrever lançamentos antigos**.
- **Acesso clínico do admin**: é uma mudança de segurança em relação ao sistema atual (hoje o gestor não lê clínico, e os testes S07/S15 provam isso). Será feita em migration própria, com os testes ajustados, **registro de todo acesso** e sem abrir leitura a outros papéis.
- **Escopo**: é grande. A F1 entrega valor sozinha e as demais podem ser reordenadas.

## 11. Próximo passo sugerido
O plano está completo. Falta só a sua **aprovação para abrir a F1** no Dev (branch própria, testes de isolamento e rota antiga preservada). Nada vai para produção sem o seu “sim”. A pendência jurídica (§9) só bloqueia produção com dado real.
