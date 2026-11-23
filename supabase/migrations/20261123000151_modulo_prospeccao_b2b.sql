-- Prospecção B2B — Fase 1: registro do módulo no catálogo da plataforma (somente o catálogo).
-- NÃO cria tabelas, funções, créditos nem integrações: isso vem nas fases seguintes, cada uma com a sua aprovação.
-- Estado `experimental`: a plataforma habilita por organização (Plataforma ▸ Organizações ▸ módulos); nenhuma organização recebe o módulo automaticamente.
-- `enforcement = none` por enquanto, porque ainda não existe nenhum objeto de banco a proteger; quando as tabelas b2b_* / core_wallet* nascerem (Fases 2–4),
-- esta linha passa a `rls_rpc` e os padrões entram em platform_module_objects na MESMA migration que criar as tabelas.

insert into public.platform_modules (key, name, description, status, core, enforcement, routes, permissions, usage_metrics, sort) values
  ('prospeccao_b2b', 'Prospecção B2B', 'Inteligência comercial: pesquisa de empresas brasileiras por atividade e cidade (base pública da Receita Federal), prévia gratuita, empresas liberadas por créditos, decisores, contatos com origem e envio ao CRM.',
   'experimental', false, 'none', '{/admin/prospeccao}', '{manager,sales}', '{}', 14)
on conflict (key) do nothing;

insert into public.platform_module_deps (module_key, requires) values ('prospeccao_b2b', 'crm') on conflict do nothing;
