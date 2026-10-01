@echo off
chcp 65001 >nul
title Spark Investissement - Mise a jour

cd /d "%~dp0"

set CALLED_FROM_UPDATE_RUN=1
call ".\build.bat"
if errorlevel 1 (
  echo.
  echo ERREUR : la mise a jour a echoue, le logiciel n'a pas ete relance.
  pause
  exit /b 1
)

set /p VERSION=<VERSION
set EXE_PATH=Spark\Spark-%VERSION%.exe

if not exist "%EXE_PATH%" (
  echo ERREUR : %EXE_PATH% introuvable apres le build.
  pause
  exit /b 1
)

start "" "%EXE_PATH%"
