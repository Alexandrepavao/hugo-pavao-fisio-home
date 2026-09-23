-- HP Group Hub — 037 /confirmar é uma rota fixa de autenticação (confirmação de e-mail com identidade HP,
-- ver supabase/functions/auth-email-hook) — precisa constar nos slugs reservados do banco, senão uma página
-- do editor poderia ser criada com esse endereço e ficar inalcançável (a rota fixa sempre vence no roteador).
-- Mantém private.is_reserved_slug() em sincronia com src/lib/reserved-slugs.ts.
create or replace function private.is_reserved_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(s) = any (array['admin','login','logout','academy','portal','api','redefinir-senha','primeiro-acesso',
    'confirmar','trabalhe-conosco','paciente','parceiro','pesquisas','auth','assets','static','favicon.png','robots.txt','sitemap.xml',
    'netlify','supabase','p','preview','hp','hub','sistema'])
$$;
