param(
  [string]$NodeExecutable = (Get-Command node -ErrorAction Stop).Source,
  [string]$TaskName = 'GreenCircuit-PriceDaily',
  [switch]$Install
)
$ErrorActionPreference = 'Stop'
if ([TimeZoneInfo]::Local.Id -ne 'Korea Standard Time') { throw '이 템플릿은 Windows 시간대가 Korea Standard Time일 때 매일 09:00 KST입니다. 시간대 설정을 확인하세요.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runner = Join-Path $PSScriptRoot 'run-price-daily.ps1'
$logDir = Join-Path $repo 'part2_price_disposal/data/refresh-staging'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$escapeXml = { param([string]$Value) [Security.SecurityElement]::Escape($Value) }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NodeExecutable "{1}" -RepoRoot "{2}"' -f $runner, $NodeExecutable, $repo
$nextStart = [DateTime]::Today.AddHours(9)
if ($nextStart -le [DateTime]::Now) { $nextStart = $nextStart.AddDays(1) }
$boundary = $nextStart.ToString('yyyy-MM-ddTHH:mm:ss') + '+09:00'
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>Green Circuit 공개 시세 일별 수집. 실패/누락은 기존 자료 유지.</Description></RegistrationInfo>
 <Triggers><CalendarTrigger><StartBoundary>$boundary</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
 <Principals><Principal id="Author"><UserId>$userSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><ExecutionTimeLimit>PT30M</ExecutionTimeLimit></Settings>
 <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>$(& $escapeXml $arguments)</Arguments><WorkingDirectory>$(& $escapeXml $repo)</WorkingDirectory></Exec></Actions>
</Task>
"@
[xml]$parsedXml = $xml # 등록 없이 XML 문법 확인
$outputFile = Join-Path $logDir 'price-daily.task.xml'
Set-Content -LiteralPath $outputFile -Value $xml -Encoding Unicode
if ($Install) {
  Register-ScheduledTask -TaskName $TaskName -Xml $xml -ErrorAction Stop | Out-Null
  Write-Output "예약 가동 설정됨: $TaskName (로그인한 사용자 세션에서 매일 09:00 KST)"
} else { Write-Output "예약 구성만 생성: $outputFile. 작업 스케줄러에는 등록하지 않았습니다." }
