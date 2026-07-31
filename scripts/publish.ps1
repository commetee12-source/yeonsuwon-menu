<#
.SYNOPSIS
  볼트의 주간업무 PDF를 읽어 식단 데이터를 갱신하고, 이상이 없으면 커밋·푸시한다.
  푸시되면 Netlify가 자동으로 재배포한다.

.DESCRIPTION
  단계: PDF 파싱 -> 데이터 검증 -> 변경 있으면 커밋 -> 푸시
  어느 단계든 실패하면 그 자리에서 멈춘다. 검증에 실패한 데이터는 절대 푸시하지 않는다.
  변경이 없으면 아무 일도 하지 않으므로, 몇 번을 돌려도 안전하다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\publish.ps1
#>
param(
  [string]$Vault,
  [switch]$DryRun   # 커밋·푸시 없이 파싱과 검증만
)

$ErrorActionPreference = "Stop"

$site = Split-Path -Parent $PSScriptRoot
if (-not $Vault) { $Vault = Split-Path -Parent $site }
Set-Location $site

function Step($msg) { Write-Host "`n[$([DateTime]::Now.ToString('HH:mm:ss'))] $msg" }

Step "PDF 읽기  (볼트: $Vault)"
python scripts/import_pdf.py --vault $Vault
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n중단: PDF 를 해석하지 못했다. 표 양식이 바뀌었을 수 있다." -ForegroundColor Red
  exit 1
}

Step "데이터 검증"
node scripts/check-data.mjs
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n중단: 검증 실패. 잘못된 데이터는 푸시하지 않는다." -ForegroundColor Red
  Write-Host "data/ 를 되돌리려면:  git checkout -- data/"
  exit 1
}

$changed = git status --porcelain -- data/
if (-not $changed) {
  Step "변경 없음 - 배포할 것이 없다"
  exit 0
}

Write-Host ""
$changed | ForEach-Object { Write-Host "  $_" }

if ($DryRun) {
  Step "DryRun - 커밋·푸시는 건너뛴다"
  exit 0
}

# 커밋 메시지에 어떤 주차가 바뀌었는지 담는다
$weeks = git status --porcelain -- data/ |
  ForEach-Object { [regex]::Match($_, '(\d{4}-W\d{2})\.json').Groups[1].Value } |
  Where-Object { $_ } | Sort-Object -Unique
if ($weeks) { $subject = "data: $($weeks -join ', ') 식단" } else { $subject = "data: 식단 갱신" }

Step "커밋·푸시"
git add data/
git commit -m $subject
if ($LASTEXITCODE -ne 0) { Write-Host "커밋 실패" -ForegroundColor Red; exit 1 }

git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "푸시 실패" -ForegroundColor Red; exit 1 }

Step "완료 - Netlify 재배포가 시작된다 (약 30초)"
Write-Host "  https://yeonsuwon-menu.netlify.app"
