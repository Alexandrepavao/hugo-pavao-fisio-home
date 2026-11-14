# “Ver como” — o gestor vê o app do fisioterapeuta e do paciente (somente leitura)

> Pedido do proprietário (14/11/2026): dentro da área do gestor, poder “se passar” por um fisioterapeuta (e depois por um paciente) e ver o app exatamente como essa pessoa vê, para conferir a experiência dela.
> Decisões: **somente olhar** (nada é gravado em nome da pessoa) · **só o gestor (dono)** · **paciente com dado clínico visível, com registro de cada acesso**.

## Como usar
**Gestão › Ver como** (menu “Controle”, só gestor). Duas abas, **Fisioterapeutas** e **Pacientes** (só aparece quem já tem acesso ao app), com busca por nome ou e-mail. “Ver como” abre `/fisio` ou `/paciente` **como essa pessoa**: mesmas telas, mesmos números, mesmos menus. Uma **faixa laranja fixa no topo** diz quem está sendo visto, que é somente leitura e quanto tempo falta; **“Sair do ver como”** volta ao painel. A tela também lista as **últimas sessões** (quem viu, como quem, quando começou e terminou).
- Vale **só na aba** onde foi aberto: outra aba, ou o login normal, continua sendo o gestor.
- A sessão dura **até 4 horas** e é fechada ao sair. Abrir outra sessão fecha a anterior (uma por gestor).
- Dentro do “ver como” o painel do gestor não abre (as rotas são da pessoa vista; qualquer rota proibida leva de volta ao início do app dela).
- Botões que gravam (ex.: “Salvar”, agendar, registrar sessão) continuam aparecendo, mas o **servidor recusa** a gravação e a tela mostra “Modo ‘ver como’: somente leitura”.

## O que é registrado
- Tabela `view_as_sessions`: quem viu (gestor), como quem, tipo, início, fim e motivo do fim. Sem leitura direta pela API: só as funções (security definer) do gestor.
- **Ver como paciente** também grava o acesso clínico do gestor em `clinical_access_log` (papel `admin`, escopo `ver_como`), no mesmo lugar dos demais acessos clínicos.

## Por dentro (migration 128)
1. `view_as_start(pessoa)` — só o gestor; só fisioterapeuta puro (papel `physio`, sem gestão/administrativo/financeiro/comercial) ou paciente (`member`, sem papel de equipe), com conta ativa; nunca outro gestor.
2. O site manda `x-view-as: <id da sessão>` em todas as chamadas à API (`src/lib/supabase.ts`). Uma **função de pré-requisição do PostgREST** (`public.hp_pre_request`, ligada em `authenticator` por `pgrst.db_pre_request`) confere que a sessão é do usuário logado, está aberta, não expirou, que ele **ainda é gestor** e que o alvo continua elegível; então **troca `auth.uid()` para o da pessoa vista** (por isso as 177 funções e todas as políticas de acesso respondem como responderiam a ela, sem reescrever nada) e liga **`transaction_read_only`**: qualquer INSERT/UPDATE/DELETE falha com `25006`. Cabeçalho inventado, de outro usuário, expirado ou de sessão encerrada = `42501` (nunca “cai” na identidade do gestor). **Sem o cabeçalho a função não faz nada.**
3. Encerrar (`view_as_end`) só funciona **sem** o cabeçalho (com ele a transação é somente leitura); `view_as_current` devolve quem está sendo visto (o site usa para montar a faixa e os papéis).
4. `private.log_clinical_access` não grava em “ver como” (a sessão é o registro; a transação é somente leitura).
- Site: `src/lib/viewAs.ts`, `AuthProvider` (identidade e papéis da pessoa vista), `RequireAuth` (rota proibida → início do app da pessoa), `ViewAsBanner`, `pages/admin/ViewAs.tsx`.

## Como desligar (se precisar, sem mexer no código)
Em SQL, como administrador do banco: `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';` — as chamadas voltam a ignorar o cabeçalho (o “ver como” mostraria o próprio gestor; a faixa continuaria, então desligue também escondendo a rota). Para apenas encerrar sessões abertas: `update view_as_sessions set ended_at = now() where ended_at is null`.

## Limitações
- Só vê como quem **tem login no app** (fisioterapeuta com conta; paciente com conta). Paciente sem conta não tem app para ver.
- Arquivos privados servidos por funções de borda com o login do próprio usuário (ex.: vídeo de exercício) podem não abrir, porque essas funções não passam pela troca de identidade.
- “Somente leitura” vale para o banco (dados). Cookies/sessões de login e o próprio “ver como” continuam funcionando normalmente.
- Notificações de leitura que o app grava ao abrir telas (marcar como lida etc.) também não são gravadas em “ver como”.

## Testes
SQL `N14` (28) e `N15` (11); E2E `N33` (5: API pelo PostgREST de verdade, todas as telas do fisioterapeuta e do paciente sem chamada com erro, sessão derrubada, celular 390 px). Capturas em `docs/screenshots/ver-como/`.
