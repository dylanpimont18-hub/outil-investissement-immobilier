@echo off
title Spark Investissement
cd /d "%~dp0"

set VERSION=dev
if exist VERSION for /f "usebackq delims=" %%v in ("VERSION") do set VERSION=%%v

:: Fermer l'instance existante (port 8080)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8080 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
ping -n 2 127.0.0.1 >nul

:: Lancer avec le code a jour
echo Spark Investissement v%VERSION% - demarrage...
start "" pythonw app.py
