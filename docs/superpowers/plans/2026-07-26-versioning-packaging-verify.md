# Versioning, Packaging & Verify Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Spark Investissement a single source-of-truth version number that flows into the UI and the build output filename, a CHANGELOG, a hardened `build.bat`, and a local `verify.bat` gate (pytest + JS tests) that `build.bat` must pass before compiling — with no remote CI, per standing project rule.

**Architecture:** A plain-text `VERSION` file at the repo root is the single source of truth. `app.py`, `server.py` (via a new `/api/version` route), `spark.spec`, and `build.bat` each read it independently (no cross-import between them is possible given the existing module layering, so each reads the same file directly — see Global Constraints). The UI fetches `/api/version` once at boot and renders it in the topbar. `verify.bat` runs `pytest tests/` then the two JS test files, aborting on first failure; `build.bat` calls it as step 0 and aborts the build on failure.

**Tech Stack:** Python 3.13 / Flask / PyInstaller (existing), vanilla JS (existing), Windows batch scripts, Node.js (already used to run `tests/*.mjs`).

## Global Constraints

- Never `git push` / open a PR / touch the remote — this project is local-only (standing rule, see project memory `feedback_no_git_push`).
- No GitHub Actions / remote CI of any kind. If the idea resurfaces, stop and ask before touching the remote repo.
- No auto-update mechanism — the app stays 100% offline (per `CLAUDE.md`).
- All user-facing text stays in French, matching the rest of the app.
- `calculs.js` exports must stay pure (no DOM/localStorage/window) — not touched by this plan, but keep in mind if a coverage task brushes against it.
- Update `CODEBASE_MAP.md` for every file touched or created (project-wide rule from `CLAUDE.md`).
- Test every change for real: run `build.bat` end-to-end at least once and confirm the UI in a browser, not just unit tests (project feedback memory `feedback_verify_in_app`).
- Starting version is `1.0.0` (first tracked release — no prior version markers exist anywhere in the codebase, confirmed by grep).

---

### Task 1: Fix pytest cross-test isolation bug blocking the full suite

**Context:** `python -m pytest tests/` currently fails when run as a full suite (though every file passes individually). `tests/test_calculs_py.py:8-21` stubs `sys.modules['config']` with a `types.ModuleType` that lacks `ANTHROPIC_API_KEY`, and never removes it. Because pytest runs all test modules in one process, this stub leaks into `tests/test_enrich.py` (collected later, alphabetically), whose `scraper/ia.py` does `from config import ANTHROPIC_API_KEY` and gets `ImportError: cannot import name 'ANTHROPIC_API_KEY' from 'config' (unknown location)`. `verify.bat` (Task 5) is only useful if `pytest tests/` reliably passes as a full run, so this must be fixed first.

**Files:**
- Modify: `tests/test_calculs_py.py:1-24`

**Interfaces:**
- Consumes: nothing new.
- Produces: `python -m pytest tests/` (full suite, no `-k`/single-file) exits 0. Later tasks (verify.bat) rely on this.

- [x] **Step 1: Reproduce the failure**

Run: `python -m pytest tests/ -q`
Expected: fails during collection of `tests/test_enrich.py` with `ImportError: cannot import name 'ANTHROPIC_API_KEY' from 'config' (unknown location)`.

- [x] **Step 2: Fix — remove the stub from `sys.modules` right after it has served its purpose**

`scraper/calculs.py` does `from config import (...)` at module load time (confirmed: it's the only `config` reference in that file, and the names are copied into `calculs`'s own namespace at import time), so the stub is only needed for the instant of `import calculs as C`. Edit `tests/test_calculs_py.py`:

