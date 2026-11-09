-- HP Group Hub — 111 Marketing: o gatilho de higienização roda como definidor (quem envia o formulário/quiz — inclusive anônimo — não tem EXECUTE nas funções privadas).
create or replace function private.mkt_sanitize_origin() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name in ('form_submissions','quiz_leads','page_visits') then
    new.utm := case when new.utm is null and tg_table_name = 'form_submissions' then null else private.mkt_clean_utm(new.utm) end;
    new.referrer := private.mkt_clean_url(new.referrer);
  elsif tg_table_name = 'opportunities' then
    new.utm := case when new.utm is null then null else private.mkt_clean_utm(new.utm) end;
  end if;
  if tg_table_name = 'quiz_leads' then new.origin_path := private.mkt_clean_url(new.origin_path); end if;
  return new;
end $$;
revoke all on function private.mkt_sanitize_origin() from public, anon, authenticated;
