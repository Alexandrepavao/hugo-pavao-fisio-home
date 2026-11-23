-- Data Platform da Receita (Prospecção B2B, Fase 2). BANCO SEPARADO do ERP: nada aqui tem org_id nem dado de cliente.
-- Fonte: dados abertos do CNPJ (Receita Federal), licença Creative Commons Atribuição — citar a fonte e a data de referência nas telas.
-- Camadas: stage.* (carga bruta, tudo texto, descartável) -> rfb.* (tipado, fiel ao layout oficial) -> search.* (denormalizado só para pesquisa).
-- CNPJ = TEXTO (o básico e o CNPJ completo podem ter letras desde jul/2026).
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create schema if not exists stage; create schema if not exists rfb; create schema if not exists search;

create schema if not exists rfb;
-- normalização de texto para busca: SEM acento e minúsculas (imutável, para poder indexar). Remove o acento ANTES de baixar a caixa: com locale C, lower() só mexe em ASCII.
create or replace function rfb.f_norm(v text) returns text language sql immutable parallel safe strict as $$ select lower(public.unaccent('public.unaccent', v)) $$;

-- ---------------------------------------------------------------- stage (ordem das colunas = layout oficial dos CSV, sem cabeçalho, ';' e aspas, ISO-8859-1)
create table if not exists stage.empresas (cnpj_basico text, razao_social text, natureza_juridica text, qualificacao_responsavel text, capital_social text, porte text, ente_federativo text);
create table if not exists stage.estabelecimentos (
  cnpj_basico text, cnpj_ordem text, cnpj_dv text, identificador_matriz_filial text, nome_fantasia text, situacao_cadastral text, data_situacao_cadastral text, motivo_situacao_cadastral text,
  nome_cidade_exterior text, pais text, data_inicio_atividade text, cnae_fiscal_principal text, cnae_fiscal_secundaria text, tipo_logradouro text, logradouro text, numero text, complemento text,
  bairro text, cep text, uf text, municipio text, ddd1 text, telefone1 text, ddd2 text, telefone2 text, ddd_fax text, fax text, correio_eletronico text, situacao_especial text, data_situacao_especial text);
create table if not exists stage.socios (cnpj_basico text, identificador_socio text, nome_socio text, cnpj_cpf_socio text, qualificacao_socio text, data_entrada_sociedade text, pais text,
  representante_legal text, nome_representante text, qualificacao_representante text, faixa_etaria text);
create table if not exists stage.simples (cnpj_basico text, opcao_simples text, data_opcao_simples text, data_exclusao_simples text, opcao_mei text, data_opcao_mei text, data_exclusao_mei text);
create table if not exists stage.cnaes (codigo text, descricao text);
create table if not exists stage.municipios (codigo text, descricao text);
create table if not exists stage.naturezas (codigo text, descricao text);
create table if not exists stage.qualificacoes (codigo text, descricao text);
create table if not exists stage.paises (codigo text, descricao text);
create table if not exists stage.motivos (codigo text, descricao text);

-- ---------------------------------------------------------------- funções de conversão (nunca derrubam a carga por um dado ruim)
create or replace function rfb.safe_date(v text) returns date language plpgsql immutable as $$
begin
  if v is null or v !~ '^[0-9]{8}$' or v = '00000000' then return null; end if;
  return to_date(v, 'YYYYMMDD');
exception when others then return null;   -- ex.: 20210231
end $$;
create or replace function rfb.safe_money(v text) returns numeric language plpgsql immutable as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return replace(replace(btrim(v), '.', ''), ',', '.')::numeric;   -- o arquivo usa vírgula decimal
exception when others then return null;
end $$;
create or replace function rfb.nullif_blank(v text) returns text language sql immutable as $$ select nullif(btrim(v), '') $$;

-- ---------------------------------------------------------------- rfb (tipado)
create table if not exists rfb.import_runs (
  id bigserial primary key, source_month date not null, file_name text not null, kind text not null,
  rows_in_file bigint, rows_loaded bigint, sha256 text, started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')), note text);
create table if not exists rfb.cnaes (codigo text primary key, descricao text not null);
create table if not exists rfb.municipios (codigo text primary key, descricao text not null);
create table if not exists rfb.naturezas (codigo text primary key, descricao text not null);
create table if not exists rfb.qualificacoes (codigo text primary key, descricao text not null);
create table if not exists rfb.paises (codigo text primary key, descricao text not null);
create table if not exists rfb.motivos (codigo text primary key, descricao text not null);

create table if not exists rfb.empresas (
  cnpj_basico text primary key, razao_social text, natureza_juridica text, qualificacao_responsavel text, capital_social numeric(18, 2),
  porte text check (porte in ('00', '01', '03', '05') or porte is null),           -- 00 não informado, 01 micro, 03 pequeno, 05 demais
  ente_federativo text, source_month date not null);

create table if not exists rfb.estabelecimentos (
  cnpj_basico text not null, cnpj_ordem text not null, cnpj_dv text not null,
  cnpj text generated always as (cnpj_basico || cnpj_ordem || cnpj_dv) stored,
  matriz boolean, nome_fantasia text,
  situacao smallint,                                                              -- 1 nula, 2 ativa, 3 suspensa, 4 inapta, 8 baixada
  data_situacao date, motivo_situacao text, pais text, data_inicio date,
  cnae_principal text, cnae_secundarios text[],
  tipo_logradouro text, logradouro text, numero text, complemento text, bairro text, cep text, uf text, municipio_cod text,
  ddd1 text, telefone1 text, ddd2 text, telefone2 text, email text, situacao_especial text, data_situacao_especial date,
  source_month date not null,
  primary key (cnpj_basico, cnpj_ordem, cnpj_dv));
create table if not exists rfb.socios (
  id bigserial primary key, cnpj_basico text not null, identificador_socio smallint,                -- 1 PJ, 2 PF, 3 estrangeiro
  nome_socio text, doc_mascarado text,                                            -- CPF já vem MASCARADO da Receita (***123456**); nunca tentar reconstruir
  qualificacao_socio text, data_entrada date, pais text, representante_legal_mascarado text, nome_representante text, qualificacao_representante text, faixa_etaria text, source_month date not null);
create table if not exists rfb.simples (cnpj_basico text primary key, opcao_simples boolean, data_opcao_simples date, data_exclusao_simples date, opcao_mei boolean, data_opcao_mei date, data_exclusao_mei date, source_month date not null);
