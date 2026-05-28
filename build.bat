@echo off
chcp 65001 >nul
echo.
echo ====================================================
echo   Spark Investissement — Build
echo ====================================================
echo.

cd /d "%~dp0"

:: Convertit Logo_site.png en .ico pour l'exe
echo [1/4] Création de l'icône...
python -c "from PIL import Image; img = Image.open('Logo_site.png').convert('RGBA'); img.save('spark.ico')"
if errorlevel 1 (
    echo ERREUR : PIL manquant. Lance : pip install pillow
    pause & exit /b 1
)

:: Compilation PyInstaller
echo [2/4] Compilation avec PyInstaller...
python -m PyInstaller spark.spec --clean --noconfirm
if errorlevel 1 (
    echo ERREUR : PyInstaller a échoué.
    pause & exit /b 1
)

:: Copie des fichiers statiques dans dist\Spark\
echo [3/4] Copie des fichiers statiques...
set DEST=dist\Spark
copy /Y index.html     "%DEST%\" >nul
copy /Y main.js        "%DEST%\" >nul
copy /Y calculs.js     "%DEST%\" >nul
copy /Y pdf.js         "%DEST%\" >nul
copy /Y ui.js          "%DEST%\" >nul
copy /Y scanner.js     "%DEST%\" >nul
copy /Y styles.css     "%DEST%\" >nul
copy /Y Logo_site.png  "%DEST%\" >nul
copy /Y server.py      "%DEST%\" >nul
if exist charte_graphique.txt copy /Y charte_graphique.txt "%DEST%\" >nul

:: Copie du dossier scraper (source Python + config)
echo [4/4] Copie du dossier scraper...
if not exist "%DEST%\scraper" mkdir "%DEST%\scraper"
copy /Y scraper\*.py "%DEST%\scraper\" >nul
if exist scraper\config.example.py copy /Y scraper\config.example.py "%DEST%\scraper\" >nul
if not exist "%DEST%\scraper\scrapers" mkdir "%DEST%\scraper\scrapers"
copy /Y scraper\scrapers\*.py "%DEST%\scraper\scrapers\" >nul

:: Raccourci bureau (PowerShell)
echo.
echo Création du raccourci bureau...
powershell -NoProfile -Command ^
  "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Spark Investissement.lnk');$s.TargetPath='%CD%\dist\Spark\Spark.exe';$s.WorkingDirectory='%CD%\dist\Spark';$s.IconLocation='%CD%\dist\Spark\Spark.exe';$s.Save()"

echo.
echo ====================================================
echo   Build terminé !
echo   → dist\Spark\Spark.exe
echo   → Raccourci créé sur le bureau
echo ====================================================
echo.
pause
