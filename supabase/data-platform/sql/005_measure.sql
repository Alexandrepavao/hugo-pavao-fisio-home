-- Medições de latência da prévia gratuita (cada linha: consulta | resultado | tempo de execução em ms). CNAE 8650004 = Atividades de fisioterapia.
\timing off
create or replace function pg_temp.t(label text, q text) returns text language plpgsql as $$
declare t0 timestamptz; r text; ms numeric;
begin t0 := clock_timestamp(); execute q into r; ms := round(extract(epoch from clock_timestamp() - t0) * 1000, 1); return format('%s | %s | %s ms', label, r, ms); end $$;
select pg_temp.t('A rollup: fisioterapia em Santo André/SP (prévia)', $q$select coalesce(sum(n_total), 0)::text from search.rollup r join rfb.municipios m on m.codigo = r.municipio_cod where r.uf = 'SP' and m.descricao = 'SANTO ANDRE' and r.cnae_principal = '8650004'$q$);
select pg_temp.t('B exata: mesma pergunta em search.establishment', $q$select count(*)::text from search.establishment e join rfb.municipios m on m.codigo = e.municipio_cod where e.uf = 'SP' and m.descricao = 'SANTO ANDRE' and e.cnae_principal = '8650004'$q$);
select pg_temp.t('C rollup: fisioterapia no estado de SP', $q$select coalesce(sum(n_total), 0)::text from search.rollup where uf = 'SP' and cnae_principal = '8650004'$q$);
select pg_temp.t('D exata: fisioterapia no estado de SP', $q$select count(*)::text from search.establishment where uf = 'SP' and cnae_principal = '8650004'$q$);
select pg_temp.t('E rollup: fisioterapia no Brasil', $q$select coalesce(sum(n_total), 0)::text from search.rollup where cnae_principal = '8650004'$q$);
select pg_temp.t('F exata: fisioterapia no Brasil', $q$select count(*)::text from search.establishment where cnae_principal = '8650004'$q$);
select pg_temp.t('G exata: ativas no Brasil (varredura total)', $q$select count(*)::text from search.establishment$q$);
select pg_temp.t('H rollup: ativas no Brasil (soma)', $q$select sum(n_total)::text from search.rollup$q$);
select pg_temp.t('I texto sem acento "fisioterapia" em SP (trigrama)', $q$select count(*)::text from search.establishment where uf = 'SP' and rfb.f_norm(coalesce(razao_social, '') || ' ' || coalesce(nome_fantasia, '')) like '%fisioterapia%'$q$);
select pg_temp.t('J CNAE secundário 8650004 em SP (GIN)', $q$select count(*)::text from search.establishment where uf = 'SP' and cnae_secundarios @> array['8650004']$q$);
select pg_temp.t('K abertas há mais de 3 anos, SP, fisioterapia, capital > 100 mil', $q$select count(*)::text from search.establishment where uf = 'SP' and cnae_principal = '8650004' and data_inicio < current_date - interval '3 years' and capital_social > 100000$q$);
select pg_temp.t('L fisioterapia em SP com telefone cadastral', $q$select count(*)::text from search.establishment where uf = 'SP' and cnae_principal = '8650004' and tem_telefone_cadastral$q$);
