# Carga de arquivos da Receita (CNPJ) para o banco da Data Platform (piloto local, só 127.0.0.1). Roda FORA do ERP e do navegador.
#   .\import-month.ps1 -Files D:\...\Empresas1.zip,D:\...\Cnaes.zip -Database rfb -Truncate
# Aceita .zip (extrai 1 CSV) ou CSV puro. Tipo pelo nome do arquivo: Empresas*, Estabelecimentos*, Socios*, Simples*, Cnaes*, Municipios*, Naturezas*, Qualificacoes*, Paises*, Motivos*.
# Regra de qualidade: LINHAS DO ARQUIVO (contadas por quebra de linha) = LINHAS CARREGADAS. Divergência = status failed (relato público: parser com aspas já perdeu ~20 milhões de linhas em silêncio).
param(
  [Parameter(Mandatory = $true)][string[]]$Files,
  [string]$Database = "rfb", [int]$Port = 55432, [string]$SourceMonth = "",
  [string]$PsqlBin = "D:\Tools\postgresql-bin\bin\psql.exe", [string]$Work = "D:\Claude\hp-data-receita\work", [switch]$Truncate, [switch]$KeepExtracted
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Work | Out-Null
function Psql([string]$sql) { & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -X -q -t -A -c $sql; if ($LASTEXITCODE -ne 0) { throw "psql falhou: $sql" } }
function PsqlFile([string]$path) { & $PsqlBin -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -X -q -f $path; if ($LASTEXITCODE -ne 0) { throw "psql falhou: $path" } }
function CountRows([string]$path) {
  $buf = New-Object byte[] (8MB); $n = 0L; $last = 10; $fs = [System.IO.File]::OpenRead($path)
  try { while (($r = $fs.Read($buf, 0, $buf.Length)) -gt 0) { for ($i = 0; $i -lt $r; $i++) { if ($buf[$i] -eq 10) { $n++ } }; $last = $buf[$r - 1] } } finally { $fs.Dispose() }
  if ($last -ne 10) { $n++ }; return $n
}
$kinds = @{ empresas = "empresas"; estabelecimentos = "estabelecimentos"; socios = "socios"; simples = "simples"; cnaes = "cnaes"; municipios = "municipios"; naturezas = "naturezas"; qualificacoes = "qualificacoes"; paises = "paises"; motivos = "motivos" }
if ($Truncate) { Psql "truncate stage.empresas, stage.estabelecimentos, stage.socios, stage.simples, stage.cnaes, stage.municipios, stage.naturezas, stage.qualificacoes, stage.paises, stage.motivos" }
$month = if ($SourceMonth) { $SourceMonth } else { (Get-Date -Format "yyyy-MM") + "-01" }
$bad = 0
foreach ($f in $Files) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($f); $kind = $null
  foreach ($k in $kinds.Keys) { if ($name.ToLower().StartsWith($k)) { $kind = $kinds[$k] } }
  if (-not $kind) { throw "Tipo desconhecido para o arquivo: $f" }
  $sha = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower(); $csv = $f; $tmp = $null
  if ($f.ToLower().EndsWith(".zip")) {
    $tmp = Join-Path $Work ([guid]::NewGuid().ToString("N")); New-Item -ItemType Directory -Force $tmp | Out-Null
    & tar.exe -xf $f -C $tmp; if ($LASTEXITCODE -ne 0) { throw "falha ao extrair $f" }
    $inner = @(Get-ChildItem $tmp -File); if ($inner.Count -ne 1) { throw "esperava 1 arquivo dentro de $f e achei $($inner.Count)" }; $csv = $inner[0].FullName
  }
  $started = Get-Date; $rowsFile = CountRows $csv
  $id = Psql ("insert into rfb.import_runs (source_month, file_name, kind, rows_in_file, sha256) values ('$month', '" + ([System.IO.Path]::GetFileName($f)) + "', '$kind', $rowsFile, '$sha') returning id")
  $before = [int64](Psql "select count(*) from stage.$kind")
  $copy = Join-Path $Work "copy.sql"; $p = $csv.Replace("\", "/")
  Set-Content -Path $copy -Encoding ASCII -Value "\copy stage.$kind from '$p' with (format csv, delimiter ';', quote '""', encoding 'LATIN1')"
  try { PsqlFile $copy } catch { Psql "update rfb.import_runs set status = 'failed', finished_at = now(), note = 'falha no COPY' where id = $id"; throw }
  $loaded = [int64](Psql "select count(*) from stage.$kind") - $before
  $ok = ($loaded -eq $rowsFile)
  Psql ("update rfb.import_runs set rows_loaded = $loaded, status = '" + ($(if ($ok) { "ok" } else { "failed" })) + "', finished_at = now(), note = " + ($(if ($ok) { "null" } else { "'linhas do arquivo diferem das carregadas'" })) + " where id = $id")
  $secs = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  Write-Host ("{0,-28} {1,-18} arquivo={2,12:N0} carregadas={3,12:N0} {4}  ({5}s)" -f ([System.IO.Path]::GetFileName($f)), $kind, $rowsFile, $loaded, $(if ($ok) { "OK" } else { "DIVERGE" }), $secs)
  if (-not $ok) { $bad++ }
  if ($tmp -and -not $KeepExtracted) { Remove-Item -Recurse -Force $tmp }
}
if ($bad -gt 0) { throw "$bad arquivo(s) com linhas divergentes — carga recusada." }
