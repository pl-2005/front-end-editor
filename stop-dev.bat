@echo off
chcp 65001 >nul
title 编辑器关闭服务
setlocal
cd /d "%~dp0"
set "EDITOR_POWERSHELL=powershell.exe"
where pwsh.exe >nul 2>&1
if not errorlevel 1 set "EDITOR_POWERSHELL=pwsh.exe"
%EDITOR_POWERSHELL% -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-dev.ps1" %*
if errorlevel 1 (
    echo.
    echo 关闭失败，请查看上方错误信息。
    echo 请按任意键关闭窗口……
    pause >nul
    exit /b 1
)
endlocal
