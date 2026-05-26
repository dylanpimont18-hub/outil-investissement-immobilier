@echo off
:: Spark Scanner — Installation tache planifiee Windows
:: A executer UNE SEULE FOIS en tant qu'administrateur

SET SCRIPT_DIR=%~dp0
SET SCRIPT_PATH=%SCRIPT_DIR%scanner.py

:: Detecte le chemin Python
FOR /F "tokens=*" %%i IN ('where python') DO SET PYTHON_PATH=%%i

IF "%PYTHON_PATH%"=="" (
    echo ERREUR : Python introuvable dans le PATH.
    echo Installe Python depuis https://www.python.org/downloads/
    pause
    exit /b 1
)

echo Python detecte : %PYTHON_PATH%
echo Script         : %SCRIPT_PATH%
echo.

:: Installe les dependances
echo Installation des dependances...
"%PYTHON_PATH%" -m pip install -r "%SCRIPT_DIR%requirements.txt" --quiet
IF %errorlevel% NEQ 0 (
    echo ERREUR lors de l'installation des dependances.
    pause
    exit /b 1
)

:: Cree la tache planifiee (tous les jours a 07:00)
schtasks /create ^
  /tn "Spark Scanner LeBonCoin 18100" ^
  /tr "\"%PYTHON_PATH%\" \"%SCRIPT_PATH%\"" ^
  /sc daily ^
  /st 07:00 ^
  /f ^
  /rl highest

IF %errorlevel% EQU 0 (
    echo.
    echo Tache planifiee creee avec succes !
    echo Le scanner tournera automatiquement chaque jour a 07:00.
    echo.
    echo RAPPEL : avant de lancer, renseigne ton mot de passe
    echo d'application Google dans scanner\config.py
    echo ^(EMAIL_MOT_DE_PASSE_APP^)
) ELSE (
    echo.
    echo ERREUR : relance ce fichier en tant qu'Administrateur.
    echo Clic droit sur setup_task.bat ^> Executer en tant qu'administrateur
)

echo.
pause
