# Release v1 — primeira versão operacional do HP Group Hub

> Estado: **pronta para revisão, NÃO publicada.** Nada foi alterado em produção, DNS ou dados reais. A aprovação final é para publicar esta versão.
> Branch de entrega: `release/v1` (a partir do commit `93ac116`, sem o Contábil). O desenvolvimento continua em `feature/lead-quizzes` (PR #2) e em novas branches.

## 1. O que entra e o que fica de fora

| Escopo obrigatório | Situação nesta versão | Prova |
|---|---|---|
| Login, primeiro acesso, recuperação de senha, logout | ✅ Fluxos prontos. Envio pelo Resend: **nível 1 verificado no Dev** (aceito); entrega/clique dependem da caixa do destinatário autorizado; **produção não tem Resend nem hook configurados** (bloqueio, §9) | E2E 01; §7 |
| Equipe, papéis e permissões | ✅ | R02 (menu + rota + backend por papel), SQL S01 |
| Cadastro central (pacientes, parceiros, empresas) | ✅ Pessoas + ADM (PF/PJ, importação com prévia) | R01, N10/N11, SQL N01/N02 |
| Captação pelo site e quizzes → CRM | ✅ (agora também com indicação de parceiro pelo quiz) | R01, R03, E2E 02/08/09 |
| CRM (leads, responsáveis, oportunidades, etapas, tarefas, histórico) | ✅ | R01 |
| Agenda (agendar, remarcar, cancelar, comparecimento/falta) | ✅ (com trava nova: falta/comparecimento só após o horário) | R01, SQL 004 |
| Atendimento e acompanhamento restrito | ✅ Atendimento = agendamento realizado; **acompanhamento** (conteúdos e mensagens) só com vínculo. **Não existe ficha/evolução clínica** (ver §9) | R02, SQL 006 |
| Pacotes (sessões disponíveis/realizadas/canceladas, sem consumo duplicado) | ✅ | R01 passo 6 |
| Financeiro operacional (vendas, parcelas, recebimentos, contas a pagar, estornos, comissões) | ✅ | R01 passos 4–5, SQL S02 |
| Dashboard com indicadores reais e detalhes | ✅ | R01 passo 7 |
| Configurações essenciais (organização, unidades, serviços, preços, equipe, WhatsApp) | ✅ | Configurações + R02 |
| Área do paciente | ✅ atendimentos, pacotes, orientações, dados pessoais, mensagens — só o próprio | R03 |
| Área do parceiro | ✅ perfil, código e indicações (só 1º nome + etapa), repasses autorizados | R03 |

**Preservados e visíveis, sem ampliar escopo:** Academy, Pesquisas, Contas corporativas, Recorrência/DRE/Conciliação/Relatórios do Financeiro, Meu dia, metas do CRM.
**Fora da navegação e das rotas da v1** (perfil de entrega, `src/lib/release.ts`): CRM › *Mensagens agendadas* e *Disparo de mensagens* (exigem provedor de envio automático que não existe), *Estado dos módulos* e os cartões *Pendente* de Configurações. **Fora desta release:** Contábil (pronto, em `feature/lead-quizzes`), Marketing, Jurídico, RH e provisionamento white label.
> Ocultar menu/rota **não é autorização**: nenhuma permissão depende dessa flag. O acesso a cada dado é decidido no banco (RLS e funções) e verificado por chamadas diretas à API no R02.

## 2. Bloqueios encontrados na jornada de aceite (e como foram resolvidos)

| # | Achado | Impacto | Correção |
|---|---|---|---|
| 1 | "Converter em venda" no CRM abria `/admin/financeiro` (visão geral), não a tela de vendas | Quebrava o passo lead → venda | Link corrigido para `/admin/financeiro/vendas` (clicado de verdade no R01) |
| 2 | Falta (`no_show`) podia ser marcada **antes do horário** e consumia sessão do pacote | Consumo indevido | Migration 052 (mesma regra do comparecimento) |
| 3 | Indicação de parceiro pelo quiz (`/avaliacao?ref=`) não era rastreada, embora o portal prometa "qualquer página" | Parceiro não via a indicação | Migration 053 + front envia `ref`; **`CREATE OR REPLACE` zerou o GRANT de `anon` em `quiz_start`** — pego pelo teste e restaurado na própria migration |
| 4 | Supabase **Dev** com Site URL `http://localhost:3000` e lista de redirecionamento vazia | Links de e-mail iriam para o localhost | Dev ajustado (§7). **Produção tem o mesmo defeito** — pendente (§9) |
| 5 | **O site de produção `hp-group-hub-producao` foi publicado com o banco DEV embutido no bundle** (só `fsvtz…` aparece; nunca `wfqkj…`) | Produção gravaria em banco de teste | Salvaguarda no build (`vite.config.ts`): produção só com o banco de produção e teste/preview nunca com o de produção; `netlify.toml` define `VITE_APP_ENV` por contexto; `version.json` registra commit, ambiente e banco. **Precisa republicar** (§8) |
| 6 | Site Dev `hp-group-hub` está **público** (200 sem login de equipe), contra o que os docs afirmam | Front de teste + banco Dev abertos | Registrado; ver §9 |
| 7 | Função temporária `diag-email-config` ainda no Dev | Superfície desnecessária | Removida |

## 3. Resultados dos testes
Ver a seção *Resultados* ao final deste arquivo (preenchida na execução final).

## 4. Migrations para produção (ordem exata)
Produção está na **037** (37 migrations, sem dados: 0 usuários, 0 pessoas). Aplicar, **nesta ordem**, só estas 12 (Dev já as tem):

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `20260924000038_lead_quizzes.sql` | Quizzes de captação, números de WhatsApp (seed), funções `quiz_*` e de gestão |
| 2 | `20260924000039_dashboard_card_detail.sql` | Detalhamento dos cartões (dashboard) |
| 3 | `20260924000040_audit_quiz_whatsapp_numbers.sql` | Auditoria dos números de WhatsApp |
| 4 | `20260924000041_dashboard_card_detail_expand.sql` | Detalhamento ampliado + correção do total |
| 5 | `20260924000042_crm_dashboard.sql` | Dashboard do CRM |
| 6 | `20260924000043_crm_goals.sql` | Metas do CRM |
| 7 | `20260924000044_crm_lists.sql` | Listas do CRM |
| 8 | `20260924000045_adm_directory.sql` | ADM: PJ, CPF/CNPJ, campos de PF |
| 9 | `20260924000046_adm_directory_rpc.sql` | ADM: listagem/indicadores/edição de PJ |
| 10 | `20260929000047_adm_import_views.sql` | ADM: importação de PJ, colunas por usuário |
| 11 | `20260930000052_appointment_status_guard.sql` | Trava de falta/comparecimento futuro |
| 12 | `20260930000053_quiz_partner_referral.sql` | Indicação de parceiro pelo quiz (+ GRANT) |

**NÃO aplicar 048–051** (papel `accountant` e Contábil): existem no Dev e ficam na branch de desenvolvimento. Não há dependência da v1 nelas. Como a 052/053 têm versão maior que a 051, a ordem de aplicação em produção (…047 → 052 → 053) e a futura chegada de 048–051 são compatíveis (são independentes).
Como aplicar: uma a uma, em ordem, com `apply_migration` (nunca `db reset`), conferindo `list_migrations` (deve terminar em 49 registros) e rodando os testes SQL `supabase/tests/release` **contra o Dev** antes. As migrations foram aplicadas no Dev na mesma ordem; **não foram ensaiadas numa cópia de produção** (o plano do projeto não tem branch/PITR — ver §6).

## 5. Variáveis e configurações (somente nomes; valores ficam nos painéis)
| Onde | Nome | Observação |
|---|---|---|
| Netlify (site de produção) — build | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | **Do projeto de produção `HP Group Core`**. `VITE_APP_ENV=production` e `VITE_RELEASE_PROFILE=v1` já vêm do `netlify.toml` (contexto production) |
| Netlify — funções/edge | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (só servidor), `RESEND_API_KEY`, `EMAIL_FROM` | `send-email` (convite) e `social-meta` leem estas |
| Supabase produção — secrets das Edge Functions | `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`, `PUBLIC_SITE_URL` | **Hoje nenhum está configurado em produção** |
| Supabase produção — Auth | Site URL = domínio final; Redirect URLs = `https://<domínio>/**`; Send Email Hook **habilitado** → `auth-email-hook`; limite de e-mails ≥ 30/h; senha mínima ≥ 10 (Dev está em 6) | Hoje: Site URL `http://localhost:3000`, lista vazia, hook desabilitado, limite 2/h |
| Resend | domínio `hpfisioterapia.com.br` verificado (DKIM; SPF **mesclado** ao existente do Hostinger) | ver `docs/integrations.md` |

## 6. Backup e recuperação antes da migração
- Produção **não tem backup automático nem PITR** (`backups: []`, `pitr_enabled: false`). Hoje o banco está **vazio de dados de negócio**, então migrar agora tem risco baixo: o que se perderia é só o schema, que é reproduzível pelos arquivos do repositório.
- Antes de aplicar: (1) registrar `list_migrations` (deve ser 37 até `20260923030432`); (2) exportar o inventário do schema (tabelas, funções e policies) por consulta e guardar no repositório privado; (3) **recomendado: subir o projeto para um plano com backup diário/PITR ANTES do primeiro dado real** — a partir do primeiro paciente cadastrado, "recuperação" deixa de ser reconstruir e passa a exigir backup.
- Recuperação se uma migration falhar no meio: cada arquivo roda em uma transação por chamada; se falhar, nada dela persiste. Parar, corrigir o arquivo, reaplicar. Não seguir para a próxima.
- Reversão das duas migrations que **substituem função**: 052 → reaplicar `set_appointment_status` do arquivo `20260921000006_directory_agenda.sql`; 053 → reaplicar `quiz_start` de `20260924000038_lead_quizzes.sql` **e o GRANT a `anon`**. As demais só adicionam objetos.

## 7. Verificação de login e e-mail (Resend) no Dev
- **Usuário de teste autorizado**: somente `jan.darioush@yahoo.com.br`. **Um** e-mail de recuperação enviado em 2026-09-30 02:04:30Z pelo fluxo real (`/auth/v1/recover` → hook → Resend): API respondeu 200, o Auth registrou `recovery_sent_at` 02:04:31Z — ou seja, o hook respondeu com sucesso, o que só acontece se o Resend aceitou o envio (**nível 1**).
- **Falta para os níveis 2 e 3** (entrega registrada no Resend e clique no link): conferir a caixa do destinatário (e o painel do Resend). Não tenho acesso a nenhum dos dois.
- Auth do **Dev** ajustado: Site URL `https://hp-group-hub.netlify.app`; Redirect URLs incluem também `http://127.0.0.1:5180/**` e `http://localhost:5180/**`.
- Nenhuma mensagem foi enviada a pacientes ou terceiros. Convite de equipe por e-mail (`send-email`, Netlify) **não foi testado** — depende de `RESEND_API_KEY` no Netlify e de login Netlify que esta sessão não tem.

## 8. Plano de publicação e reversão
**Pré-condição:** produção ainda não tem usuários; as duas manobras (banco e front) são de baixo risco agora e ficam perigosas depois do primeiro uso real — por isso a ordem abaixo importa.

Publicação (banco → configuração → front → verificação):
1. Backup/inventário (§6). Congelar mudanças de schema.
2. Aplicar as 12 migrations (§4), uma a uma. Rodar `npm run test:sql:release` **apontando para o Dev** e conferir em produção: `list_migrations` = 49; nenhuma função `acc_`/`adm_` executável por `anon`; lista de funções de `anon` = `get_public_page`, `track_page_visit`, `submit_public_form` + `quiz_*` (6).
3. Configurar o Supabase de produção (§5): secrets, hook, Site URL/Redirect URLs, limite de e-mail, senha mínima.
4. **Conectar o site Netlify de produção ao repositório**, branch `release/v1` (ou `main` após o merge), com as variáveis de produção — assim o **Netlify** compila (não a máquina de alguém) e cada deploy carrega o `COMMIT_REF`. Sem `.env.local` no build.
5. Deploy. Verificar `GET /version.json`: `commit` = commit aprovado, `environment` = `production`, `backend` = `produção`. Se não bater, **não abrir para a equipe**. A tela *Configurações* mostra a mesma linha e, fora de produção, aparece o selo "AMBIENTE DE TESTE".
6. Bootstrap: entrar como gestor pelo primeiro acesso (`contato@hpfisioterapia.com.br` ou `jan.darioush@yahoo.com.br`, ambos já na lista de bootstrap), convidar a equipe, criar a configuração mínima (§ guia) e só então divulgar o link.

Reversão:
- **Front:** Netlify → *Deploys* → publicar o deploy anterior (instantâneo). O front antigo funciona com o banco novo (as migrations só adicionam, exceto as duas funções acima, mantendo assinatura).
- **Banco:** as migrations são para frente; para desfazer use os arquivos de origem (§6) ou restaure backup (se existir). Enquanto não houver dado real, a saída mais limpa é reaplicar o schema.
- **E-mail:** desabilitar o hook volta ao remetente padrão do Supabase (limite baixo) — só como contingência.

## 9. Pendências que IMPEDEM o uso × melhorias futuras
**Impedem colocar em produção (precisam de ação sua/painéis):**
1. Republicar o front de produção com o banco de produção (hoje aponta para o Dev — §2 #5) e conectá-lo ao repositório.
2. Aplicar as 12 migrations em produção.
3. Configurar e-mail em produção: Resend (domínio, DKIM/SPF), secrets e hook do Supabase, Site URL/Redirect URLs, limite de e-mails (§5). Sem isso ninguém completa o primeiro acesso.
4. DNS de `hpfisioterapia.com.br` continua no GitHub Pages (HTTPS válido); o app não está no domínio oficial. Decidir subdomínio do app (ex.: `app.hpfisioterapia.com.br`) e apontar o DNS quando aprovado.
5. Proteger ou desligar o site Dev público `hp-group-hub` (§2 #6) e resolver o site Netlify não documentado `leafy-cascaron-325147` (ver `docs/deployment.md`).
6. Configuração mínima de operação (não existe em produção): serviços e preços, pacotes, profissionais e disponibilidade, conta financeira, regra de comissão, criação/publicação das páginas do site, convites da equipe. O guia (`docs/guia-operacao-v1.md`) lista onde fazer.
7. Backup/PITR antes do primeiro dado real (§6).

**Melhorias futuras (não bloqueiam):** ficha/evolução clínica por atendimento; agenda para celular com ações visíveis sem rolar a tabela (hoje as tabelas largas rolam na horizontal); remarcar com seletor de horários em vez de texto `AAAA-MM-DD HH:MM`; envio automático de lembretes (exige provedor de mensagens); testes SQL legados 001–023 reescritos para banco descartável; Contábil, Marketing, Jurídico, RH e provisionamento white label (roteiro pausado).
