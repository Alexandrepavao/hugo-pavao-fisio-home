-- HP Group Hub — 030 Conciliação: reimportar o mesmo extrato não duplica linha. Achado ao escrever o teste
-- dedicado de conciliação (item 6): bank_statement_import() inseria cada linha sem checar se ela já existia
-- de uma importação anterior — reenviar o mesmo CSV (ex.: usuário confuso se já importou, ou reenvio por engano)
-- dobrava as linhas pendentes de conciliação. Idempotência é pelo CONTEÚDO da linha (conta + data + descrição +
-- valor + referência), não pelo id da importação — cada arquivo pode gerar um novo bank_statement_imports, mas
-- uma linha idêntica a uma já existente (de qualquer importação anterior da mesma conta) é ignorada, contada
-- à parte. Retorno passa de uuid para jsonb (import_id/inserted/duplicates) para o relatório poder distinguir.
drop function if exists public.bank_statement_import(uuid, jsonb);

create or replace function public.bank_statement_import(p_account uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.current_org(); v_unit uuid; v_import uuid; ln jsonb; v_amount bigint; v_n int := 0; v_dup int := 0;
  v_date date; v_desc text; v_ref text;
begin
  select unit_id into v_unit from public.financial_accounts where id = p_account and org_id = v_org;
  if v_unit is null or not private.can_finance(v_unit) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'inclua ao menos uma linha do extrato'; end if;
  if jsonb_array_length(p_lines) > 2000 then raise exception 'no máximo 2000 linhas por importação'; end if;
  insert into public.bank_statement_imports (org_id, unit_id, account_id, imported_by) values (v_org, v_unit, p_account, (select auth.uid())) returning id into v_import;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_amount := (ln ->> 'amount_cents')::bigint;
    if v_amount = 0 or (ln ->> 'date') is null or coalesce(btrim(ln ->> 'description'), '') = '' then continue; end if;
    v_date := (ln ->> 'date')::date; v_desc := btrim(ln ->> 'description'); v_ref := ln ->> 'ref';
    if exists (select 1 from public.bank_statement_lines x join public.bank_statement_imports i on i.id = x.import_id
        where i.account_id = p_account and x.txn_date = v_date and x.description = v_desc and x.amount_cents = v_amount
          and coalesce(x.external_ref, '') = coalesce(v_ref, '')) then
      v_dup := v_dup + 1; continue;
    end if;
    insert into public.bank_statement_lines (org_id, unit_id, import_id, txn_date, description, amount_cents, external_ref)
      values (v_org, v_unit, v_import, v_date, v_desc, v_amount, v_ref);
    v_n := v_n + 1;
  end loop;
  update public.bank_statement_imports set row_count = v_n where id = v_import;
  return jsonb_build_object('import_id', v_import, 'inserted', v_n, 'duplicates', v_dup);
end $$;

grant execute on function public.bank_statement_import(uuid, jsonb) to authenticated;
