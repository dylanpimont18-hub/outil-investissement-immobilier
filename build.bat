@echo off
chcp 65001 >nul
echo.
echo ====================================================
echo   Spark Investissement - Build
echo ====================================================
echo.

cd /d "%~dp0"

:: Verification (tests) - abandon du build si un test echoue
echo [1/6] Verification (tests)...
set CALLED_FROM_BUILD=1
call ".\verify.bat"
if errorlevel 1 (
  echo ERREUR : la verification a echoue. Build abandonne.
  pause
  exit /b 1
)

:: Bump automatique du patch (X.Y.Z -> X.Y.Z+1) maintenant que les tests passent.
:: Pour un bump minor/major, editer VERSION a la main avant de relancer build.bat :
:: l'auto-bump patch repart ensuite de la nouvelle valeur.
echo.
echo [2/6] Incrementation de version...
python -c "import pathlib; p = pathlib.Path('VERSION'); parts = p.read_text(encoding='utf-8').strip().split('.'); parts[2] = str(int(parts[2]) + 1); p.write_text('.'.join(parts) + chr(10), encoding='utf-8')"
if errorlevel 1 (
  echo ERREUR : le bump de version a echoue.
  pause
  exit /b 1
)
set /p VERSION=<VERSION
echo   Nouvelle version : %VERSION%

:: Convertit Logo_site.png en .ico pour l'exe
echo [3/6] Creation de l'icone...
python -c "from PIL import Image; img = Image.open('Logo_site.png').convert('RGBA'); img.save('spark.ico')"
if errorlevel 1 (
  echo ERREUR : PIL manquant. Lance : pip install pillow
  pause
  exit /b 1
)

:: Compilation PyInstaller
echo [4/6] Compilation avec PyInstaller (version %VERSION%)...
python -m PyInstaller spark.spec --clean --noconfirm --distpath .
if errorlevel 1 (
  echo ERREUR : PyInstaller a echoue.
  pause
  exit /b 1
)

set EXE_PATH=Spark\Spark-%VERSION%.exe
if not exist "%EXE_PATH%" (
  echo ERREUR : %EXE_PATH% introuvable apres compilation. Build abandonne.
  pause
  exit /b 1
)

:: Copie des fichiers statiques dans Spark\
echo [5/6] Copie des fichiers statiques...
set DEST=Spark
copy /Y VERSION         "%DEST%\" >nul
copy /Y index.html      "%DEST%\" >nul
:: Tous les modules JS de la racine (main, calculs, owned-portfolio, utils, pdf, ui, scanner).
:: Copie par joker : une liste figee avait ete oubliee lors de l'extraction de
:: owned-portfolio.js / utils.js, ce qui produisait un exe sans le module Portefeuille.
copy /Y *.js            "%DEST%\" >nul
copy /Y styles.css      "%DEST%\" >nul
copy /Y Logo_site.png   "%DEST%\" >nul
copy /Y server.py       "%DEST%\" >nul
if exist charte_graphique.txt copy /Y charte_graphique.txt "%DEST%\" >nul

:: Copie du dossier scraper (source Python + config)
if not exist "%DEST%\scraper" mkdir "%DEST%\scraper"
copy /Y scraper\*.py "%DEST%\scraper\" >nul
if exist scraper\config.example.py copy /Y scraper\config.example.py "%DEST%\scraper\" >nul
if not exist "%DEST%\scraper\scrapers" mkdir "%DEST%\scraper\scrapers"
copy /Y scraper\scrapers\*.py "%DEST%\scraper\scrapers\" >nul

:: Copie du dossier data (communes JSON)
if exist data if not exist "%DEST%\data" mkdir "%DEST%\data"
if exist data\communes_centre_val.json copy /Y data\communes_centre_val.json "%DEST%\data\" >nul

:: Copie de Leaflet
if not exist "%DEST%\vendor\leaflet" mkdir "%DEST%\vendor\leaflet"
if exist vendor\leaflet\leaflet.js  copy /Y vendor\leaflet\leaflet.js  "%DEST%\vendor\leaflet\" >nul
if exist vendor\leaflet\leaflet.css copy /Y vendor\leaflet\leaflet.css "%DEST%\vendor\leaflet\" >nul
if exist vendor\fonts (
  if not exist "%DEST%\vendor\fonts" mkdir "%DEST%\vendor\fonts"
  copy /Y vendor\fonts\*.ttf "%DEST%\vendor\fonts\" >nul
)

:: Raccourci bureau (PowerShell)
echo.
echo [6/6] Creation du raccourci bureau + archive versionnee...
powershell -NoProfile -Command ^
  "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Spark Investissement.lnk');$s.TargetPath='%CD%\%EXE_PATH%';$s.WorkingDirectory='%CD%\Spark';$s.IconLocation='%CD%\%EXE_PATH%';$s.Save()"

:: Archive zip versionnee du dossier Spark\ (alternative simple a un installeur, cf. CHANGELOG.md)
powershell -NoProfile -Command "Compress-Archive -Path '%CD%\Spark\*' -DestinationPath '%CD%\Spark-%VERSION%.zip' -Force"

for %%F in ("%EXE_PATH%") do set EXE_SIZE=%%~zF
set /a EXE_SIZE_MB=%EXE_SIZE% / 1048576

echo.
echo ====================================================
echo   Build termine !
echo   - Version    : %VERSION%
echo   - Executable : %EXE_PATH%  (~%EXE_SIZE_MB% Mo)
echo   - Archive    : Spark-%VERSION%.zip
echo   - Raccourci cree sur le bureau
echo ====================================================
echo.
pause
