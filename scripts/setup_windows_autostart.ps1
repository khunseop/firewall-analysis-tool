# FAT 서버 윈도우 부팅 시 자동 시작 등록 (일회성 셋업)
# 사용: 관리자 권한 PowerShell에서 실행
#   powershell -ExecutionPolicy Bypass -File scripts\setup_windows_autostart.ps1
#
# 사전 조건: .venv 생성 + pip install -r backend/requirements.txt,
#            python backend/migrate.py, frontend `npm run build` 완료

# ===== 환경에 맞게 수정 =====
$ProjectRoot = "C:\fat\firewall-analysis-tool"   # 프로젝트 루트
$Port        = 8000
$TaskName    = "FAT-Server"
# ============================

$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$LogDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 로그 리다이렉트를 위해 cmd /c 로 감쌈
$cmd = "`"$Python`" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port $Port >> `"$LogDir\server.log`" 2>&1"

$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd" -WorkingDirectory $ProjectRoot
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force

# 외부 PC에서 접속해야 하면 방화벽 허용
New-NetFirewallRule -DisplayName "FAT-Server $Port" -Direction Inbound `
    -Protocol TCP -LocalPort $Port -Action Allow -ErrorAction SilentlyContinue

# 지금 바로 시작
Start-ScheduledTask -TaskName $TaskName

# 중지: Stop-ScheduledTask FAT-Server
# 제거: Unregister-ScheduledTask FAT-Server -Confirm:$false