```python
"""Tests for scraper/calculs.py — P0a alignment with calculs.js."""
import sys
import os
import types
import unittest

# ── Mock config before importing calculs ──────────────────────────────────────
_config = types.ModuleType('config')
_config.TAUX_CREDIT               = 3.0
_config.ASSURANCE                 = 0.30
_config.DUREE_MOIS                = 240
_config.LOYER_M2_APPARTEMENT      = 8.5
_config.LOYER_M2_MAISON           = 7.0
_config.LOYER_MAX_APPARTEMENT     = 700.0
_config.LOYER_MAX_MAISON          = 900.0
_config.CHARGES_COPRO_APPARTEMENT = 80.0
_config.CHARGES_COPRO_MAISON      = 20.0
_config.TAXE_FONCIERE_RATIO       = 0.083
_config.VACANCE_RATIO             = 0.05
_config.TMI                       = 30
sys.modules['config'] = _config

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scraper'))
import calculs as C  # noqa: E402

# `calculs.py` copied the values it needs via `from config import (...)` above —
# remove the stub so it doesn't leak into other test modules collected later
# in the same pytest process (it lacks ANTHROPIC_API_KEY, which scraper/ia.py needs).
del sys.modules['config']
```

(Only the `sys.path.insert(0, ...)` / `import calculs as C` block and the new `del` line change; the rest of the file — the `TestMensualiteCredit` / `TestSciIsAmortissement` classes and `unittest.main()` — is untouched.)

- [x] **Step 3: Run the full suite to verify the fix**

Run: `python -m pytest tests/ -q`
Expected: all tests pass (`X passed`), no `ImportError`, no collection error for `test_enrich.py`.

- [x] **Step 4: Commit**

```bash
git add tests/test_calculs_py.py
git commit -m "fix(tests): stop test_calculs_py's config stub leaking into later test modules"
```

---

### Task 2: VERSION file, `app.py` constant, `/api/version` endpoint

