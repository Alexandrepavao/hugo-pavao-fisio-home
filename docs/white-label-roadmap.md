# Rumo ao SaaS white label — registro de direção

> Este documento só **registra a direção futura** e o que já está pronto para ela. Não é um plano de execução
> desta fase, e nada aqui foi construído nesta sessão além do que está explicitamente marcado como "feito".
> HP Group Hub continua sendo a build de produção do HP Group — este documento não muda isso.

## O que isso significa

O HP Group Hub é a **primeira implementação** de uma plataforma que, no futuro, pode virar SaaS white label
para outros segmentos (não só fisioterapia). Isso não significa "genérico desde já" — significa que, ao tomar
decisões de arquitetura, vale perguntar "isso é uma regra do HP Group/fisioterapia, ou é uma regra de negócio
geral que qualquer operação parecida teria?" e, quando a resposta for "geral", preferir deixar reutilizável —
sem pagar o custo de generalizar algo que ainda não se sabe se vai ser reaproveitado.

## O que já está pronto para isso (feito, não é promessa)

- **Isolamento por organização e unidade já existe e é a base de tudo.** Toda tabela de negócio carrega
  `org_id`; a maioria também `unit_id`. RLS nunca confia em nada vindo do cliente — sempre resolve a
  organização/unidade do usuário autenticado no próprio banco (`private.current_org()`,
  `private.has_org_role()`, `private.has_unit_role()`). **Hoje existe uma única organização** (`hp-group`) —
  o modelo já é multi-organização no desenho, mas nunca foi exercitado com uma segunda organização real.
- **Separação de papéis de negócio genéricos e específicos da fisioterapia já é visível no schema.**
  `manager`, `ops_admin`, `unit_manager`, `sales`, `finance`, `partner`, `member` são papéis de qualquer
  operação de atendimento/vendas. `physio` (fisioterapeuta) e `teacher` (professor/mentor) são os dois papéis
  hoje amarrados ao domínio da fisioterapia/educação do HP Group.
- **Utilitários de período/filtro promovidos a compartilhados nesta sessão**: `src/lib/period.ts` e
  `src/lib/PeriodFilter.tsx` (antes só existiam dentro de `pages/admin/finance/`) — Pesquisas e Contas
  corporativas já os usam, junto do Financeiro e do Início. `pages/admin/finance/shared.ts` e
  `pages/admin/finance/PeriodFilter.tsx` viraram só reexportações, para não quebrar nada que já importava
  de lá.
- **Padrão de indicador `{value, available, basis}` e k-anonimato (mínimo de 5) são convenções gerais**, já
  usadas em módulos de domínios bem diferentes (Financeiro, Pesquisas, Contas corporativas) — não são
  específicos de fisioterapia e já se provaram reaproveitáveis nesta sessão.

## O que é claramente específico da fisioterapia/HP Group hoje (não generalizado, e tudo bem)

- Papel `physio`, `person_kind` incluindo `patient`, textos/copy em toda a interface ("paciente",
  "atendimento", "sessão", linguagem clínica).
- **Marca e identidade visual estão espalhadas, não centralizadas**: nome "HP Fisioterapia", logo, cores e
  dados de contato aparecem hardcoded em ~16 arquivos diferentes (`PortalShell.tsx`, `AppShell.tsx`,
  `AuthShell.tsx`, `Footer.tsx`, `Logo.tsx`, `lib/contact.ts`, `WhatsAppFloat.tsx`, `TrabalheConosco.tsx`,
  `WorkWithUs.tsx`, entre outros) em vez de vir de uma única configuração de organização. Isso é esperado
  para uma operação de uma marca só — vira trabalho real no dia em que existir uma segunda organização com
  marca própria.
- O catálogo de produtos (`product_kind`: service/course/mentoring/package/plan) e o modelo de agenda por
  profissional/serviço são genéricos o bastante para outros segmentos de atendimento, mas nunca foram
  testados fora do contexto de clínica.

## Próximos passos concretos (quando isso for priorizado — não agora)

1. Centralizar marca/identidade numa configuração por organização (nome, logo, cores, contato, domínio) em
   vez de espalhada pelo código — troca "HP Fisioterapia" fixo por dado de `organizations`.
2. Decidir se `physio`/`teacher` continuam papéis fixos do enum `app_role` ou viram papéis configuráveis por
   organização (trade-off: enum é mais simples e mais seguro; papéis configuráveis são mais flexíveis e mais
   complexos de proteger com RLS).
3. Exercitar o isolamento multi-organização de verdade: criar uma segunda organização de teste no Dev e
   confirmar que nada vaza entre elas (hoje é verdade por construção do RLS, mas nunca foi testado com dados
   de duas organizações simultâneas).
4. **Não fazer agora** (fora do escopo até ser pedido): reconstrução para múltiplas empresas, um provisionador
   de novas organizações (fluxo de "criar minha conta" self-service), questionário de onboarding por segmento.

## O que este documento não é

Não é uma decisão de que o white label vai acontecer, nem uma data. É só o registro de que a direção existe,
do que já ajuda por já ter sido feito com essa reutilização em mente, e do que continua deliberadamente
específico do HP Group até haver um pedido concreto de generalizar.
