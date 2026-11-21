-- HP Group Hub — 141 /plataforma é rota fixa (administração da plataforma white label): precisa constar nos slugs reservados do banco, senão uma página do editor poderia ocupar esse endereço.
-- Mantém private.is_reserved_slug() em sincronia com src/lib/reserved-slugs.ts. (Lista anterior preservada integralmente.)
create or replace function private.is_reserved_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(s) = any (array['admin','login','logout','academy','portal','api','redefinir-senha','primeiro-acesso',
    'confirmar','trabalhe-conosco','paciente','parceiro','pesquisas','auth','assets','static','favicon.png','robots.txt','sitemap.xml',
    'netlify','supabase','p','preview','hp','hub','sistema','plataforma'])
$$;
