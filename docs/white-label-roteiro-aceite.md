# White label — roteiro de aceite (Dev)

Só **Dev** (`fsvtzowcwhvwtluwrhnb`). Preview: `https://white-label--hp-group-hub.netlify.app` (alias `white-label`; **não** use o alias padrão `preview`). Acesso ao preview exige **login da equipe Netlify** em todas as rotas — veja [white-label-autenticacao-organizacao.md](white-label-autenticacao-organizacao.md) §5. Senha das contas de teste = variável de usuário `HP_QA_PASSWORD` (nunca em chat/arquivo).

## A. Abrir a Clínica Delta (criada pelo questionário)

| O quê | Onde |
|---|---|
| Login da Delta | `<preview>/empresa/delta-fisio/login` (marca "Delta Fisioterapia", sem HP) |
| Captação pública (quiz) | `<preview>/empresa/delta-fisio/avaliacao` |
| Administrador (conta **simulada**) | `delta.admin@example.test` |
| Fisioterapeuta (conta **simulada**) | `delta.fisio@example.test` → `/fisio`, `/admin/meu-resumo` |
| Paciente (conta **simulada**) | `delta.paciente@example.test` → `/paciente` |
| Plataforma (administrador da plataforma) | `qa.plataforma@hp-test.dev` → `/plataforma` (solicitação "Clínica Delta") |

A Delta é **recriada do zero** a cada execução do E2E `N40` (a anterior é removida pelo slug exato `delta-fisio`). Comando: `npx playwright test e2e/novos/N40-white-label-delta-jornada.spec.ts --workers=1` (precisa de `SUPABASE_ACCESS_TOKEN` e `HP_QA_PASSWORD`).

## B. Repetir o provisionamento (sem código, sem SQL, sem novo projeto Supabase)

