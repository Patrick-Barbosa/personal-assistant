# verify_app_health.ps1
# Script de automacao para subir a aplicacao Copernico, aguardar 30s e verificar logs/integridade.

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Iniciando Verificacao de Saude do Copernico (30s)     " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$logPath = "$PSScriptRoot\app_test_run.log"
if (Test-Path $logPath) { Remove-Item $logPath -Force }

Write-Host "[1/4] Iniciando 'pnpm tauri dev'..." -ForegroundColor Yellow
$procInfo = New-Object System.Diagnostics.ProcessStartInfo
$procInfo.FileName = "pnpm.cmd"
$procInfo.Arguments = "tauri dev"
$procInfo.WorkingDirectory = "$PSScriptRoot"
$procInfo.RedirectStandardOutput = $true
$procInfo.RedirectStandardError = $true
$procInfo.UseShellExecute = $false
$procInfo.CreateNoWindow = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $procInfo

$stdoutBuilder = New-Object System.Text.StringBuilder
$stderrBuilder = New-Object System.Text.StringBuilder

$proc.Start() | Out-Null

Write-Host "[2/4] Aplicacao iniciada com PID $($proc.Id). Aguardando 30 segundos..." -ForegroundColor Yellow
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) {
        Write-Host "[ERRO CRITICO] A aplicacao encerrou prematuramente apos $i segundos com ExitCode $($proc.ExitCode)!" -ForegroundColor Red
        break
    }
}

$isRunning = -not $proc.HasExited

Write-Host "[3/4] Coletando logs de execucao..." -ForegroundColor Yellow
try {
    $stdoutText = $proc.StandardOutput.ReadToEnd()
    $stderrText = $proc.StandardError.ReadToEnd()
    $combinedLogs = "=== STDOUT ===`n" + $stdoutText + "`n`n=== STDERR ===`n" + $stderrText
    [System.IO.File]::WriteAllText($logPath, $combinedLogs)
} catch {
    Write-Host "[LOG] Logs em stream nao coletados completamente."
}

Write-Host "[4/4] Finalizando processo de teste..." -ForegroundColor Yellow
try {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Get-Process | Where-Object { $_.ProcessName -match "copernico|tauri" } | Stop-Process -Force -ErrorAction SilentlyContinue
} catch {}

Write-Host "`n================ RESUMO DA EXECUCAO ================" -ForegroundColor Cyan
if ($isRunning) {
    Write-Host "[STATUS] SUCESSO! Aplicacao rodou estavelmente por 30s sem fechar ou quebrar." -ForegroundColor Green
} else {
    Write-Host "[STATUS] FALHA: Aplicacao caiu durante os 30s." -ForegroundColor Red
}
