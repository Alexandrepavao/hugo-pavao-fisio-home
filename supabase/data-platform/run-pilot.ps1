# Piloto completo da Data Platform: espera o download terminar (arquivo DONE), carrega os 37 arquivos, tipa (rfb), constrói a pesquisa (search), mede e escreve o relatório.
#   .\run-pilot.ps1 -Month 2026-11     (rodar desacoplado: dura horas)
param([string]$Month = "2026-11", [string]$Database = "rfb", [string]$Root = "D:\Claude\hp-data-receita")
$ErrorActionPreference = "Stop"
$env:PGOPTIONS = "-c client_min_messages=warning"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path; $psql = "D:\Tools\postgresql-bin\bin\psql.exe"; $dl = Join-Path $Root "downloads\$Month"; $rep = Join-Path $Root "reports"
New-Item -ItemType Directory -Force $rep | Out-Null; $log = Join-Path $rep "pilot-$Month.log"; $timings = [ordered]@{}
function Log($t) { $l = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $t; Add-Content -Path $log -Value $l; Write-Host $l }
function Q([string]$sql) { & $psql -h 127.0.0.1 -p 55432 -U postgres -d $Database -X -q -t -A -F " | " -v ON_ERROR_STOP=1 -c $sql }
function Step([string]$name, [scriptblock]$b) { Log "início: $name"; $t = Get-Date; & $b; $s = [math]::Round(((Get-Date) - $t).TotalSeconds); $timings[$name] = $s; Log ("fim: {0} ({1}s)" -f $name, $s) }

Log "aguardando o download (arquivo DONE em $dl)"
while (-not (Test-Path (Join-Path $dl "DONE"))) { Start-Sleep -Seconds 60 }
Log "download concluído"

$order = @("Cnaes", "Municipios", "Naturezas", "Qualificacoes", "Paises", "Motivos", "Simples") + (0..9 | ForEach-Object { "Empresas$_" }) + (0..9 | ForEach-Object { "Estabelecimentos$_" }) + (0..9 | ForEach-Object { "Socios$_" })
$first = $true
Step "carga (stage) dos 37 arquivos" {
  foreach ($n in $order) {
    $args2 = @{ Files = @("$dl\$n.zip"); Database = $Database; SourceMonth = "$Month-01"; Work = (Join-Path $Root "work") }
    if ($first) { $args2["Truncate"] = $true; $script:first = $false }
    & (Join-Path $here "import-month.ps1") @args2 2>&1 | ForEach-Object { Log "$_" }
  }
}
Step "tipagem (stage -> rfb)" { & $psql -h 127.0.0.1 -p 55432 -U postgres -d $Database -X -q -v ON_ERROR_STOP=1 -v "source_month='$Month-01'" -f (Join-Path $here "sql\002_transform.sql") 2>&1 | ForEach-Object { Log "$_" } }
Step "pesquisa (rfb -> search)" { & $psql -h 127.0.0.1 -p 55432 -U postgres -d $Database -X -q -v ON_ERROR_STOP=1 -f (Join-Path $here "sql\003_search.sql") 2>&1 | ForEach-Object { Log "$_" } }
$quality = & $psql -h 127.0.0.1 -p 55432 -U postgres -d $Database -X -q -A -F " | " -f (Join-Path $here "sql\004_quality.sql")
Step "medições de consulta (latência da prévia)" { $script:meas = & $psql -h 127.0.0.1 -p 55432 -U postgres -d $Database -X -q -A -F " | " -f (Join-Path $here "sql\005_measure.sql") }
$sizes = Q "select pg_size_pretty(pg_database_size(current_database())) as banco; select n.nspname||'.'||c.relname, pg_size_pretty(pg_total_relation_size(c.oid)), c.reltuples::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('stage','rfb','search') and c.relkind='r' order by pg_total_relation_size(c.oid) desc limit 14"
$md = @("# Piloto da Data Platform - mês $Month", "", "Gerado em $(Get-Date -Format 'yyyy-MM-dd HH:mm') - 37 arquivos oficiais da Receita (licença CC Atribuição).", "", "## Tempos (s)", ($timings.GetEnumerator() | ForEach-Object { "- $($_.Key): $($_.Value)" }), "", "## Qualidade", '```', $quality, '```', "", "## Medições de consulta", '```', $meas, '```', "", "## Tamanhos", '```', $sizes, '```')
Set-Content -Path (Join-Path $rep "pilot-$Month.md") -Value $md -Encoding UTF8
Log "relatório: $(Join-Path $rep "pilot-$Month.md")"; Set-Content -Path (Join-Path $rep "PILOT_DONE") -Value (Get-Date -Format o)
