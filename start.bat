@echo off
setlocal EnableDelayedExpansion

REM -- Ensure logs folder exists --
if not exist "logs" mkdir "logs"

REM -- Generate timestamp YYYY-MM-DD_HH-mm-ss (locale-independent via PowerShell) --
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"') do set TIMESTAMP=%%i
if not defined TIMESTAMP set TIMESTAMP=%date:~-4%-%date:~3,2%-%date:~0,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%

set "LOGFILE=logs\app_%TIMESTAMP%.log"
set "LATEST=logs\latest.log"

echo [%TIMESTAMP%] Starting personal-assistant - logging to %LOGFILE%

REM -- Create log headers as UTF-8 (PowerShell handles encoding) --
powershell -NoProfile -Command "Set-Content -Path '%LOGFILE%' -Value '[%TIMESTAMP%] Starting personal-assistant' -Encoding utf8; Set-Content -Path '%LATEST%' -Value '[%TIMESTAMP%] Starting personal-assistant' -Encoding utf8"

REM -- Run app and tee output to console + timestamped log + latest.log (UTF-8) --
.venv\Scripts\python.exe valid_usuario/valid_sprint05.py 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { Write-Output $_; $_ | Out-File -Append -Encoding utf8 -FilePath '%LOGFILE%'; $_ | Out-File -Append -Encoding utf8 -FilePath '%LATEST%' }"

set EXITCODE=%errorlevel%
powershell -NoProfile -Command "Add-Content -Path '%LOGFILE%' -Value '[%TIMESTAMP%] Exit code: %EXITCODE%' -Encoding utf8; Add-Content -Path '%LATEST%' -Value '[%TIMESTAMP%] Exit code: %EXITCODE%' -Encoding utf8"
exit /b %EXITCODE%
