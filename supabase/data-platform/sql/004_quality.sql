-- Relatório de qualidade da carga (cada linha: métrica | valor | observação). Um valor inesperado NÃO é corrigido em silêncio: aparece aqui.
select 'estabelecimentos (rfb)' as metrica, count(*)::text as valor, 'todas as situações' as obs from rfb.estabelecimentos
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
