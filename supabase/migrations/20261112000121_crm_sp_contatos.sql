-- HP Group Hub — 121 CRM: todos os contatos de São Paulo capital com a zona que cada um cadastrou.
-- Usado pelo painel que desce logo abaixo da linha "São Paulo" em Distribuição geográfica (mapa das zonas + lista com a coluna Zona).
-- Só leitura e só acrescenta uma função: mesma regra de acesso e mesma base (private.crm_zone_base) das funções de zona da migration 118.
create or replace function public.crm_sp_contacts(p_kind text default null, p_unit uuid default null) returns table (
  person_id uuid, full_name text, phone text, email text, neighborhood text, zone text, kinds text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_any_role(array['manager','ops_admin','unit_manager','sales','finance']::public.app_role[]) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
  select b.person_id, b.name, b.phone, b.email, b.neighborhood, b.zone, b.kinds from private.crm_zone_base(p_kind, p_unit) b order by b.name limit 1000;
end $$;
revoke all on function public.crm_sp_contacts(text, uuid) from public, anon;
grant execute on function public.crm_sp_contacts(text, uuid) to authenticated;