1. `/plataforma ▸ Criar aplicativo` → etapas A–I (nome, segmento *Fisioterapia*, responsável + e-mail, unidade, serviços, equipe, captação, módulos, marca com **subdomínio** = slug, plano) → **Criar aplicativo**. Estado final: *Disponível com pendências*.
2. `Provisionamento ▸ (solicitação)`: endereço de acesso `/empresa/<slug>`, **Enviar convite**, **Evidência do primeiro acesso (5 níveis)**, **Conferir entrega**, **Revogar**/**Reenviar**.
3. A clínica configura **sozinha**, pelas telas normais: Configurações ▸ Operação (serviços, pacote), Financeiro ▸ Configurações (conta), Agenda ▸ Profissionais e disponibilidade (fisioterapeuta, acesso, horários), Financeiro ▸ Comissões ▸ Regras (regra de repasse), Configurações ▸ Captação (WhatsApp), Pages (página + formulário).

## C. Primeiro acesso com e-mail REAL (a única parte que depende de você)

O envio real foi feito para `jan.darioush@yahoo.com.br` (único destinatário autorizado) na organização **Clínica Épsilon QA** (`epsilon-qa`). Esse e-mail já tem conta no Dev (gestor da HP), então o caminho validado é o de **conta existente**:
1. Abra o e-mail recebido (aviso do convite) **ou** vá direto a `<preview>/empresa/epsilon-qa/login` e entre com a sua conta.
2. A tela mostra "Sem acesso a esta organização" + **Convites para você** → **Aceitar convite**.
3. Confira no painel da plataforma (solicitação *Clínica Épsilon QA*): níveis 4 (link/aceite) e 5 (acesso e papel de gestor). Sua identidade, sua senha e o vínculo com a HP **não mudam**.

Nível 3 (entrega confirmada) exige o webhook do Resend — veja o bloqueio em [white-label-autenticacao-organizacao.md](white-label-autenticacao-organizacao.md) §6.

## D. Verificações de isolamento que o roteiro cobre (N21, N23, N24, N25, N38, N40, N41)

- Lead da Delta aparece **uma vez** no CRM/cadastro da Delta e **não** na HP, Alfa, Beta ou Gama.
- Formulário/ID da Delta usado em outro endereço (ou sem endereço) → recusado; `x-org` forjado → recusado; anônimo não lista nada.
- "Venda feita" **não** ativa o paciente; pagamento parcial **não** ativa; 1ª parcela **quitada** ativa; reenvio do mesmo recebimento não duplica; pagamento em organização errada é recusado.
- Presença **não** é automática; sessão só é consumida quando a fisioterapeuta registra o comparecimento.
- Repasse positivo visível ao gestor (`/admin/financeiro/comissoes`) e à fisioterapeuta (`/admin/meu-resumo`), vindo da **regra criada na Delta**.
- Limites de plano e 8 requisições simultâneas: 1 passa, 7 bloqueadas; histórico e exportação continuam.

## E. Ordem de dependência de PRs e migrations

1. **PR #38** (Jornada: avaliação → apresentação → pendente → pagamento; migrations 131–133) — base.
2. **PR #39** (white label, rascunho, empilhado no #38): migrations **134 → 149** em ordem (134 fundação, 135 catálogo/planos, 136 provisionamento, 137 storage/exportação, 138 marca no e-mail, 139–141 catálogo/módulos/slug, **142 EXECUTE de anon no pré-request**, **143 captação pública por slug**, **144 ciclo do convite**, 145 slug `empresa` + `org_slug`, **146 webhook de entrega**, **147 planos/limites/histórico**, **148 acesso ao portal só para pessoa da organização**, **149 RLS dos logs: papel avaliado uma vez por consulta**).
3. Funções Edge: `auth-email-hook` (`--sem-jwt`), `provisioning-invite`, `org-export`, `resend-webhook` (`--sem-jwt`), `patient-invite` (já no #38).
4. Antes de promover qualquer coisa à produção: conferir `anon` com EXECUTE em `hp_pre_request` (142), definir `PUBLIC_SITE_URL`, `EMAIL_FROM` verificado e (opcional) `RESEND_WEBHOOK_SECRET`; **não** definir `EMAIL_ALLOWED_RECIPIENTS` em produção. Nada disso foi feito em produção.

## F. Pendências de operação comercial (decisão humana)

Preços e limites reais dos planos; revisão jurídica dos textos de consentimento por organização; verificação de posse de domínio próprio (DNS) e `base_domain`; remetente Resend por organização (hoje "<Marca> via HP Group Hub" no endereço verificado da plataforma); integração de cobrança (nenhuma contratada); acesso excepcional de suporte (break-glass); teste de carga em escala (só concorrência pequena foi medida); personalização das perguntas do quiz por organização; rótulos "HP" remanescentes em telas administrativas.

## G. Achados da jornada da Delta (E2E N40) e medições

- **Vazamento entre organizações corrigido (migration 148):** `portal_access_state` e `person_portal_access` autorizavam pelo papel de gestor da organização ativa mas não conferiam a organização da pessoa-alvo; o gestor de uma organização lia o estado de acesso (e-mail mascarado, último envio, primeiro acesso) de paciente de outra. Varredura: as demais funções públicas que recebem id de pessoa/entidade usam `require_care`/`has_unit_role`/`sched_can_manage`, que validam a organização desde a migration 134. Cobertura: N40-11 (API direta, 3 contas de outras organizações) e N24 (SQL).
- **Comportamento existente, não alterado:** estornar o valor INTEIRO de uma parcela a marca como "estornada" e a tela não permite receber de novo; estorno parcial mantém a parcela recebível. A fisioterapeuta não vê o nome do paciente na agenda (a pessoa só é lida por funções com vínculo assistencial; igual à HP).
- **Textos ainda da HP (limitação):** rótulos "Parte da HP"/"Linha de negócio (HP Fisioterapia / HP Academy)" em Preços e repasses/Configurações e o modelo de página "Seja um parceiro HP" no editor.
- **Tempos medidos (Dev, Delta):** clicar em *Criar aplicativo* → *Disponível* ≈ 1,0 s (soma das etapas internas 142 ms); configuração operacional pela interface (serviços, pacote, conta, fisioterapeuta, acesso, 7 horários, regra de repasse) ≈ 9,6 s de automação; ativação = tempo até a 1ª parcela quitada (decisão humana, não medida). Esperas externas (entrega do e-mail, clique do administrador, DNS, importação, treinamento) **não medidas**.
- **Ambiente compartilhado:** várias sessões podem usar o mesmo Dev ao mesmo tempo. Execuções concorrentes derrubam contas `@example.test` órfãs (limpeza), apagam `test-results` e deixaram uma cadeia órfã de marketing (toque/atribuição/origem/venda atribuída de uma campanha apagada), removida para voltar o N03 (170 OK). Rode o N40 sem outra suíte E2E em paralelo; para o servidor use `E2E_BASE_URL` com um Vite próprio.
