-- Asserções do arquivo-modelo sintético (cada linha: [OK]/[FALHA] mensagem).
create or replace function pg_temp.chk(ok boolean, msg text) returns text language sql as $$ select format('[%s] %s', case when coalesce(ok, false) then 'OK' else 'FALHA' end, msg) $$;
create temp view q as select 'estabelecimentos (rfb)' as metrica, count(*)::text as valor, 'todas as situações' as obs from rfb.estabelecimentos
union all select 'estabelecimentos ativos (search)', count(*)::text, 'situação 2' from search.establishment
union all select 'empresas (rfb)', count(*)::text, '' from rfb.empresas
union all select 'sócios (rfb)', count(*)::text, '' from rfb.socios
union all select 'estabelecimentos SEM empresa correspondente', count(*)::text, 'precisam do mesmo lote de Empresas; se > 0 no piloto, os arquivos N de Empresas/Estabelecimentos não cobrem os mesmos CNPJs básicos' from rfb.estabelecimentos e where not exists (select 1 from rfb.empresas m where m.cnpj_basico = e.cnpj_basico)
union all select 'CNAE principal ausente da tabela de CNAEs', count(*)::text, '' from rfb.estabelecimentos e where e.cnae_principal is not null and not exists (select 1 from rfb.cnaes c where c.codigo = e.cnae_principal)
union all select 'município ausente da tabela de municípios', count(*)::text, '' from rfb.estabelecimentos e where e.municipio_cod is not null and not exists (select 1 from rfb.municipios c where c.codigo = e.municipio_cod)
union all select 'CNPJ com letras (alfanumérico)', count(*)::text, 'esperado crescer a partir de jul/2026' from rfb.estabelecimentos where cnpj ~ '[A-Z]'
union all select 'datas de início inválidas/zeradas', count(*)::text, 'viram NULL (ex.: 00000000, 20210231)' from stage.estabelecimentos where rfb.safe_date(btrim(data_inicio_atividade)) is null and btrim(coalesce(data_inicio_atividade, '')) <> ''
union all select 'capital social não numérico', count(*)::text, '' from stage.empresas where btrim(coalesce(capital_social, '')) <> '' and rfb.safe_money(capital_social) is null
union all select 'linhas rejeitadas por duplicidade (estabelecimentos)', ((select count(*) from stage.estabelecimentos) - (select count(*) from rfb.estabelecimentos))::text, 'duplicadas na origem'
union all select 'carga: linhas no arquivo × carregadas divergentes', count(*)::text, 'rfb.import_runs com rows_in_file <> rows_loaded' from rfb.import_runs where rows_in_file is distinct from rows_loaded;
select pg_temp.chk((select count(*) from rfb.import_runs where status <> 'ok' or rows_in_file is distinct from rows_loaded) = 0, 'toda carga: linhas do arquivo = linhas carregadas (nenhuma perdida em silêncio)');
select pg_temp.chk((select count(*) from rfb.import_runs) = 10, 'dez arquivos registrados em import_runs (6 apoio + empresas, estabelecimentos, sócios, simples)  — obtido ' || (select count(*) from rfb.import_runs));
select pg_temp.chk((select razao_social from rfb.empresas where cnpj_basico = '12ABC345') = 'CLÍNICA ALFA; SAÚDE & CIA "LTDA"', 'campo com ponto e vírgula, aspas dobradas e acentos Latin-1 chegou intacto');
select pg_temp.chk((select count(*) from rfb.estabelecimentos where cnpj = '12ABC345000173') = 1, 'CNPJ alfanumérico preservado como texto (12ABC345000173)');
select pg_temp.chk((select capital_social from rfb.empresas where cnpj_basico = '12ABC345') = 1000000.00 and (select capital_social from rfb.empresas where cnpj_basico = '55544433') is null, 'capital social: vírgula decimal convertida; texto inválido vira NULL');
select pg_temp.chk((select count(*) from rfb.estabelecimentos where data_inicio is null and cnpj_basico = '99887766') = 2, 'data zerada (00000000) e inexistente (20210231) viram NULL sem derrubar a carga');
select pg_temp.chk((select array_length(cnae_secundarios, 1) from rfb.estabelecimentos where cnpj = '11222333000181') = 2, 'CNAEs secundários separados em lista');
select pg_temp.chk((select count(*) from rfb.estabelecimentos) = 5 and (select count(*) from rfb.empresas) = 4 and (select count(*) from rfb.socios) = 3, 'contagens rfb: 5 estabelecimentos, 4 empresas, 3 sócios');
select pg_temp.chk((select count(*) from search.establishment) = 3, 'pesquisa só tem ATIVOS com empresa correspondente (3 de 5: baixada e órfã ficam de fora)');
select pg_temp.chk((select qtd_socios from search.establishment where cnpj = '11222333000181') = 2, 'quantidade de sócios na pesquisa');
select pg_temp.chk((select doc_mascarado from rfb.socios where nome_socio = 'MARIA APARECIDA DA SILVA') = '***123456**', 'CPF do sócio permanece MASCARADO como na origem');
select pg_temp.chk((select n_total from search.rollup where uf = 'SP' and municipio_cod = '6475' and cnae_principal = '1091102') = 1 and (select n_telefone_cadastral from search.rollup where uf = 'SP' and municipio_cod = '6475' and cnae_principal = '1091102') = 1, 'rollup exato: total e telefone cadastral');
select pg_temp.chk((select sum(n_total) from search.rollup where uf = 'SP') = 2 and (select sum(n_telefone_cadastral) from search.rollup where uf = 'SP') = 1 and (select sum(n_email_cadastral) from search.rollup where uf = 'SP') = 1, 'rollup SP: 2 empresas, 1 com telefone cadastral, 1 com e-mail cadastral (ausência de dado ≠ inexistência)');
select pg_temp.chk((select count(*) from search.establishment where rfb.f_norm(coalesce(razao_social, '') || ' ' || coalesce(nome_fantasia, '')) like '%pao quente%') = 1, 'busca de nome sem acento (pao quente) encontra "PÃO QUENTE"');
select pg_temp.chk((select valor::int from q where metrica = 'estabelecimentos SEM empresa correspondente') = 1, 'qualidade: 1 estabelecimento órfão (sem empresa) é REPORTADO, não escondido');
select pg_temp.chk((select valor::int from q where metrica = 'CNAE principal ausente da tabela de CNAEs') = 1, 'qualidade: 1 CNAE ausente da tabela é reportado');
select pg_temp.chk((select valor::int from q where metrica = 'município ausente da tabela de municípios') = 1, 'qualidade: 1 município ausente é reportado');
select pg_temp.chk((select valor::int from q where metrica = 'CNPJ com letras (alfanumérico)') = 1, 'qualidade: CNPJ alfanumérico contado');
select pg_temp.chk((select valor::int from q where metrica = 'datas de início inválidas/zeradas') = 2, 'qualidade: 2 datas inválidas contadas (viram NULL)');
