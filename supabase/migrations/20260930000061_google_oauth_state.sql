-- HP Group Hub — 061 State do OAuth do Google com USO ÚNICO.
-- O "state" já era assinado (HMAC) e expirava em 10 min, mas o nonce dele nunca era guardado nem consumido: o mesmo callback podia ser repetido dentro da janela.
-- Agora a Edge Function google-calendar grava o nonce ao iniciar (POST /start) e o CONSOME (apaga) ao receber o callback; repetir o state, ou usar um state
-- assinado que nunca foi emitido, é recusado. Tabela só do servidor (service_role): sem política e sem GRANT para anon/authenticated.
create table public.google_oauth_states (
  nonce uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index google_oauth_states_expiry_idx on public.google_oauth_states (expires_at);
alter table public.google_oauth_states enable row level security;
revoke all on public.google_oauth_states from public, anon, authenticated;
