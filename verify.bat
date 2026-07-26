@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ====================================================
echo   Spark Investissement - Verification
echo ====================================================
echo.

echo [1/4] Tests Python (pytest tests/)...
python -m pytest tests/ -q
if errorlevel 1 (
  echo.
  echo ECHEC : les tests Python ne passent pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo [2/4] Tests JS - fiscalite des travaux...
node tests\test_frais_fiscalite.mjs
if errorlevel 1 (
  echo.
  echo ECHEC : tests\test_frais_fiscalite.mjs ne passe pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo [3/4] Tests JS - regimes fiscaux...
node tests\test_regimes_fiscaux.mjs
if errorlevel 1 (
  echo.
  echo ECHEC : tests\test_regimes_fiscaux.mjs ne passe pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo [4/4] Tests JS - historique de loyer...
node tests\test_loyer_historique.mjs
if errorlevel 1 (
  echo.
  echo ECHEC : tests\test_loyer_historique.mjs ne passe pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo ====================================================
echo   Verification OK - tous les tests passent
echo ====================================================
if not defined CALLED_FROM_BUILD pause
exit /b 0
