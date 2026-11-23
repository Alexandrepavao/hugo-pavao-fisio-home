-- stage.* -> rfb.* (tipado). Uso: psql -v source_month="'2026-11-01'" -f 002_transform.sql
-- Recarga completa do mês: limpa rfb.* e reconstrói (a troca atômica entre bancos/esquemas fica para a fase de produção do pipeline).
\set ON_ERROR_STOP on
begin;
truncate rfb.cnaes, rfb.municipios, rfb.naturezas, rfb.qualificacoes, rfb.paises, rfb.motivos, rfb.empresas, rfb.estabelecimentos, rfb.socios, rfb.simples;

insert into rfb.cnaes select btrim(codigo), btrim(descricao) from stage.cnaes where btrim(coalesce(codigo, '')) <> '' on conflict do nothing;
insert into rfb.municipios select btrim(codigo), btrim(descricao) from stage.municipios where btrim(coalesce(codigo, '')) <> '' on conflict do nothing;
insert into rfb.naturezas select btrim(codigo), btrim(descricao) from stage.naturezas where btrim(coalesce(codigo, '')) <> '' on conflict do nothing;
insert into rfb.qualificacoes select btrim(codigo), btrim(descricao) from stage.qualificacoes where btrim(coalesce(codigo, '')) <> '' on conflict do nothing;
insert into rfb.paises select btrim(codigo), btrim(descricao) from stage.paises where btrim(coalesce(codigo, '')) <> '' on conflict do nothing;
insert into rfb.motivos select btrim(codigo), btrim(descricao) from stage.motivos where btrim(coalesce(codigo, '')) <> '' on conflict do nothing;

insert into rfb.empresas
select upper(btrim(cnpj_basico)), rfb.nullif_blank(razao_social), rfb.nullif_blank(natureza_juridica), rfb.nullif_blank(qualificacao_responsavel), rfb.safe_money(capital_social),
       case when btrim(porte) in ('00', '01', '03', '05') then btrim(porte) end, rfb.nullif_blank(ente_federativo), :source_month::date
from stage.empresas where btrim(coalesce(cnpj_basico, '')) <> ''
on conflict (cnpj_basico) do nothing;

insert into rfb.estabelecimentos (cnpj_basico, cnpj_ordem, cnpj_dv, matriz, nome_fantasia, situacao, data_situacao, motivo_situacao, pais, data_inicio, cnae_principal, cnae_secundarios,
  tipo_logradouro, logradouro, numero, complemento, bairro, cep, uf, municipio_cod, ddd1, telefone1, ddd2, telefone2, email, situacao_especial, data_situacao_especial, source_month)
select upper(btrim(cnpj_basico)), upper(btrim(cnpj_ordem)), btrim(cnpj_dv), (btrim(identificador_matriz_filial) = '1'), rfb.nullif_blank(nome_fantasia),
       case when btrim(situacao_cadastral) ~ '^[0-9]+$' then btrim(situacao_cadastral)::smallint end, rfb.safe_date(btrim(data_situacao_cadastral)), rfb.nullif_blank(motivo_situacao_cadastral),
       rfb.nullif_blank(pais), rfb.safe_date(btrim(data_inicio_atividade)), rfb.nullif_blank(cnae_fiscal_principal),
       case when rfb.nullif_blank(cnae_fiscal_secundaria) is null then null else string_to_array(btrim(cnae_fiscal_secundaria), ',') end,
       rfb.nullif_blank(tipo_logradouro), rfb.nullif_blank(logradouro), rfb.nullif_blank(numero), rfb.nullif_blank(complemento), rfb.nullif_blank(bairro), rfb.nullif_blank(cep),
       upper(rfb.nullif_blank(uf)), rfb.nullif_blank(municipio), rfb.nullif_blank(ddd1), rfb.nullif_blank(telefone1), rfb.nullif_blank(ddd2), rfb.nullif_blank(telefone2),
       lower(rfb.nullif_blank(correio_eletronico)), rfb.nullif_blank(situacao_especial), rfb.safe_date(btrim(data_situacao_especial)), :source_month::date
from stage.estabelecimentos where btrim(coalesce(cnpj_basico, '')) <> ''
on conflict (cnpj_basico, cnpj_ordem, cnpj_dv) do nothing;

insert into rfb.socios (cnpj_basico, identificador_socio, nome_socio, doc_mascarado, qualificacao_socio, data_entrada, pais, representante_legal_mascarado, nome_representante, qualificacao_representante, faixa_etaria, source_month)
select upper(btrim(cnpj_basico)), case when btrim(identificador_socio) ~ '^[0-9]+$' then btrim(identificador_socio)::smallint end, rfb.nullif_blank(nome_socio), rfb.nullif_blank(cnpj_cpf_socio),
       rfb.nullif_blank(qualificacao_socio), rfb.safe_date(btrim(data_entrada_sociedade)), rfb.nullif_blank(pais), rfb.nullif_blank(representante_legal), rfb.nullif_blank(nome_representante),
       rfb.nullif_blank(qualificacao_representante), rfb.nullif_blank(faixa_etaria), :source_month::date
from stage.socios where btrim(coalesce(cnpj_basico, '')) <> '';

insert into rfb.simples
select upper(btrim(cnpj_basico)), (btrim(opcao_simples) = 'S'), rfb.safe_date(btrim(data_opcao_simples)), rfb.safe_date(btrim(data_exclusao_simples)),
       (btrim(opcao_mei) = 'S'), rfb.safe_date(btrim(data_opcao_mei)), rfb.safe_date(btrim(data_exclusao_mei)), :source_month::date
from stage.simples where btrim(coalesce(cnpj_basico, '')) <> '' on conflict (cnpj_basico) do nothing;

create index if not exists socios_basico_idx on rfb.socios (cnpj_basico);
create index if not exists estab_basico_idx on rfb.estabelecimentos (cnpj_basico);
commit;
analyze rfb.empresas; analyze rfb.estabelecimentos; analyze rfb.socios; analyze rfb.simples;
