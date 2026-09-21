# Plano de implementação

Legenda: ✅ concluído · 🟡 parcial · ⬜ não iniciado · 🔒 bloqueado

## Etapa 1 — Diagnóstico e fundação
- ✅ Diagnóstico do repositório, ambiente e destinos (Supabase/Netlify)
- ✅ Branch `feature/hp-group-hub`
- ✅ Projeto Supabase Dev criado (US$ 0)
- ✅ Migration 001 (fundação) e 002 (funções de pessoas) no Dev, advisors de segurança limpos
- ✅ Teste RLS de isolamento (16 verificações)
- ✅ Cliente Supabase, AuthProvider, login, recuperação, `/redefinir-senha` (link inválido/expirado tratado)
- ✅ Layout admin por perfil; Pessoas (listar/buscar/criar com duplicidade); Auditoria
- 🟡 Convites (tabela e trigger prontos; **função de servidor que dispara o e-mail** ⬜)
- 🔒 Bootstrap do gestor: falta o **e-mail do gestor** (informar ao agente)
- ⬜ `netlify.toml`, site Netlify, variáveis por contexto, primeiro deploy de preview
- ⬜ Teste do fluxo completo de recuperação de senha com e-mail real (depende de SMTP/remetente — ver `integrations.md`)

## Etapa 2 — Captação e comercial
⬜ HP Pages (blocos, versões, publicação/agendamento, UTM, métricas) · ⬜ formulários públicos (Netlify Function + rate limit + dedupe) · ⬜ CRM (funis, kanban, tarefas, motivos de perda) · ⬜ mesclagem de pessoas, importação/exportação

## Etapa 3 — Operação e financeiro
⬜ Agenda (exclusion constraint), pacotes e saldo, vendas/contratos, recebíveis, pagamentos, estornos, comissões, forecast de mensalidades

## Etapa 4 — Educação e relacionamento
⬜ Academy (pacientes e profissionais), acesso com validade/revogação, comunidades, certificados, portal de parceiros

## Etapa 5 — Consolidação
⬜ Outbox de eventos + processamento idempotente · ⬜ Dashboard com definições em `metrics.md`

## Etapa 6 — Validação e publicação
⬜ E2E das jornadas Checkup e Mentoria · ⬜ revisão de segurança · ⬜ deploy e verificação ao vivo

## Próximo passo exato
1. Obter do responsável o e-mail do gestor → `insert into private.bootstrap_config` no Dev (e depois em produção).
2. Criar `netlify.toml` + site Netlify (time "Hp Group") e configurar variáveis por contexto.
3. Migration 003: HP Pages + formulários + reservas de slug; Netlify Function `submit-form`.
