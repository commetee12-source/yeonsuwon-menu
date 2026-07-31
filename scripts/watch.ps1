<#
.SYNOPSIS
  볼트 폴더를 지켜보다가 PDF 가 새로 들어오면 publish.ps1 을 돌린다.

.DESCRIPTION
  파일이 완전히 저장될 때까지 기다린 뒤(크기가 더 이상 변하지 않을 때까지) 실행한다.
  여러 파일이 한꺼번에 들어와도 한 번만 돈다.
  창을 닫으면 감시도 끝난다. 껐다 켜도 계속 돌게 하려면 작업 스케줄러에 등록한다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\watch.ps1
#>
param(
  [string]$Vault,
  [int]$SettleSeconds = 10   # 파일이 잠잠해질 때까지 기다리는 시간
)

$ErrorActionPreference = "Stop"

$site = Split-Path -Parent $PSScriptRoot
if (-not $Vault) { $Vault = Split-Path -Parent $site }

Write-Host "감시 시작: $Vault (*.pdf)"
Write-Host "종료하려면 Ctrl+C`n"

$fsw = New-Object System.IO.FileSystemWatcher $Vault, "*.pdf"
$fsw.IncludeSubdirectories = $false
$fsw.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite
$fsw.EnableRaisingEvents = $true

$pending = $false
$lastEvent = [DateTime]::MinValue

$onChange = {
  $script:pending = $true
  $script:lastEvent = [DateTime]::Now
  Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] 감지: $($Event.SourceEventArgs.Name)"
}

Register-ObjectEvent $fsw Created -SourceIdentifier MenuPdfCreated -Action $onChange | Out-Null
Register-ObjectEvent $fsw Changed -SourceIdentifier MenuPdfChanged -Action $onChange | Out-Null

try {
  while ($true) {
    Start-Sleep -Seconds 2
    if (-not $script:pending) { continue }
    # 마지막 이벤트로부터 조용해졌으면 실행한다 (파일 저장이 끝났다는 뜻)
    if (([DateTime]::Now - $script:lastEvent).TotalSeconds -lt $SettleSeconds) { continue }

    $script:pending = $false
    Write-Host "`n----- 배포 시작 -----"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "publish.ps1") -Vault $Vault
    Write-Host "----- 배포 끝 (계속 감시 중) -----`n"
  }
}
finally {
  Unregister-Event -SourceIdentifier MenuPdfCreated -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier MenuPdfChanged -ErrorAction SilentlyContinue
  $fsw.EnableRaisingEvents = $false
  $fsw.Dispose()
  Write-Host "감시 종료"
}
