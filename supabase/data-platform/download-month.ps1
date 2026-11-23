# Baixa TODOS os arquivos de um mês do repositório oficial da Receita (compartilhamento público), com retomada e conferência do tamanho exato.
#   .\download-month.ps1 -Manifest D:\Claude\hp-data-receita\manifest-2026-11.json -Dest D:\Claude\hp-data-receita\downloads\2026-11
# Sequencial (educado com o servidor). Reexecutar é seguro: arquivos completos são pulados e os parciais continuam de onde pararam.
param([Parameter(Mandatory = $true)][string]$Manifest, [Parameter(Mandatory = $true)][string]$Dest)
$ErrorActionPreference = "Stop"
$m = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
$tok = ($m.source -split "/s/")[1]; $base = "https://arquivos.receitafederal.gov.br/public.php/dav/files/$tok" + $m.path
New-Item -ItemType Directory -Force $Dest | Out-Null
$log = Join-Path $Dest "download.log"; $failed = @()
function Log($t) { $l = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $t; Add-Content -Path $log -Value $l; Write-Host $l }
Log ("início: {0} arquivos, {1:N0} bytes" -f $m.files.Count, ($m.files | Measure-Object size -Sum).Sum)
function IsZip([string]$path) { if (-not (Test-Path $path)) { return $false }; $fs = [System.IO.File]::OpenRead($path); try { $b = New-Object byte[] 2; $n = $fs.Read($b, 0, 2); return ($n -eq 2 -and $b[0] -eq 0x50 -and $b[1] -eq 0x4B) } finally { $fs.Dispose() } }
foreach ($f in ($m.files | Sort-Object size)) {          # pequenos primeiro: falha cedo se algo estiver errado
  $path = Join-Path $Dest $f.name; $want = [int64]$f.size; $done = $false
  for ($try = 1; $try -le 8 -and -not $done; $try++) {
    $have = if (Test-Path $path) { (Get-Item $path).Length } else { 0 }
    if ($have -eq $want -and (IsZip $path)) { Log "completo: $($f.name)"; $done = $true; break }
    if ($have -gt $want -or ($have -gt 0 -and -not (IsZip $path))) { Remove-Item $path -Force; $have = 0 }   # nunca retomar sobre HTML de erro
    $t0 = Get-Date
    & curl.exe -sS -L --connect-timeout 30 -C - -u "${tok}:" -A "Mozilla/5.0" -o $path "$base/$($f.name)"
    $got = if (Test-Path $path) { (Get-Item $path).Length } else { 0 }
    if ($got -eq $want -and (IsZip $path)) { Log ("ok {0} {1:N0} bytes em {2}s" -f $f.name, $got, [math]::Round(((Get-Date) - $t0).TotalSeconds)); $done = $true }
    else {
      if ($got -lt 4096 -and -not (IsZip $path)) { if (Test-Path $path) { Remove-Item $path -Force }; $wait = 60 * $try; Log ("REJEITADO pelo servidor (limite de requisições?) {0}, tentativa {1}/8; aguardando {2}s" -f $f.name, $try, $wait); Start-Sleep -Seconds $wait }
      else { Log ("parcial {0}: {1:N0} de {2:N0}; retomando" -f $f.name, $got, $want); Start-Sleep -Seconds 10 }
    }
  }
  if (-not $done) { Log "FALHA definitiva: $($f.name)"; $failed += $f.name }
  Start-Sleep -Seconds 8                                  # educado com o servidor: pausa entre arquivos
}
if ($failed.Count) { Log ("terminou COM FALHAS: " + ($failed -join ", ")); exit 1 } else { Log "terminou: todos os arquivos conferem com o tamanho do manifesto"; Set-Content -Path (Join-Path $Dest "DONE") -Value (Get-Date -Format o) }
