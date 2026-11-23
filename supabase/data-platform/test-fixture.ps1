# Teste da cadeia inteira (carga -> tipagem -> pesquisa -> qualidade) com o arquivo-modelo SINTÉTICO. Banco descartável `rfb_fixture` no Postgres local (127.0.0.1:55432).
#   .\test-fixture.ps1        # sai com código 1 se houver [FALHA]
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path; $psql = "D:\Tools\postgresql-bin\bin\psql.exe"; $db = "rfb_fixture"; $port = 55432; $fx = "D:\Claude\hp-data-receita\fixture"
function P { param([string[]]$a) & $psql -h 127.0.0.1 -p $port -U postgres -X -v ON_ERROR_STOP=1 @a; if ($LASTEXITCODE -ne 0) { throw "psql falhou: $a" } }
P @("-d", "postgres", "-q", "-c", "drop database if exists $db"); P @("-d", "postgres", "-q", "-c", "create database $db")
node (Join-Path $here "fixture\make-fixture.mjs") $fx | Out-Null
P @("-d", $db, "-q", "-f", (Join-Path $here "sql\001_schema.sql"))
$files = @("Cnaes", "Municipios", "Naturezas", "Qualificacoes", "Paises", "Motivos", "Empresas1", "Estabelecimentos1", "Socios1", "Simples1") | ForEach-Object { Join-Path $fx "$_.csv" }
& (Join-Path $here "import-month.ps1") -Files $files -Database $db -Truncate -SourceMonth "2026-11-01" -Work "D:\Claude\hp-data-receita\work"
P @("-d", $db, "-q", "-v", "source_month='2026-11-01'", "-f", (Join-Path $here "sql\002_transform.sql"))
P @("-d", $db, "-q", "-f", (Join-Path $here "sql\003_search.sql"))
Write-Host "`n--- relatório de qualidade"; P @("-d", $db, "-q", "-A", "-F", " | ", "-f", (Join-Path $here "sql\004_quality.sql"))
Write-Host "`n--- asserções"; $out = & $psql -h 127.0.0.1 -p $port -U postgres -d $db -X -q -t -A -f (Join-Path $here "fixture\assert.sql"); $out | ForEach-Object { if ($_ -match "^\[") { Write-Host $_ } }
$fail = @($out | Where-Object { $_ -match "^\[FALHA" }).Count; $ok = @($out | Where-Object { $_ -match "^\[OK" }).Count
Write-Host "`nTOTAL: $ok OK, $fail FALHA"; if ($fail -gt 0) { exit 1 }
