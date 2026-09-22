# Auditoria dos repositórios de referência

Clonados (somente leitura, fora deste projeto) em `D:\Claude\hp-refs\`: `brightercore-4d41cb1d`, `brighter-flow-20722354`, `engage-nest-space-71c70a06`, `focussphere-51789`. Nenhum foi alterado; nenhuma credencial, dado pessoal ou conteúdo de marca foi copiado — apenas padrões de componente e estrutura, adaptados à identidade e ao modelo de dados do HP.

## Brighter Core → layout administrativo
**Encontrado:** `AdminSidebar.tsx` (576 linhas) com sidebar recolhível persistida em `localStorage`, grupos com rótulo maiúsculo, item ativo com barra lateral, `AdminHeader.tsx` com submenu por seção, tema claro/escuro via `useTheme`, `framer-motion` para abrir/fechar grupos, drawer mobile com overlay.
**Aproveitado:** estrutura de sidebar recolhível + persistida, agrupamento por seção com rótulo maiúsculo, indicador de item ativo com barra lateral, header compacto sticky, drawer mobile via `Sheet` (shadcn) em vez de `framer-motion` (evita nova dependência de animação).
**Equivalente HP:** `src/components/hp/AppShell.tsx` + `src/components/hp/nav.ts` + `src/styles/app.css`. Cor de marca: azul institucional (`--sb-bg`) em vez do preto/dourado da Brighter — nunca importado.
**Diferença:** Brighter Core guarda a ordem do menu editável pelo usuário (`adminNavConfig`) — não replicado (fora do escopo pedido). Brighter usa `framer-motion`; HP usa CSS puro para manter o bundle simples.

## Brighter Flow → CRM
**Encontrado:** `pages/Pipeline.tsx` com `@dnd-kit/core` (`DndContext`, `PointerSensor`), `components/deals/StageColumn.tsx`, `DealCard.tsx` (413 linhas), `DealCardMenu.tsx` (menu de ações via `DropdownMenu`), `DealSheet.tsx` (969 linhas, painel lateral completo), `PipelineFiltersDropdown.tsx`.
**Aproveitado:** `@dnd-kit` para arrastar cards com sobreposição de arraste (`DragOverlay`) e sensor de teclado; menu de ações "⋯" por card (mover para etapa, marcar ganha/perdida) como alternativa ao arraste; painel lateral com abas (resumo/histórico/tarefas) no lugar do `DealSheet` gigante.
**Equivalente HP:** `src/pages/admin/CRM.tsx` + `src/pages/admin/crm/{types.ts,OpportunitySheet.tsx}`. Já existia CRM funcional (funis, tarefas, histórico); o que mudou foi só a experiência (colunas com largura fixa e rolagem restrita ao quadro, cards compactos, menu contextual, drag-and-drop persistido com atualização otimista e reversão em erro).
**Diferença:** Brighter Flow tem `ChatwootChat`/`MessageBlast` (WhatsApp e disparo em massa) — **não replicado**: o HP não tem provedor de mensageria conectado (ver `integrations.md`), e o prompt original proíbe apresentar isso como conectado.

## Engage Nest → Academy/comunidade
**Encontrado:** `pages/Courses.tsx`/`CourseDetail.tsx`/`LessonDetail.tsx`, `components/courses/CourseCard.tsx` (capa + badges de tier + progresso), `LockedLessonScreen.tsx` (bloqueio por liberação programada), `components/comments/CommentCard.tsx`, `components/spaces` (comunidades por espaço).
**Aproveitado:** cartão de curso com capa, badge de estado (novo/andamento/concluído) e barra de progresso; "continuar de onde parou"; navegação por módulos/aulas com indicador de concluída; discussão em thread (pergunta + respostas) na aba Comunidade.
**Equivalente HP:** `src/pages/portal/Academy.tsx` (já existia o acesso por compra/turma/manual com revogação no servidor — mantido integralmente). A capa usa um gradiente gerado localmente (sem imagem externa) em vez de upload de capa (fora do escopo desta etapa).
**Diferença:** Engage Nest tem tiers de assinatura (free/pro/vip) e "espaços" multi-curso — o HP usa `entitlements` por curso (mais simples e já compatível com compra/turma/liberação manual). Engage Nest expõe `VideoPlayer.tsx` para vídeo próprio — o HP continua usando Supabase Storage com URL assinada (vídeo de provedor externo segue pendente, ver `integrations.md`).

## FocusSphere → produtividade (pendente, próxima etapa)
Ainda não iniciado nesta sessão. Inspeção preliminar: `pages/Planner.tsx`, `Focus.tsx`, `Goals.tsx`, `components/DailyTimeline.tsx`, `DraggableTask.tsx`, `EisenhowerMatrix.tsx`, `kanban/`, e também `SaudeEmocional.tsx`/`Penseira.tsx`/`MeusPacientes*` (diário emocional e prontuário de pacientes de psicólogo — **fora do escopo**, não será importado). Plano: reaproveitar `DailyTimeline`/`EisenhowerMatrix`/visão diária-semanal, ligando tarefas à agenda clínica existente (`appointments`) e ao CRM (`crm_tasks`) por relação explícita, nunca como uma segunda fonte de compromissos.
