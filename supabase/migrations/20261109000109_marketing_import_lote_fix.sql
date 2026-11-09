-- HP Group Hub — 109 Marketing: corrige a importação manual em lote (busca da conta pelo nome usava HAVING sem agregado).
create or replace function public.mkt_spend_manual_import(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.mkt_require_admin(); r jsonb; i int := 0; ok int := 0; errs jsonb := '[]'::jsonb; v_acc uuid; v_camp uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'envie até 2000 linhas'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      -- conta MANUAL pelo nome, dentro da organização; nome ambíguo é erro (nada é escolhido às cegas)
      select min(a.id::text)::uuid into v_acc from public.mkt_ad_accounts a where a.org_id = v_org and a.selected and a.origin = 'manual' and lower(a.name) = lower(btrim(r ->> 'account'))
        and (r ->> 'platform' is null or a.platform = r ->> 'platform') having count(*) = 1;
      if v_acc is null then raise exception 'conta manual não encontrada (ou nome ambíguo): %', coalesce(r ->> 'account', '(vazio)'); end if;
      select c.id into v_camp from public.mkt_campaigns c where c.account_id = v_acc and lower(c.name) = lower(btrim(r ->> 'campaign')) limit 1;
      if v_camp is null then v_camp := public.mkt_manual_campaign_create(v_acc, r ->> 'campaign'); end if;
      perform public.mkt_spend_manual_upsert(v_camp, (r ->> 'day')::date, replace(r ->> 'amount', ',', '.')::numeric, r ->> 'currency', null, null, 'importação em lote', coalesce((r ->> 'prefer_manual')::boolean, false));
      ok := ok + 1;
    exception when others then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('imported', ok, 'errors', errs);
end $$;
revoke all on function public.mkt_spend_manual_import(jsonb) from public, anon; grant execute on function public.mkt_spend_manual_import(jsonb) to authenticated;
