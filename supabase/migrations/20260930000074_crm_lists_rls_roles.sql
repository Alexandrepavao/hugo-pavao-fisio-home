-- Listas do CRM: as políticas só exigiam pertencer à organização (private.in_org), então paciente, parceiro e fisioterapeuta conseguiam ler, criar e apagar listas
-- (e ligar pessoas a elas) chamando a API direto — a rota /admin/crm só era barrada na interface. Passam a exigir papel do CRM (gestor, adm. operacional, gestor de unidade
-- ou comercial). Quem lê/insere MEMBROS só vê/liga pessoas que já pode ler (outra unidade fica de fora). A importação CSV grava por função security definer e não é afetada.

drop policy if exists crm_lists_read on public.crm_lead_lists;
drop policy if exists crm_lists_write on public.crm_lead_lists;
drop policy if exists crm_lists_update on public.crm_lead_lists;
drop policy if exists crm_lists_delete on public.crm_lead_lists;
drop policy if exists crm_list_members_read on public.crm_lead_list_members;
drop policy if exists crm_list_members_write on public.crm_lead_list_members;
drop policy if exists crm_list_members_delete on public.crm_lead_list_members;

create policy crm_lists_read on public.crm_lead_lists for select to authenticated
  using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy crm_lists_write on public.crm_lead_lists for insert to authenticated
  with check (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy crm_lists_update on public.crm_lead_lists for update to authenticated
  using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]))
  with check (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy crm_lists_delete on public.crm_lead_lists for delete to authenticated
  using (private.in_org(org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[]));
create policy crm_list_members_read on public.crm_lead_list_members for select to authenticated
  using (private.can_read_person(person_id) and exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])));
create policy crm_list_members_write on public.crm_lead_list_members for insert to authenticated
  with check (private.can_read_person(person_id) and exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])));
create policy crm_list_members_delete on public.crm_lead_list_members for delete to authenticated
  using (exists (select 1 from public.crm_lead_lists l where l.id = list_id and private.in_org(l.org_id) and private.has_any_role(array['manager','ops_admin','unit_manager','sales']::public.app_role[])));
