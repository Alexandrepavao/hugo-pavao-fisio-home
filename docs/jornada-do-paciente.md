# Jornada do paciente e vídeos privados (Bunny)

> Migration `058`, Edge Function `bunny-playback`, portal (`/paciente` › “Minha jornada”), painel do fisioterapeuta (Acompanhamento › Meus pacientes › Jornada do paciente) e teste `S07`.
> **Nada aqui cobra, consome sessão ou promete resultado.** O número de sessões é só contagem; melhora clínica é avaliação do fisioterapeuta.

## O que a jornada mostra ao paciente
Objetivos definidos com o fisioterapeuta · plano de sessões (**modelo inicial de 10 sessões, configurável**; a quantidade final é decisão clínica) · próximas consultas · sessões **separadas** (realizadas, faltas do paciente, ausência do profissional — que não desconta —, canceladas) e o **saldo do pacote à parte** · gráfico de evolução com avaliações **reais** (dor, funcionalidade, bem-estar, escala 0–10), cada ponto com data e autoria (paciente ou profissional) · vídeos privados atribuídos pelo profissional · reavaliação (continuidade, manutenção ou alta, com mensagem ao paciente) · pedido de renovação/contato **sem cobrança automática**.

## Privacidade (regra central)
- Dado clínico (objetivos, plano, avaliações, reavaliações, vídeos) só é lido pelo **próprio paciente** (função `my_journey`, que omite o restrito) e pelo **fisioterapeuta com vínculo assistencial ativo** (`professional_journey`, `private.has_care_relationship`). **Gestor, administrador, comercial e financeiro não leem nada disso**, nem por SQL direto (RLS), nem por função.
- A **nota clínica** da reavaliação é visível só ao profissional vinculado; o paciente vê apenas a decisão e a mensagem.
- Avaliações são **imutáveis** (não há edição nem exclusão): corrigir = registrar outra.
- Pedido de renovação é administrativo (sem dado clínico): a equipe vê a fila (`renewal_requests_open`), e uma tarefa é criada para o responsável do CRM. O pedido repetido reaproveita o aberto.
- Toda tabela nova tem RLS e **nenhum GRANT de escrita**: toda escrita passa por função que valida a permissão.

## Vídeos privados (Bunny Stream) — o que cadastrar e onde
A reprodução **não é pública**. O navegador nunca recebe a chave nem os IDs do Bunny sem autorização: ele pede à Edge Function `bunny-playback`, que (1) valida o JWT, (2) pergunta ao banco se aquele usuário pode assistir aquele vídeo (paciente dono ou profissional vinculado; vídeo não revogado e não vencido; registra o acesso) e (3) assina um link de embed de curta duração (padrão 1 h). Sem a chave configurada a tela mostra **“reprodução indisponível por configuração”** — nunca cai para vídeo público.

**No painel do Bunny (bunny.net › Stream › sua biblioteca):**
1. **Library ID** (número da biblioteca) → não é segredo. Cadastre em **Configurações › Operação › Jornada do paciente › “ID da biblioteca Bunny (padrão)”**.
2. **Security › Embed View Token Authentication**: ative e copie a **Token Authentication Key** → **é segredo** (passo 4).
3. **Security › Allowed Referrers**: adicione os domínios onde o app roda (`hpfisioterapia.com.br`, o subdomínio do app quando existir e, no Dev, `hp-group-hub.netlify.app`) e ative **Block Direct URL File Access**. Recomendado: ativar também a proteção **MediaCage (DRM básico)** da biblioteca.
4. Para cada vídeo enviado, copie o **Video ID (GUID)**.

**No Supabase (projeto Dev `fsvtzowcwhvwtluwrhnb`; repetir na produção só quando for a hora):**
1. **Project Settings › Edge Functions › Secrets** (ou `supabase secrets set`): `BUNNY_EMBED_TOKEN_KEY` = a Token Authentication Key do passo 2. Opcional: `BUNNY_TOKEN_TTL_SECONDS` (60 a 21600; padrão 3600).
2. **Publicar a função** (deixando a verificação de JWT ligada, que é o padrão): `supabase functions deploy bunny-playback --project-ref fsvtzowcwhvwtluwrhnb`.
3. Conferir em **Configurações › Operação › Jornada do paciente › “Verificar proteção de vídeo”**: “Proteção NÃO configurada”, “função não publicada” ou “configurada”.

**Por vídeo (fisioterapeuta):** Acompanhamento › Meus pacientes › (paciente) › Jornada do paciente › *Vídeos privados* › título + Video ID (e a biblioteca, se for diferente da padrão) › “Atribuir”. “Revogar” corta o acesso na hora.

> Nenhum segredo é digitado no chat, gravado no repositório ou exposto ao navegador (`VITE_*`).

## Como testar
- SQL: `supabase/tests/release/S07_jornada_paciente.sql` (privacidade, plano, avaliações, reavaliação, vídeos, renovação, anon).
- A reprodução ponta a ponta depende de configurar o Bunny e publicar a função (acima); até lá o comportamento correto é “indisponível por configuração”.

## Limitações conhecidas
- O gráfico traz três escalas de autorrelato 0–10 (dor, funcionalidade, bem-estar) e os registros de dor já existentes de `care_activity`; **não há escalas clínicas validadas específicas** (ex.: DASH, WOMAC) — o profissional escolhe o que registrar e interpreta.
- Não há notificação automática ao paciente sobre a reavaliação (e nenhum envio de mensagem foi criado).
- O plano é por paciente (um ativo por vez); o vínculo com um pacote específico é opcional.
