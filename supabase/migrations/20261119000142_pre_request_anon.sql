-- HP Group Hub — 142 O pré-request da API (`public.hp_pre_request`, configurado no papel authenticator) roda em TODA chamada, inclusive sem login (papel anon).
-- Sem EXECUTE para anon, qualquer chamada pública (páginas públicas, avaliação, marca por endereço) falha com "permission denied for function hp_pre_request".
-- A migration 128 já concedia a anon; o Dev estava sem essa concessão (achado nos testes do white label: marca por endereço na tela de login). Idempotente e sem efeito de segurança:
-- a função só LÊ cabeçalhos e valida vínculos quando há usuário autenticado (anon não tem auth.uid(); ver o ramo `(select auth.uid()) is not null`).
revoke all on function public.hp_pre_request() from public;
grant execute on function public.hp_pre_request() to anon, authenticated, service_role;
