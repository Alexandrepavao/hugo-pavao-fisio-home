# Data Platform da Receita (Prospecção B2B — Fase 2)

Banco **separado do ERP**: sem `org_id`, sem dado de cliente. O ERP só lê por Edge Functions (nunca do navegador) e **copia** para o tenant o que ele adquire.
Fonte: dados abertos do CNPJ da Receita Federal — licença **Creative Commons Atribuição** (citar fonte e data de referência nas telas). Repositório oficial (2026): `arquivos.receitafederal.gov.br` → `Dados/Cadastros/CNPJ/AAAA-MM` (37 arquivos, ~7,3 GB compactados em 2026-11).

| Camada | Arquivo | O que faz |
|---|---|---|
| `stage.*` | `sql/001_schema.sql` | carga bruta, tudo texto (ordem das colunas = layout oficial; CSV sem cabeçalho, `;`, aspas, ISO-8859-1) |
| `rfb.*` | `sql/002_transform.sql` | tipado e fiel ao layout; datas/valores inválidos viram `NULL` sem derrubar a carga; **CNPJ sempre texto** (alfanumérico desde jul/2026) |
| `search.*` | `sql/003_search.sql` | só estabelecimentos **ativos**, denormalizado, com índices (UF/município/CNAE, GIN de CNAEs secundários, trigrama sem acento) e `search.rollup` com contagens **exatas** para a prévia gratuita |
| qualidade | `sql/004_quality.sql` | relatório: órfãos, CNAE/município ausentes, CNPJ com letras, datas inválidas, linhas arquivo × carregadas |

**Carga:** `import-month.ps1 -Files <zip|csv...> -Database rfb -Truncate -SourceMonth 2026-11-01`. Regra: **linhas do arquivo = linhas carregadas**, senão a carga é recusada (relato público de parser que perdeu ~20 milhões de linhas por causa de aspas).
**Teste:** `powershell -File supabase/data-platform/test-fixture.ps1` — gera um conjunto SINTÉTICO no layout oficial (acentos Latin-1, `;` e aspas dentro do campo, CNPJ com letras, datas `00000000`/`20210231`, capital não numérico, órfão) e confere a cadeia inteira (19 verificações).

**Ambiente local (piloto):** PostgreSQL 17.6 em `D:\Tools\postgresql-bin`, dados em `D:\Claude\hp-data-receita\pgdata`, **só `127.0.0.1:55432`**, nada em `C:`. Subir: `pg_ctl -D D:\Claude\hp-data-receita\pgdata -l ...\logs\postgres.log start`.
**Limites conhecidos:** o CPF dos sócios chega **mascarado** (`***123456**`) e assim fica; contagens de contato são "cadastral" (Receita), nunca "confirmado"; a recarga mensal ainda é *truncate + reload* (a troca atômica vem na fase de produção do pipeline); mudança de layout da Receita exige revisar as colunas dos `stage.*`.
