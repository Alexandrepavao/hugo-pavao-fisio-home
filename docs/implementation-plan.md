# Plano de implementação

Legenda: ✅ funcional no Dev · 🟡 parcial · ⬜ não iniciado · 🔒 bloqueado por dependência externa

## Etapa 1 — Fundação ✅ (com ressalva de e-mail 🔒)
Repositório/branch, ambientes (Dev/Preview/Prod), migrations 001–003, RLS e testes, login/primeiro acesso/recuperação, layout por perfil, tipografia Manrope/Inter, lint corrigido. 🔒 Fluxo real de e-mail.

## Etapa 2 — Captação e comercial ✅
HP Pages (blocos, versões, publicação, agendamento, desativação, UTM, métricas), formulários públicos seguros, Pessoas (duplicidade, CSV), CRM (funis, kanban, tarefas, histórico). 🟡 Mesclagem de pessoas e importação.

## Etapa 3 — Operação e financeiro ✅/🟡
Agenda, pacotes, consumo de sessões, vendas→contrato→parcelas→recebimentos, estornos, comissões, a pagar, projeção de mensalidades. 🟡 Conciliação, DRE completo, tela de regras de comissão.

## Etapa 4 — Educação e relacionamento ✅/🟡
Academy (aluno + admin), acompanhamento de pacientes com vínculo revogável, comunidade, certificados, parceiros, indicações, repasses. 🟡 Pesquisas/corporativo (só banco).

## Etapa 5 — Consolidação ✅/🟡
Dashboard e alertas ✅; eventos idempotentes ✅; 🟡 agendador de retentativas; webhooks (⬜ dependem do provedor de pagamento).

## Etapa 6 — Validação e publicação 🟡
Testes SQL/unit/UI/API feitos no Dev. ⬜ E2E automatizado, ⬜ revisão de segurança independente, ⬜ aplicar em produção e validar ao vivo.

## Próximo passo exato
Ver `project-status.md` → "Próximo passo exato".