**Files:**
- Create: `VERSION`
- Modify: `app.py:21-28`
- Modify: `server.py` (new route, placed next to `index()` at `server.py:589-591`)
- Test: `tests/test_server_api.py` (append new test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /api/version` → `{"version": "<contents of VERSION, stripped>"}`. `app.py` exposes `__version__` (str). Task 3 (UI) consumes the `/api/version` JSON shape `{version: string}`. Task 6 (`spark.spec`, `build.bat`) reads the same `VERSION` file independently (batch/PyInstaller-spec can't import `app.py`'s constant).

- [x] **Step 1: Create the VERSION file**

Create `VERSION` at the repo root with exactly this content (no trailing newline needed, but one is harmless):

```
1.0.0
```

- [x] **Step 2: Write the failing test for `/api/version`**

Append to `tests/test_server_api.py` (after the existing imports, anywhere among the other `test_api_*` functions — e.g. right after `test_api_results_rejects_offset_without_limit`):

```python
def test_api_version_reads_version_file():
    client = server.app.test_client()

    resp = client.get("/api/version")

    assert resp.status_code == 200
    expected = (Path(server.STATIC_DIR) / "VERSION").read_text(encoding="utf-8").strip()
    assert resp.get_json() == {"version": expected}
```

- [x] **Step 3: Run it to confirm it fails**

Run: `python -m pytest tests/test_server_api.py -q -k test_api_version_reads_version_file`
Expected: FAIL — `404 NOT FOUND` (no such route yet).

- [x] **Step 4: Add the route in `server.py`**

In `server.py`, insert this new route immediately after the existing `index()` route (`server.py:589-591`), before the catch-all `static_files` route:

```python
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/version")
def api_version():
    try:
        version = (Path(STATIC_DIR) / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        version = "dev"
    return jsonify({"version": version})


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)
```

`Path` and `jsonify` are already imported at the top of `server.py` (`from pathlib import Path`, `from flask import Flask, jsonify, request, send_from_directory`) — no new imports needed.

- [x] **Step 5: Run the test again to confirm it passes**

Run: `python -m pytest tests/test_server_api.py -q -k test_api_version_reads_version_file`
Expected: PASS.

- [x] **Step 6: Add the `__version__` constant to `app.py`**

In `app.py`, right after `os.chdir(BASE_DIR)` (line 28) and before the `# ── Import server...` comment block, insert:

```python
os.chdir(BASE_DIR)

# ── Version (source de vérité : fichier VERSION, lu aussi par server.py / spark.spec / build.bat) ──
try:
    with open(os.path.join(BASE_DIR, 'VERSION'), encoding='utf-8') as _f:
        __version__ = _f.read().strip()
except OSError:
    __version__ = 'dev'

# ── Import server et patch des chemins ───────────────────────────────────────
```

- [x] **Step 7: Run the full test suite to confirm no regression**

Run: `python -m pytest tests/ -q`
Expected: all tests pass.

- [x] **Step 8: Commit**

```bash
git add VERSION app.py server.py tests/test_server_api.py
git commit -m "feat(version): add VERSION file as source of truth, expose via /api/version"
```

---

### Task 3: Display the version in the UI (topbar)

**Files:**
- Modify: `index.html:23-25`
- Modify: `styles.css` (near `.topbar-name`, `styles.css:960-967`)
- Modify: `main.js` (add node reference + fetch call)

**Interfaces:**
- Consumes: `GET /api/version` → `{version: string}` (Task 2).
- Produces: nothing consumed by later tasks — this is a leaf UI feature.

- [x] **Step 1: Add the DOM element in `index.html`**

In `index.html`, inside `.topbar-brand-copy` (lines 23-25), add a version span:

```html
                <div class="topbar-brand-copy">
                    <span class="topbar-name">Spark Investissement</span>
                    <span id="topbar-version" class="topbar-version"></span>
                </div>
```

- [x] **Step 2: Style it in `styles.css`**

Right after the `.topbar-name` rule (`styles.css:960-967`), add:

```css
.topbar-version {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
}
```

(If `--font-mono` isn't the exact token name used elsewhere in `styles.css` for IBM Plex Mono, grep `styles.css` for `--font-mono` first and reuse whatever variable name is already defined — do not invent a second one.)

- [x] **Step 3: Register the node and fetch the version in `main.js`**

Add to the `nodes` object (`main.js:273`, alongside `topbarStudyName`):

```javascript
    topbarVersion: document.getElementById('topbar-version'),
```

Then, near the end of the bootstrap section (`main.js`, right after `initSliders();` at line 2966), add:

```javascript
initSliders();

fetch('/api/version')
    .then((res) => res.json())
    .then((data) => {
        if (nodes.topbarVersion && data && data.version) {
            nodes.topbarVersion.textContent = `v${data.version}`;
        }
    })
    .catch(() => {});
```

- [x] **Step 4: Manually verify in the running app**

Run: `python app.py`
Expected: the app window opens; the topbar shows "Spark Investissement" with a small "v1.0.0" underneath/beside it. Check both light and dark themes (theme toggle) to confirm the muted color reads correctly in both.

- [x] **Step 5: Commit**

```bash
git add index.html styles.css main.js
git commit -m "feat(ui): display app version in the topbar"
```

---

### Task 4: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed programmatically — human-maintained doc, referenced by the "how to cut a release" note at the end of this plan.

- [x] **Step 1: Create `CHANGELOG.md`**

```markdown
# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

## [1.0.0] - 2026-07-26

### Added
- Fichier `VERSION` (source de vérité unique), exposé via `/api/version` et affiché dans la topbar.
- `spark.spec` / `build.bat` nomment désormais l'exécutable de sortie `Spark-<version>.exe` d'après `VERSION`.
- `build.bat` génère en fin de build une archive versionnée `Spark-<version>.zip` du dossier `Spark/` (voir note ci-dessous sur le choix zip vs. installeur).
- `verify.bat` : lance `pytest tests/` puis les tests JS (`test_frais_fiscalite.mjs`, `test_regimes_fiscaux.mjs`), s'arrête net au premier échec. `build.bat` l'appelle en première étape et abandonne le build si un test échoue.

### Fixed
- Isolation des tests Python : `tests/test_calculs_py.py` laissait un stub `sys.modules['config']` incomplet après son import, ce qui faisait échouer `tests/test_enrich.py` uniquement quand la suite complète tournait (jamais en exécution isolée).

### Note — zip versionné plutôt qu'un installeur
Un vrai installeur (Inno Setup) demanderait d'installer et maintenir un outil supplémentaire, un script `.iss` séparé à tenir à jour à chaque release, et n'apporte rien pour une app 100% locale sans auto-update et sans besoin d'un assistant d'installation Windows (pas de clé de registre, pas de désinstalleur à fournir). Un zip versionné du dossier `Spark/` est suffisant : décompresser et lancer `Spark-<version>.exe` fait le travail, avec un seul point de maintenance (`build.bat`).
```

- [x] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md (Keep a Changelog format)"
```

---

### Task 5: `verify.bat`

**Files:**
- Create: `verify.bat`

**Interfaces:**
- Consumes: `tests/` (pytest suite, fixed in Task 1), `tests/test_frais_fiscalite.mjs`, `tests/test_regimes_fiscaux.mjs` (existing, run via plain `node <file>`, confirmed to exit non-zero on assertion failure — Node's default behavior for an uncaught exception).
- Produces: an exit code (`0` success, `1` first failure) and a `CALLED_FROM_BUILD` env-var convention that Task 6's `build.bat` sets before calling this script (so `verify.bat` doesn't `pause` when invoked non-interactively from `build.bat`, but does pause when double-clicked directly).

- [x] **Step 1: Create `verify.bat`**

```batch
@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ====================================================
echo   Spark Investissement - Verification
echo ====================================================
echo.

echo [1/3] Tests Python (pytest tests/)...
python -m pytest tests/ -q
if errorlevel 1 (
  echo.
  echo ECHEC : les tests Python ne passent pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo [2/3] Tests JS - fiscalite des travaux...
node tests\test_frais_fiscalite.mjs
if errorlevel 1 (
  echo.
  echo ECHEC : tests\test_frais_fiscalite.mjs ne passe pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo [3/3] Tests JS - regimes fiscaux...
node tests\test_regimes_fiscaux.mjs
if errorlevel 1 (
  echo.
  echo ECHEC : tests\test_regimes_fiscaux.mjs ne passe pas. Verification interrompue.
  if not defined CALLED_FROM_BUILD pause
  exit /b 1
)

echo.
echo ====================================================
echo   Verification OK - tous les tests passent
echo ====================================================
if not defined CALLED_FROM_BUILD pause
exit /b 0
```

- [x] **Step 2: Verify the success path**

Run: `verify.bat` (or `cmd /c verify.bat` non-interactively to skip the pause)
Expected: all three steps print OK, final banner "Verification OK", exit code 0. Confirm with: `echo %errorlevel%` after running (or check via `cmd /c verify.bat & echo EXIT=%errorlevel%`).

- [x] **Step 3: Verify the failure path stops at the first failure**

Temporarily break a Python test to prove `verify.bat` stops before even reaching the JS tests: edit `tests/test_calculs.py`'s `test_mensualite_basique` to `assert False` temporarily, run `verify.bat`, confirm it prints the Python failure message and exits without ever printing "[2/3]", then revert the temporary edit (`git diff tests/test_calculs.py` should be empty again before moving on — do not commit the broken version).

- [x] **Step 4: Commit**

```bash
git add verify.bat
git commit -m "build: add verify.bat (pytest + JS tests, stop on first failure)"
```

---

### Task 6: Harden `build.bat` + version-based exe naming in `spark.spec`

**Files:**
- Modify: `spark.spec:1-64`
- Modify: `build.bat` (full rewrite of the existing 78 lines)
- Modify: `.gitignore` (add versioned zip artifact pattern)

**Interfaces:**
- Consumes: `VERSION` file (Task 2), `verify.bat` (Task 5, sets `CALLED_FROM_BUILD=1` before calling it).
- Produces: `Spark/Spark-<version>.exe`, `Spark-<version>.zip` at repo root. Nothing else in this plan consumes these.

- [x] **Step 1: Make `spark.spec` read `VERSION` and name the exe after it**

In `spark.spec`, right after the existing `sys.path.insert(0, ...)` line (`spark.spec:3`), add:

```python
# -*- mode: python ; coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(SPEC), 'scraper'))

with open(os.path.join(os.path.dirname(SPEC), 'VERSION'), encoding='utf-8') as _f:
    _version = _f.read().strip()

from PyInstaller.utils.hooks import collect_all, collect_submodules
```

Then change the `EXE(...)` block's `name` argument (`spark.spec:56`) from:

```python
    name='Spark',
```

to:

```python
    name=f'Spark-{_version}',
```

Leave the `COLLECT(...)` block's `name='Spark'` (`spark.spec:73`) unchanged — the output **folder** stays `Spark/` across versions (so `build.bat`'s static-file copy step and the desktop shortcut logic don't need to track a moving folder name); only the **exe inside it** carries the version.

- [x] **Step 2: Rewrite `build.bat`**

Replace the full contents of `build.bat` with:

```batch
@echo off
chcp 65001 >nul
echo.
echo ====================================================
echo   Spark Investissement - Build
echo ====================================================
echo.

cd /d "%~dp0"

set /p VERSION=<VERSION

:: Verification (tests) — abandon du build si un test echoue
echo [1/5] Verification (tests)...
set CALLED_FROM_BUILD=1
call verify.bat
if errorlevel 1 (
  echo ERREUR : la verification a echoue. Build abandonne.
  pause
  exit /b 1
)

:: Convertit Logo_site.png en .ico pour l'exe
echo [2/5] Creation de l'icone...
python -c "from PIL import Image; img = Image.open('Logo_site.png').convert('RGBA'); img.save('spark.ico')"
if errorlevel 1 (
  echo ERREUR : PIL manquant. Lance : pip install pillow
  pause
  exit /b 1
)

:: Compilation PyInstaller
echo [3/5] Compilation avec PyInstaller (version %VERSION%)...
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
echo [4/5] Copie des fichiers statiques...
set DEST=Spark
copy /Y VERSION         "%DEST%\" >nul
copy /Y index.html      "%DEST%\" >nul
copy /Y main.js         "%DEST%\" >nul
copy /Y calculs.js      "%DEST%\" >nul
copy /Y pdf.js          "%DEST%\" >nul
copy /Y ui.js           "%DEST%\" >nul
copy /Y scanner.js      "%DEST%\" >nul
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
echo [5/5] Creation du raccourci bureau + archive versionnee...
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
```

- [x] **Step 3: Ignore the versioned zip artifact**

In `.gitignore`, right after the existing `# Build artifacts` block (`.gitignore:1-4`):

```
# Build artifacts
build/
dist/
Spark/
Spark-*.zip
```

- [x] **Step 4: Run the full build end-to-end**

Run: `build.bat`
Expected:
- Step `[1/5]` runs `verify.bat` and passes (proves Task 1's fix + Task 5's script work together).
- Step `[3/5]` produces `Spark\Spark-1.0.0.exe` (not `Spark\Spark.exe`).
- Step `[5/5]` produces a desktop shortcut pointing at `Spark-1.0.0.exe`, and `Spark-1.0.0.zip` at the repo root.
- Final summary shows version `1.0.0`, the exe path, an approximate size in MB, and the zip name.
- Double-click the desktop shortcut (or launch `Spark\Spark-1.0.0.exe` directly) and confirm the app opens and the topbar shows "v1.0.0" (ties back to Task 3).

- [x] **Step 5: Commit**

```bash
git add spark.spec build.bat .gitignore
git commit -m "build: version-named exe (Spark-<version>.exe), verify.bat gate, versioned zip, robust failure handling"
```

---

### Task 7: Update `CODEBASE_MAP.md`

**Files:**
- Modify: `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: the final state of every file touched in Tasks 1-6.
- Produces: nothing (documentation leaf).

- [x] **Step 1: Update the `app.py` entry**

In `CODEBASE_MAP.md`, under `## app.py`, add a line noting the version constant:

```markdown
## app.py
Entrée desktop : lance Flask en thread (`threaded=True`) + fenêtre PyWebView + icône barre système.
- `__version__` — lu depuis le fichier `VERSION` à la racine (source de vérité unique, aussi lue par `server.py`/`spark.spec`/`build.bat`), `'dev'` si absent.
Pas de fonctions exportées — exécuté directement par `python app.py` ou PyInstaller.
```

- [x] **Step 2: Update the `server.py` entry**

Add one bullet to the existing `## server.py` list (alongside `api_communes`, etc.):

```markdown
- `api_version` GET `/api/version` — lit le fichier `VERSION` à la racine, retourne `{version}` (`'dev'` si absent)
```

- [x] **Step 3: Update the `main.js` entry**

Add one line to `## main.js` noting the version fetch:

```markdown
- Bootstrap : fetch `/api/version` au démarrage → affiche `vX.Y.Z` dans `#topbar-version` (topbar)
```

- [x] **Step 4: Add a "Build & outillage" section**

Append a new section at the end of `CODEBASE_MAP.md`:

```markdown
## VERSION
Fichier texte à la racine, source de vérité unique du numéro de version (`X.Y.Z`). Lu indépendamment par `app.py` (`__version__`), `server.py` (`/api/version`), `spark.spec` (nom de l'exe) et `build.bat` (raccourci + résumé) — pas d'import possible entre eux vu l'ordre de chargement des modules.

---

## CHANGELOG.md
Journal des versions (format Keep a Changelog) — à mettre à jour à chaque release.

---

## verify.bat
Vérification locale : `pytest tests/` puis `tests/test_frais_fiscalite.mjs` et `tests/test_regimes_fiscaux.mjs`, s'arrête net (exit non-zero) au premier échec. Appelé par `build.bat` en première étape (variable `CALLED_FROM_BUILD` pour ne pas `pause` en mode non-interactif).

---

## build.bat
Build de production : appelle `verify.bat` (abandonne si échec), compile via `spark.spec` (exe nommé `Spark-<version>.exe` d'après `VERSION`), copie les fichiers statiques dans `Spark\`, crée le raccourci bureau et une archive `Spark-<version>.zip`.

---

## spark.spec
Config PyInstaller. Lit `VERSION` à la racine pour nommer l'exe `Spark-<version>.exe` ; le dossier `COLLECT` reste nommé `Spark` (stable d'une version à l'autre).
```

- [x] **Step 5: Commit**

```bash
git add CODEBASE_MAP.md
git commit -m "docs: update CODEBASE_MAP.md for versioning/build/verify changes"
```

---

## After this plan: coverage audit (reporting only, no task)

The user asked to audit current test coverage of `calculs.js` / `scraper/calculs.py` and propose a prioritized list of missing cases — explicitly **not** asking for all of them to be written now. This is a reporting deliverable, not a code task: after Task 7 is done and the build has been proven end-to-end, present (in chat, not as a new repo file) a prioritized gap list covering at least:
- `calculs.js`: `computeCF`/`computeProjectMetrics` (DSCR, GRM, CoC — the core per-asset KPIs, currently untested directly), `calculateTMI`/`getHouseholdTaxParts` (bracket edges), `computeRegimeComparison`/`getOptimalRegime` (only reached indirectly via `computeCFBreakdown` today), `computeCompteResultat`/`computeDeclaration2044` (tax-form output, highest blast radius if wrong), `computeAmortizationSchedule`/`computePatrimoineNet`.
- `scraper/calculs.py`: `enrichir()` end-to-end (only its private helpers `_mensualite_credit`/`_cf_*` are unit-tested today) and `_score()` (untested).

Do not write these tests speculatively as part of this plan — only the prioritized list is owed here.

## Execution note

This plan was written and will be executed inline in the current session (`superpowers:executing-plans`) rather than dispatched to fresh subagents per task — the investigation above (the config-stub bug, the exact file layout) is already loaded in context, and Task 6's build needs to be run and watched directly. Say if you'd prefer subagent-driven execution instead.
