@echo off
chcp 65001 >nul 2>&1
title Copernico - Second Brain
cls

cd /d "%~dp0"

:: Garante diretorio de logs e rotacao do log anterior
if not exist "%~dp0logs" mkdir "%~dp0logs"
if exist "%~dp0logs\copernico.log" (
    move /y "%~dp0logs\copernico.log" "%~dp0logs\copernico.prev.log" >nul 2>&1
)

set "LOG_FILE=%~dp0logs\copernico.log"

echo ====================================================================
echo                   COPERNICO - SECOND BRAIN
echo            Sistema Desktop de Alta Performance (Local-First)
echo ====================================================================
echo.
echo  [*] STATUS DO SISTEMA:   Online e em execucao
echo  [*] ATALHO GLOBAL:       Ctrl + Espaco (Abrir / Fechar Overlay)
echo  [*] WAKE WORD:           Ativo em segundo plano ("Copernico")
echo  [*] ARQUITETURA:         Tauri 2.x + Rust + React 19 + FastEmbed
echo  [*] BANCO DE DADOS:      SQLite WAL Mode (cofres/cache.db)
echo.
echo --------------------------------------------------------------------
echo  [i] PAINEL DE LOGS SILENCIOSO ATIVO
echo  Todos os logs detalhados (stdout/stderr) estao sendo gravados em:
echo      logs\copernico.log
echo.
echo  Para inspecionar os logs em tempo real em outro terminal:
echo      Get-Content logs\copernico.log -Wait -Tail 30
echo --------------------------------------------------------------------
echo.
echo  [Dica] Para encerrar o aplicativo, pressione Ctrl+C ou feche esta janela.
echo.

:: Executa a aplicacao redirecionando stdout e stderr para o log
call pnpm tauri dev > "%LOG_FILE%" 2>&1

set EXIT_CODE=%ERRORLEVEL%
if %EXIT_CODE% NEQ 0 (
    echo.
    echo ====================================================================
    echo  [!] O processo foi finalizado com codigo de erro: %EXIT_CODE%
    echo  [i] Consulte o arquivo de log para mais informacoes: logs\copernico.log
    echo ====================================================================
    echo.
    pause
)

