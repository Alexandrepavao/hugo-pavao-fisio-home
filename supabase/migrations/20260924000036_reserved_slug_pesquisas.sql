-- HP Group Hub — 036 /pesquisas é uma rota fixa do portal (item A desta fase) — faltava na lista de slugs
-- reservados do banco, então uma página do editor poderia ter sido criada com esse endereço e ficar inalcançável
-- (a rota fixa sempre vence no roteador). Mantém private.is_reserved_slug() em sincronia com src/lib/reserved-slugs.ts.
create or replace function private.is_reserved_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(s) = any (array['admin','login','logout','academy','portal','api','redefinir-senha','primeiro-acesso',
    'trabalhe-conosco','paciente','parceiro','pesquisas','auth','assets','static','favicon.png','robots.txt','sitemap.xml',
    'netlify','supabase','p','preview','hp','hub','sistema'])
$$;
