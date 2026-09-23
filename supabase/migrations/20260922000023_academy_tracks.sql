-- HP Group Hub — 023 Trilhas do HP Academy (formação empresarial): agrupam cursos/mentorias já existentes em uma
-- sequência recomendada. Não duplica courses/lessons — é só ordenação. Semeadas como RASCUNHO (nunca publicadas
-- automaticamente) e sem nenhum curso vinculado ainda: é uma proposta editorial de estrutura, não conteúdo
-- inventado (nenhuma aula gravada, professor ou certificado é criado aqui). Ver docs/reference-audit.md.

create table public.learning_tracks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) > 1),
  description text,
  position int not null default 0,
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
create trigger learning_tracks_touch before update on public.learning_tracks for each row execute function private.touch_updated_at();

create table public.learning_track_courses (
  track_id uuid not null references public.learning_tracks(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  position int not null default 0,
  primary key (track_id, course_id)
);

alter table public.learning_tracks enable row level security;
alter table public.learning_track_courses enable row level security;
grant select, insert, update on public.learning_tracks to authenticated;
grant select, insert, delete on public.learning_track_courses to authenticated;

-- Mesma regra de leitura de cursos: quem gerencia vê tudo; os demais só trilhas publicadas.
create policy tracks_read on public.learning_tracks for select to authenticated using (private.in_org(org_id) and (private.can_manage_courses() or status = 'published'));
create policy tracks_write on public.learning_tracks for insert to authenticated with check (private.in_org(org_id) and private.can_manage_courses() and created_by = (select auth.uid()));
create policy tracks_update on public.learning_tracks for update to authenticated using (private.in_org(org_id) and private.can_manage_courses()) with check (private.in_org(org_id));
create policy track_courses_read on public.learning_track_courses for select to authenticated using (exists (select 1 from public.learning_tracks t where t.id = track_id and (private.can_manage_courses() or t.status = 'published')));
create policy track_courses_write on public.learning_track_courses for insert to authenticated with check (exists (select 1 from public.learning_tracks t where t.id = track_id and private.in_org(t.org_id) and private.can_manage_courses()));
create policy track_courses_delete on public.learning_track_courses for delete to authenticated using (exists (select 1 from public.learning_tracks t where t.id = track_id and private.can_manage_courses()));

create trigger audit_learning_tracks after insert or update on public.learning_tracks for each row execute function private.audit_row('title','status');

-- Proposta editorial (RASCUNHO, sem cursos vinculados) — quem gerencia o Academy decide o que publicar e com qual conteúdo real.
insert into public.learning_tracks (org_id, slug, title, description, position, status)
select o.id, t.slug, t.title, t.description, t.position, 'draft' from public.organizations o, (values
  ('comece-por-aqui', 'Comece por aqui', 'Diagnóstico do negócio e plano de desenvolvimento', 1),
  ('precificacao', 'Precificação', 'Custos, capacidade, hora de atendimento, margem, pacotes e descontos', 2),
  ('posicionamento', 'Posicionamento', 'Público, proposta de valor, diferenciação e marca', 3),
  ('comercial', 'Comercial', 'Atendimento, avaliação, proposta, negociação e acompanhamento', 4),
  ('marketing', 'Marketing', 'Conteúdo, canais, campanhas e mensuração', 5),
  ('gestao-financeira', 'Gestão financeira', 'Caixa, DRE, metas, recorrência e indicadores', 6),
  ('operacao', 'Operação', 'Agenda, processos, equipe e experiência do paciente', 7),
  ('crescimento', 'Crescimento', 'Parcerias, expansão e planejamento', 8)
) t(slug, title, description, position)
where o.slug = 'hp-group' on conflict (org_id, slug) do nothing;
