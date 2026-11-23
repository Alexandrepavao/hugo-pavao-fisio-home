-- rfb.* -> search.* (denormalizado, SÓ estabelecimentos ATIVOS na v1; inativos continuam em rfb.estabelecimentos).
-- search.establishment é o que a pesquisa consulta; search.rollup guarda contagens EXATAS pré-agregadas (prévia gratuita instantânea).
-- Contagens de contato = o que existe no cadastro da Receita ("cadastral"), nunca "confirmado": enriquecimento e verificação são outra camada.
\set ON_ERROR_STOP on
begin;
drop table if exists search.rollup; drop table if exists search.establishment;
create table search.establishment as
select e.cnpj, e.cnpj_basico, em.razao_social, e.nome_fantasia, e.cnae_principal, e.cnae_secundarios, e.uf, e.municipio_cod, m.descricao as municipio, e.cep, e.bairro,
       em.porte, em.capital_social, em.natureza_juridica, e.matriz, e.data_inicio,
       coalesce(s.opcao_simples, false) as simples, coalesce(s.opcao_mei, false) as mei,
       (e.telefone1 is not null) as tem_telefone_cadastral, (e.email is not null) as tem_email_cadastral,
       coalesce(so.n, 0)::int as qtd_socios, e.source_month
from rfb.estabelecimentos e
join rfb.empresas em on em.cnpj_basico = e.cnpj_basico
left join rfb.municipios m on m.codigo = e.municipio_cod
left join rfb.simples s on s.cnpj_basico = e.cnpj_basico
left join (select cnpj_basico, count(*) n from rfb.socios group by 1) so on so.cnpj_basico = e.cnpj_basico
where e.situacao = 2;
alter table search.establishment add primary key (cnpj);
create index est_geo_cnae_idx on search.establishment (uf, municipio_cod, cnae_principal);
create index est_cnae_idx on search.establishment (cnae_principal);
create index est_cnae2_gin on search.establishment using gin (cnae_secundarios);
create index est_porte_idx on search.establishment (porte);
create index est_inicio_idx on search.establishment (data_inicio);
create index est_nome_trgm on search.establishment using gin (rfb.f_norm(coalesce(razao_social, '') || ' ' || coalesce(nome_fantasia, '')) gin_trgm_ops);

create table search.rollup as
select uf, municipio_cod, cnae_principal, porte, matriz,
       count(*)::bigint as n_total,
       count(*) filter (where tem_telefone_cadastral)::bigint as n_telefone_cadastral,
       count(*) filter (where tem_email_cadastral)::bigint as n_email_cadastral,
       count(*) filter (where qtd_socios > 0)::bigint as n_com_qsa,
       count(*) filter (where simples)::bigint as n_simples, count(*) filter (where mei)::bigint as n_mei,
       max(source_month) as source_month
from search.establishment group by uf, municipio_cod, cnae_principal, porte, matriz;
create index rollup_idx on search.rollup (uf, municipio_cod, cnae_principal);
commit;
analyze search.establishment; analyze search.rollup;
