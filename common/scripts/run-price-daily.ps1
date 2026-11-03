param(
  [string]$NodeExecutable = 'node',
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
)
$ErrorActionPreference = 'Stop'
$resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
$jobScript = Join-Path $resolvedRepo 'part2_price_disposal/scripts/price-daily.js'
if (-not (Test-Path -LiteralPath $jobScript)) { throw '시세 수집 실행 파일이 없습니다' }
Push-Location -LiteralPath $resolvedRepo
try {
  & $NodeExecutable $jobScript run --apply
  $jobExit = $LASTEXITCODE
  if ($jobExit -ne 0) { throw "시세 일별 실행 실패 (exit $jobExit). price-daily.js status와 failures.jsonl을 확인하세요." }
} finally { Pop-Location }
